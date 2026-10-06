// Test fixture: spawn path-following trip-cars (or short-trip walkers) into an AmbientState.
//
// This is the retired `ingestTrips` sim seam (src/live/agents.ts), kept verbatim here because the sim
// no longer drives it — the O-D trip generator is gone and citizens' own cars carry traffic — but
// the parking / kerb / last-mile / tint / home-health / mode-choice tests still need cars that follow
// a committed `path` and park on arrival. The objects it builds are plain `Car`/`Ped` literals of the
// real live types; everything after the spawn (driving, parking, deposits) is the real stepper.
// Deterministic; draws no rng.

import type { GameMap } from '../../src/engine/map';
import { BuiltKind } from '../../src/engine/fabric';
import { ZoneType, zoneTypeOf } from '../../src/engine/zone';
import { liveCaps } from '../../src/live/caps';
import { WALK_RANGE } from '../../src/live/tuning';
import { DIR_DX, DIR_DY } from '../../src/live/geometry';
import type { AmbientState } from '../../src/live/types';

/** The residential building tile 4-adjacent to a trip's origin road (its home), or -1 if the
 *  origin doesn't front a home — i.e. a non-residential (freight) trip. */
function residentialHome(map: GameMap, roadIdx: number): number {
  const x = roadIdx % map.width;
  const y = (roadIdx - x) / map.width;
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    if (!map.inBounds(nx, ny)) continue;
    const t = map.idx(nx, ny);
    if (zoneTypeOf(map.built[t]!) === ZoneType.Residential) return t;
  }
  return -1;
}

/** Any zoned (R/C/I/Civic) building tile 4-adjacent to a road — the destination PLOT a trip's
 *  end road fronts, or -1 if none. Used to aim a walking citizen at the plot it's visiting. */
function zonedNeighbor(map: GameMap, roadIdx: number): number {
  const x = roadIdx % map.width;
  const y = (roadIdx - x) / map.width;
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    if (!map.inBounds(nx, ny)) continue;
    const t = map.idx(nx, ny);
    if (zoneTypeOf(map.built[t]!) !== ZoneType.None) return t;
  }
  return -1;
}

/**
 * Spawn trip-cars (or short-trip walkers) from given origin→destination paths. Each car follows its
 * committed `path` leg by leg and parks on arrival; capped at liveCaps.carCap (moving cars only).
 * A trip leaving a residential plot is a CITIZEN (its home is tagged so the visit's wellbeing is
 * deposited there); a short (≤ WALK_RANGE), freeway-free citizen trip to a zoned plot WALKS instead.
 */
export function spawnTrips(
  state: AmbientState,
  trips: ReadonlyArray<{ path: readonly number[] }>,
  map: GameMap,
): void {
  let moving = 0; // parked cars are stored, not traffic — cap only the moving ones
  for (const c of state.cars) if (!c.parked) moving++;
  for (const trip of trips) {
    if (trip.path.length < 2) continue; // need at least one leg to travel
    const p0 = trip.path[0]!;
    const p1 = trip.path[1]!;
    const x0 = p0 % map.width;
    const y0 = (p0 - x0) / map.width;
    const x1 = p1 % map.width;
    const y1 = (p1 - x1) / map.width;
    const dir = x1 > x0 ? 1 : x1 < x0 ? 3 : y1 > y0 ? 2 : 0;
    const home = residentialHome(map, p0);

    // Mode choice: a short citizen trip that doesn't need a freeway walks; others drive.
    const usesFreeway = trip.path.some((t) => map.built[t]! === BuiltKind.RoadHighway);
    if (home >= 0 && trip.path.length <= WALK_RANGE && !usesFreeway) {
      if (state.peds.length >= liveCaps.pedCap) continue; // walkers are full
      const destPlot = zonedNeighbor(map, trip.path[trip.path.length - 1]!);
      if (destPlot >= 0) {
        const dpx = destPlot % map.width;
        const dpy = (destPlot - dpx) / map.width;
        state.peds.push({
          x: x0,
          y: y0,
          dir,
          tx: x0,
          ty: y0,
          walkTo: { x: dpx, y: dpy },
          phase: 'to-building',
          homeTile: home,
          building: { x: dpx, y: dpy },
        });
        continue; // walked — no car
      }
      // no destination plot to aim at → fall through and drive
    }

    if (moving >= liveCaps.carCap) continue;
    // Colour bound to the car: a spread hash of (origin, next) so neighbouring trips differ.
    const tint = (Math.imul(p0 ^ p1, 0x9e3779b1) >>> 0) % 0x10000;
    state.cars.push({
      x: x0,
      y: y0,
      dir,
      tx: x1,
      ty: y1,
      path: trip.path,
      leg: 2,
      tint,
      homeTile: home >= 0 ? home : undefined,
    });
    moving++;
  }
}
