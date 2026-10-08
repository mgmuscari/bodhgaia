// Live-layer CARS: the per-substep vehicle machine. A car is in exactly one of four states —
// abandoned (rusting), owned (managed by its citizen), parked (waiting for its driver), or moving
// (a committed trip path, or a path-less grid wander) — and `stepCar` dispatches on it. Also the
// substep's shared vehicle context (congestion speed + the space-ahead block test), which the
// citizen-driven cars in peds.ts read too. Lifted verbatim from step.ts's substep (L15).

import type { GameMap } from '../engine/map';
import { BuiltKind } from '../engine/fabric';
import type { Rng } from '../engine/rng';
import { CAR_SPEED, STUCK_GIVE_UP } from './tuning';
import type { AmbientState, Car, Mover } from './types';
import { degradeAbandonedCar, tryPark } from './agents';
import {
  advanceMover,
  assignSerials,
  blockedAhead,
  boxBlocked,
  buildMoverGrid,
  congestionCount,
  congestionSpeedMult,
  pathStep,
  rerouteIfStuck,
  uTurnIfStuck,
} from './motion';
import { nextRoadStep } from './network';

/** The per-substep vehicle context, built once from a snapshot at substep start. */
export interface VehicleCtx {
  /** The mover grid of every MOVING vehicle (cars + cruisers) — the collision/following index. */
  readonly moverGrid: Map<number, Mover[]>;
  /** `base` speed slowed by the same/orthogonal-direction pileup on tile (x,y). */
  speedAt(base: number, x: number, y: number, dir: number): number;
  /** Whether a vehicle must pause: a same-direction vehicle sits in the space just ahead. */
  blocked(m: Mover): boolean;
}

/**
 * Snapshot the substep's vehicle context. Per-tile, per-DIRECTION histogram of MOVING cars for the
 * pileup slowdown: a car on a crowded tile creeps (congestion made physical). Counts free + owned-
 * being-driven cars; parked and abandoned cars sit off to the side and don't jam. Direction-aware so
 * a car is only slowed by same-direction / orthogonal traffic — oncoming cars are just passing
 * (Maddy). Collision/following: vehicles can't overlap — a car PAUSES if a same-direction vehicle
 * sits in the bounding-box space just ahead (queues form, trips take longer). Grid built from the
 * moving cars + cruisers; cruisers share it (stepCruisers).
 */
export function buildVehicleCtx(state: AmbientState, map: GameMap): VehicleCtx {
  const carDirHist = new Map<number, [number, number, number, number]>();
  for (const c of state.cars) {
    if (c.parked || c.abandoned) continue;
    const i = map.idx(Math.round(c.x), Math.round(c.y));
    let h = carDirHist.get(i);
    if (!h) carDirHist.set(i, (h = [0, 0, 0, 0]));
    const d = c.dir & 3; // 0..3
    h[d] = h[d]! + 1;
  }
  const gridMovers = [...state.cars.filter((c) => !c.parked && !c.abandoned), ...state.cruisers]; // PARKED cars don't count (Maddy)
  assignSerials(state, gridMovers);
  const moverGrid = buildMoverGrid(gridMovers, map.width);
  return {
    moverGrid,
    speedAt(base, x, y, dir) {
      const h = carDirHist.get(map.idx(x, y));
      return h ? base * congestionSpeedMult(congestionCount(h, dir)) : base;
    },
    blocked: (mm) => blockedAhead(moverGrid, map.width, mm) || boxBlocked(moverGrid, map, mm),
  };
}

/** A car's speed this substep: 2× on a freeway, slowed by the pileup on its tile, times its own mul. */
export function carSpeed(map: GameMap, ctx: VehicleCtx, c: Car): { speed: number; onFreeway: boolean } {
  const cx = Math.round(c.x);
  const cy = Math.round(c.y);
  const onFreeway = map.built[map.idx(cx, cy)] === BuiltKind.RoadHighway;
  return { speed: ctx.speedAt(onFreeway ? CAR_SPEED * 2 : CAR_SPEED, cx, cy, c.dir) * (c.speedMul ?? 1), onFreeway };
}

/** A PARKED (non-owned) car waits for its last-mile ped, which zeroes `dwell` on return; the
 *  countdown is just a safety release. */
function stepParked(c: Car): boolean {
  c.dwell! -= 1;
  return c.dwell! > 0;
}

/** A MOVING car: a trip follows its committed path through the jam ladder and PARKS on arrival
 *  (a lot stall, or a curb); a path-less car (a test fixture) wanders the road grid. */
function stepMoving(state: AmbientState, map: GameMap, rng: Rng, ctx: VehicleCtx, c: Car): boolean {
  const sp = carSpeed(map, ctx, c).speed;
  if (c.path !== undefined) {
    // jam ladder: re-plan round it, then turn back; a trip still jammed after that just ends
    rerouteIfStuck(map, c, state.traffic);
    uTurnIfStuck(map, c, state.traffic);
    if ((c.stuck ?? 0) >= STUCK_GIVE_UP) return false;
    const alive = advanceMover(c, sp, map, (x, y) => pathStep(map, c, x, y), ctx.blocked);
    return alive ? true : tryPark(state, c, map);
  }
  return advanceMover(c, sp, map, (x, y, fromDir, recent) => nextRoadStep(map, x, y, fromDir, rng, recent), ctx.blocked);
}

/**
 * Advance one car one substep; returns whether it survives. An ABANDONED derelict (its citizen was
 * arrested) rusts into ground pollution, then despawns. An OWNED citizen-car is managed entirely by
 * its owner ped (peds.ts) — never moved, dwelled or despawned here, so it never vanishes while its
 * owner is away on foot.
 */
export function stepCar(state: AmbientState, map: GameMap, rng: Rng, ctx: VehicleCtx, c: Car): boolean {
  if (c.wreck !== undefined) return --c.wreck > 0; // a wreck blocks its lane until it's towed
  if (c.abandoned) return degradeAbandonedCar(state, map, c);
  if (c.owned) return true;
  if (c.parked) return stepParked(c);
  return stepMoving(state, map, rng, ctx, c);
}
