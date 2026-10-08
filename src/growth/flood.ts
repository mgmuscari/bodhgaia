// Floods (docs/design/disasters.md): heavy rain lifts the water over the low land beside it. Simulation-side, like
// fire, because the water damages the hashed stock (building condition). Deterministic in (world, the hour, whether
// the hour's rain is heavy). Engine-layer discipline: no DOM, no transcendental Math, no ui.
//
// - The plain: land connected to the water and lying within FLOOD_RISE of the shoreline water's level, at most
//   FLOOD_REACH tiles in — each tile's distance from the water is its depth in the plain.
// - Each hour of heavy rain the flood climbs FLOOD_CLIMB; each other hour it recedes FLOOD_RECEDE. A plain tile is
//   under water while the flood stands above its threshold: its distance in, scaled by the ground around it —
//   paving sheds the rain onto it (lower), greens, gardens, rewilded land and forest soak it up (higher).
// - A building with water on its footprint loses FLOOD_DAMAGE condition each hour it stands in it.
// - A retention pond holds the storm: no plain tile within POND_REACH of one floods (Maddy 2026-10-08).

import { BuiltKind, isRoadKind, type ParcelStore } from '../engine/fabric';
import { LandCover, type GameMap } from '../engine/map';

/** How far above the shoreline water's level land can lie and still flood (elevation is 0..1). */
export const FLOOD_RISE = 0.035;
/** The plain is at most this many tiles from the water. */
export const FLOOD_REACH = 10;
/** Flood level gained per heavy-rain hour, and lost per other hour (level 1 reaches the plain's far edge on
 *  neutral ground). */
export const FLOOD_CLIMB = 0.1;
export const FLOOD_RECEDE = 0.08;
/** A retention pond keeps every plain tile within this many tiles of it dry (Euclidean, from any of its tiles). */
export const POND_REACH = 8;
/** Condition a building loses each hour it stands in water. */
export const FLOOD_DAMAGE = 6;
/** How much each paved / soaking tile within SOAK_RADIUS moves a tile's threshold (×). */
const PAVE_SHED = 0.03;
const GREEN_SOAK = 0.06;
const SOAK_RADIUS = 2;

const SOAKERS: ReadonlySet<number> = new Set<number>([BuiltKind.Park, BuiltKind.CommunityGarden, BuiltKind.RewildedLand, BuiltKind.Parklet, BuiltKind.Yard]);

/** The flood plain: plain tile → its distance from the water (1 = the shore). */
export function floodPlain(map: GameMap): Map<number, number> {
  const plain = new Map<number, number>();
  const ref = new Map<number, number>(); // the water level each plain tile was reached from
  let frontier: number[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = map.idx(x, y);
      if (map.water[i] === 0) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (!map.inBounds(x + dx, y + dy)) continue;
        const n = map.idx(x + dx, y + dy);
        if (map.water[n] !== 0 || plain.has(n)) continue;
        if (map.elevation[n]! > map.elevation[i]! + FLOOD_RISE) continue;
        plain.set(n, 1);
        ref.set(n, map.elevation[i]!);
        frontier.push(n);
      }
    }
  }
  for (let d = 2; d <= FLOOD_REACH && frontier.length > 0; d++) {
    const next: number[] = [];
    for (const t of frontier) {
      const x = t % map.width;
      const y = (t - x) / map.width;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (!map.inBounds(x + dx, y + dy)) continue;
        const n = map.idx(x + dx, y + dy);
        if (map.water[n] !== 0 || plain.has(n)) continue;
        if (map.elevation[n]! > ref.get(t)! + FLOOD_RISE) continue;
        plain.set(n, d);
        ref.set(n, ref.get(t)!);
        next.push(n);
      }
    }
    frontier = next;
  }
  return plain;
}

export interface FloodState {
  plain: Map<number, number>;
  /** 0 = dry; rises with heavy rain. */
  level: number;
  /** The tiles under water now. */
  flooded: Set<number>;
  lastHour?: number;
}

export function createFloodState(map: GameMap): FloodState {
  return { plain: floodPlain(map), level: 0, flooded: new Set() };
}

/** The level a plain tile floods at: its distance in, scaled by the ground around it. */
function threshold(map: GameMap, t: number, dist: number): number {
  const x = t % map.width;
  const y = (t - x) / map.width;
  let scale = 1;
  for (let dy = -SOAK_RADIUS; dy <= SOAK_RADIUS; dy++) {
    for (let dx = -SOAK_RADIUS; dx <= SOAK_RADIUS; dx++) {
      if (!map.inBounds(x + dx, y + dy)) continue;
      const n = map.idx(x + dx, y + dy);
      const k = map.built[n]!;
      if (SOAKERS.has(k) || (k === BuiltKind.None && map.landCover[n] === LandCover.Forest)) scale += GREEN_SOAK;
      else if (isRoadKind(k) || k === BuiltKind.ParkingLot) scale -= PAVE_SHED;
    }
  }
  return ((dist - 0.5) / FLOOD_REACH) * Math.max(0.4, scale); // the shore goes under in the first heavy hour
}

export interface FloodEvents {
  /** Did the flood move this call (a new hour)? Otherwise the lists are empty because nothing happened. */
  stepped: boolean;
  /** Tiles that went under / came out of water this hour. */
  rose: number[];
  fell: number[];
  /** Buildings (store index) with water on their footprint this hour (each lost FLOOD_DAMAGE). */
  underWater: number[];
}

/** One flood step: once per in-game hour, climb (heavy rain) or recede, then damage what stands in the water. */
export function stepFlood(world: { map: GameMap; parcels: ParcelStore }, f: FloodState, opts: { hour?: number; heavy: boolean }): FloodEvents {
  const ev: FloodEvents = { stepped: false, rose: [], fell: [], underWater: [] };
  if (opts.hour === undefined || opts.hour === f.lastHour) return ev;
  ev.stepped = true;
  f.lastHour = opts.hour;
  const { map, parcels } = world;
  f.level = opts.heavy ? Math.min(1.5, f.level + FLOOD_CLIMB) : Math.max(0, f.level - FLOOD_RECEDE);
  const held = pondHeld(map, parcels);
  for (const [t, dist] of f.plain) {
    const wet = f.level > 0 && !held.has(t) && threshold(map, t, dist) < f.level;
    if (wet && !f.flooded.has(t)) {
      f.flooded.add(t);
      ev.rose.push(t);
    } else if (!wet && f.flooded.has(t)) {
      f.flooded.delete(t);
      ev.fell.push(t);
    }
  }
  const hit = new Set<number>();
  for (const t of f.flooded) {
    const id = map.parcel[t]!;
    if (id !== 0) hit.add(id - 1);
  }
  for (const i of [...hit].sort((a, b) => a - b)) {
    if (!parcels.isAlive(i)) continue;
    parcels.setCondition(i, parcels.conditionAt(i) - FLOOD_DAMAGE);
    ev.underWater.push(i);
  }
  return ev;
}

/** The tiles a retention pond keeps dry: every tile within POND_REACH of one of its tiles. */
function pondHeld(map: GameMap, parcels: ParcelStore): Set<number> {
  const held = new Set<number>();
  const r2 = POND_REACH * POND_REACH;
  for (const i of parcels.aliveIndices()) {
    const p = parcels.get(i);
    if (p.kind !== BuiltKind.RetentionPond) continue;
    for (let y = p.y - POND_REACH; y < p.y + p.height + POND_REACH; y++) {
      for (let x = p.x - POND_REACH; x < p.x + p.width + POND_REACH; x++) {
        if (!map.inBounds(x, y)) continue;
        const dx = x < p.x ? p.x - x : x >= p.x + p.width ? x - (p.x + p.width - 1) : 0;
        const dy = y < p.y ? p.y - y : y >= p.y + p.height ? y - (p.y + p.height - 1) : 0;
        if (dx * dx + dy * dy <= r2) held.add(map.idx(x, y));
      }
    }
  }
  return held;
}
