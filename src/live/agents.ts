// Live-layer AGENTS: the citizens and their owned cars. Daily-itinerary citizens spawn from the
// live occupancy, pick a mode per leg, walk to an owned car, drive, park (lot stall or kerb) and walk
// the last mile; owned cars are retired, sent home or abandoned (rusting into ground pollution); the
// wellbeing a visit carries home is deposited into the home's health. Parking, owned cars and
// citizens are mutually recursive, so they share one module. Cut verbatim from ui/ambientContent.ts.

import type { GameMap } from '../engine/map';
import { visitValue } from '../citizens/plots';
import { DAILY_ITINERARY } from '../citizens/itinerary';
import { TravelMode } from '../citizens/modes';
import type { Household } from '../citizens/census';
import { layField } from '../citizens/field';
import type { Rng } from '../engine/rng';
import { liveCaps } from './caps';
import {
  ABANDONED_DEGRADE_TIME,
  ABANDONED_GROUND_POLL,
  CURB_RADIUS,
  FAILED_TRIP_PENALTY,
  GROUND_POLL_MAX,
  HEALTH_MAX,
  JAM_SKIP_PENALTY,
  LOT_ABSORB_MARGIN,
  LOT_REROUTE_RADIUS,
  MAX_PARK_SEEKS,
  PARK_CLAIM_DIST,
  PARK_MAX_WAIT,
  PARK_RADIUS,
  RETIRED_CAR_LINGER,
} from './tuning';
import { DIR_DX, DIR_DY } from './geometry';
import type { AmbientState, Car, ParkingLotInfo, Ped } from './types';
import { spawnTargetFor } from './fields/occupancy';
import { commitHeading } from './motion';
import {
  chooseMode,
  jamNear,
  nearestDemandTile,
  nearestDriveStart,
  nearestEmptyTile,
  nearestOfCategory,
  nearestWalkable,
  roadPath,
  tripEvaporates,
  walkPath,
} from './pathing';
import { curbStallOffsets, isCarRoad, isParkable, isWalkable } from './network';

/**
 * Put a citizen in its owned car and commit the car to a least-cost route to a free parking spot near
 * the citizen's leg destination (`building`, else `homeDest`): the car snaps onto the route's first tile
 * and the citizen rides ('driving'). Returns false (touching nothing) when there's no destination or
 * no road route.
 */
export function boardOwnedCar(state: AmbientState, p: Ped, map: GameMap, car: Car): boolean {
  const dest = p.building ?? p.homeDest;
  if (!dest) return false;
  const spot = findParkingNear(state, map, dest.x, dest.y) ?? dest;
  const path = roadPath(map, Math.round(car.x), Math.round(car.y), spot.x, spot.y, state.traffic);
  if (!path || path.length < 2) return false;
  // Board: snap onto the route's first tile and commit to following it (cars=committed paths).
  const p0x = path[0]! % map.width;
  const p0y = (path[0]! - p0x) / map.width;
  const p1x = path[1]! % map.width;
  const p1y = (path[1]! - p1x) / map.width;
  car.x = p0x;
  car.y = p0y;
  car.tx = p1x;
  car.ty = p1y;
  commitHeading(car, p1x > p0x ? 1 : p1x < p0x ? 3 : p1y > p0y ? 2 : 0); // a fresh route: turn onto it from the way it faced (arc / U-turn sweep)
  car.path = path;
  car.leg = 2; // path[0]=start, path[1]=the committed next tile; pathStep targets path[2] next
  car.parked = false;
  car.curbSlot = undefined; // it has left its stall
  car.lotIdx = undefined;
  car.stallIdx = undefined;
  car.recent = undefined;
  car.stuck = 0;
  p.parkAt = spot;
  p.phase = 'driving';
  return true;
}

/** No drive possible: finish the current leg on foot (to its building, or home). */
export function walkLegInstead(p: Ped): void {
  p.phase = p.homeDest ? 'to-home' : 'to-building';
  p.walkTo = p.homeDest ?? p.building ?? { x: Math.round(p.x), y: Math.round(p.y) };
  p.mode = TravelMode.Walk;
  p.tx = Math.round(p.x);
  p.ty = Math.round(p.y);
  p.recent = undefined;
}

/** Park an owned car right where it stands — at a free kerb stall of its tile if there is one — so it is
 *  never left standing in a traffic lane when its driver has to walk on. */
export function parkInPlace(state: AmbientState, map: GameMap, car: Car): void {
  const tx = Math.round(car.x);
  const ty = Math.round(car.y);
  const taken = new Set(
    state.cars.filter((o) => o !== car && o.parked && o.curbSlot !== undefined && Math.round(o.x) === tx && Math.round(o.y) === ty).map((o) => o.curbSlot!),
  );
  const stalls = curbStallOffsets(map, tx, ty);
  const slot = stalls.findIndex((_, i) => !taken.has(i));
  if (slot >= 0) {
    const st = stalls[slot]!;
    car.x = tx + st.dx;
    car.y = ty + st.dy;
    car.curbDir = st.dir;
    car.curbSlot = slot;
  } else {
    car.x = tx;
    car.y = ty;
  }
  car.tx = tx;
  car.ty = ty;
  car.parked = true;
  car.path = undefined;
  car.stuck = 0;
}

/** Send a citizen home: drive its owned car home to park it if it has one out, else walk. */
export function headHome(state: AmbientState, p: Ped, map: GameMap): void {
  const hx = p.homeTile! % map.width;
  const hy = (p.homeTile! - hx) / map.width;
  const car = p.carId !== undefined ? findCar(state, p.carId) : undefined;
  if (!(car && setDriveLeg(state, p, map, { x: hx, y: hy }, 'to-home'))) {
    p.phase = 'to-home';
    p.walkTo = { x: hx, y: hy };
    p.building = undefined; // stops banked on arrival; the home leg carries nothing extra
    p.mode = TravelMode.Walk;
  }
}

/**
 * Jam rung 3: a citizen whose car has been jammed STUCK_GIVE_UP substeps abandons the stop it was driving
 * to — the household takes a small wellbeing hit (JAM_SKIP_PENALTY) — and moves on to the next reachable
 * stop of its round (driving its car there), or home if none remain (Maddy 2026-09-30).
 */
export function skipJammedStop(state: AmbientState, p: Ped, map: GameMap): void {
  if (p.homeTile !== undefined) depositHealth(state, p.homeTile, -JAM_SKIP_PENALTY);
  const car = p.carId !== undefined ? findCar(state, p.carId) : undefined;
  if (car) car.stuck = 0;
  if (!(p.itinerary !== undefined && advanceItinerary(state, p, map)) && p.homeTile !== undefined) headHome(state, p, map);
  // the driver is IN its car: don't dismount and walk back to it — re-route the car straight on; if no
  // route exists, park it right here (never left standing in a lane) and walk the rest
  if (car && !car.parked && p.phase === 'to-vehicle') {
    if (!boardOwnedCar(state, p, map, car)) {
      parkInPlace(state, map, car);
      walkLegInstead(p);
    }
  }
}

/** Squared distance from (x, y) to the nearest point of a lot's bounding box (0 inside it). Lets a
 *  car at a big lot's EDGE select it even when its centre is far out of PARK_RADIUS (Maddy: big
 *  lot blocks held one car each because selection keyed off the distant centre). */
export function lotBboxDist2(lot: ParkingLotInfo, x: number, y: number): number {
  const cx = x < lot.x0 ? lot.x0 : x > lot.x1 ? lot.x1 : x;
  const cy = y < lot.y0 ? lot.y0 : y > lot.y1 ? lot.y1 : y;
  return (cx - x) * (cx - x) + (cy - y) * (cy - y);
}

/**
 * Can a citizen at (cx,cy) actually REACH `plot`? — on foot (a walkPath exists) OR by car (a road
 * near the citizen drives, via roadPath, to a parking spot near the plot). Trip-stop selection picks
 * the nearest stop by RADIUS, which on an isolated landmass (a bridged exurb cut off for cars, an
 * island across water) chooses a mainland stop the citizen can never get to — so it spawns, fails to
 * route, gives up and churns ("the NE region spawns + immediately despawns travelers", Maddy). Gating
 * on real reachability drops those doomed trips at the source (the resident stays home as occupancy).
 * The plot's own door is a walkable neighbour by construction, so reachability to the plot tile
 * suffices. Cheap: walkPath/roadPath that FAIL only explore the isolated component (small).
 */
export function stopReachable(
  state: AmbientState,
  map: GameMap,
  cx: number,
  cy: number,
  plot: { x: number; y: number },
): boolean {
  if (walkPath(map, cx, cy, plot.x, plot.y, state.wear, state.traffic, state.pollution)) return true;
  const from = findCurbSpot(state, map, cx, cy); // a road near the citizen to drive from
  const to = findParkingNear(state, map, plot.x, plot.y); // a parking spot near the plot
  return !!(from && to && roadPath(map, from.x, from.y, to.x, to.y, state.traffic));
}

/** Advance a citizen to the NEXT reachable stop on its daily round: from its current position,
 *  aim it at the nearest plot of the next itinerary category that it can actually REACH (skipping
 *  categories the district lacks OR can't get to). Sets it walking ('to-building') toward that plot
 *  and resets the leg's walk tolls. Returns false when no reachable stops remain — the caller then
 *  sends it home (or, at spawn, drops it so it stays home instead of churning). */
export function advanceItinerary(state: AmbientState, p: Ped, map: GameMap): boolean {
  const itin = p.itinerary!;
  const cx = Math.round(p.x);
  const cy = Math.round(p.y);
  for (let step = (p.itinStep ?? 0) + 1; step < itin.length; step++) {
    const plot = nearestOfCategory(map, cx, cy, itin[step]!, state.landValue);
    if (plot && stopReachable(state, map, cx, cy, plot)) {
      const jam = p.carId !== undefined ? 0 : Math.max(jamNear(map, state.traffic, cx, cy), jamNear(map, state.traffic, plot.x, plot.y));
      const chosen = p.carId !== undefined ? TravelMode.Drive : chooseMode(map, cx, cy, plot.x, plot.y, jam, state.walkable);
      // a drive into gridlock may simply not happen — the errand is forgone or folded into another
      if (chosen === TravelMode.Drive && tripEvaporates(jam, Math.imul(p.homeTile ?? 0, 31) + step * 7919 + (state.serialNext ?? 0))) continue;
      p.itinStep = step;
      // If the citizen took its CAR out (carId set), it RETURNS TO THE CAR and drives to the next stop
      // — it doesn't abandon the car and walk off (Maddy: "if they've driven to a location, they should
      // go back to their car"). Mode is only chosen freely from HOME (no car out yet → walk option).
      const mode = chosen;
      // DRIVE: walk to the owned car, drive it to a parking spot, then walk to the plot. If no car
      // can be had (land-locked), fall through and walk the leg.
      if (mode === TravelMode.Drive && setDriveLeg(state, p, map, plot, 'to-building')) return true;
      p.phase = 'to-building';
      p.walkTo = { x: plot.x, y: plot.y };
      p.building = { x: plot.x, y: plot.y };
      p.mode = mode === TravelMode.Drive ? TravelMode.Walk : mode; // drive unavailable → walk
      p.roadSteps = undefined; // a fresh leg — its tolls accrue anew
      p.wornSteps = undefined;
      return true;
    }
  }
  p.itinStep = itin.length; // round exhausted
  return false;
}

// ── Traffic evaporation (Maddy 2026-10-01: a freeway came out, the streets gridlocked, people left). When
// road capacity falls, trips don't all pile onto what's left: some shift to foot and bike (chooseMode's
// stretch) and a share simply stop happening — combined, moved, forgone (Cairns et al.: ~¼ of the traffic
// "evaporates" after road-space reductions). The balancing loop a car-only mode choice lacked.

/** A citizen's OWNED vehicle: the persistent parked Car it walks to and drives. Returns the existing
 *  one (by carId), or lazily spawns one parked on a road by the citizen's current spot. Null if there
 *  is no drivable tile nearby (land-locked) → the caller walks the leg instead. The car is `owned`
 *  (the car filter never auto-moves or despawns it — its owner manages it), so it never vanishes
 *  while its owner is away on foot. */
export function ensureOwnedCar(state: AmbientState, p: Ped, map: GameMap): Car | null {
  if (p.carId !== undefined) {
    const existing = findCar(state, p.carId);
    if (existing) return existing;
  }
  const start = nearestDriveStart(map, Math.round(p.x), Math.round(p.y));
  if (!start) return null;
  // A freshly-spawned owned car must rest in a VALID STALL (a kerb slot / lot bay), never warped onto a
  // lane centre where they pile up (Maddy). No stall in reach → no car here → the citizen walks.
  const spot = nearestParkSpot(state, map, start.x, start.y);
  if (!spot) return null;
  const id = (state.nextCarId = (state.nextCarId ?? 0) + 1);
  const car: Car = {
    x: start.x,
    y: start.y,
    dir: 0,
    tx: start.x,
    ty: start.y,
    owned: true,
    id,
    dwell: PARK_MAX_WAIT,
    tint: (Math.imul((map.idx(start.x, start.y) + 1) ^ id, 0x9e3779b1) >>> 0) % 0x10000,
    // ±15% deterministic speed jitter (hashed from id, not rng) so cars don't bunch in lockstep.
    speedMul: 0.85 + ((Math.imul((id + 7) ^ 0x85ebca6b, 0xc2b2ae35) >>> 0) % 31) / 100,
  };
  applyParkSpot(car, spot); // parked in a real stall (sets x/y + curbSlot|lotIdx, parked = true)
  state.cars.push(car);
  p.carId = id;
  return car;
}

/** A free, available parking spot (a drivable tile not already holding a parked car) near (x, y) —
 *  where a citizen-car drives to and parks before its owner walks the last mile. Null if none. */
/** The nearest TILE of the nearest parking lot within PARK_RADIUS of (x, y), or null. The route
 *  target for a parking citizen — so owned cars head to the lot EDGE nearest their destination (and
 *  then fill the nearest stalls) rather than driving to a distant centre or skipping big lots whose
 *  centre is out of range. */
export function nearestLotCenter(state: AmbientState, x: number, y: number): { x: number; y: number } | null {
  const lots = state.parkingLots;
  if (!lots || lots.length === 0) return null;
  let best = -1;
  let bestD = PARK_RADIUS * PARK_RADIUS;
  for (let i = 0; i < lots.length; i++) {
    const d = lotBboxDist2(lots[i]!, x, y);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0) return null;
  const lot = lots[best]!;
  return {
    x: Math.round(x < lot.x0 ? lot.x0 : x > lot.x1 ? lot.x1 : x),
    y: Math.round(y < lot.y0 ? lot.y0 : y > lot.y1 ? lot.y1 : y),
  };
}

export function findParkingNear(state: AmbientState, map: GameMap, x: number, y: number): { x: number; y: number } | null {
  // The drive target TILE near (x,y): a lot edge if one is near (cars fill its stalls), else the road
  // tile of the nearest free kerb slot (round the stall position back to its tile to drive to).
  const lot = nearestLotCenter(state, x, y);
  if (lot) return lot;
  const curb = findCurbSpot(state, map, x, y);
  return curb ? { x: Math.round(curb.x - 0.5), y: Math.round(curb.y - 0.5) } : null;
}

/**
 * Park an owned car when its drive ends: pull into a FREE lot stall if a lot is in reach (so lots
 * fill to capacity, not one car each), else a street curb. Stays OWNED so it persists until its
 * owner returns. The stall path mirrors the trip-car convention (x = stall.x - 0.5; renderer draws
 * the centre on the stall) and records lotIdx/stallIdx so findLotStall counts it.
 */
/** The nearest available PARKING spot to (x,y), in priority order (Maddy: re-route to a side street
 *  if available, not just a far lot): (1) a free stall in a NEARBY lot — the intended parking; (2)
 *  failing that, a side-street CURB nearby (visible, close); (3) failing that, the nearest free stall
 *  in a FARTHER lot (re-route across town). A lot result carries lotIdx/stallIdx (the stall position);
 *  a curb result is a bare tile. Null when nothing is reachable. */
export function nearestParkSpot(
  state: AmbientState,
  map: GameMap,
  x: number,
  y: number,
): { x: number; y: number; lotIdx?: number; stallIdx?: number; dir?: number; slot?: number } | null {
  const lot = findLotStall(state, x, y, PARK_RADIUS);
  const curb = findCurbSpot(state, map, x, y);
  if (lot && curb) {
    // Park at the CLOSER of the two; a lot wins within LOT_ABSORB_MARGIN of the curb's distance (it
    // absorbs nearby cars), but a free street kerb the next tile over beats a lot several tiles off.
    const dLot = Math.abs(lot.x - x) + Math.abs(lot.y - y);
    const dCurb = Math.abs(curb.x - x) + Math.abs(curb.y - y);
    return dLot - LOT_ABSORB_MARGIN <= dCurb ? lot : curb;
  }
  return lot ?? curb ?? findLotStall(state, x, y, LOT_REROUTE_RADIUS);
}

export function parkOwnedCarSomewhere(state: AmbientState, map: GameMap, car: Car): void {
  const spot = nearestParkSpot(state, map, Math.round(car.x), Math.round(car.y));
  if (!spot) {
    // No free stall or kerb anywhere in reach → the car LEAVES rather than freezing on the freeway
    // tile its route ended on (Maddy: cars parking on freeways). Its owner finishes on foot.
    const i = state.cars.indexOf(car);
    if (i >= 0) state.cars.splice(i, 1);
    return;
  }
  applyParkSpot(car, spot); // a lot bay or a kerb slot — the renderer draws it on the stall
}

/**
 * When a driving car's route ends and the lots at hand are full, DRIVE to the nearest lot with a free
 * stall and re-check on arrival (it may have been taken en route → seek again), circling up to
 * MAX_PARK_SEEKS times — instead of curb-dumping a pile where it arrived (Maddy: "(57,103) accepting
 * infinite cars"; "the car should drive to the new spot, and if it encounters the same condition, try
 * again"). Returns true if it committed a new drive path toward a parking spot (the car keeps driving
 * and seeking); false if it should park NOW — a free stall is already at hand, none is reachable, or
 * it has circled enough. Pure of rng (live layer).
 */
export function routeToParking(state: AmbientState, map: GameMap, car: Car): boolean {
  const spot = nearestParkSpot(state, map, Math.round(car.x), Math.round(car.y));
  if (!spot) return false; // nothing reachable → park now (leaves)
  // The drive target TILE: both a lot stall and a curb stall carry an absolute stall position (x = the
  // tile centre + the bay/kerb offset), so its tile is round(x − 0.5) either way.
  const tx = Math.round(spot.x - 0.5);
  const ty = Math.round(spot.y - 0.5);
  const d = Math.abs(Math.round(car.x) - tx) + Math.abs(Math.round(car.y) - ty);
  if (d <= PARK_CLAIM_DIST) return false; // already there → claim it now
  if ((car.parkSeeks ?? 0) >= MAX_PARK_SEEKS) return false; // circled enough → settle (claim nearest / curb)
  const path = roadPath(map, Math.round(car.x), Math.round(car.y), tx, ty, state.traffic);
  if (!path || path.length < 2) return false; // can't drive there → park now
  car.parkSeeks = (car.parkSeeks ?? 0) + 1;
  const p0x = path[0]! % map.width;
  const p0y = (path[0]! - p0x) / map.width;
  const p1x = path[1]! % map.width;
  const p1y = (path[1]! - p1x) / map.width;
  car.x = p0x;
  car.y = p0y;
  car.tx = p1x;
  car.ty = p1y;
  commitHeading(car, p1x > p0x ? 1 : p1x < p0x ? 3 : p1y > p0y ? 2 : 0); // a fresh route: turn onto it from the way it faced (arc / U-turn sweep)
  car.path = path;
  car.leg = 2;
  car.parked = false;
  return true; // keep driving toward the spot
}

/** The single writer for "a car comes to rest in a STALL" — a lot stall (lotIdx/stallIdx) or a curb
 *  stall (curbDir/curbSlot). `spot.x/y` is the stall's absolute position; the car stores x = pos − 0.5,
 *  so the renderer draws it ON the stall (lot bay or kerb slot), never warped to the lane centre. */
export function applyParkSpot(
  car: Car,
  spot: { x: number; y: number; lotIdx?: number; stallIdx?: number; dir?: number; slot?: number },
): void {
  car.x = spot.x - 0.5;
  car.y = spot.y - 0.5;
  car.tx = car.x;
  car.ty = car.y;
  car.lotIdx = spot.lotIdx;
  car.stallIdx = spot.stallIdx;
  car.curbDir = spot.dir;
  car.curbSlot = spot.slot;
  car.parked = true;
  car.recent = undefined;
}

/** When a citizen's round ends (it gets home, gives up, or is lost), retire its owned car: demote
 *  it to a plain lingering parked car (no longer owned) so it sits a moment then leaves on its dwell
 *  — "the car is put away" — rather than vanishing the instant its owner does. */
export function retireOwnedCar(state: AmbientState, p: Ped, map: GameMap): void {
  if (p.carId === undefined) return;
  const car = findCar(state, p.carId);
  if (car && car.owned) {
    if (car.parked && (car.curbSlot !== undefined || car.lotIdx !== undefined)) {
      // Already at rest in a valid stall (drove home + parked) → just put it away to linger then leave.
      car.owned = false;
      car.dwell = RETIRED_CAR_LINGER;
    } else {
      // Retired mid-drive (no stall) → re-park it in a real stall nearby so it never lingers stranded in
      // a lane centre (Maddy); if no stall is in reach, it drives off rather than freezing on the road.
      const spot = nearestParkSpot(state, map, Math.round(car.x), Math.round(car.y));
      if (spot) {
        applyParkSpot(car, spot);
        car.owned = false;
        car.dwell = RETIRED_CAR_LINGER;
      } else {
        const i = state.cars.indexOf(car);
        if (i >= 0) state.cars.splice(i, 1);
      }
    }
  }
  p.carId = undefined;
}

/**
 * Send a departed citizen's OWNED car HOME: warp it to a parking spot near `homeTile` and leave it
 * parked there (unowned, lingering on its dwell like any put-away car), rather than vanishing it on
 * the spot where the ped stood. So when a citizen is sent home (gives up / is taken off the street),
 * its car FOLLOWS it home instead of despawning where it disappeared (Maddy: "if the ped legitimately
 * gets sent home the car should warp to park near their home too"). Falls back to removing the car
 * only when home has no reachable parking, so it never strands a frozen wreck mid-map. Releases the
 * ped→car link. No-op if the ped owns no car. No rng (live layer; determinism untouched).
 */
export function sendOwnedCarHome(state: AmbientState, map: GameMap, p: Ped, homeTile: number): void {
  if (p.carId === undefined) return;
  const car = findCar(state, p.carId);
  p.carId = undefined;
  if (!car || !car.owned) return;
  const hx = homeTile % map.width;
  const hy = (homeTile - hx) / map.width;
  const spot = nearestParkSpot(state, map, hx, hy);
  if (spot) {
    applyParkSpot(car, spot); // warp it home and park in a kerb slot / lot bay
    car.owned = false; // a put-away car now — clears on its dwell, isn't kept alive as "owned"
    car.dwell = RETIRED_CAR_LINGER;
  } else {
    const i = state.cars.indexOf(car); // nowhere to park near home → remove rather than strand it
    if (i >= 0) state.cars.splice(i, 1);
  }
}

/**
 * ABANDON an arrested citizen's owned car: the citizen is removed from the game, so the car is left a
 * DERELICT on a nearby EMPTY tile (Maddy: "their cars should become abandoned in an empty tile
 * somewhere") — NOT driven home (no one to drive it). It then rusts into ground pollution and
 * despawns ({@link degradeAbandonedCar}). Falls back to abandoning it in place if no empty tile is in
 * reach. Releases the ped→car link; no-op if the ped owns no car. No rng (live layer).
 */
export function abandonOwnedCar(state: AmbientState, map: GameMap, p: Ped): void {
  if (p.carId === undefined) return;
  const car = findCar(state, p.carId);
  p.carId = undefined;
  if (!car || !car.owned) return;
  const spot = nearestEmptyTile(map, Math.round(car.x), Math.round(car.y));
  if (spot) {
    car.x = spot.x;
    car.y = spot.y;
    car.tx = spot.x;
    car.ty = spot.y;
  }
  car.lotIdx = undefined;
  car.stallIdx = undefined;
  car.curbDir = undefined;
  car.recent = undefined;
  car.path = undefined;
  car.leg = undefined;
  car.owned = false;
  car.parked = true;
  car.abandoned = true; // a derelict — degrades into ground pollution then rusts away
  car.dwell = ABANDONED_DEGRADE_TIME;
}

/** Advance one abandoned derelict: leak ground pollution into its tile (the wreck rusting into the
 *  land — a lingering, reparable contaminated patch) and tick its degrade clock. Returns false when
 *  it has fully rusted away (the caller despawns it; the contamination it laid remains). */
export function degradeAbandonedCar(state: AmbientState, map: GameMap, c: Car): boolean {
  layField(state.groundPollution, map.idx(Math.round(c.x), Math.round(c.y)), ABANDONED_GROUND_POLL, GROUND_POLL_MAX);
  c.dwell = (c.dwell ?? 0) - 1;
  return c.dwell > 0;
}

/** Set up a DRIVE leg toward `dest`: the citizen walks to its owned car ('to-vehicle'), drives it to
 *  an available parking spot near `dest` ('driving' → park), then walks the last mile to `dest`
 *  (`finalWalk`). Returns false if it can't get a car (land-locked) so the caller walks instead.
 *  The car is a distinct persistent entity — walked to, parked, never morphed into the rider. */
export function setDriveLeg(
  state: AmbientState,
  p: Ped,
  map: GameMap,
  dest: { x: number; y: number },
  finalWalk: 'to-building' | 'to-home',
): boolean {
  const car = ensureOwnedCar(state, p, map);
  if (!car) return false;
  p.phase = 'to-vehicle';
  p.walkTo = { x: Math.round(car.x), y: Math.round(car.y) };
  p.parkAt = findParkingNear(state, map, dest.x, dest.y) ?? { x: dest.x, y: dest.y };
  p.mode = TravelMode.Walk; // walking to the car
  p.building = finalWalk === 'to-building' ? { x: dest.x, y: dest.y } : undefined;
  p.homeDest = finalWalk === 'to-home' ? { x: dest.x, y: dest.y } : undefined;
  p.roadSteps = undefined;
  p.wornSteps = undefined;
  return true;
}

// --- Spawning ------------------------------------------------------------

/** How many daily-itinerary citizens are out right now — counting both active travellers (peds with
 *  an itinerary) and DRIVERS (citizen-cars with an itinerary), so the population cap covers both. */
export function citizenCount(state: AmbientState): number {
  let n = 0;
  for (const p of state.peds) if (p.itinerary !== undefined) n++;
  return n;
}

/** Top the daily-itinerary population up from the LIVE occupancy: the spawn target tracks total
 *  occupancy (a declining city empties its streets), and a home is picked weighted by its occupancy
 *  (a fuller home sends proportionally more people out, an emptied one none). Occupancy is seeded
 *  lazily from the census baseline, so before the first occupancy pass this matches the old
 *  density-weighting. Each leg the ped picks its own mode (walk/bike/transit/drive); a drive leg
 *  makes it walk to its OWNED car, drive, park, and walk on. Census citizens are PRIMARY. */
export function spawnCitizens(state: AmbientState, map: GameMap, rng: Rng): void {
  const homes = state.households;
  if (!homes || homes.length === 0) return;
  const occAt = (h: Household): number => state.occupancy.get(map.idx(h.x, h.y)) ?? h.count;
  let total = 0;
  for (const h of homes) total += occAt(h);
  if (total <= 0) return;
  const target = spawnTargetFor(total);
  for (let s = 0; s < liveCaps.spawnPerSubstep; s++) {
    if (citizenCount(state) >= target) return;
    // Occupancy-weighted pick: a home with more residents is proportionally likelier to send one out.
    let r = rng.next() * total;
    let home = homes[0]!;
    for (const cand of homes) {
      r -= occAt(cand);
      if (r < 0) {
        home = cand;
        break;
      }
    }
    // Stand the citizen on a walkable tile beside its home plot (the plot itself isn't walkable).
    let sx = -1;
    let sy = -1;
    for (let d = 0; d < 4; d++) {
      const nx = home.x + DIR_DX[d]!;
      const ny = home.y + DIR_DY[d]!;
      if (isWalkable(map, nx, ny)) {
        sx = nx;
        sy = ny;
        break;
      }
    }
    if (sx < 0) continue; // a hemmed-in home, nowhere to step out
    const ped: Ped = {
      x: sx,
      y: sy,
      dir: 0,
      tx: sx,
      ty: sy,
      homeTile: map.idx(home.x, home.y),
      itinerary: DAILY_ITINERARY,
      itinStep: -1, // advanceItinerary sets the first stop (step 0 = Work)
    };
    if (advanceItinerary(state, ped, map)) state.peds.push(ped); // dropped if the district has no stops
  }
}

/** The free stall NEAREST (x, y) to park in: among lots whose bounding box is within PARK_RADIUS,
 *  the nearest free stall to (x, y) — so a big block fills tile-by-tile from the side a car arrives
 *  at (not row-major from a far corner), and a big lot is reachable from its EDGE, not only its
 *  centre (Maddy: big lot blocks held one car each). Null if no lot has a free stall in reach. */
export function findLotStall(
  state: AmbientState,
  x: number,
  y: number,
  radius: number = PARK_RADIUS,
): { lotIdx: number; stallIdx: number; x: number; y: number } | null {
  const lots = state.parkingLots;
  if (!lots || lots.length === 0) return null;
  // Stalls already taken, grouped by lot — one pass over the cars rather than a scan per stall.
  const taken = new Map<number, Set<number>>();
  for (const o of state.cars) {
    if (o.parked && o.lotIdx !== undefined) {
      let s = taken.get(o.lotIdx);
      if (!s) taken.set(o.lotIdx, (s = new Set<number>()));
      s.add(o.stallIdx!);
    }
  }
  let best: { lotIdx: number; stallIdx: number; x: number; y: number } | null = null;
  let bestD = radius * radius;
  for (let i = 0; i < lots.length; i++) {
    const lot = lots[i]!;
    if (lotBboxDist2(lot, x, y) > bestD) continue; // no stall here can beat the best found
    const t = taken.get(i);
    for (let s = 0; s < lot.stalls.length; s++) {
      if (t && t.has(s)) continue;
      const dx = lot.stalls[s]!.x - x;
      const dy = lot.stalls[s]!.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = { lotIdx: i, stallIdx: s, x: lot.stalls[s]!.x, y: lot.stalls[s]!.y };
      }
    }
  }
  return best;
}

/** The nearest free curb (drivable tile NOT already holding a parked car) by ring search
 *  outward from (ax, ay), capped at CURB_RADIUS. Crowding (near curbs taken) pushes the
 *  result farther out, so the pedestrian walks farther. Returns tile coords, or null. */
export function findCurbSpot(
  state: AmbientState,
  map: GameMap,
  ax: number,
  ay: number,
): { x: number; y: number; dir: number; slot: number } | null {
  // Occupied CURB STALLS, keyed tile*4 + slot — so a road tile holds up to 4 cars, each in its own kerb
  // slot, never two on the same slot and never in the lane interior.
  const taken = new Set<number>();
  for (const o of state.cars) {
    if (o.parked && o.curbSlot !== undefined) taken.add(map.idx(Math.round(o.x), Math.round(o.y)) * 4 + o.curbSlot);
  }
  for (let r = 0; r <= CURB_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring at Chebyshev distance r
        const x = ax + dx;
        const y = ay + dy;
        if (!isParkable(map, x, y) || !isCarRoad(map.built[map.idx(x, y)]!)) continue; // a STREET kerb only (lots have their own stalls; not a freeway/bridge)
        const stalls = curbStallOffsets(map, x, y);
        if (stalls.length === 0) continue; // no kerb (a mid-road lane) → never a street park
        const base = map.idx(x, y) * 4;
        for (let s = 0; s < stalls.length; s++) {
          if (taken.has(base + s)) continue;
          const st = stalls[s]!;
          // Return the STALL position (tile centre + kerb offset). The caller stores car.x = pos − 0.5,
          // so the renderer draws it at the kerb (mirrors the lot-stall convention).
          return { x: x + 0.5 + st.dx, y: y + 0.5 + st.dy, dir: st.dir, slot: s };
        }
      }
    }
  }
  return null;
}

/** Park a trip-car that has reached the end of its path. It pulls into the nearest free lot
 *  stall, or — when none is free — to the nearest free street curb (so cars no longer vanish
 *  at their destination). Then it gets a bound pedestrian that walks to the building, dwells,
 *  and returns. Returns true if parked (always, unless truly nowhere to stop → despawn). */
export function tryPark(state: AmbientState, c: Car, map: GameMap): boolean {
  const ax = Math.round(c.x);
  const ay = Math.round(c.y);
  // A citizen-car knows the exact plot it drove to; a sim/freight car deposits at the nearest one.
  const building = c.building ?? nearestDemandTile(map, ax, ay);
  const spot = nearestParkSpot(state, map, ax, ay); // nearby lot → side-street kerb slot → farther lot
  if (!spot) return false; // nowhere at all (rare) → despawn
  applyParkSpot(c, spot); // a lot bay or a kerb slot — drawn ON the stall, never the lane centre
  c.path = undefined;
  c.leg = undefined;
  c.dwell = PARK_MAX_WAIT;
  c.id = state.nextCarId = (state.nextCarId ?? 0) + 1;
  if (building) {
    // The citizen reached its destination plot → carry that plot's wellbeing home now. The
    // bound ped below is the VISIBLE visit; the deposit is not gated on it spawning (the ped
    // cap must never silently starve the health signal).
    if (c.homeTile !== undefined) depositVisit(state, c.homeTile, building, map);
    spawnBoundPed(state, c, building);
  }
  return true;
}

/** Spawn the pedestrian bound to a just-parked car: it starts at the car and walks to the
 *  destination building (the car→building leg). It later returns to the SAME car (by id) and
 *  releases it. No building nearby ⇒ no ped (the car will leave on its safety timeout). */
export function spawnBoundPed(state: AmbientState, c: Car, building: { x: number; y: number }): void {
  if (state.peds.length >= liveCaps.pedCap) return;
  // Start on the car's TILE (rounded): a lot-parked car sits at a fractional stall position,
  // but the Manhattan router walks integer tiles, so the ped steps off from the tile centre.
  const sx = Math.round(c.x);
  const sy = Math.round(c.y);
  state.peds.push({
    x: sx,
    y: sy,
    dir: 0,
    tx: sx,
    ty: sy,
    walkTo: { x: building.x, y: building.y },
    carId: c.id,
    phase: 'to-building',
    building: { x: building.x, y: building.y },
  });
}

/** Find a (parked) car by its id, so a returning pedestrian can rebind to it. */
export function findCar(state: AmbientState, id: number): Car | undefined {
  return state.cars.find((c) => c.id === id);
}

/** Add `value` (signed) to a home building's health, clamped. */
export function depositHealth(state: AmbientState, homeTile: number, value: number): void {
  if (value === 0) return;
  const cur = state.buildingHealth.get(homeTile) ?? 0;
  state.buildingHealth.set(homeTile, Math.max(-HEALTH_MAX, Math.min(HEALTH_MAX, cur + value)));
}

/** Deposit the wellbeing a citizen carries home from visiting `plot` into its home building's
 *  health, less any `penalty` (e.g. an unpleasant road walk). Called when a citizen completes
 *  its visit (a driver on park-arrival, a walker on getting home). */
export function depositVisit(
  state: AmbientState,
  homeTile: number,
  plot: { x: number; y: number },
  map: GameMap,
  penalty = 0,
): void {
  depositHealth(state, homeTile, visitValue(map.built[map.idx(plot.x, plot.y)]!) - penalty);
}

/** A walk citizen whose trip can't complete (its destination is unreachable, OR the way home is
 *  blocked too) isn't annihilated in the field: the household persists, so the citizen RESPAWNS at
 *  home — snapped to a walkable spot beside its home plot, trip state cleared so it rejoins the
 *  neighbourhood — and the home takes the FAILED_TRIP_PENALTY for the wasted trip. A bound or
 *  homeless ped (no `homeTile`) has nowhere to respawn, so it despawns (its car releases on its own
 *  timeout). Returns true if it respawned (keep the sprite), false if it should despawn. */
export function respawnAtHome(state: AmbientState, p: Ped, map: GameMap): boolean {
  if (p.homeTile === undefined) {
    retireOwnedCar(state, p, map); // even a homeless/bound ped's owned car (if any) must be retired
    return false;
  }
  sendOwnedCarHome(state, map, p, p.homeTile); // its car FOLLOWS it home (warps to park near home)
  depositHealth(state, p.homeTile, -FAILED_TRIP_PENALTY);
  const hx = p.homeTile % map.width;
  const hy = (p.homeTile - hx) / map.width;
  // Stand just outside the home plot — on an orthogonally adjacent walkable tile (the plot itself
  // isn't walkable). A coastal/boxed home may have no walkable orthogonal neighbour, so fall back to
  // the nearest walkable tile (a wider search) rather than landing the ped on the plot or on water.
  let sx = hx;
  let sy = hy;
  let found = false;
  for (let d = 0; d < 4; d++) {
    const nx = hx + DIR_DX[d]!;
    const ny = hy + DIR_DY[d]!;
    if (isWalkable(map, nx, ny)) {
      sx = nx;
      sy = ny;
      found = true;
      break;
    }
  }
  if (!found) {
    const w = nearestWalkable(map, hx, hy);
    if (w) {
      sx = w.x;
      sy = w.y;
    }
  }
  p.x = sx;
  p.y = sy;
  p.tx = sx;
  p.ty = sy;
  p.walkTo = undefined;
  p.phase = undefined;
  p.building = undefined;
  p.carId = undefined;
  p.fuel = undefined;
  p.recent = undefined;
  p.path = undefined; // the committed foot route is invalid after a reposition
  p.leg = undefined;
  p.pathGoal = undefined;
  p.roadSteps = undefined;
  p.wornSteps = undefined;
  p.itinerary = undefined; // a lost citizen's round ends; it rejoins the neighbourhood at home
  p.itinStep = undefined;
  p.mode = undefined;
  p.parkAt = undefined;
  p.homeDest = undefined;
  return true;
}
