// Riders (docs/design/transit.md): a long trip with stops near both ends rides the line. The rider walks to the
// boarding stop's platform, waits there in sight, boards a vehicle of that line halted at the stop, rides it out of
// sight, gets off when it halts at the stop nearest the destination, and walks on. Nobody waits for ever: after
// WAIT_MAX they walk instead. Live layer: writes only its own state.

import type { GameMap } from '../engine/map';
import type { AmbientState, Ped, Train } from './types';
import { transitFor, type LineFamily, type Stop } from './transit';
import { walkPath } from './pathing';
import { isWalkable } from './network';
import { advanceMover, commitHeading, pathStep } from './motion';
import { DIR_DX, DIR_DY } from './geometry';
import { FUEL_TANK, PED_SPEED, TRAIN_LEN } from './tuning';
import { TRAM_LEN } from './trains';
import { TravelMode } from '../citizens/modes';

/** The furthest a rider walks to or from a stop (Manhattan, to its platform). */
export const STOP_WALK = 8;
/** Stops nearer each other than this aren't worth riding between (Manhattan, track to track). */
export const MIN_RIDE = 8;
/** Substeps a rider waits before giving up and walking (~45 s). */
export const WAIT_MAX = 900;
/** Riders a car carries; a vehicle carries that times its consist (Maddy 2026-10-08: a two-car tram, 64). */
export const PER_CAR = 32;
export const capacityOf = (family: LineFamily): number => PER_CAR * (family === 'tram' ? TRAM_LEN : TRAIN_LEN);
/** Energy a rider gets back each substep aboard — a ride is a rest (Maddy 2026-10-08). */
export const RIDE_REST = 1;

export interface Ride {
  family: LineFamily;
  board: Stop;
  alight: Stop;
  stage: 'to-stop' | 'waiting' | 'riding';
  waited: number;
  vehicle?: Train;
  /** Where the trip is going, and the walking phase it finishes in. */
  dest: { x: number; y: number };
  then: 'to-building' | 'to-home';
}

const tileXY = (map: GameMap, t: number): [number, number] => [t % map.width, Math.floor(t / map.width)];
const manhattan = (map: GameMap, t: number, x: number, y: number): number => {
  const [tx, ty] = tileXY(map, t);
  return Math.abs(tx - x) + Math.abs(ty - y);
};

/** A ride: where to get on and off, and the walking it leaves (to the one stop and from the other). */
export interface RidePlan {
  board: Stop;
  alight: Stop;
  walk: number;
}

/** A ride from near (ox, oy) to near (dx, dy) on a line of `family`: the boarding and alighting stops — on the same
 *  line, each within STOP_WALK of its end, at least MIN_RIDE apart — with the least walking; or null. */
export function planRide(map: GameMap, ox: number, oy: number, dx: number, dy: number, family: LineFamily): RidePlan | null {
  let best: { board: Stop; alight: Stop; walk: number } | null = null;
  for (const line of transitFor(map).lines) {
    if (line.family !== family || line.stops.length < 2) continue;
    let board: Stop | null = null;
    let alight: Stop | null = null;
    let wb = Infinity;
    let wa = Infinity;
    for (const s of line.stops) {
      const b = manhattan(map, s.platform, ox, oy);
      const a = manhattan(map, s.platform, dx, dy);
      if (b < wb) [wb, board] = [b, s];
      if (a < wa) [wa, alight] = [a, s];
    }
    if (!board || !alight || board === alight || wb > STOP_WALK || wa > STOP_WALK) continue;
    const [ax, ay] = tileXY(map, alight.track);
    if (manhattan(map, board.track, ax, ay) < MIN_RIDE) continue;
    if (!best || wb + wa < best.walk) best = { board, alight, walk: wb + wa };
  }
  return best;
}

/** Set a citizen off on a ride: they walk to the boarding platform first. */
export function startRide(p: Ped, plan: { board: Stop; alight: Stop }, dest: { x: number; y: number }, then: Ride['then']): void {
  const family = plan.board.family;
  p.ride = { family, board: plan.board, alight: plan.alight, stage: 'to-stop', waited: 0, dest, then };
  p.phase = 'transit';
  p.mode = family === 'tram' ? TravelMode.Streetcar : TravelMode.ElevatedRail;
  p.walkTo = undefined;
  p.path = undefined;
  p.leg = undefined;
}

/** The tile a vehicle's head is on. */
const headTile = (map: GameMap, t: Train): number => map.idx(Math.round(t.hx), Math.round(t.hy));

/** On foot again, for the rest of the trip. */
function walkOn(p: Ped): void {
  const ride = p.ride!;
  p.phase = ride.then;
  p.walkTo = { x: ride.dest.x, y: ride.dest.y };
  p.mode = TravelMode.Walk;
  p.path = undefined;
  p.leg = undefined;
  p.tx = Math.round(p.x);
  p.ty = Math.round(p.y);
  p.recent = undefined;
  p.ride = undefined;
}

/** Board a ped onto a foot route (as gatherers do); false if there is nowhere to walk. */
function walkRoute(p: Ped, path: readonly number[] | null, map: GameMap): boolean {
  if (!path || path.length < 2) return false;
  const [x0, y0] = tileXY(map, path[0]!);
  const [x1, y1] = tileXY(map, path[1]!);
  p.x = x0;
  p.y = y0;
  p.tx = x1;
  p.ty = y1;
  commitHeading(p, x1 > x0 ? 1 : x1 < x0 ? 3 : y1 > y0 ? 2 : 0);
  p.path = path;
  p.leg = 2;
  p.recent = undefined;
  return true;
}

/** A foot route onto the platform itself — walkPath stops beside its target (a door), but a platform is stood on. */
function toPlatform(map: GameMap, x: number, y: number, platform: number): number[] | null {
  const [px, py] = tileXY(map, platform);
  const path = walkPath(map, x, y, px, py);
  if (!path) return null;
  const last = path[path.length - 1]!;
  return last === platform ? path : manhattan(map, last, px, py) === 1 ? [...path, platform] : null;
}

/** A rider's step (the 'transit' and 'riding' ped phases). Always keeps the ped. */
export function stepRider(state: AmbientState, map: GameMap, p: Ped): boolean {
  const ride = p.ride;
  if (!ride) {
    p.phase = 'to-building';
    return true;
  }
  const [px, py] = tileXY(map, ride.board.platform);
  if (ride.stage === 'to-stop') {
    if (p.path && advanceMover(p, PED_SPEED, map, (x, y) => pathStep(map, p, x, y), undefined, 0, false)) return true;
    p.path = undefined;
    p.leg = undefined;
    if (Math.round(p.x) === px && Math.round(p.y) === py) {
      p.x = px;
      p.y = py;
      p.tx = px;
      p.ty = py;
      ride.stage = 'waiting';
      return true;
    }
    if (!walkRoute(p, toPlatform(map, Math.round(p.x), Math.round(p.y), ride.board.platform), map)) walkOn(p); // can't reach it: walk
    return true;
  }
  if (ride.stage === 'waiting') {
    const t = state.trains.find(
      (v) => (v.family ?? 'rail') === ride.family && (v.dwell ?? 0) > 0 && headTile(map, v) === ride.board.track &&
        state.peds.filter((q) => q.ride?.vehicle === v).length < capacityOf(ride.family),
    );
    if (t) {
      ride.vehicle = t;
      ride.stage = 'riding';
      p.phase = 'riding';
    } else if (++ride.waited > WAIT_MAX) walkOn(p); // nothing came: walk
    return true;
  }
  // riding: carried, out of sight; off at the far stop when the vehicle halts there
  const t = ride.vehicle;
  if (!t || !state.trains.includes(t)) {
    // the vehicle is gone (its track was torn up): off here, onto the nearest walkable ground
    const hx = Math.round(p.x);
    const hy = Math.round(p.y);
    for (let d = 0; d < 4 && !isWalkable(map, Math.round(p.x), Math.round(p.y)); d++) {
      if (isWalkable(map, hx + DIR_DX[d]!, hy + DIR_DY[d]!)) {
        p.x = hx + DIR_DX[d]!;
        p.y = hy + DIR_DY[d]!;
      }
    }
    walkOn(p);
    return true;
  }
  p.x = t.hx;
  p.y = t.hy;
  p.fuel = Math.min(FUEL_TANK, (p.fuel ?? FUEL_TANK) + RIDE_REST);
  if ((t.dwell ?? 0) > 0 && headTile(map, t) === ride.alight.track) {
    const [ax, ay] = tileXY(map, ride.alight.platform);
    p.x = ax;
    p.y = ay;
    walkOn(p);
  }
  return true;
}
