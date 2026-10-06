// Pure ambient-life model: the deterministic stepper behind the cars, pedestrians,
// and bird flocks that animate over a built city. It READS the world (road class,
// pedestrian substrate, fauna presence) and writes ONLY its own AmbientState — no
// map writes, no parcel writes, no engine/sim rng. The renderer culls the resulting
// sprites to the viewport at draw time.
//
// This module is in the architecture guard's PURE_UI_ALLOWLIST, so it is DOM-free
// and transcendental-free: only Math.min/max/abs/floor/sqrt (exactly-rounded /
// integer) appear — never sin/cos/exp/pow/log/random. Determinism is load-bearing:
// every random choice draws from the caller's `fork('ambient')` Rng, so a worldgen
// or sim run is byte-identical whether or not the stepper is interleaved.
//
// Motion model (CRITIC-YP6): a car/ped carries a heading (`dir`) and a committed
// target tile (`tx`,`ty`); each substep it advances toward the target, and on
// arrival it recommits to a connected traversable neighbour EXCLUDING the immediate
// U-turn (unless a dead-end forces it). So traffic flows along a road and turns at
// junctions instead of vibrating A→B→A. Cars traverse `isRoadKind` (1..3) only — so
// they neither spawn on NOR move onto quiet streets (QuietStreet reads as a road to
// `transportCategory`, which is therefore deliberately unused here, YP4).

import type { GameMap } from '../engine/map';
import { BuiltKind } from '../engine/fabric';
import { TravelMode, modeSpeedMult } from '../citizens/modes';
import { layField, decayField } from '../citizens/field';
import type { Rng } from '../engine/rng';
import {
  AMBIENT_MAX_FRAME_MS,
  SUBSTEP_MS,
  ARREST_CADENCE,
  POLICE_VIOLENCE_DECAY,
  CAR_SPEED,
  PED_SPEED,
  HEALTH_DECAY,
  TRAFFIC_DECAY,
  POLL_MAX,
  POLL_DECAY,
  WIND_CADENCE,
  RAIN_CADENCE,
  LV_CADENCE,
  OCC_CADENCE,
  ROAD_WALK_PENALTY,
  WORN_DEGRADE_MIN,
  WORN_WALK_PENALTY,
  FUEL_TANK,
  FUEL_LIMP_HOME,
  GIVE_UP_PENALTY,
  WEAR_MAX,
  WEAR_RATE,
  WEAR_DECAY,
  WATER_RUNOFF_CADENCE,
  GROUND_RUNOFF_CADENCE,
  ROAD_CADENCE,
  INSIDE_DWELL_MIN,
  INSIDE_DWELL_SPAN,
  STUCK_GIVE_UP,
} from '../live/tuning';

import type { Mover, AmbientState } from '../live/types';
import {
  boardOwnedCar,
  walkLegInstead,
  headHome,
  skipJammedStop,
  advanceItinerary,
  parkOwnedCarSomewhere,
  routeToParking,
  retireOwnedCar,
  degradeAbandonedCar,
  spawnCitizens,
  tryPark,
  findCar,
  depositHealth,
  depositVisit,
  respawnAtHome,
} from '../live/agents';
import { buildSafeZones, policePhase, spawnCruisers, stepCruisers, stepArrests } from '../live/police';
import { spawnTrains, stepTrain } from '../live/trains';
import { flockTile, advanceFlock, spawnFlocks } from '../live/birds';
import { stepOccupancy } from '../live/fields/occupancy';
import { computeCoverage, recomputeLandValue, stepRoadDecay } from '../live/fields/landValue';
import {
  layTraffic,
  layPollution,
  accumulateWaterRunoff,
  accumulateGroundPollution,
  driftPollution,
  diffusePollution,
  applyRain,
  flowWaterPollution,
  treatWaterPollution,
} from '../live/fields/pollution';
import {
  congestionSpeedMult,
  congestionCount,
  rerouteIfStuck,
  uTurnIfStuck,
  spaceClear,
  commitHeading,
  buildMoverGrid,
  assignSerials,
  blockedAhead,
  boxBlocked,
  advanceMover,
  pathStep,
} from '../live/motion';
import {
  nearestWalkable,
  usesCommittedPath,
  fuelBurn,
  refuelFor,
  nextStepToward,
  walkPath,
} from '../live/pathing';
import {
  birdSpawnAt,
  nextRoadStep,
  carOffNetwork,
  isWalkable,
  reachedPlot,
  isWearable,
  pedDespawns,
} from '../live/network';
import { pedLegLateral, snapshotMovers } from '../live/poses';

export * from '../live/caps';
export * from '../live/types';

export {
  AMBIENT_MAX_FRAME_MS,
  SUBSTEP_MS,
  OCC_SETTLE_PASSES,
  FUEL_TANK,
  STUCK_REPATH,
  STUCK_UTURN,
  STUCK_GIVE_UP,
  JAM_SKIP_PENALTY,
  STUCK_ESCAPE,
} from '../live/tuning';

export {
  CAR_LENGTH,
  CAR_WIDTH,
  LANE_OFFSET,
  laneOffset,
  curbParkOffset,
} from '../live/geometry';

export {
  legPaceFactor,
  type Pose,
  type LateralProfile,
  syncTrainLegs,
  trainPoses,
  moverPose,
  snapshotMovers,
  ambientAlpha,
  carPose,
  pedPose,
} from '../live/poses';

export {
  carWeightForRoad,
  isCarRoad,
  type FreewayLane,
  freewayLane,
  isPedSubstrate,
  birdSpawnAt,
  isParkable,
  curbStallOffsets,
  canDrive,
  nextRoadStep,
  nextRailStep,
  carOffNetwork,
  reachedPlot,
  isWearable,
  pedDespawns,
} from '../live/network';

export {
  nearestWalkable,
  pedCost,
  usesCommittedPath,
  roadPath,
  walkPath,
  nearestOfCategory,
  chooseMode,
  jamNear,
  tripEvaporates,
} from '../live/pathing';

export {
  congestionSpeedMult,
  congestionCount,
  rerouteIfStuck,
  uTurnIfStuck,
  spaceClear,
  commitHeading,
  buildMoverGrid,
  blockedAhead,
  boxBlocked,
} from '../live/motion';

export {
  prevailingWind,
  pollutionEmit,
  accumulateWaterRunoff,
  accumulateGroundPollution,
  driftPollution,
  diffusePollution,
  applyRain,
  flowWaterPollution,
  treatWaterPollution,
  seedDecay,
} from '../live/fields/pollution';

export { computeCoverage, landValueAt, recomputeLandValue, stepRoadDecay } from '../live/fields/landValue';

export {
  capacityOf,
  occupancySignal,
  occupancyStep,
  spawnTargetFor,
  stepOccupancy,
} from '../live/fields/occupancy';

export { spawnTrains } from '../live/trains';

export {
  buildSafeZones,
  policePhase,
  arrestChance,
  spawnCruisers,
  huntTarget,
  nextPatrolStep,
  stepCruisers,
  stepArrests,
} from '../live/police';

export {
  skipJammedStop,
  stopReachable,
  parkOwnedCarSomewhere,
  routeToParking,
  sendOwnedCarHome,
  abandonOwnedCar,
  degradeAbandonedCar,
  ingestTrips,
} from '../live/agents';

/** The LIVE sample values the inspector appends to its readout — each undefined when the tile
 *  carries no such field (a road has traffic/smog but no population; a home the reverse). */
export interface LiveSamples {
  occupancy?: number;
  landValue?: number;
  health?: number;
  traffic?: number;
  pollution?: number;
  water?: number;
  road?: number;
  violence?: number;
  /** Fire/health service: true = covered, false = under-served. Omitted when not applicable. */
  served?: boolean;
}

/**
 * Format the live-layer samples for the inspect readout — `pop 12 · land value 64 · traffic 30 ·
 * smog 8`, in a fixed order, omitting any field the tile doesn't carry. Returns '' when nothing is
 * present (so the host appends nothing). Pure: rounds for display, reads only its argument.
 */
export function liveInspectLine(s: LiveSamples): string {
  const parts: string[] = [];
  if (s.occupancy !== undefined) parts.push(`pop ${Math.round(s.occupancy)}`);
  if (s.landValue !== undefined) parts.push(`land value ${Math.round(s.landValue)}`);
  if (s.health !== undefined) parts.push(`health ${Math.round(s.health)}`);
  if (s.traffic !== undefined) parts.push(`traffic ${Math.round(s.traffic)}`);
  if (s.pollution !== undefined) parts.push(`smog ${Math.round(s.pollution)}`);
  if (s.water !== undefined) parts.push(`water ${Math.round(s.water)} contaminated`);
  if (s.road !== undefined) parts.push(`road ${Math.round(s.road)} crumbling`);
  if (s.violence !== undefined) parts.push(`police violence ${Math.round(s.violence)}`);
  if (s.served !== undefined) parts.push(s.served ? 'served' : 'under-served');
  return parts.join(' · ');
}

// --- The substep + the public stepper ------------------------------------

function substep(state: AmbientState, map: GameMap, rng: Rng): void {
  // 1. Despawn anything whose substrate vanished (read-only self-healing). See pedDespawns for the
  //    exemptions (last-mile walkers + hidden drivers).
  state.cars = state.cars.filter((c) => !carOffNetwork(map, c));
  state.peds = state.peds.filter((p) => !pedDespawns(map, p));
  for (const f of state.birds) {
    const t = flockTile(map, f);
    if (!birdSpawnAt(map, t.x, t.y)) f.birds.pop();
  }
  state.birds = state.birds.filter((f) => f.birds.length > 0);

  // 2. Spawn the daily-itinerary CITIZENS (the foot population — from the residential census; each
  //    runs a home→work→shop→lifestyle→leisure round, so green/leisure tiles draw real trips). There
  //    is no ambient-wanderer pool (Maddy 2026-06-20: everyone paths to a destination). Cars are NOT
  //    spawned here — they are the citizens' own cars, boarded when a leg is too long to walk
  //    (cars=trips). Last-mile walkers spawn on a car PARKING (see tryPark → spawnParkPed), not here.
  spawnCitizens(state, map, rng);
  spawnFlocks(state, map, rng);
  spawnCruisers(state, map, rng); // top the patrol fleet up from the precincts
  spawnTrains(state, map, rng); // ambient trains on the rail network
  // Advance the trains along their rails; a train whose line vanished underneath despawns.
  state.trains = state.trains.filter((t) => stepTrain(map, t, rng));

  // Per-tile, per-DIRECTION histogram of MOVING cars (a snapshot at substep start), for the pileup
  // slowdown: a car on a crowded tile creeps (congestion made physical). Counts free + owned-being-
  // driven cars; parked and abandoned cars sit off to the side and don't jam. Direction-aware so a car
  // is only slowed by same-direction / orthogonal traffic — oncoming (opposite) cars are just passing
  // (Maddy). Both car movers below read this, passing the moving car's heading.
  const carDirHist = new Map<number, [number, number, number, number]>();
  for (const c of state.cars) {
    if (c.parked || c.abandoned) continue;
    const i = map.idx(Math.round(c.x), Math.round(c.y));
    let h = carDirHist.get(i);
    if (!h) carDirHist.set(i, (h = [0, 0, 0, 0]));
    const d = c.dir & 3; // 0..3
    h[d] = h[d]! + 1;
  }
  const speedAt = (base: number, x: number, y: number, dir: number): number => {
    const h = carDirHist.get(map.idx(x, y));
    return h ? base * congestionSpeedMult(congestionCount(h, dir)) : base;
  };

  // Collision/following: vehicles can't overlap — a car PAUSES if a same-direction vehicle sits in the
  //    bounding-box space just ahead (Maddy: queues form, trips take longer). Grid built from the moving
  //    cars + cruisers at substep start; cruisers share it (stepCruisers below).
  const gridMovers = [...state.cars.filter((c) => !c.parked && !c.abandoned), ...state.cruisers]; // PARKED cars don't count (Maddy)
  assignSerials(state, gridMovers);
  const moverGrid = buildMoverGrid(gridMovers, map.width);
  const blocked = (mm: Mover): boolean => blockedAhead(moverGrid, map.width, mm) || boxBlocked(moverGrid, map, mm);

  // 3. Move the cars. A PARKED car waits for its pedestrian (its bound ped zeroes `dwell` on
  //    return; the countdown is just a safety release). A moving trip-car follows its path
  //    and, on arrival, PARKS (a lot stall, or a street curb if none) — it no longer vanishes
  //    at the destination. A path-less car (a test fixture) falls back to the grid wander.
  state.cars = state.cars.filter((c) => {
    // An ABANDONED derelict (its citizen was arrested) sits on its empty tile rusting into ground
    // pollution, then despawns — the toxic legacy left behind, not driven anywhere.
    if (c.abandoned) return degradeAbandonedCar(state, map, c);
    // An OWNED citizen-car is managed entirely by its owner ped (it walks to it, drives it, parks
    // it, retires it). The filter never moves, dwells, or despawns it — so it never vanishes while
    // its owner is away on foot. (Demoted to a plain parked car when the owner's round ends.)
    if (c.owned) return true;
    if (c.parked) {
      c.dwell! -= 1;
      return c.dwell! > 0;
    }
    // A freeway moves traffic twice as fast as a surface street; a crowded tile slows every car on it.
    const cx = Math.round(c.x);
    const cy = Math.round(c.y);
    const onFreeway = map.built[map.idx(cx, cy)] === BuiltKind.RoadHighway;
    const sp = speedAt(onFreeway ? CAR_SPEED * 2 : CAR_SPEED, cx, cy, c.dir) * (c.speedMul ?? 1);
    if (c.path !== undefined) {
      // jam ladder: re-plan round it, then turn back; a trip still jammed after that just ends
      rerouteIfStuck(map, c, state.traffic);
      uTurnIfStuck(map, c, state.traffic);
      if ((c.stuck ?? 0) >= STUCK_GIVE_UP) return false;
      const alive = advanceMover(c, sp, map, (x, y) => pathStep(map, c, x, y), blocked);
      return alive ? true : tryPark(state, c, map);
    }
    return advanceMover(c, sp, map, (x, y, fromDir, recent) =>
      nextRoadStep(map, x, y, fromDir, rng, recent), blocked,
    );
  });

  // 3a. Police: advance the scatter/chase clock, move the cruisers (hunt in chase, patrol in
  //     scatter), and run the arrest sweep ONLY during a chase — the streets pulse between calm
  //     and active sweeps (the ghost cadence).
  state.policeTick += 1;
  // Community safe-zones the cruisers avoid + never sweep (built fresh only when there ARE cruisers).
  const safe = state.cruisers.length > 0 ? buildSafeZones(map) : undefined;
  stepCruisers(state, map, rng, safe, moverGrid);
  state.arrestTick += 1;
  if (state.arrestTick % ARREST_CADENCE === 0 && policePhase(state.policeTick) === 'chase') {
    stepArrests(state, map, rng, safe);
  }

  // 3b. Move the pedestrians. A walk target (walkTo) is reached by a MANHATTAN walk — an
  //     axis-aligned, tile-by-tile route over walkable tiles (never diagonally, never through
  //     a plot). A BOUND ped (carId) runs its car→building→inside→car machine, releasing its
  //     car on return. Others wander on ped substrate.
  state.peds = state.peds.filter((p) => {
    // Self-heal the substrate invariant: a visible ped must stand on the walkable set. If it was
    // placed off it (open water, a freeway, a plot — a degenerate spawn/park), snap it back onto
    // the nearest solid tile, or respawn home if it's truly stranded. Riders ('driving') and peds
    // 'inside' a building are hidden and exempt. (Maddy: pedestrians crossing water / freeways.)
    if (
      p.phase !== 'driving' &&
      p.phase !== 'inside' &&
      !isWalkable(map, Math.round(p.x), Math.round(p.y))
    ) {
      const w = nearestWalkable(map, Math.round(p.x), Math.round(p.y));
      if (w === null) return respawnAtHome(state, p, map);
      p.x = w.x;
      p.y = w.y;
      p.tx = w.x;
      p.ty = w.y;
      p.recent = undefined;
    }
    if (p.phase === 'inside') {
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
        const hx = p.homeTile! % map.width;
        const hy = (p.homeTile! - hx) / map.width;
        p.phase = 'to-home';
        p.walkTo = { x: hx, y: hy };
      }
      p.tx = Math.round(p.x); // recommit the Manhattan route from here toward the destination
      p.ty = Math.round(p.y);
      p.recent = undefined;
      return true;
    }

    if (p.phase === 'driving') {
      // The citizen rides its owned car along a COMMITTED least-cost route (set at boarding — no
      // greedy circling), fast on freeways, laying live traffic as it goes (which other cars route
      // around). On arrival it PARKS in a free, non-freeway spot and the citizen walks the last mile.
      const car = p.carId !== undefined ? findCar(state, p.carId) : undefined;
      if (!car || car.path === undefined) {
        p.phase = p.homeDest ? 'to-home' : 'to-building'; // lost the car / no route → finish on foot
        p.walkTo = p.homeDest ?? p.building ?? { x: Math.round(p.x), y: Math.round(p.y) };
        p.mode = TravelMode.Walk;
        p.tx = Math.round(p.x);
        p.ty = Math.round(p.y);
        p.recent = undefined;
        return true;
      }
      const carx = Math.round(car.x);
      const cary = Math.round(car.y);
      const onFreeway = map.built[map.idx(carx, cary)] === BuiltKind.RoadHighway;
      // Freeways move traffic 2×; a crowded tile slows it (the same pileup field the car filter uses).
      const sp = speedAt(onFreeway ? CAR_SPEED * 2 : CAR_SPEED, carx, cary, car.dir) * (car.speedMul ?? 1);
      // an owned car obeys the same space-ahead rule as every other vehicle (it used to drive through queues)
      // jam ladder: re-plan round it, then turn back, then give up on this stop (small wellbeing hit)
      rerouteIfStuck(map, car, state.traffic);
      uTurnIfStuck(map, car, state.traffic);
      if ((car.stuck ?? 0) >= STUCK_GIVE_UP) {
        skipJammedStop(state, p, map);
        return true;
      }
      const moving = advanceMover(car, sp, map, (x, y) => pathStep(map, car, x, y), blocked);
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
      p.phase = p.homeDest ? 'to-home' : 'to-building';
      p.walkTo = p.homeDest ?? p.building ?? { x: Math.round(p.x), y: Math.round(p.y) };
      p.mode = TravelMode.Walk;
      p.tx = Math.round(p.x);
      p.ty = Math.round(p.y);
      p.recent = undefined;
      p.fuel = undefined; // fresh walking leg
      return true;
    }
    if (p.walkTo !== undefined) {
      const tgtx = Math.round(p.walkTo.x);
      const tgty = Math.round(p.walkTo.y);
      // FUEL: a persistent tank, spent per substep by the terrain underfoot (beaten paths cheap,
      //   lush ground dear) and refilled at plots. A citizen chasing an UNREACHABLE destination loops
      //   without closing the distance and burns out — catching limit cycles longer than `recent`.
      //   On burnout it turns back home on a limp-home reserve (losing some wellbeing); if it's
      //   ALREADY heading home (or has no home), it respawns at home / despawns.
      p.fuel ??= FUEL_TANK;
      p.fuel -= fuelBurn(map, state.wear, Math.round(p.x), Math.round(p.y));
      if (p.fuel <= 0) {
        if (p.carId === undefined && p.phase === 'to-building' && p.homeTile !== undefined) {
          const hx = p.homeTile % map.width;
          const hy = (p.homeTile - hx) / map.width;
          p.phase = 'to-home';
          p.walkTo = { x: hx, y: hy };
          p.building = undefined; // never visited the plot → carries no visit value, just the give-up cost
          p.tx = Math.round(p.x); // recommit the route home from here
          p.ty = Math.round(p.y);
          p.recent = undefined;
          p.fuel = FUEL_LIMP_HOME; // a reserve to drag itself home (not a full tank)
          p.mode = TravelMode.Walk; // exhausted → limp home on foot
          depositHealth(state, p.homeTile, -GIVE_UP_PENALTY);
          return true;
        }
        return respawnAtHome(state, p, map); // couldn't even get home → respawn there (or despawn if homeless)
      }
      // The travel MODE sets the route (which tiles, which it hugs) and the speed (fast on its
      // network — a tram on its line, a driver on roads — slower walking to/from a stop).
      const mode = p.mode ?? TravelMode.Walk;
      const hereKind = map.built[map.idx(Math.round(p.x), Math.round(p.y))]!;
      const speed = PED_SPEED * modeSpeedMult(mode, hereKind);
      let moving: boolean;
      if (usesCommittedPath(mode)) {
        // Walking AND cycling legs follow a COMMITTED least-cost route (walkPath), so the agent routes
        // AROUND buildings/freeways instead of dithering in a greedy local minimum at a wall (Maddy:
        // peds piling up / drifting "to nowhere", and looping cyclists). Recompute only when the
        // destination (walkTo) changes; reuse otherwise.
        const goalIdx = map.idx(tgtx, tgty);
        if (p.path === undefined || p.pathGoal !== goalIdx) {
          const route = walkPath(
            map, Math.round(p.x), Math.round(p.y), tgtx, tgty, state.wear, state.traffic, state.pollution,
          );
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
        moving = p.path !== undefined && advanceMover(p, speed, map, (x, y) => pathStep(map, p, x, y), undefined, pedLegLateral(map, p));
      } else {
        // Transit legs (streetcar/elevated) hug their OWN line via the greedy mode-cost step (walkPath
        // doesn't know a tram network; a rider must prefer its rails). Dithering is rare on open lines.
        moving = advanceMover(p, speed, map, (x, y, _fromDir, recent) =>
          nextStepToward(map, x, y, tgtx, tgty, recent, state.wear, mode, state.traffic, state.pollution),
          undefined,
          pedLegLateral(map, p),
        );
      }
      if (moving) return true; // still walking this leg
      // The leg ended (arrived within a tile, or no route) — drop the committed path so the NEXT leg
      // (a new stop / heading home) recomputes a fresh route.
      p.path = undefined;
      p.leg = undefined;
      p.pathGoal = undefined;
      // advanceMover stopped: arrived (reached the destination plot — adjacent to the target, or any
      // tile of a multi-tile footprint) or boxed in.
      const arrived = reachedPlot(map, Math.round(p.x), Math.round(p.y), tgtx, tgty);
      if (!arrived) {
        // A citizen that DROVE to its destination but can't complete the last-mile on FOOT — the
        // building is walled off by other non-walkable kinds (a job hemmed in by industry/buildings,
        // like (79,106) on the default seed: walkPath never reaches it) — has still ARRIVED: it reached
        // the place by car and ENTERS (Maddy: a building is walkable when you're visiting it). Without
        // this it gives up + respawns home, and a fresh commuter repeats it forever → rapid spawn/
        // despawn (the (75,106) churn). Falls through to the 'to-building' handler → goes inside. Only
        // a DRIVEN (carId) to-building leg; a homeless/boxed walker with no car still gives up below.
        if (!(p.carId !== undefined && p.phase === 'to-building' && p.building)) {
          // pathing went nowhere (boxed in, dead-ended at a freeway) — the citizen gives up. A homed
          // citizen respawns at home (the household persists) and home loses wellbeing; a bound/homeless
          // ped despawns (a bound car releases on its safety timeout).
          return respawnAtHome(state, p, map);
        }
      }
      if (p.phase === 'to-vehicle') {
        // Reached its OWNED car → plan a COMMITTED least-cost route to a free parking spot near the
        // destination, then drive it. (The car was parked, waiting; it never vanished.) If no road
        // route exists, finish the leg on foot.
        const car = p.carId !== undefined ? findCar(state, p.carId) : undefined;
        // wait in the stall until the way out is clear — cars leaving a lot at once all materialised on
        // the lot tile's centre, stacked on top of each other
        if (car && car.parked && !spaceClear(moverGrid, map.width, Math.round(car.x), Math.round(car.y))) return true;
        if (!car || !boardOwnedCar(state, p, map, car)) walkLegInstead(p);
        return true;
      }
      if (p.phase === 'to-building') {
        p.phase = 'inside';
        p.dwellInside = INSIDE_DWELL_MIN + rng.nextInt(INSIDE_DWELL_SPAN);
        if (p.building) {
          const kind = map.built[map.idx(p.building.x, p.building.y)]!;
          // A successful visit refuels the citizen by the plot's status/use (a good plot restores more).
          p.fuel = Math.min(FUEL_TANK, (p.fuel ?? 0) + refuelFor(kind));
          // A citizen on a daily round BANKS each stop's wellbeing at home as it visits (less the
          // leg's walk tolls), so its home health tracks where its people actually go. A single-stop
          // walk citizen instead deposits once on getting home (below).
          if (p.itinerary !== undefined && p.homeTile !== undefined) {
            const penalty = Math.floor(
              (p.roadSteps ?? 0) * ROAD_WALK_PENALTY + (p.wornSteps ?? 0) * WORN_WALK_PENALTY,
            );
            depositVisit(state, p.homeTile, p.building, map, penalty);
          }
        }
        return true;
      }
      if (p.phase === 'to-car') {
        // A sim/freight last-mile ped got back in → release its car to leave.
        const car = findCar(state, p.carId!);
        if (car) car.dwell = 0;
        return false;
      }
      if (p.phase === 'to-home') {
        // Walked home → deposit any single-stop visit (sim walk citizens), less the road/worn tolls.
        if (p.homeTile !== undefined && p.building) {
          const penalty = Math.floor(
            (p.roadSteps ?? 0) * ROAD_WALK_PENALTY + (p.wornSteps ?? 0) * WORN_WALK_PENALTY,
          );
          depositVisit(state, p.homeTile, p.building, map, penalty);
        }
        retireOwnedCar(state, p, map); // the citizen is home → its car is put away (lingers, then leaves)
        return false;
      }
      return false; // unbound routed ped → despawn on arrival
    }
    // An IDLE ped that HAS a home — a citizen repositioned beside home after a failed/boxed/exhausted
    // trip (respawnAtHome cleared its round) — heads HOME and goes inside, instead of aimlessly
    // wandering the green substrate forever (Maddy: "citizens not commuting home; peds roam parks/
    // rewilded, may never go home"). At the door it goes inside (despawns into the household).
    if (p.homeTile !== undefined) {
      const hx = p.homeTile % map.width;
      const hy = (p.homeTile - hx) / map.width;
      if (Math.abs(Math.round(p.x) - hx) + Math.abs(Math.round(p.y) - hy) <= 1) return false; // home → inside
      p.phase = 'to-home';
      p.walkTo = { x: hx, y: hy };
      p.mode = TravelMode.Walk;
      p.tx = Math.round(p.x);
      p.ty = Math.round(p.y);
      p.recent = undefined;
      return true;
    }
    // A ped with NO home AND no destination is the retired ambient-stroller pool — it despawns
    // (Maddy 2026-06-20: "there should be no ambient stroller pool anymore. everyone needs to path
    // to somewhere"). Purposeful agents are citizens (an itinerary + home, with green/leisure stops),
    // last-mile walkers (a car + walkTo), and cruisers — never destination-less wanderers.
    return false;
  });
  for (const f of state.birds) advanceFlock(f);

  // 4. Building health eases toward neutral so it tracks RECENT citizen visits, not all-time.
  if (state.buildingHealth.size > 0) {
    for (const [k, v] of [...state.buildingHealth]) {
      const nv = v > 0 ? v - HEALTH_DECAY : v + HEALTH_DECAY;
      if (Math.abs(nv) < HEALTH_DECAY) state.buildingHealth.delete(k);
      else state.buildingHealth.set(k, nv);
    }
  }

  // 5. Desire-path WEAR: every pedestrian on a wild-green tile beats it down a little; unused
  //    wear regrows. Cars don't count (they ride pavement) — this is foot traffic forming paths.
  for (const p of state.peds) {
    const tx = Math.round(p.x);
    const ty = Math.round(p.y);
    if (isWearable(map, tx, ty)) {
      const i = map.idx(tx, ty);
      const capped = layField(state.wear, i, WEAR_RATE, WEAR_MAX);
      // A walking citizen crossing a heavily-worn (degraded, littered) path brings home less — the
      // beaten path is convenient but bleak.
      if (p.phase !== undefined && p.carId === undefined && capped >= WORN_DEGRADE_MIN) {
        p.wornSteps = (p.wornSteps ?? 0) + 1;
      }
    } else if (p.phase !== undefined && p.carId === undefined) {
      // A walking citizen trudging a road/stroad accrues the unpleasant-commute penalty.
      const k = map.built[map.idx(tx, ty)]!;
      if (k === BuiltKind.RoadStreet || k === BuiltKind.RoadAvenue) p.roadSteps = (p.roadSteps ?? 0) + 1;
    }
  }
  decayField(state.wear, WEAR_DECAY);

  // 5b. Live traffic eases back where no car is passing — so the agent-driven field tracks CURRENT
  //     driving, and a calmed/bypassed road clears.
  decayField(state.traffic, TRAFFIC_DECAY);

  // 5c. Dirty power plants emit smog from their footprint plume every pass (persistent exhaust,
  //     like a parked source) — laid BEFORE the decay so a coal/gas district stays hazy while a
  //     renewable one clears. Clean plants publish no emitters.
  if (state.plantEmitters) {
    for (const e of state.plantEmitters) layField(state.pollution, e.tile, e.amount, POLL_MAX);
  }

  // 5d. Prevailing wind: on its own clock, carry the smog one tile downwind so plumes streak away
  //     from their sources (the freeway, the coal plant) across the neighbourhoods downwind, rather
  //     than only diffusing/lingering in place. Runs before the decay so the drifted haze still fades.
  state.windTick += 1;
  if (state.windTick % WIND_CADENCE === 0) {
    driftPollution(state, map); // wind streaks the plume downwind
    diffusePollution(state, map); // ...and it diffuses outward (drift + diffusion = a real plume)
  }
  // Occasional rain washes smog→ground→water (diluted, so pollution relocates toward the low banks,
  // doesn't vanish) — the air clears but the ground/water load (Maddy's env-justice arc).
  state.rainTick += 1;
  if (state.rainTick % RAIN_CADENCE === 0) applyRain(state, map);

  // Air pollution lingers as smog and eases back slowly (slower than traffic) — so calming a
  // corridor clears its jam quickly but the haze takes longer to lift.
  decayField(state.pollution, POLL_DECAY);
  // Police-violence record fades slowly — the harm lingers far longer than smog.
  decayField(state.policeViolence, POLICE_VIOLENCE_DECAY);

  // 6. Water runoff: on a slow cadence, each coastal water tile collects pollution from the
  //    ground around it and grows heavily polluted over time (impassable, so it never wears).
  state.waterTick += 1;
  if (state.waterTick % WATER_RUNOFF_CADENCE === 0) {
    accumulateWaterRunoff(state, map);
    flowWaterPollution(state, map); // carry the contamination downstream to the banks below
    treatWaterPollution(state, map); // the player's wastewater works heals it back
  }

  // 6b. Ground contamination: on the same slow cadence, industry + dirty power + demand-path litter
  //     poison the land they sit on and the land around them — lingering, but clearing once the
  //     source is gone (the toxic legacy the player heals; the source the creeks run off from).
  state.groundTick += 1;
  if (state.groundTick % GROUND_RUNOFF_CADENCE === 0) {
    accumulateGroundPollution(state, map);
  }

  // 7. Land value: on a slow cadence, recompute each plot's desirability from the healed land +
  //    amenities minus the live nuisances. A readout over the other layers — derived, not laid.
  state.lvTick += 1;
  if (state.lvTick % LV_CADENCE === 0) {
    state.coverage = computeCoverage(map); // refresh fire/health coverage before land value reads it
    recomputeLandValue(state, map);
  }

  // 8. Population: on a slow cadence, drift each home's occupancy toward its capacity (prized/clean/
  //    healthy) or empty (decayed/smoggy). Runs AFTER land value so it reads the fresh field. The
  //    spawn target + home weighting follow this — closing the agent-emergent population loop.
  state.occTick += 1;
  if (state.occTick % OCC_CADENCE === 0) stepOccupancy(state, map);

  // 9. Road decay: on a slow infrastructure clock, redlined roads crumble while cared-for
  //    neighborhoods' roads recover. Runs after land value so it reads the fresh field.
  state.roadTick += 1;
  if (state.roadTick % ROAD_CADENCE === 0) stepRoadDecay(state, map);
}

/**
 * Advance the ambient state by `dtMs` of wall-clock time, in fixed 50ms substeps.
 * Clamps `dtMs` to AMBIENT_MAX_FRAME_MS first (so a pathological gap can never spin
 * more than AMBIENT_MAX_FRAME_MS/50 = 20 substeps and hang the frame). Writes ONLY
 * `state`; `map` is read-only.
 */
export function stepAmbient(state: AmbientState, map: GameMap, rng: Rng, dtMs: number): void {
  state.accMs += Math.min(dtMs, AMBIENT_MAX_FRAME_MS);
  while (state.accMs >= SUBSTEP_MS) {
    state.accMs -= SUBSTEP_MS;
    snapshotMovers(state); // the "before" pose the renderer interpolates from
    substep(state, map, rng);
  }
}
