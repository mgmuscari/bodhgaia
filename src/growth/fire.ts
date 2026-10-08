// Fire (docs/design/disasters.md): the first disaster. Simulation-side, like revival, because a fire changes the
// hashed stock — a building that burns out is left a ruin. Deterministic in (world, its rng fork, the hour, the
// fires the host says trucks have reached). Engine-layer discipline: no DOM, no transcendental Math, no ui.
//
// - Ignition: once per in-game hour, each building may catch, likelier the more decayed it is, likelier still for a
//   ruin, an industrial works or a combustion plant. Greens, yards and parking don't burn. Rare: a typical city sees
//   a fire or two a day; a healing one fewer.
// - Spread: each step a burning building may set a neighbour (a building within a tile of it) alight.
// - Burnout: left BURN_STEPS steps, a fire leaves its building a ruin.
// - Quenched: a fire a truck has reached goes out; the building stands, scorched (QUENCH_DAMAGE condition).

import { BuiltKind, isBuildingKind, type ParcelStore } from '../engine/fabric';
import type { GameMap } from '../engine/map';
import type { Rng } from '../engine/rng';

/** Ignition chance per building per in-game hour at full condition (a city of ~1000 buildings: ~1 fire a day). */
export const IGNITE_BASE = 1 / 24000;
/** A building at condition 0 is (1 + DECAY_FACTOR)× as likely to catch as a pristine one. */
export const DECAY_FACTOR = 3;
/** Each step, each burning building sets each neighbour alight with this chance. */
export const SPREAD_CHANCE = 0.03;
/** Steps (the host steps ~1 a second) a fire burns before its building is a ruin. */
export const BURN_STEPS = 45;
/** Condition a building loses to a fire that was put out. */
export const QUENCH_DAMAGE = 40;

/** Kinds that don't burn: open ground, greens, yards, parking. */
const FIREPROOF: ReadonlySet<number> = new Set<number>([
  BuiltKind.Park,
  BuiltKind.RewildedLand,
  BuiltKind.CommunityGarden,
  BuiltKind.Parklet,
  BuiltKind.Yard,
  BuiltKind.ParkingLot,
]);
/** Kinds that catch more readily than their condition says: shells, works, combustion plants. */
const TINDER: ReadonlySet<number> = new Set<number>([BuiltKind.Ruin, BuiltKind.Industrial, BuiltKind.CoalPlant, BuiltKind.GasPlant]);

export interface FireState {
  /** Burning parcels (store index) → steps burned. */
  burning: Map<number, { age: number }>;
  /** The last hour ignition was drawn for. */
  lastHour?: number;
  /** Fires started (ignited or spread) since the counter was last read — for tests and stats. */
  started: number;
}

export function createFireState(): FireState {
  return { burning: new Map(), started: 0 };
}

/** The chance a building of `kind` at `condition` catches in an hour. 0 for what doesn't burn. */
export function igniteChance(kind: number, condition: number): number {
  if (!isBuildingKind(kind) || FIREPROOF.has(kind)) return 0;
  const decay = 1 + DECAY_FACTOR * (1 - Math.min(255, Math.max(0, condition)) / 255);
  return IGNITE_BASE * decay * (TINDER.has(kind) ? 2 : 1);
}

export interface FireEvents {
  ignited: number[];
  spread: number[];
  /** Buildings burnt out this step (now ruins), with their footprints. */
  burntOut: { parcel: number; x: number; y: number; w: number; h: number; kind: number }[];
  quenched: number[];
}

/** The parcels whose footprints touch `p`'s grown by one tile. */
function neighbours(map: GameMap, parcels: ParcelStore, i: number): number[] {
  const p = parcels.get(i);
  const out = new Set<number>();
  for (let y = p.y - 1; y <= p.y + p.height; y++) {
    for (let x = p.x - 1; x <= p.x + p.width; x++) {
      if (!map.inBounds(x, y)) continue;
      const id = map.parcel[map.idx(x, y)]!;
      if (id !== 0 && id - 1 !== i) out.add(id - 1);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** One fire step: put out what the trucks reached, draw the hour's ignitions (once per hour, with a clock), spread,
 *  and burn out what has burned long enough. */
export function stepFire(
  world: { map: GameMap; parcels: ParcelStore },
  fires: FireState,
  rng: Rng,
  opts: { hour?: number; quenched?: ReadonlySet<number> },
): FireEvents {
  const { map, parcels } = world;
  const ev: FireEvents = { ignited: [], spread: [], burntOut: [], quenched: [] };

  for (const i of opts.quenched ?? []) {
    if (!fires.burning.delete(i) || !parcels.isAlive(i)) continue;
    parcels.setCondition(i, parcels.conditionAt(i) - QUENCH_DAMAGE);
    ev.quenched.push(i);
  }

  if (opts.hour !== undefined && opts.hour !== fires.lastHour) {
    fires.lastHour = opts.hour;
    for (const i of parcels.aliveIndices()) {
      if (fires.burning.has(i)) continue;
      const chance = igniteChance(parcels.kindAt(i), parcels.conditionAt(i));
      if (chance > 0 && rng.next() < chance) {
        fires.burning.set(i, { age: 0 });
        ev.ignited.push(i);
      }
    }
  }

  const order = [...fires.burning.keys()].sort((a, b) => a - b);
  for (const i of order) {
    if (!parcels.isAlive(i)) {
      fires.burning.delete(i);
      continue;
    }
    for (const n of neighbours(map, parcels, i)) {
      if (fires.burning.has(n) || igniteChance(parcels.kindAt(n), 255) === 0) continue;
      if (rng.next() < SPREAD_CHANCE) {
        fires.burning.set(n, { age: 0 });
        ev.spread.push(n);
      }
    }
  }

  for (const i of order) {
    const f = fires.burning.get(i);
    if (!f) continue;
    f.age++;
    if (f.age < BURN_STEPS) continue;
    fires.burning.delete(i);
    const p = parcels.get(i);
    ev.burntOut.push({ parcel: i, x: p.x, y: p.y, w: p.width, h: p.height, kind: p.kind });
    for (let dy = 0; dy < p.height; dy++) for (let dx = 0; dx < p.width; dx++) map.built[map.idx(p.x + dx, p.y + dy)] = BuiltKind.Ruin;
    parcels.setKind(i, BuiltKind.Ruin);
    parcels.setCondition(i, 0);
  }

  fires.started += ev.ignited.length + ev.spread.length;
  return ev;
}
