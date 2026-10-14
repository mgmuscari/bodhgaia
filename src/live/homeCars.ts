// Households keep their cars (Maddy 2026-10-13: "Residents at home should park their cars on the street in excess of
// 1"). A home owns a number of cars from its residents (householdCars); one stands off the street — the driveway,
// not drawn — and the rest park at the kerb near home while the household is home (atHome cars). Someone setting off
// from home takes one of them (takeHomeCar, from ensureOwnedCar); a car out on a trip isn't at the kerb. The kerb
// cars are reconciled with the households on their refresh (syncHomeCars). Renderer-side state only: never hashed.

import type { GameMap } from '../engine/map';
import { BuiltKind } from '../engine/fabric';
import type { AmbientState, Car, Ped } from './types';
import { applyParkSpot, nearestParkSpot } from './agents';
import { transitFor } from './transit';

/** Kerb cars a single home keeps at most (the rest are garaged or round the corner — not drawn). */
export const HOME_KERB_MAX = 4;
/** How far from home (Manhattan, tiles) a resident still counts as setting off from home. */
const AT_HOME_REACH = 3;

/** Cars per resident by home kind, and the most a home holds. Communes and tiny homes own none (their residents work
 *  at home or have none); a block of flats fewer per person than a house. */
const PER_RESIDENT: ReadonlyMap<number, readonly [number, number]> = new Map<number, readonly [number, number]>([
  [BuiltKind.HouseSingle, [0.5, 3]],
  [BuiltKind.ADU, [0.5, 1]],
  [BuiltKind.Apartments, [0.3, 40]],
  [BuiltKind.Projects, [0.2, 60]],
  [BuiltKind.CoopHousing, [0.2, 20]],
]);

/** The cars a home of `kind` with `residents` owns. */
export function householdCars(kind: number, residents: number): number {
  const r = PER_RESIDENT.get(kind);
  if (!r || residents <= 0) return 0;
  return Math.min(r[1], Math.round(residents * r[0]));
}

/** Homes within this many tiles (Manhattan) of a transit stop shed their cars, in time, to none; within
 *  TRANSIT_REACH, to half (Maddy 2026-10-13: "residents cease to own cars" where transit serves them). */
export const TRANSIT_NEAR = 4;
export const TRANSIT_REACH = 8;
/** On each sync (~5 s), a household served by transit gives up a car one time in SHED_ONE_IN (~2 min a car). */
const SHED_ONE_IN = 24;

/** The cars a household owns now (its own count, once known), or undefined if not yet counted. */
export function carsOwnedAt(state: AmbientState, home: number): number | undefined {
  return state.carsOwned?.get(home);
}

/** Manhattan distance from (x, y) to the nearest transit stop's platform, capped at TRANSIT_REACH + 1. */
function stopDistance(map: GameMap, x: number, y: number): number {
  let best = TRANSIT_REACH + 1;
  for (const l of transitFor(map).lines) {
    for (const s of l.stops) {
      const px = s.platform % map.width;
      const d = Math.abs(px - x) + Math.abs((s.platform - px) / map.width - y);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Park the households' cars beyond the first at the kerb near home, minus those out on trips; drop any whose home
 *  is gone or now holds fewer. */
export function syncHomeCars(state: AmbientState, map: GameMap): void {
  const out = new Map<number, number>();
  for (const p of state.peds) if (p.homeTile !== undefined && p.carId !== undefined) out.set(p.homeTile, (out.get(p.homeTile) ?? 0) + 1);
  const parked = new Map<number, Car[]>();
  for (const c of state.cars) if (c.atHome !== undefined) (parked.get(c.atHome) ?? parked.set(c.atHome, []).get(c.atHome)!).push(c);
  const drop = new Set<Car>();
  const homes = new Set<number>();
  const owned = (state.carsOwned ??= new Map());
  const sync = (state.homeCarSyncs = (state.homeCarSyncs ?? 0) + 1);
  for (const h of state.households ?? []) {
    const tile = map.idx(h.x, h.y);
    homes.add(tile);
    const residents = state.occupancy.get(tile) ?? h.count;
    // what it owns: its count by size, less what it has given up where transit serves it
    const full = householdCars(map.built[tile]!, residents);
    let cars = Math.min(full, owned.get(tile) ?? full);
    if (cars > 0) {
      const d = stopDistance(map, h.x, h.y);
      const floor = d <= TRANSIT_NEAR ? 0 : d <= TRANSIT_REACH ? Math.ceil(full / 2) : full;
      const draw = Math.imul((tile + 1) ^ Math.imul(sync, 0x27d4eb2f), 0x9e3779b1) >>> 0; // each home on its own clock
      if (cars > floor && draw % SHED_ONE_IN === 0) cars--;
    }
    owned.set(tile, cars);
    const want = Math.max(0, Math.min(HOME_KERB_MAX, cars - 1 - (out.get(tile) ?? 0)));
    const have = parked.get(tile) ?? [];
    for (let k = want; k < have.length; k++) drop.add(have[k]!);
    for (let k = have.length; k < want; k++) {
      const spot = nearestParkSpot(state, map, h.x, h.y);
      if (!spot) break; // the kerbs round here are full
      const id = (state.nextCarId = (state.nextCarId ?? 0) + 1);
      const car: Car = {
        x: h.x,
        y: h.y,
        dir: 0,
        tx: h.x,
        ty: h.y,
        id,
        atHome: tile,
        tint: (Math.imul((tile + 1) ^ id, 0x9e3779b1) >>> 0) % 0x10000,
        speedMul: 0.85 + ((Math.imul((id + 7) ^ 0x85ebca6b, 0xc2b2ae35) >>> 0) % 31) / 100,
      };
      applyParkSpot(car, spot);
      car.x = car.tx; // parked from the start, not pulling in
      car.y = car.ty;
      state.cars.push(car);
    }
  }
  for (const [tile, cars] of parked) if (!homes.has(tile)) for (const c of cars) drop.add(c);
  for (const tile of owned.keys()) if (!homes.has(tile)) owned.delete(tile);
  if (drop.size > 0) state.cars = state.cars.filter((c) => !drop.has(c));
}

/** A resident setting off from home takes one of the household's kerb cars, which becomes theirs to drive. */
export function takeHomeCar(state: AmbientState, map: GameMap, p: Ped): Car | null {
  const home = p.homeTile!;
  const hx = home % map.width;
  const hy = (home - hx) / map.width;
  if (Math.abs(Math.round(p.x) - hx) + Math.abs(Math.round(p.y) - hy) > AT_HOME_REACH) return null;
  const car = state.cars.find((c) => c.atHome === home);
  if (!car) return null;
  car.atHome = undefined;
  car.owned = true;
  p.carId = car.id;
  return car;
}
