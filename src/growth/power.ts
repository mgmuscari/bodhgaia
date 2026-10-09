// Power grid: the SC1989-style conduction model. Any built tile conducts, so the
// grid = the 4-connected components of the built layer. A component with a plant is
// energized; its consumer parcels (R/C/I/Civic) draw power up to the component's
// total plant capacity. In the live game demand varies by hour and building
// (demandAt) and a short grid sheds whole FEEDERS in a rotating order — rolling
// blackouts. Without a clock (worldgen checks, tests) the static solve sheds the
// FARTHEST-from-source consumers first (multi-source BFS distance; ties by anchor). Pure + deterministic in (map, parcels). Engine-
// layer discipline (the src/growth fail-closed guard): no DOM, no transcendental
// Math, no ui import. Recomputed live on a cadence (derived from the hashed built
// layer), like land value — never hashed itself.

import { ParcelStore, BuiltKind } from '../engine/fabric';
import type { GameMap } from '../engine/map';
import { ZoneType, zoneTypeOf } from '../engine/zone';

/**
 * Generation capacity per plant kind (relative SC2000-ish scale). Rebalanced ×7 (Maddy 2026-09-30):
 * the legacy fleet worldgen sites (2 coal + 2 gas = 1540) carries a typical seeded city through the
 * day; the evening residential peak is what browns it out (~85–90% lit on a mid-size seed, ~60% on
 * the largest), so the grid reads MOSTLY powered with rolling blackouts that motivate clean power.
 */
export const PLANT_OUTPUT: ReadonlyMap<number, number> = new Map<number, number>([
  [BuiltKind.CoalPlant, 420],
  [BuiltKind.GasPlant, 350],
  [BuiltKind.HydroPlant, 245],
  [BuiltKind.NuclearPlant, 1400],
  [BuiltKind.WindTurbine, 56],
  [BuiltKind.SolarPlant, 210],
  [BuiltKind.FusionPlant, 3500],
  [BuiltKind.EnergyNode, 168], // a solar canopy over its battery: this at noon, nothing at night (Maddy 2026-10-08)
]);

/** The practices' power effects (resolved tech-side, tech/effects.ts — passed as plain values). */
export interface PowerPractices {
  /** Multiplier on home demand by day, ROOF_SOLAR_FROM..ROOF_SOLAR_TO (Sun and Wire: rooftop solar). */
  homeDayDemand: number;
  /** Multiplier on hydro, wind and solar output (Renewable Energy). */
  renewableOutput: number;
  /** Homes within LOCAL_GRID_RADIUS of an energy node are served first in a blackout (Local Grids). */
  localGrids: boolean;
}

export const NEUTRAL_POWER_PRACTICES: Readonly<PowerPractices> = Object.freeze({
  homeDayDemand: 1,
  renewableOutput: 1,
  localGrids: false,
});

/** The daylight hours rooftop solar covers (from inclusive, to exclusive). */
export const ROOF_SOLAR_FROM = 7;
export const ROOF_SOLAR_TO = 18;
/** How far (Chebyshev, from its footprint) an energy node's local grid reaches. */
export const LOCAL_GRID_RADIUS = 4;
/** The plants Renewable Energy boosts. */
export const RENEWABLE_KINDS: ReadonlySet<number> = new Set<number>([BuiltKind.HydroPlant, BuiltKind.WindTurbine, BuiltKind.SolarPlant]);

// Power demand per unit density, by zone class. Industry is the hungriest, homes the
// least — the classic R<C<I load curve. Civic services draw a flat-ish mid load.
const DEMAND_PER_DENSITY: ReadonlyMap<ZoneType, number> = new Map<ZoneType, number>([
  [ZoneType.Residential, 1],
  [ZoneType.Commercial, 2],
  [ZoneType.Industrial, 3],
  [ZoneType.Civic, 2],
]);

// Air pollution emitted per stepAmbient pass by the DIRTY combustion plants — coal
// the worst, gas cleaner. Hydro/Nuclear/Wind/Solar/Fusion and the distributed
// EnergyNode are clean (0), so the renewable transition visibly clears the smog.
const PLANT_POLLUTION: ReadonlyMap<number, number> = new Map<number, number>([
  [BuiltKind.CoalPlant, 6],
  [BuiltKind.GasPlant, 4],
]);

/** A parcel's power output (plant) — 0 for non-plants. */
export function plantOutput(kind: number): number {
  return PLANT_OUTPUT.get(kind) ?? 0;
}

/** Air pollution a plant emits per pass — 0 for clean plants and non-plants. */
export function plantPollution(kind: number): number {
  return PLANT_POLLUTION.get(kind) ?? 0;
}

/** A parcel's power demand from its kind + density — 0 for non-consumers (greens/transport/plants). */
export function powerDemand(kind: number, density: number): number {
  const per = DEMAND_PER_DENSITY.get(zoneTypeOf(kind)) ?? 0;
  return per * (density > 0 ? density : 0);
}

/** True iff a kind draws power (an R/C/I/Civic consumer) — never a source: an energy node is civic but feeds the
 *  grid, and read as "unpowered" for want of a supply it is itself (Maddy 2026-10-08). */
export function isPowerConsumer(kind: number): boolean {
  return DEMAND_PER_DENSITY.has(zoneTypeOf(kind)) && !PLANT_OUTPUT.has(kind);
}

// ── Time-varying demand ───────────────────────────────────────────────────────────────────────────
// A building's load is its base demand (the daily MEAN) × its zone's hour-of-day profile, phase-shifted
// ±2 h and jittered ±30% per building (redrawn each in-game hour). Pure integer hashing — no rng, no
// transcendental Math — so it stays deterministic in (map, parcels, clock).

/** The in-game time the grid is solved for: hour of day 0..23, and a monotonic hour counter. */
export interface GridClock {
  hour: number;
  slot: number;
}

// Hand-shaped daily curves (relative), normalized below to a mean of exactly 100%.
const RAW_PROFILE: ReadonlyMap<ZoneType, readonly number[]> = new Map<ZoneType, readonly number[]>([
  // homes: quiet nights, a breakfast bump, the big evening peak (lights, cooking, screens)
  [ZoneType.Residential, [55, 48, 45, 45, 48, 62, 85, 100, 92, 75, 68, 68, 68, 68, 70, 78, 95, 120, 140, 150, 145, 130, 105, 78]],
  // shops + offices: the working day
  [ZoneType.Commercial, [30, 28, 28, 28, 30, 35, 50, 75, 100, 115, 120, 120, 120, 120, 120, 120, 115, 110, 100, 85, 65, 50, 40, 35]],
  // industry: round the clock, a shallow daytime shift peak
  [ZoneType.Industrial, [80, 78, 78, 78, 80, 85, 95, 105, 110, 110, 110, 110, 110, 110, 110, 110, 108, 100, 95, 90, 88, 85, 82, 80]],
  // civic: office hours
  [ZoneType.Civic, [40, 40, 40, 40, 40, 45, 60, 90, 110, 115, 115, 115, 115, 115, 115, 110, 100, 80, 65, 55, 50, 45, 42, 40]],
]);

const PROFILE: ReadonlyMap<ZoneType, readonly number[]> = new Map(
  [...RAW_PROFILE].map(([z, raw]) => {
    const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
    return [z, raw.map((v) => (v * 100) / mean)] as const;
  }),
);

/** Percent of base demand a zone draws at `hour` (0..23; wraps). Daily mean = 100. */
export function loadProfile(zone: ZoneType, hour: number): number {
  const curve = PROFILE.get(zone);
  if (!curve) return 100;
  return curve[((hour % 24) + 24) % 24]!;
}

/** Deterministic non-negative integer hash (direction-neutral, like tieHash). */
function mix(a: number, b: number, seed: number): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b1, 0x85ebca6b);
  h = Math.imul(h ^ ((b | 0) + 0x27d4eb2f), 0xc2b2ae35);
  h = Math.imul(h ^ seed, 0x165667b1);
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * One building's demand at `clock`: base × its zone profile (phase-shifted −2..+2 h by anchor, so the
 * whole city doesn't peak on the same hour) × a 70..130% draw re-rolled every in-game hour.
 */
export function demandAt(kind: number, density: number, anchor: number, clock: GridClock): number {
  const base = powerDemand(kind, density);
  if (base === 0) return 0;
  const phase = (mix(anchor, 0, 11) % 5) - 2;
  const jitter = 70 + (mix(anchor, clock.slot, 12) % 61);
  return (base * loadProfile(zoneTypeOf(kind), clock.hour + phase) * jitter) / 10000;
}

/** The home anchors inside an energy node's local grid (Local Grids). */
function localGridAnchors(map: GameMap, parcels: ParcelStore): Set<number> {
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const i of parcels.aliveIndices()) {
    const p = parcels.get(i);
    if (p.kind !== BuiltKind.EnergyNode) continue;
    const r = LOCAL_GRID_RADIUS;
    boxes.push({ x0: p.x - r, y0: p.y - r, x1: p.x + p.width - 1 + r, y1: p.y + p.height - 1 + r });
  }
  const out = new Set<number>();
  if (boxes.length === 0) return out;
  for (const i of parcels.aliveIndices()) {
    const p = parcels.get(i);
    if (zoneTypeOf(p.kind) !== ZoneType.Residential) continue;
    if (boxes.some((b) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1)) out.add(map.idx(p.x, p.y));
  }
  return out;
}

// ── Wind and sun ──────────────────────────────────────────────────────────────────────────────────
// With a clock (the live game), solar follows the sun and wind gusts hour to hour, blowing harder by night —
// so the evening peak needs wind, energy nodes or steady plants, not just panels. Without one (worldgen,
// static solves) every plant runs at its nameplate.

/** Share of nameplate a solar plant makes at `hour`: full at noon, falling linearly to 0 at 06:00 and 18:00. */
export function solarFactor(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const f = 1 - Math.abs(h - 12) / 6;
  return f > 0 ? f : 0;
}

/** Share of nameplate a wind turbine makes this hour: a gust re-drawn each in-game hour (0.6..1.4) × a night
 *  bias (×1.15 from 20:00 to 06:00, ×0.85 by day), held to 0.4..1.6. Deterministic in the clock. */
export function windFactor(clock: GridClock): number {
  const h = ((clock.hour % 24) + 24) % 24;
  const night = h >= 20 || h < 6;
  const gust = 0.6 + (mix(clock.slot, 0, 21) % 81) / 100;
  const f = (night ? 1.15 : 0.85) * gust;
  return f < 0.4 ? 0.4 : f > 1.6 ? 1.6 : f;
}

// ── The smart grid (Community AI Node) ───────────────────────────────────────────────────────────────
/** Homes within SMART_GRID_RADIUS (Chebyshev) of a Community AI Node shift flexible load (laundry, charging,
 *  water heating) off the evening peak: they draw SMART_GRID_CUT less from SMART_GRID_FROM to SMART_GRID_TO. */
export const SMART_GRID_RADIUS = 8;
export const SMART_GRID_CUT = 0.2;
export const SMART_GRID_FROM = 17;
export const SMART_GRID_TO = 21;

/** The share of its demand a consumer at `anchor` draws at `clock` under the smart grid (1 = untouched). */
export function smartGridFactor(map: GameMap, anchor: number, clock: GridClock): number {
  const h = ((clock.hour % 24) + 24) % 24;
  if (h < SMART_GRID_FROM || h >= SMART_GRID_TO) return 1;
  if (zoneTypeOf(map.built[anchor]!) !== ZoneType.Residential) return 1;
  const x = anchor % map.width;
  const y = (anchor - x) / map.width;
  const r = SMART_GRID_RADIUS;
  for (let yy = Math.max(0, y - r); yy <= Math.min(map.height - 1, y + r); yy++) {
    for (let xx = Math.max(0, x - r); xx <= Math.min(map.width - 1, x + r); xx++) {
      if (map.built[yy * map.width + xx] === BuiltKind.AINode) return 1 - SMART_GRID_CUT;
    }
  }
  return 1;
}

function weatherFactor(kind: number, clock: GridClock | undefined): number {
  if (!clock) return 1;
  if (kind === BuiltKind.SolarPlant || kind === BuiltKind.EnergyNode) return solarFactor(clock.hour); // panels follow the sun
  if (kind === BuiltKind.WindTurbine) return windFactor(clock);
  return 1;
}

// ── Batteries (Maddy 2026-10-07: the solar problem) ─────────────────────────────────────────────────────
/** Every energy node is a solar canopy over a battery (Maddy 2026-10-08): the canopy makes power by day (its output
 *  follows the sun), and the battery stores up to BATTERY_CAPACITY power-hours, charging from its grid's surplus (its
 *  own and the grid's) and discharging into its grid's shortfall at up to BATTERY_RATE an hour — so the noon sun
 *  lights the evening. Only clocked (live) solves move the charge. */
export const BATTERY_RATE = 168;
export const BATTERY_CAPACITY = 4 * BATTERY_RATE;

// ── Rolling blackouts ─────────────────────────────────────────────────────────────────────────────
// A short grid sheds whole FEEDERS (FEEDER×FEEDER-tile blocks), never scattered single homes, and the
// order feeders are served in is re-drawn every ROTATION_HOURS — so the dark patch moves around the
// city instead of the same fringe always losing.

export const FEEDER = 8;
export const ROTATION_HOURS = 3;

/** The feeder (distribution block) a tile belongs to. */
export function feederOf(map: GameMap, tile: number): number {
  const x = tile % map.width;
  const y = (tile - x) / map.width;
  const cols = Math.ceil(map.width / FEEDER);
  return Math.floor(y / FEEDER) * cols + Math.floor(x / FEEDER);
}

export interface PowerGrid {
  /** Anchor tiles of consumer parcels that ARE powered this tick. */
  poweredAnchors: Set<number>;
  /** Each energy node's battery charge after this hour (anchor → stored power-hours). */
  storage: Map<number, number>;
  /** Total generation capacity across all plants on the map. */
  capacity: number;
  /** Total demand across all consumer parcels. */
  demand: number;
}

interface ConsumerRef {
  anchor: number;
  demand: number;
}

/**
 * Compute the live power grid: flood-fill the built layer into conductive
 * components, then per component with a plant, power its consumers greedily
 * (ascending anchor) up to the component's capacity — the rest brown out. Consumers
 * in a plantless component are unpowered. Returns the powered consumer anchors plus
 * global capacity/demand totals. Pure + deterministic.
 */
export function computePowerGrid(
  map: GameMap,
  parcels: ParcelStore,
  clock?: GridClock,
  practices: PowerPractices = NEUTRAL_POWER_PRACTICES,
  storageIn: ReadonlyMap<number, number> = new Map(),
): PowerGrid {
  const storage = new Map(storageIn);
  const size = map.width * map.height;
  const built = map.built;

  // 1. 4-connected components over built tiles (ascending-index scan, BFS).
  const comp = new Int32Array(size).fill(-1);
  let nComp = 0;
  const queue: number[] = [];
  for (let start = 0; start < size; start++) {
    if (built[start] === 0 || comp[start] !== -1) continue;
    const id = nComp++;
    comp[start] = id;
    queue.length = 0;
    queue.push(start);
    while (queue.length > 0) {
      const t = queue.pop()!;
      const x = t % map.width;
      const y = (t - x) / map.width;
      const neigh = [
        x > 0 ? t - 1 : -1,
        x < map.width - 1 ? t + 1 : -1,
        y > 0 ? t - map.width : -1,
        y < map.height - 1 ? t + map.width : -1,
      ];
      for (const n of neigh) {
        if (n >= 0 && built[n] !== 0 && comp[n] === -1) {
          comp[n] = id;
          queue.push(n);
        }
      }
    }
  }

  // 2. Bucket plant capacity + consumer demand by component; collect plant footprint tiles as the
  //    BFS sources for the distance-from-source ordering below.
  let hasAiNode = false;
  for (const i of parcels.aliveIndices()) if (parcels.kindAt(i) === BuiltKind.AINode) hasAiNode = true;
  const capByComp = new Float64Array(nComp);
  const nodesByComp: number[][] = Array.from({ length: nComp }, () => []);
  const consumersByComp: ConsumerRef[][] = Array.from({ length: nComp }, () => []);
  const plantTiles: number[] = [];
  let capacity = 0;
  let demand = 0;
  for (const i of parcels.aliveIndices()) {
    const p = parcels.get(i);
    const anchor = map.idx(p.x, p.y);
    const c = comp[anchor]!;
    if (c < 0) continue;
    const out = plantOutput(p.kind) * (RENEWABLE_KINDS.has(p.kind) ? practices.renewableOutput : 1) * weatherFactor(p.kind, clock);
    if (p.kind === BuiltKind.EnergyNode) nodesByComp[c]!.push(anchor);
    if (out > 0) {
      capByComp[c] = capByComp[c]! + out;
      capacity += out;
      for (let dy = 0; dy < p.height; dy++) {
        for (let dx = 0; dx < p.width; dx++) plantTiles.push(map.idx(p.x + dx, p.y + dy));
      }
      continue;
    }
    if (plantOutput(p.kind) > 0) continue; // a source in the dark (a canopy at night) still draws nothing
    let d = clock ? demandAt(p.kind, p.density, anchor, clock) : powerDemand(p.kind, p.density);
    // rooftop solar: homes draw less while the sun is up
    const day = !!clock && clock.hour >= ROOF_SOLAR_FROM && clock.hour < ROOF_SOLAR_TO;
    if (day && practices.homeDayDemand !== 1 && zoneTypeOf(p.kind) === ZoneType.Residential) d *= practices.homeDayDemand;
    if (clock && hasAiNode) d *= smartGridFactor(map, anchor, clock);
    if (d > 0) {
      consumersByComp[c]!.push({ anchor, demand: d });
      demand += d;
    }
  }

  // 2b. Distance from the nearest power source, by network distance through the conducting built
  //     layer — a multi-source BFS seeded from every plant tile. Powers flow from the source OUTWARD,
  //     so a brownout sheds the FARTHEST plots first (Maddy: plots nearer the source get power first).
  const dist = new Int32Array(size).fill(-1);
  const bfs: number[] = [];
  for (const t of plantTiles) {
    if (dist[t] === -1) {
      dist[t] = 0;
      bfs.push(t);
    }
  }
  for (let head = 0; head < bfs.length; head++) {
    const t = bfs[head]!;
    const x = t % map.width;
    const y = (t - x) / map.width;
    const neigh = [
      x > 0 ? t - 1 : -1,
      x < map.width - 1 ? t + 1 : -1,
      y > 0 ? t - map.width : -1,
      y < map.height - 1 ? t + map.width : -1,
    ];
    for (const n of neigh) {
      if (n >= 0 && built[n] !== 0 && dist[n] === -1) {
        dist[n] = dist[t]! + 1;
        bfs.push(n);
      }
    }
  }

  const poweredAnchors = new Set<number>();

  // 3a. With a clock (the live game): serve whole feeders in a rotating order; a feeder that doesn't fit
  //     the remaining budget goes dark as a block (a smaller one later in the order may still fit).
  if (clock) {
    const rotation = Math.floor(clock.slot / ROTATION_HOURS);
    const local = practices.localGrids ? localGridAnchors(map, parcels) : null;
    for (let c = 0; c < nComp; c++) {
      let budget = capByComp[c]!;
      // batteries: bank the surplus, or cover the shortfall from the bank — a grid with no sun left runs on them
      let load = 0;
      for (const cons of consumersByComp[c]!) load += cons.demand;
      let gap = budget - load;
      for (const node of nodesByComp[c]!) {
        const s0 = storage.get(node) ?? 0;
        if (gap > 0) {
          const add = Math.min(BATTERY_RATE, BATTERY_CAPACITY - s0, gap);
          if (add > 0) storage.set(node, s0 + add);
          gap -= Math.max(0, add);
        } else if (gap < 0 && s0 > 0) {
          const take = Math.min(BATTERY_RATE, s0, -gap);
          storage.set(node, s0 - take);
          budget += take;
          gap += take;
        }
      }
      if (budget <= 0) continue;
      const feeders = new Map<number, ConsumerRef[]>();
      for (const cons of consumersByComp[c]!) {
        // Local Grids: the homes an energy node holds are served before any feeder takes its turn
        if (local?.has(cons.anchor) && cons.demand <= budget) {
          budget -= cons.demand;
          poweredAnchors.add(cons.anchor);
          continue;
        }
        const f = feederOf(map, cons.anchor);
        const list = feeders.get(f);
        if (list) list.push(cons);
        else feeders.set(f, [cons]);
      }
      const order = [...feeders.keys()].sort((a, b) => mix(a, rotation, 13) - mix(b, rotation, 13) || a - b);
      for (const f of order) {
        const members = feeders.get(f)!;
        const load = members.reduce((sum, m) => sum + m.demand, 0);
        if (load > budget) continue; // rolling blackout: this block sits this rotation out
        budget -= load;
        for (const m of members) poweredAnchors.add(m.anchor);
      }
    }
    return { poweredAnchors, storage, capacity, demand };
  }

  // 3b. Static solve (no clock — worldgen checks and tests): power consumers per component within its
  //     capacity, NEAREST the source first (ties by anchor for determinism), so the grid lights up around
  //     its plants and the brownout dims the far edges.
  for (let c = 0; c < nComp; c++) {
    let budget = capByComp[c]!;
    if (budget <= 0) continue; // plantless component → all dark
    const consumers = consumersByComp[c]!;
    consumers.sort((a, b) => dist[a.anchor]! - dist[b.anchor]! || a.anchor - b.anchor);
    for (const cons of consumers) {
      if (budget >= cons.demand) {
        budget -= cons.demand;
        poweredAnchors.add(cons.anchor);
      }
    }
  }

  return { poweredAnchors, storage, capacity, demand };
}
