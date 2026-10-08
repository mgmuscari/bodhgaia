// Live-layer STEPPER: the fixed 50ms substep that despawns, spawns and advances every agent and
// field in a fixed order, and the public stepAmbient that runs it off wall-clock time. Order, cadence
// and rng draws are load-bearing (tests/live/golden.test.ts). Cut verbatim from ui/ambientContent.ts.

import type { GameMap } from '../engine/map';
import { BuiltKind } from '../engine/fabric';
import { decayField, layField } from '../citizens/field';
import type { Rng } from '../engine/rng';
import {
  AMBIENT_MAX_FRAME_MS,
  ARREST_CADENCE,
  GROUND_RUNOFF_CADENCE,
  HEALTH_DECAY,
  LV_CADENCE,
  OCC_CADENCE,
  POLICE_VIOLENCE_DECAY,
  POLL_DECAY,
  POLL_MAX,
  RAIN_CADENCE,
  ROAD_CADENCE,
  SUBSTEP_MS,
  TRAFFIC_DECAY,
  WATER_RUNOFF_CADENCE,
  WEAR_DECAY,
  WEAR_MAX,
  WEAR_RATE,
  WIND_CADENCE,
  WORN_DEGRADE_MIN,
} from './tuning';
import type { AmbientState } from './types';
import { spawnCitizens } from './agents';
import { buildVehicleCtx, stepCar } from './cars';
import { stepPed } from './peds';
import { buildSafeZones, policePhase, spawnCruisers, stepArrests, stepCruisers } from './police';
import { stepDeaths, stepExposure } from './death';
import { stepWanderer } from './wanderer';
import { stepTrucks } from './trucks';
import { stepClouds, stepToxic } from './spills';
import { stepGatherings } from './gatherings';
import { spawnTrains, stepTrain } from './trains';
import { advanceFlock, flockTile, spawnFlocks } from './birds';
import { stepOccupancy } from './fields/occupancy';
import { settleCamps } from './camps';
import { computeCoverage, recomputeLandValue, stepRoadDecay } from './fields/landValue';
import {
  accumulateGroundPollution,
  accumulateWaterRunoff,
  applyRain,
  diffusePollution,
  driftPollution,
  flowWaterPollution,
  treatWaterPollution,
} from './fields/pollution';
import { birdSpawnAt, carOffNetwork, isWearable, pedDespawns } from './network';
import { snapshotMovers } from './poses';

// --- The substep + the public stepper ------------------------------------

function substep(state: AmbientState, map: GameMap, rng: Rng): void {
  // the fallen and the memorials; the night's exposure deaths (once per in-game hour, with a host clock)
  stepDeaths(state);
  stepExposure(state, map, rng);
  if (state.wanderer) stepWanderer(state, map, rng); // the opening's night walker
  if (state.trucks) stepTrucks(state, map); // fire trucks on a call
  if (state.clouds?.length) stepClouds(state, map, rng); // toxic clouds from a spill (no draws without one)
  if (state.gatherings?.length) stepGatherings(state); // community gatherings: age them, send people home, end them
  if (state.toxic?.size) stepToxic(state, map, state.windTick % WIND_CADENCE === 0); // their smog drifts and clears
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

  // The substep's vehicle context (congestion histogram + collision grid), snapshotted at substep
  // start; cars, citizen-driven cars and cruisers all read it (see cars.ts).
  const ctx = buildVehicleCtx(state, map);

  // 3. Move the cars (cars.ts: abandoned / owned / parked / moving).
  state.cars = state.cars.filter((c) => stepCar(state, map, rng, ctx, c));

  // 3a. Police: advance the scatter/chase clock, move the cruisers (hunt in chase, patrol in
  //     scatter), and run the arrest sweep ONLY during a chase — the streets pulse between calm
  //     and active sweeps (the ghost cadence).
  state.policeTick += 1;
  // Community safe-zones the cruisers avoid + never sweep (built fresh only when there ARE cruisers).
  const safe = state.cruisers.length > 0 ? buildSafeZones(map) : undefined;
  stepCruisers(state, map, rng, safe, ctx.moverGrid);
  state.arrestTick += 1;
  if (state.arrestTick % ARREST_CADENCE === 0 && policePhase(state.policeTick) === 'chase') {
    stepArrests(state, map, rng, safe);
  }

  // 3b. Move the pedestrians (peds.ts: the citizen state machine — hidden phases, walking a leg
  //     and arriving, idle → home).
  state.peds = state.peds.filter((p) => stepPed(state, map, rng, ctx, p));
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
  if (state.occTick % OCC_CADENCE === 0) {
    stepOccupancy(state, map);
    settleCamps(state, map); // the unhoused go to the camps (and the re-housed leave them)
  }

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
