// NOTE: the model itself now lives in src/live/ (stepper: live/step.ts). This file is a re-export
// barrel (LiveSamples/liveInspectLine now live in ui/inspectContent.ts); importers migrate off it at L13.
//
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

export { stepAmbient } from '../live/step';

export { liveInspectLine, type LiveSamples } from './inspectContent';
