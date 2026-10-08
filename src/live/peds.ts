// Live-layer PEDESTRIANS: the per-substep citizen state machine, lifted verbatim from step.ts's
// substep (L15). A ped is in one of three regimes, dispatched by `stepPed`:
//
//   'inside' / 'driving'  — a hidden phase with its own handler (PHASE_STEP);
//   walking (walkTo set)  — spend fuel, advance along the leg, and on arrival run the ARRIVE handler
//                           for its phase ('to-vehicle' | 'to-building' | 'to-car' | 'to-home');
//   idle                  — a homed ped heads home; a homeless, destination-less one despawns.
//
// Every handler returns whether the ped survives the substep (the caller filters on it). Order of
// rng draws is load-bearing (tests/live/golden.test.ts).

import { stepGatherer } from './gatherings';
import type { GameMap } from '../engine/map';
import { TravelMode, modeSpeedMult } from '../citizens/modes';
import type { Rng } from '../engine/rng';
import {
  FUEL_LIMP_HOME,
  FUEL_TANK,
  GIVE_UP_PENALTY,
  INSIDE_DWELL_MIN,
  INSIDE_DWELL_SPAN,
  PED_SPEED,
  ROAD_WALK_PENALTY,
  STUCK_GIVE_UP,
  WORN_WALK_PENALTY,
} from './tuning';
import type { AmbientState, Ped } from './types';
import {
  advanceItinerary,
  boardOwnedCar,
  depositHealth,
  depositVisit,
  findCar,
  headHome,
  parkOwnedCarSomewhere,
  respawnAtHome,
  retireOwnedCar,
  routeToParking,
  skipJammedStop,
  walkLegInstead,
} from './agents';
import { layPollution, layTraffic } from './fields/pollution';
import { advanceMover, commitHeading, pathStep, rerouteIfStuck, spaceClear, uTurnIfStuck } from './motion';
import { fuelBurn, nearestWalkable, nextStepToward, refuelFor, usesCommittedPath, walkPath } from './pathing';
import { isWalkable, reachedPlot } from './network';
import { carSpeed, type VehicleCtx } from './cars';

type Phase = NonNullable<Ped['phase']>;
type PedStep = (state: AmbientState, map: GameMap, rng: Rng, ctx: VehicleCtx, p: Ped) => boolean;

// --- small shared moves ------------------------------------------------------

/** Recommit the route from where the ped stands (a fresh leg, or a changed destination). */
function recommitFromHere(p: Ped): void {
  p.tx = Math.round(p.x);
  p.ty = Math.round(p.y);
  p.recent = undefined;
}

function homeXY(map: GameMap, homeTile: number): { x: number; y: number } {
  const hx = homeTile % map.width;
  return { x: hx, y: (homeTile - hx) / map.width };
}

/** The leg's road/worn walking tolls, docked from a visit's wellbeing. */
function walkPenalty(p: Ped): number {
  return Math.floor((p.roadSteps ?? 0) * ROAD_WALK_PENALTY + (p.wornSteps ?? 0) * WORN_WALK_PENALTY);
}

/** Out of the car → finish the leg on foot, toward home or the building. */
function finishOnFoot(p: Ped): void {
  p.phase = p.homeDest ? 'to-home' : 'to-building';
  p.walkTo = p.homeDest ?? p.building ?? { x: Math.round(p.x), y: Math.round(p.y) };
  p.mode = TravelMode.Walk;
  recommitFromHere(p);
}

/**
 * Self-heal the substrate invariant: a visible ped must stand on the walkable set. If it was placed
 * off it (open water, a freeway, a plot — a degenerate spawn/park), snap it back onto the nearest
 * solid tile. Returns false when it's truly stranded (no walkable tile near). Riders ('driving') and
 * peds 'inside' a building are hidden and exempt. (Maddy: pedestrians crossing water / freeways.)
 */
function snapToWalkable(map: GameMap, p: Ped): boolean {
  if (p.phase === 'driving' || p.phase === 'inside' || isWalkable(map, Math.round(p.x), Math.round(p.y))) return true;
  const w = nearestWalkable(map, Math.round(p.x), Math.round(p.y));
  if (w === null) return false;
  p.x = w.x;
  p.y = w.y;
  p.tx = w.x;
  p.ty = w.y;
  p.recent = undefined;
  return true;
}

// --- hidden phases -----------------------------------------------------------

/** 'inside' a building: dwell, then set out on the next leg. */
const stepInside: PedStep = (state, map, _rng, _ctx, p) => {
  p.dwellInside! -= 1;
  if (p.dwellInside! > 0) return true;
  if (p.itinerary !== undefined) {
    // A CITIZEN on a daily round: go to the next stop (each leg picks its own mode), or head home.
    if (!advanceItinerary(state, p, map)) headHome(state, p, map); // round done → drive/walk home
  } else if (p.carId !== undefined) {
    // A sim/freight last-mile ped: walk back to its parked car and release it.
    const car = findCar(state, p.carId);
    if (!car) return false; // its car already left → the ped vanishes too
    p.phase = 'to-car';
    p.walkTo = { x: car.x, y: car.y };
  } else {
    // A single-stop sim walk citizen: head home, carrying the visit's wellbeing.
    p.phase = 'to-home';
    p.walkTo = homeXY(map, p.homeTile!);
  }
  recommitFromHere(p); // recommit the Manhattan route from here toward the destination
  return true;
};

/**
 * 'driving' its owned car along a COMMITTED least-cost route (set at boarding — no greedy circling),
 * fast on freeways, laying live traffic as it goes (which other cars route around). On arrival it
 * PARKS in a free, non-freeway spot and the citizen walks the last mile.
 */
const stepDriving: PedStep = (state, map, _rng, ctx, p) => {
  const car = p.carId !== undefined ? findCar(state, p.carId) : undefined;
  if (!car || car.path === undefined) {
    finishOnFoot(p); // lost the car / no route → finish on foot
    return true;
  }
  const { speed: sp, onFreeway } = carSpeed(map, ctx, car);
  // an owned car obeys the same space-ahead rule as every other vehicle (it used to drive through queues)
  // jam ladder: re-plan round it, then turn back, then give up on this stop (small wellbeing hit)
  rerouteIfStuck(map, car, state.traffic);
  uTurnIfStuck(map, car, state.traffic);
  if ((car.stuck ?? 0) >= STUCK_GIVE_UP) {
    skipJammedStop(state, p, map);
    return true;
  }
  const moving = advanceMover(car, sp, map, (x, y) => pathStep(map, car, x, y), ctx.blocked);
  layTraffic(state, map, Math.round(car.x), Math.round(car.y)); // the car IS the traffic
  layPollution(state, map, Math.round(car.x), Math.round(car.y), onFreeway); // ...and the smog
  p.x = car.x; // ride along (hidden)
  p.y = car.y;
  if (moving) return true;
  // route done → if the lots at hand are full, DRIVE to the nearest one with a free stall and
  // re-check on arrival (circling for parking), rather than curb-dumping a pile here.
  if (routeToParking(state, map, car)) {
    p.x = car.x; // keep riding (hidden) while it seeks a spot
    p.y = car.y;
    return true;
  }
  // a free stall is at hand (or it circled enough / no lot) → park, then walk the last mile.
  parkOwnedCarSomewhere(state, map, car);
  car.parkSeeks = undefined;
  car.path = undefined;
  car.leg = undefined;
  p.x = car.x;
  p.y = car.y;
  finishOnFoot(p);
  p.fuel = undefined; // fresh walking leg
  return true;
};

const PHASE_STEP: Partial<Record<Phase, PedStep>> = {
  inside: stepInside,
  driving: stepDriving,
  gathering: (state, map, rng, _ctx, p) => stepGatherer(state, map, rng, p),
};

// --- walking a leg -------------------------------------------------------------

/**
 * FUEL: a persistent tank, spent per substep by the terrain underfoot (beaten paths cheap, lush
 * ground dear) and refilled at plots. A citizen chasing an UNREACHABLE destination loops without
 * closing the distance and burns out — catching limit cycles longer than `recent`. On burnout it
 * turns back home on a limp-home reserve (losing some wellbeing); if it's ALREADY heading home (or
 * has no home), it respawns at home / despawns. Returns undefined while it still has fuel, else
 * whether it survives.
 */
function burnFuel(state: AmbientState, map: GameMap, p: Ped): boolean | undefined {
  p.fuel ??= FUEL_TANK;
  p.fuel -= fuelBurn(map, state.wear, Math.round(p.x), Math.round(p.y));
  if (!(p.fuel <= 0)) return undefined;
  if (p.carId === undefined && p.phase === 'to-building' && p.homeTile !== undefined) {
    p.phase = 'to-home';
    p.walkTo = homeXY(map, p.homeTile);
    p.building = undefined; // never visited the plot → carries no visit value, just the give-up cost
    recommitFromHere(p); // recommit the route home from here
    p.fuel = FUEL_LIMP_HOME; // a reserve to drag itself home (not a full tank)
    p.mode = TravelMode.Walk; // exhausted → limp home on foot
    depositHealth(state, p.homeTile, -GIVE_UP_PENALTY);
    return true;
  }
  return respawnAtHome(state, p, map); // couldn't even get home → respawn there (or despawn if homeless)
}

/**
 * Walking AND cycling legs follow a COMMITTED least-cost route (walkPath), so the agent routes
 * AROUND buildings/freeways instead of dithering in a greedy local minimum at a wall (Maddy: peds
 * piling up / drifting "to nowhere", and looping cyclists). Recompute only when the destination
 * (walkTo) changes; reuse otherwise.
 */
function commitWalkRoute(state: AmbientState, map: GameMap, p: Ped, tgtx: number, tgty: number): void {
  const goalIdx = map.idx(tgtx, tgty);
  if (p.path !== undefined && p.pathGoal === goalIdx) return;
  const route = walkPath(map, Math.round(p.x), Math.round(p.y), tgtx, tgty, state.wear, state.traffic, state.pollution);
  if (route && route.length >= 2) {
    const p0x = route[0]! % map.width;
    const p0y = (route[0]! - p0x) / map.width;
    const p1x = route[1]! % map.width;
    const p1y = (route[1]! - p1x) / map.width;
    p.x = p0x; // snap onto the route start (the rounded tile it already stands on)
    p.y = p0y;
    p.tx = p1x;
    p.ty = p1y;
    commitHeading(p, p1x > p0x ? 1 : p1x < p0x ? 3 : p1y > p0y ? 2 : 0); // a fresh route: turn onto it from the way it faced (arc / U-turn sweep)
    p.path = route;
    p.leg = 2; // route[0]=start, route[1]=committed next; pathStep targets route[2] onward
    p.pathGoal = goalIdx;
  } else {
    p.path = undefined; // already at the door (len 1) or no foot route → arrival/give-up below
    p.pathGoal = undefined;
  }
}

/** Advance along the leg one substep; returns whether it's still moving. The travel MODE sets the
 *  route (which tiles, which it hugs) and the speed (fast on its network, slower walking to a stop). */
function advanceLeg(state: AmbientState, map: GameMap, p: Ped, tgtx: number, tgty: number): boolean {
  const mode = p.mode ?? TravelMode.Walk;
  const hereKind = map.built[map.idx(Math.round(p.x), Math.round(p.y))]!;
  const speed = PED_SPEED * modeSpeedMult(mode, hereKind);
  if (usesCommittedPath(mode)) {
    commitWalkRoute(state, map, p, tgtx, tgty);
    // walkers keep their own pace round corners (Maddy 2026-10-08: the vehicles' arc pacing, at the kerb's tight
    // radius, shot them round at up to 13× a walk)
    return p.path !== undefined && advanceMover(p, speed, map, (x, y) => pathStep(map, p, x, y), undefined, 0, false);
  }
  // Transit legs (streetcar/elevated) hug their OWN line via the greedy mode-cost step (walkPath
  // doesn't know a tram network; a rider must prefer its rails). Dithering is rare on open lines.
  return advanceMover(
    p,
    speed,
    map,
    (x, y, _fromDir, recent) => nextStepToward(map, x, y, tgtx, tgty, recent, state.wear, mode, state.traffic, state.pollution),
    undefined,
    0,
    false, // their own pace (see above)
  );
}

// --- arrivals (the leg ended at its destination) ----------------------------------

/** Reached its OWNED car → plan a committed route to parking near the destination and drive it.
 *  (The car was parked, waiting.) If no road route exists, finish the leg on foot. */
const arriveAtVehicle: PedStep = (state, map, _rng, ctx, p) => {
  const car = p.carId !== undefined ? findCar(state, p.carId) : undefined;
  // wait in the stall until the way out is clear — cars leaving a lot at once all materialised on
  // the lot tile's centre, stacked on top of each other
  if (car && car.parked && !spaceClear(ctx.moverGrid, map.width, Math.round(car.x), Math.round(car.y))) return true;
  if (!car || !boardOwnedCar(state, p, map, car)) walkLegInstead(p);
  return true;
};

/** Reached the building → go inside; a successful visit refuels, and a citizen on a daily round
 *  BANKS the stop's wellbeing at home (less the leg's walk tolls). */
const arriveAtBuilding: PedStep = (state, map, rng, _ctx, p) => {
  p.phase = 'inside';
  p.dwellInside = INSIDE_DWELL_MIN + rng.nextInt(INSIDE_DWELL_SPAN);
  if (p.building) {
    const kind = map.built[map.idx(p.building.x, p.building.y)]!;
    p.fuel = Math.min(FUEL_TANK, (p.fuel ?? 0) + refuelFor(kind));
    // A single-stop walk citizen instead deposits once on getting home (arriveHome).
    if (p.itinerary !== undefined && p.homeTile !== undefined) {
      depositVisit(state, p.homeTile, p.building, map, walkPenalty(p));
    }
  }
  return true;
};

/** A sim/freight last-mile ped got back in → release its car to leave. */
const arriveAtCar: PedStep = (state, _map, _rng, _ctx, p) => {
  const car = findCar(state, p.carId!);
  if (car) car.dwell = 0;
  return false;
};

/** Walked home → deposit any single-stop visit (less the road/worn tolls) and put the car away. */
const arriveHome: PedStep = (state, map, _rng, _ctx, p) => {
  if (p.homeTile !== undefined && p.building) depositVisit(state, p.homeTile, p.building, map, walkPenalty(p));
  retireOwnedCar(state, p, map); // the citizen is home → its car is put away (lingers, then leaves)
  return false;
};

const ARRIVE: Partial<Record<Phase, PedStep>> = {
  'to-vehicle': arriveAtVehicle,
  'to-building': arriveAtBuilding,
  'to-car': arriveAtCar,
  'to-home': arriveHome,
};

/** A ped with a walk target: burn fuel, advance the leg, and on its end arrive (or give up). */
const stepWalking: PedStep = (state, map, rng, ctx, p) => {
  const tgtx = Math.round(p.walkTo!.x);
  const tgty = Math.round(p.walkTo!.y);
  const burnt = burnFuel(state, map, p);
  if (burnt !== undefined) return burnt;
  if (advanceLeg(state, map, p, tgtx, tgty)) return true; // still walking this leg
  // The leg ended (arrived within a tile, or no route) — drop the committed path so the NEXT leg
  // (a new stop / heading home) recomputes a fresh route.
  p.path = undefined;
  p.leg = undefined;
  p.pathGoal = undefined;
  // advanceMover stopped: arrived (reached the destination plot — adjacent to the target, or any
  // tile of a multi-tile footprint) or boxed in.
  const arrived = reachedPlot(map, Math.round(p.x), Math.round(p.y), tgtx, tgty);
  // A citizen that DROVE to its destination but can't complete the last-mile on FOOT — the building
  // is walled off by other non-walkable kinds (a job hemmed in by industry/buildings, like (79,106)
  // on the default seed: walkPath never reaches it) — has still ARRIVED: it reached the place by car
  // and ENTERS (a building is walkable when you're visiting it). Without this it gives up + respawns
  // home, and a fresh commuter repeats it forever (the (75,106) churn). Only a DRIVEN (carId)
  // to-building leg; a homeless/boxed walker with no car gives up: a homed citizen respawns at home
  // (home loses wellbeing); a bound/homeless ped despawns (a bound car releases on its timeout).
  if (!arrived && !(p.carId !== undefined && p.phase === 'to-building' && p.building)) {
    return respawnAtHome(state, p, map);
  }
  const arrive = p.phase !== undefined ? ARRIVE[p.phase] : undefined;
  return arrive ? arrive(state, map, rng, ctx, p) : false; // unbound routed ped → despawn on arrival
};

/**
 * An IDLE ped that HAS a home — a citizen repositioned beside home after a failed/boxed/exhausted
 * trip (respawnAtHome cleared its round) — heads HOME and goes inside, instead of aimlessly wandering
 * the green substrate. A ped with NO home AND no destination is the retired ambient-stroller pool —
 * it despawns (Maddy 2026-06-20: "everyone needs to path to somewhere").
 */
const stepIdle: PedStep = (_state, map, _rng, _ctx, p) => {
  if (p.homeTile === undefined) return false;
  const home = homeXY(map, p.homeTile);
  if (Math.abs(Math.round(p.x) - home.x) + Math.abs(Math.round(p.y) - home.y) <= 1) return false; // home → inside
  p.phase = 'to-home';
  p.walkTo = home;
  p.mode = TravelMode.Walk;
  recommitFromHere(p);
  return true;
};

/** Advance one pedestrian one substep; returns whether it survives. */
export function stepPed(state: AmbientState, map: GameMap, rng: Rng, ctx: VehicleCtx, p: Ped): boolean {
  if (!snapToWalkable(map, p)) return respawnAtHome(state, p, map);
  const hidden = p.phase !== undefined ? PHASE_STEP[p.phase] : undefined;
  if (hidden) return hidden(state, map, rng, ctx, p);
  if (p.walkTo !== undefined) return stepWalking(state, map, rng, ctx, p);
  return stepIdle(state, map, rng, ctx, p);
}
