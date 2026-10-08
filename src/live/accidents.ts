// Traffic accidents (docs/design/disasters.md): a jammed road crashes. Once an in-game hour each moving car may
// crash, likelier the worse the jam under it (nothing below CRASH_JAM); the car just ahead of it is wrecked too.
// Wrecks block their lane until they're towed (CRASH_SUBSTEPS), and a crash may kill someone — the driver, or a
// walker beside the road. A driven car's driver who lives gets out and walks on. Live
// layer: writes only its own state (never hashed); the host draws with its own rng fork.

import type { GameMap } from '../engine/map';
import type { Rng } from '../engine/rng';
import type { AmbientState, Car, Ped } from './types';
import { offStreet } from './types';
import { residentDies } from './death';
import { CRASH_BASE, CRASH_DEATH, CRASH_JAM, CRASH_SUBSTEPS, TRAFFIC_MAX } from './tuning';

/** The chance a moving car crashes in an hour on a road carrying `traffic`. */
export function crashChance(traffic: number): number {
  const jam = Math.min(1, traffic / TRAFFIC_MAX);
  return jam < CRASH_JAM ? 0 : CRASH_BASE * ((jam - CRASH_JAM) / (1 - CRASH_JAM));
}

/** A car on the move: a driven owned car (its owner riding, on a route), or through traffic — never parked,
 *  abandoned or already wrecked. */
const canCrash = (c: Car): boolean => !c.parked && !c.abandoned && c.wreck === undefined && (!c.owned || c.path !== undefined);

/** Wreck a car where it stands: it's nobody's to drive now (its driver, if any, is released — they finish on foot)
 *  and it blocks its lane until it's towed. Returns the driver, if it had one. */
function wreck(state: AmbientState, c: Car): Ped | undefined {
  const driver = c.owned ? state.peds.find((p) => p.phase === 'driving' && p.carId === c.id) : undefined;
  if (driver) driver.carId = undefined; // the driving step finds no car and sends them on foot
  c.owned = false;
  c.path = undefined;
  c.leg = undefined;
  c.wreck = CRASH_SUBSTEPS;
  return driver;
}

/** A crash: `c` and the car just ahead of it are wrecked; the camera is called; someone may die — the driver,
 *  or a walker beside the road. */
export function crash(state: AmbientState, map: GameMap, rng: Rng, c: Car): void {
  const driver = wreck(state, c);
  for (const o of state.cars) {
    if (o === c || !canCrash(o)) continue;
    if (Math.abs(o.x - c.x) + Math.abs(o.y - c.y) <= 1) {
      wreck(state, o); // the car it ran into
      break;
    }
  }
  const x = Math.max(0, Math.min(map.width - 1, Math.round(c.x)));
  const y = Math.max(0, Math.min(map.height - 1, Math.round(c.y)));
  state.events?.push({ kind: 'crash', x, y, w: 1, h: 1 });
  if (rng.next() >= CRASH_DEATH) return;
  const walker = state.peds.find((p) => p !== driver && !offStreet(p) && Math.abs(p.x - c.x) + Math.abs(p.y - c.y) <= 1.5);
  const victim = walker && rng.next() < 0.4 ? walker : driver;
  if (victim) {
    state.peds = state.peds.filter((p) => p !== victim);
    if (victim.homeTile !== undefined) state.occupancy.set(victim.homeTile, Math.max(0, (state.occupancy.get(victim.homeTile) ?? 0) - 1));
    else if (state.unhoused >= 1) state.unhoused -= 1;
    residentDies(state, Math.round(victim.x), Math.round(victim.y));
    return;
  }
  // through traffic: the driver was nobody we model on foot
  if (c.homeTile !== undefined) state.occupancy.set(c.homeTile, Math.max(0, (state.occupancy.get(c.homeTile) ?? 0) - 1));
  residentDies(state, x, y);
}

/** Once per in-game hour, each moving car may crash on the jam under it. Returns how many crashed. */
export function drawCrashes(state: AmbientState, map: GameMap, rng: Rng, hour: number | undefined): number {
  if (hour === undefined || hour === state.crashHour) return 0;
  state.crashHour = hour;
  let n = 0;
  for (const c of [...state.cars]) {
    if (!canCrash(c)) continue;
    const tx = Math.round(c.x);
    const ty = Math.round(c.y);
    if (!map.inBounds(tx, ty)) continue;
    const chance = crashChance(state.traffic.get(map.idx(tx, ty)) ?? 0);
    if (chance > 0 && rng.next() < chance) {
      crash(state, map, rng, c);
      n++;
    }
  }
  return n;
}
