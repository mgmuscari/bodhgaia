// Live-layer TYPES + STATE: the mover/flock/train shapes, the AmbientState record, its constructor and
// the host-published structural inputs (parking lots, households, plant emitters). Cut verbatim from
// ui/ambientContent.ts.

import type { Rng } from '../engine/rng';
import type { StopCategory } from '../citizens/itinerary';
import type { TravelMode } from '../citizens/modes';
import type { Household } from '../citizens/census';
import { prevailingWind } from './fields/pollution';
import { OCC_FLOOR } from './tuning';
import { visitValue } from '../citizens/plots';
import { BuiltKind } from '../engine/fabric';

/** A grid-following sprite: float world position + heading + committed target tile. */
export interface Mover {
  /** Float world position in tile units. */
  x: number;
  y: number;
  /** Current travel direction (0=N, 1=E, 2=S, 3=W). */
  dir: number;
  /** The heading of the PREVIOUS leg (set by commitHeading) — cosmetic, read only by moverPose to draw
   *  a turn as a smooth arc. Undefined ⇒ same as `dir` (no turn). */
  prevDir?: number;
  /** The mover's leg state as it stood BEFORE the latest substep (snapshotMovers) — cosmetic, read only
   *  by the pose functions to interpolate between 50 ms substeps at the display's frame rate. */
  snap?: { x: number; y: number; dir: number; prevDir?: number; tx: number; ty: number };
  /** Consecutive substeps this vehicle has been held by the space-ahead rule. Drives gridlock relief:
   *  a re-plan at STUCK_REPATH, a one-off pass-through at STUCK_ESCAPE. Reset whenever it moves. */
  stuck?: number;
  /** A stable per-vehicle ordinal for yield tie-breaks when `id` is unset (assignSerials, per substep). */
  serial?: number;
  /** Committed target tile (integer tile coords) — the end of the current leg. */
  tx: number;
  ty: number;
  /** Recently-visited tile indices (bounded, oldest-first) for loop avoidance. A car
   *  prefers a neighbour NOT in this list; if boxed in (all options recent) it
   *  despawns instead of circling. Lazily created on first recommit. */
  recent?: number[];
  /** Committed route (tile indices, origin→destination) — set when a citizen's car commits to
   *  a least-cost route (e.g. to parking near its leg destination). A car with a `path` follows
   *  it leg by leg (see pathStep) instead of wandering. */
  path?: readonly number[];
  /** Cursor into `path`: the index of the NEXT tile to commit to. */
  leg?: number;
  /** (Car) How many times it has re-routed seeking a free parking stall (circling for parking). Caps
   *  the search at MAX_PARK_SEEKS so it eventually settles (claims the nearest stall / curbs). */
  parkSeeks?: number;
  /** For a walking ped following a committed `walkPath`: the tile index of the path's GOAL, so the
   *  route is recomputed when the destination (`walkTo`) changes (a new itinerary stop / heading
   *  home) and reused otherwise. Undefined for cars (they recommit via their own leg machinery). */
  pathGoal?: number;
  /** Straight-line walk target (float world coords) — set for LAST-MILE pedestrians who
   *  walk between a parked car and a nearby building. A ped with `walkTo` lerps straight
   *  toward it (ignoring the road/ped grid, so it can cross a lot or road), despawns on
   *  arrival, and is exempt from the ped-substrate despawn. */
  walkTo?: { x: number; y: number };
  /** A car that has finished its trip and is PARKED — in a lot stall (lotIdx/stallIdx set)
   *  or at a street curb (lotIdx undefined). It waits for its bound pedestrian to return,
   *  then leaves; `dwell` is a safety countdown (the ped normally releases it by zeroing it). */
  parked?: boolean;
  dwell?: number;
  lotIdx?: number;
  stallIdx?: number;
  /** Stable id assigned when a car parks, so its pedestrian can find its way back to it. */
  id?: number;
  /** The citizen's HOME building tile (a residential neighbour of the trip origin), set when
   *  a trip leaves a residential plot. The destination's visit wellbeing is deposited here on
   *  return. Undefined ⇒ a non-residential (freight) trip — no home, no health deposit. */
  homeTile?: number;
  /** For a street-parked car: the direction (0=N/1=E/2=S/3=W) toward its curb (the adjacent
   *  non-road tile), so the renderer draws it hugging the kerb instead of in the lane. */
  curbDir?: number;
  /** For a street-parked car: which discrete CURB STALL (0..3) of its road tile it occupies — a kerb
   *  slot, like a lot stall (curbStallOffsets). Up to 4 per road tile, so cars line the kerb instead of
   *  warping into the lane centre (Maddy). Undefined ⇒ not curb-parked (moving, or a lot stall). */
  curbSlot?: number;
  /** A colour tag bound to the car at spawn (a non-negative int the renderer maps into its
   *  palette mod its length). Stays with the car for its whole life, so it shows the same
   *  colour moving on the road and parked in a lot. */
  tint?: number;
  /** A per-car speed multiplier (~0.85..1.15) bound at spawn — declumps traffic so cars don't move in
   *  lockstep (Maddy). Deterministic (hashed from id), not rng. Multiplies the congestion-adjusted speed. */
  speedMul?: number;
  /** A pedestrian on a citizen trip. A DRIVE trip's last-mile ped is bound to a parked car
   *  (`carId`) and returns to it ('to-car'); a WALK trip's ped has no car and returns home
   *  ('to-home'), depositing the visit at `homeTile` on arrival. `phase` tracks the leg;
   *  `building` is the destination plot (the wellbeing source); `dwellInside` times the visit. */
  carId?: number;
  phase?: 'to-building' | 'inside' | 'to-car' | 'to-home' | 'to-vehicle' | 'driving';
  building?: { x: number; y: number };
  dwellInside?: number;
  /** (Car) A citizen's OWNED vehicle — a persistent entity its owner walks to and drives. The car
   *  filter never auto-moves, dwells, or despawns an owned car; only its owner ped moves it (in the
   *  'driving' phase) and retires it when its round ends. So it never vanishes while its owner is
   *  away on foot, and is never the same entity as the rider. */
  owned?: boolean;
  /** (Car) An ABANDONED derelict — its citizen was arrested (removed from the game), so it sits on an
   *  empty tile rusting into ground pollution, then despawns. Exempt from the off-network despawn (it
   *  legitimately sits off the road) and from the owner-managed/parked-dwell branches. */
  abandoned?: boolean;
  /** (Ped, DRIVE leg) the available parking spot its owned car drives to, before the owner walks the
   *  last mile to the real destination. */
  parkAt?: { x: number; y: number };
  /** (Ped, DRIVE-HOME leg) where to walk after parking the car, then despawn (the home plot). */
  homeDest?: { x: number; y: number };
  /** Substeps a walking citizen has spent on a road/stroad this trip — taxes the home deposit. */
  roadSteps?: number;
  /** Substeps a walking citizen has spent on a heavily-WORN (degraded) desire path this trip —
   *  also taxes the home deposit: a beaten path is convenient underfoot but bleak. */
  wornSteps?: number;
  /** A citizen's daily round: the ordered stop CATEGORIES it visits (work, shop, lifestyle) before
   *  heading home. Undefined ⇒ a single-stop walk (a sim trip). `itinStep` is the index of the stop
   *  it is currently travelling to / visiting; on each `inside` it advances to the next reachable
   *  stop, banking that visit's wellbeing at home, and heads home once the round is done. */
  itinerary?: readonly StopCategory[];
  itinStep?: number;
  /** A walking citizen's remaining FUEL: a persistent energy tank (lazily FUEL_TANK), spent per
   *  substep by the terrain underfoot and refilled at plots. When it hits zero the citizen gives up
   *  — turns home on a limp reserve, or respawns at home if even that fails. Guards against
   *  oscillation toward an unreachable destination (a limit cycle the `recent` window can't catch). */
  fuel?: number;
  /** The travel MODE for the current leg (walk/bike/streetcar/rail/drive). Undefined ⇒ Walk (the
   *  default + back-compat). Chosen per leg by distance + nearby infra; sets which tiles the mover
   *  can enter, which it hugs (the mode's network), and how fast it goes. */
  mode?: TravelMode;
  /** (Cruiser) chase personality, ghost-style: 0 = direct (chase the citizen's tile, Blinky), 1 =
   *  ambush (target AHEAD of the citizen's heading, Pinky), 2 = shy (only pounce when close, else
   *  patrol, Clyde). Assigned at spawn; read by huntTarget. */
  personality?: number;
}

export type Car = Mover;
export type Ped = Mover;

/** One bird within a flock. */
export interface Bird {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** A bird flock: a cohesive cluster of 3..7 boids. */
export interface Flock {
  birds: Bird[];
}

/** An ambient TRAIN riding the rail network as a snake of cells (Maddy: rails need trains). `cells`
 *  are tile indices, HEAD FIRST; the head also has a fractional position (hx, hy) for smooth motion
 *  toward its committed next tile (tx, ty) along `dir`. On reaching a tile a new head tile is pushed
 *  and the tail dropped, so the cars trace the exact track. Live layer, never hashed. */
export interface Train {
  cells: number[];
  hx: number;
  hy: number;
  tx: number;
  ty: number;
  dir: number;
  /** One Mover per car (head first), re-synced each substep by syncTrainLegs — the same movers cars and
   *  peds are, so the substep snapshot and pose blending cover trains too. */
  cars?: Mover[];
}

/** A parking lot the ambient layer can store cars in: its centre, its bounding box (for the
 *  nearest-TILE search — a car parks in a big lot from the edge it arrives at, not only when near
 *  the far-off centre), and its stall centres (float world coords, capacity = stalls.length).
 *  Occupancy is dynamic — derived from the parked cars, not stored here. */
export interface ParkingLotInfo {
  cx: number;
  cy: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  stalls: ReadonlyArray<{ x: number; y: number }>;
}

/** The full ambient sprite state — renderer-side only, never part of the world. */
/** A fire truck: where it is, the road route it follows, and what it's doing. */
/** A fire truck: a mover on a committed road route (the shared vehicle mover — lanes, turns, interpolation), out
 *  to a fire, spraying it, or driving home. */
export interface Truck extends Mover {
  /** Where it is in the call. */
  call: 'to-fire' | 'spraying' | 'home';
  /** The burning parcel (store index) it was sent to. */
  target: number;
  /** Substeps left spraying. */
  spray: number;
  /** The road tile by its station, to drive home to. */
  home: { x: number; y: number };
  /** Substeps left before it leaves the station (the crew turning out). */
  turnout?: number;
}

/** A toxic cloud from an industrial spill: its centre (tiles), age (substeps), the people it has already passed
 *  over (each rolls once) and how many it has killed. */
export interface ToxicCloud {
  x: number;
  y: number;
  age: number;
  touched: WeakSet<object>;
  deaths: number;
}

/** Something that happened in the city, framed by the tiles it covers (x, y, w, h). */
export interface LiveEvent {
  kind: 'death' | 'arrest' | 'fire' | 'spill';
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The tech practices' coefficients the live layer reads. The host fills it from the tech tree's resolved
 *  effects (tech/effects.ts) — structurally, so the live layer never imports tech. */
export interface LivePractices {
  /** Walk-range multiplier for mode choice (Walkable Streets). */
  walkStretch: number;
  /** Cycling-range multiplier for mode choice (Bike Shares). */
  bikeStretch: number;
  /** Share of police stops that go to a circle instead of an arrest (Circles). */
  arrestRelease: number;
  /** Share of driven shopping trips that are delivered instead (Drone Deliveries). */
  droneShopDrop: number;
  /** The fraction of a home's baseline it never thins below (Mutual Aid). */
  occFloor: number;
  /** The wellbeing a citizen brings home from a day at industry (Collective Ownership). */
  industryVisit: number;
  /** Multiplier on how often a works spills (Collective Ownership: the workers who live downwind run it). */
  spillRate: number;
}

/** No practices: the coefficients the live layer runs on before any tech. */
export const NEUTRAL_PRACTICES: Readonly<LivePractices> = Object.freeze({
  walkStretch: 1,
  bikeStretch: 1,
  arrestRelease: 0,
  droneShopDrop: 0,
  occFloor: OCC_FLOOR,
  industryVisit: visitValue(BuiltKind.Industrial),
  spillRate: 1,
});

export interface AmbientState {
  cars: Car[];
  peds: Ped[];
  /** Police cruisers patrolling out of the precincts — the visible over-policing of the
   *  redlined districts. They wander the local roads (flashing lights, renderer-side) and
   *  make arrests that drain the community (see stepArrests). Live, never hashed. */
  cruisers: Mover[];
  /** Substep counter gating the arrest sweep to ARREST_CADENCE. */
  arrestTick: number;
  /** Substep counter driving the police scatter/chase phase (the ghost cadence). */
  policeTick: number;
  /** Live POLICE VIOLENCE (0..POLICE_VIOLENCE_MAX), keyed by tile: laid where arrests happen,
   *  lingering as a slow-decaying record. This is the anti-crime-map — it shows where the STATE
   *  inflicts harm, not where residents are blamed. Renderer-side, never hashed. */
  policeViolence: Map<number, number>;
  birds: Flock[];
  /** Ambient trains riding the rail network (Maddy: rails need trains). Live, never hashed. */
  trains: Train[];
  /** Leftover sub-substep time carried between stepAmbient calls. */
  accMs: number;
  /** Next vehicle serial for yield tie-breaks (assignSerials). */
  serialNext: number;
  /** The parking lots that STORE the moving cars: a trip-car parks in the nearest one on
   *  arrival (or at a street curb if none is free), waits for its pedestrian, then leaves.
   *  Renderer-side, set by the host via setParkingLots; never part of the world hash. */
  parkingLots?: ReadonlyArray<ParkingLotInfo>;
  /** Monotonic counter for parked-car ids (so a pedestrian can rebind to its own car). */
  nextCarId?: number;
  /** Live per-building HEALTH, keyed by home building tile index: the running sum of what
   *  its citizens bring home from their trips (decayed toward neutral). Renderer-side, never
   *  hashed — it reads the deterministic world but is a live overlay quantity. */
  buildingHealth: Map<number, number>;
  /** Live trample WEAR (0..WEAR_MAX), keyed by tile index: how hard pedestrians have beaten a
   *  desire path through a wild-green tile. Accumulates under foot traffic, decays when unused
   *  (the path regrows). Renderer-side, never hashed — the deterministic ecology is untouched;
   *  the renderer browns the ground + litters trash by this value. */
  wear: Map<number, number>;
  /** Live WATER POLLUTION (0..WATER_POLL_MAX), keyed by water tile index: runoff collected from
   *  the surrounding ground, growing heavily polluted over time. Renderer-side, never hashed. */
  waterPollution: Map<number, number>;
  /** Substep counter gating the (whole-map) water-runoff pass to WATER_RUNOFF_CADENCE. */
  waterTick: number;
  /** Live GROUND POLLUTION (0..GROUND_POLL_MAX), keyed by LAND tile: industry + dirty power + the
   *  litter/wear of demand paths poison the surrounding land, lingering and slow to clear (the land
   *  analogue of water runoff — the toxic legacy the player heals). Renderer-side, never hashed. */
  groundPollution: Map<number, number>;
  /** Substep counter gating the (whole-map) ground-contamination pass to GROUND_RUNOFF_CADENCE. */
  groundTick: number;
  /** Live AGENT-DRIVEN traffic density (0..TRAFFIC_MAX), keyed by road tile: laid by cars as they
   *  drive, decayed when they don't. THE traffic — emergent from the agents, not an aggregate field.
   *  Car pathfinding routes around it and peds shun it; renderer-side, never hashed. */
  traffic: Map<number, number>;
  /** Live AGENT-DRIVEN air pollution (0..POLL_MAX), keyed by tile: cars emit it on the tiles they
   *  drive (heavier on freeways / in congestion), lingering as smog that decays slowly. Peds shun it
   *  and it drags land value down. Renderer-side, never hashed — the smog emerges from the vehicles. */
  pollution: Map<number, number>;
  /** The world's prevailing wind (integer unit vector): air pollution drifts one tile along it each
   *  drift pass, so smog streaks downwind into plumes. Seeded per world from the ambient rng (never
   *  the sim streams); defaults to a westerly. Renderer-side, never hashed. */
  wind: { dx: number; dy: number };
  /** Substep counter gating the smog-drift + diffusion pass to WIND_CADENCE. */
  windTick: number;
  /** Substep counter gating the occasional RAIN storm (smog→ground→water) to RAIN_CADENCE. */
  rainTick: number;
  /** Live DERIVED land value (0..LV_MAX), keyed by inhabited plot tile: desirability recomputed on a
   *  slow cadence from greenery + amenity neighbours minus pollution/traffic/decay. Steers citizen
   *  destinations (and, next, household growth). Renderer-side, never hashed. */
  landValue: Map<number, number>;
  /** Substep counter gating the (whole-map) land-value recompute to LV_CADENCE. */
  lvTick: number;
  /** Live fire/health SERVICE COVERAGE: tiles within reach of a station. Redlined zones start
   *  under-served (uncovered → a land-value drag); the player extends it. Recomputed on the LV
   *  cadence; never hashed. */
  coverage: Set<number>;
  /** Live AGENT-EMERGENT population, keyed by residential home tile: how many people actually live
   *  there now. Seeded from the census baseline, drifts toward capacity (prized/clean/healthy) or
   *  empty (decayed/smoggy) on a cadence. Drives the spawn target + home weighting. Never hashed. */
  occupancy: Map<number, number>;
  /** Substep counter gating the occupancy re-evaluation to OCC_CADENCE. */
  occTick: number;
  /** The practices' live coefficients (set by the host from the tech tree each step). */
  practices: LivePractices;
  /** Per home: the occupancy signal its residents are used to (see OCC_SETTLE_PASSES). */
  occExpect: Map<number, number>;
  /** Occupancy passes run so far (the opening settles for OCC_SETTLE_PASSES). */
  occPasses: number;
  /** The unhoused: people without a home (docs/design/rehoming.md). Homes lose people into it and win
   *  people back from it; it never moves without a cause. */
  unhoused: number;
  /** Per home tile: how organised its neighbourhood is, 0..1 (civic voice ÷ 255), set by the host after
   *  each civic tick — the welcome that re-homes people there. Absent ⇒ no welcome anywhere. */
  welcome?: Map<number, number>;
  /** Homes built since the opening that are still filling for the first time (they open empty). */
  freshHomes?: Set<number>;
  /** The in-game hour (0..23), set by the host each step; absent ⇒ no clock (tests, the golden run). */
  hour?: number;
  /** The last hour exposure was drawn for (deaths are drawn once per in-game hour). */
  exposureHour?: number;
  /** Residents who have just died, lying where they fell (t = substeps since). */
  fallen?: { x: number; y: number; t: number }[];
  /** Street memorials — a candle and flowers — where someone died (age in substeps). */
  memorials?: { x: number; y: number; age: number }[];
  /** The opening's night walker (bodhgaia-opening.md): one unhoused resident the camera follows until they die.
   *  Position in tiles; `path` is the current foot route (tile indices), `i` the next waypoint. */
  wanderer?: { x: number; y: number; path: number[]; i: number; age: number; life: number; seed: number };
  /** Fire trucks out on a call (disasters.md): driving to a fire, spraying it, or driving home. */
  trucks?: Truck[];
  /** A storm, while one lasts (app/weather.ts): rain on screen and in the ears; a heavy one floods the low land. */
  rain?: { heavy: boolean };
  /** Toxic clouds drifting downwind from a spill (live/spills.ts). */
  clouds?: ToxicCloud[];
  /** The toxic smog the clouds lay: drifts and spreads like smog, drawn greenish-yellow by the smog overlay.
   *  Absent until the first spill. */
  toxic?: Map<number, number>;
  /** The in-game hour spills were last drawn for. */
  spillHour?: number;
  /** Fires the trucks have put out (parcel store indices) — the host hands them to the fire step and clears it. */
  quenched?: Set<number>;
  /** Footprints burning now (published by the host from the fire step) — the renderer draws the flames. */
  burning?: { x: number; y: number; w: number; h: number }[];
  /** Residents who have died so far (the news reads its change). */
  deaths?: number;
  /** The live event feed — deaths, arrests (disasters later) — for the host's CCTV inset, news and costs.
   *  Collected only once the host creates it (absent ⇒ nothing recorded); the host drains it. */
  events?: LiveEvent[];
  /** Live ROAD DECAY (0..ROAD_DECAY_MAX), keyed by road tile: how crumbled the pavement is.
   *  Redlined roads crumble (the city won't maintain the disinvested districts); roads recover
   *  where the neighborhood is cared-for (high land value). Drags land value, never hashed. */
  roadDecay: Map<number, number>;
  /** Substep counter gating the road-decay pass to ROAD_CADENCE. */
  roadTick: number;
  /** The residential homes citizens are spawned from (the census), published by the host via
   *  setHouseholds. Each spawn picks a home weighted by its citizen count (denser → more people
   *  out), so the daily-itinerary population reflects the built city. Renderer-side, never hashed. */
  households?: ReadonlyArray<Household>;
  /** Dirty power-plant emission sources: {tile, amount} laid into the air-pollution field every
   *  step (like a car's exhaust, but persistent). Published by the host via setPlantEmitters from
   *  the built layer, so a coal/gas plant smogs its district. Renderer-side, never hashed. */
  plantEmitters?: ReadonlyArray<{ tile: number; amount: number }>;
}

export function createAmbientState(rng?: Rng): AmbientState {
  return {
    wind: prevailingWind(rng),
    windTick: 0,
    rainTick: 0,
    cars: [],
    peds: [],
    cruisers: [],
    arrestTick: 0,
    policeTick: 0,
    policeViolence: new Map(),
    birds: [],
    trains: [],
    accMs: 0,
    serialNext: 1,
    buildingHealth: new Map(),
    wear: new Map(),
    waterPollution: new Map(),
    waterTick: 0,
    groundPollution: new Map(),
    groundTick: 0,
    traffic: new Map(),
    pollution: new Map(),
    landValue: new Map(),
    lvTick: 0,
    coverage: new Set(),
    occupancy: new Map(),
    occTick: 0,
    practices: { ...NEUTRAL_PRACTICES },
    occExpect: new Map(),
    occPasses: 0,
    unhoused: 0,
    roadDecay: new Map(),
    roadTick: 0,
  };
}

/** Publish the parking lots that store moving cars. The host (main.ts) computes these from
 *  the map's ParkingLot components (centre + stall grid) so parked cars land on the stalls. */
export function setParkingLots(state: AmbientState, lots: ReadonlyArray<ParkingLotInfo>): void {
  state.parkingLots = lots;
}

/** Publish the residential homes citizens spawn from (the host computes these from the parcel
 *  store via residentialCensus). Mirrors setParkingLots — structural, never part of the world. */
export function setHouseholds(state: AmbientState, households: ReadonlyArray<Household>): void {
  state.households = households;
}

/** Publish the dirty-plant emission sources (the host computes these from the built layer via
 *  power.plantPollution + each plant's footprint plume). Mirrors setHouseholds — structural,
 *  never part of the world; stepAmbient lays them into the live air-pollution field each pass. */
export function setPlantEmitters(
  state: AmbientState,
  emitters: ReadonlyArray<{ tile: number; amount: number }>,
): void {
  state.plantEmitters = emitters;
}
