// Live-layer POLLUTION fields: the prevailing wind, what a driving car deposits (traffic + air
// pollution), smog drift/diffusion and rain washout, water runoff/flow/treatment, ground pollution
// and its healing near player greens, and the seeded starting decay. Cut verbatim from
// ui/ambientContent.ts (prevailingWind from the former live/wind.ts); the stepper sets the cadence.

import type { GameMap } from '../../engine/map';
import type { Rng } from '../../engine/rng';
import { BuiltKind, isRoadKind } from '../../engine/fabric';
import { ZoneType, zoneTypeOf } from '../../engine/zone';
import { visitValue } from '../../citizens/plots';
import { decayField, layField, sampleField } from '../../citizens/field';
import {
  GREEN_HEAL_KINDS,
  GREEN_HEAL_RADIUS,
  GROUND_DECAY,
  GROUND_GREEN_HEAL,
  GROUND_INDUSTRY,
  GROUND_LITTER,
  GROUND_PLANT,
  GROUND_POLL_MAX,
  GROUND_SEEP,
  HEALTH_MAX,
  POLL_CONGEST,
  POLL_DIFFUSE_COEFF,
  POLL_FREEWAY_MULT,
  POLL_LAY_BASE,
  POLL_MAX,
  RAIN_RUNOFF_DILUTION,
  RAIN_SMOG_DILUTION,
  RUNOFF_INDUSTRY,
  RUNOFF_URBAN,
  RUNOFF_WILD,
  RUNOFF_WORN,
  TRAFFIC_LAY,
  TRAFFIC_MAX,
  WATER_FLOW_FRACTION,
  WATER_POLL_MAX,
  WATER_TREAT_AMOUNT,
  WATER_TREAT_RADIUS,
  WEAR_MAX,
  WIND_DIRS,
  WIND_FRACTION,
} from '../tuning';
import { DIR_DX, DIR_DY } from '../geometry';
import { seedInheritedOccupancy } from './occupancy';
import type { AmbientState } from '../types';

/** The world's prevailing wind as an integer unit vector, drawn from the (seeded) ambient rng so it
 *  is consistent per world seed and NEVER touches the sim/worldgen streams. Defaults to a westerly
 *  (blowing due east) when no rng is supplied, so the no-arg `createAmbientState()` stays usable. */
export function prevailingWind(rng?: Rng): { dx: number; dy: number } {
  const [dx, dy] = rng ? WIND_DIRS[rng.nextInt(WIND_DIRS.length)]! : WIND_DIRS[2]!;
  return { dx, dy };
}

/** A driving car lays live traffic at the tile under it — the agent-driven traffic field (cars ARE
 *  the traffic). Other cars' pathfinding routes around it; pedestrians shun it. */
export function layTraffic(state: AmbientState, map: GameMap, x: number, y: number): void {
  layField(state.traffic, map.idx(x, y), TRAFFIC_LAY, TRAFFIC_MAX);
}

/** How much air pollution a car emits at the tile under it this substep (pure decision seam): a base
 *  amount on a surface road, doubled on a freeway (faster, heavier flow), plus up to POLL_CONGEST
 *  more scaled by how jammed the tile is (`congestion` 0..1 = local traffic / TRAFFIC_MAX) — idling
 *  in a jam smogs the most. The car IS the source; the macro smog pattern emerges from the agents. */
export function pollutionEmit(onFreeway: boolean, congestion: number): number {
  return POLL_LAY_BASE * (onFreeway ? POLL_FREEWAY_MULT : 1) + congestion * POLL_CONGEST;
}

/** A driving car lays live air pollution at the tile under it, scaled by freeway/congestion via
 *  pollutionEmit. Peds shun it (pedCost) and it drags land value down — the agent-driven air layer. */
export function layPollution(state: AmbientState, map: GameMap, x: number, y: number, onFreeway: boolean): void {
  const i = map.idx(x, y);
  const congestion = sampleField(state.traffic, i) / TRAFFIC_MAX;
  layField(state.pollution, i, pollutionEmit(onFreeway, congestion), POLL_MAX);
}

/** One water-runoff pass: every water tile with ground neighbours collects their runoff
 *  (paved/built/worn ground sheds most), accumulating toward WATER_POLL_MAX. Open water with no
 *  ground neighbours stays clean. Whole-map scan — gated to WATER_RUNOFF_CADENCE by the caller. */
export function accumulateWaterRunoff(state: AmbientState, map: GameMap): void {
  const W = map.width;
  const H = map.height;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = map.idx(x, y);
      if (map.water[i] === 0) continue; // only water collects runoff
      let runoff = 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIR_DX[d]!;
        const ny = y + DIR_DY[d]!;
        if (!map.inBounds(nx, ny)) continue;
        const ni = map.idx(nx, ny);
        if (map.water[ni] !== 0) continue; // a water neighbour sheds nothing
        const k = map.built[ni]!;
        if (zoneTypeOf(k) === ZoneType.Industrial) {
          // Industry is the toxic source; redlined industry sheds the MOST (least
          // regulated, concentrated there by policy) — scale by the tile's grade.
          // This is the Hackensack: the contamination starts at the redlined plant.
          runoff += RUNOFF_INDUSTRY * (1 + map.redline[ni]! / 255);
        } else if (isRoadKind(k) || k === BuiltKind.ParkingLot || zoneTypeOf(k) !== ZoneType.None) {
          // Redlined built ground sheds more toxic runoff — the disinvested district
          // (no drainage, dumping, industrial legacy) poisons its own water. Grade-
          // scaled so the mechanic holds even where worldgen gutted the industry.
          runoff += RUNOFF_URBAN * (1 + map.redline[ni]! / 255);
        } else {
          runoff += RUNOFF_WILD; // wilderness is not a toxic source, regardless of grade
        }
        if ((state.wear.get(ni) ?? 0) > 40) runoff += RUNOFF_WORN;
      }
      if (runoff === 0) continue;
      layField(state.waterPollution, i, runoff, WATER_POLL_MAX);
    }
  }
}

/** Lay the LAND-contamination field: each ground tile accrues pollution from its OWN source-ness
 *  (industry + a dirty power plant sitting on it, grade-scaled), the litter/wear of demand paths
 *  that cross it, and a seep from adjacent industrial/plant tiles (the plume spreads a tile). Then
 *  the whole field decays slowly, so removing a source (bulldoze the plant, calm the path, rewild)
 *  lets the land recover — the toxic legacy is lingering but reparable. Whole-map scan; gated to
 *  GROUND_RUNOFF_CADENCE by the caller. Live/non-hashed. */
export function accumulateGroundPollution(state: AmbientState, map: GameMap): void {
  const W = map.width;
  const H = map.height;
  const plants =
    state.plantEmitters && state.plantEmitters.length > 0
      ? new Set(state.plantEmitters.map((e) => e.tile))
      : null;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = map.idx(x, y);
      if (map.water[i] !== 0) continue; // ground only — water keeps its own runoff field
      let load = 0;
      const k = map.built[i]!;
      // The tile's OWN source-ness: industry + dirty power poison the ground they stand on.
      if (zoneTypeOf(k) === ZoneType.Industrial) load += GROUND_INDUSTRY * (1 + map.redline[i]! / 255);
      if (plants && plants.has(i)) load += GROUND_PLANT;
      // Demand-path litter: the trampled, littered ground of a beaten path leaches into the soil.
      const wear = state.wear.get(i) ?? 0;
      if (wear > 0) load += (wear / WEAR_MAX) * GROUND_LITTER;
      // Seep from adjacent sources — the contamination spreads a tile into the surrounding land.
      for (let d = 0; d < 4; d++) {
        const nx = x + DIR_DX[d]!;
        const ny = y + DIR_DY[d]!;
        if (!map.inBounds(nx, ny)) continue;
        const ni = map.idx(nx, ny);
        if (map.water[ni] !== 0) continue;
        if (zoneTypeOf(map.built[ni]!) === ZoneType.Industrial) {
          load += GROUND_SEEP * (1 + map.redline[ni]! / 255);
        } else if (plants && plants.has(ni)) {
          load += GROUND_SEEP;
        }
      }
      if (load > 0) layField(state.groundPollution, i, load, GROUND_POLL_MAX);
    }
  }
  decayField(state.groundPollution, GROUND_DECAY); // lingers, but clears once the sources are gone
  healGroundNearGreens(state, map); // de-paving heals the soil — pollution clears faster near greens
}

/** Is there a player green within {@link GREEN_HEAL_RADIUS} (Chebyshev) of (x, y)? */
export function nearPlayerGreen(map: GameMap, x: number, y: number): boolean {
  for (let dy = -GREEN_HEAL_RADIUS; dy <= GREEN_HEAL_RADIUS; dy++) {
    for (let dx = -GREEN_HEAL_RADIUS; dx <= GREEN_HEAL_RADIUS; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (map.inBounds(nx, ny) && GREEN_HEAL_KINDS.has(map.built[map.idx(nx, ny)]!)) return true;
    }
  }
  return false;
}

/** Extra ground-pollution clearing on tiles near the player's greens: de-paving (greening) heals the
 *  contaminated soil it replaces (Maddy: healing redline helps clear ground pollution). Sparse pass
 *  over the live field; the de-paved land recovers faster than the lingering GROUND_DECAY alone. */
export function healGroundNearGreens(state: AmbientState, map: GameMap): void {
  if (state.groundPollution.size === 0) return;
  for (const [i, v] of state.groundPollution) {
    if (v <= 0) continue;
    const x = i % map.width;
    const y = (i - x) / map.width;
    if (!nearPlayerGreen(map, x, y)) continue;
    const nv = v * GROUND_GREEN_HEAL;
    if (nv <= 0.5) state.groundPollution.delete(i);
    else state.groundPollution.set(i, nv);
  }
}

/**
 * Flow water pollution DOWNSTREAM: each polluted water tile pushes WATER_FLOW_FRACTION
 * of its load to its lower-elevation water neighbours. Processed high→low elevation so
 * contamination cascades downhill in a single pass — so a community DOWNSTREAM of the
 * redlined industry is poisoned even with no polluting neighbour of its own (the
 * Hackensack: the harm is sited upstream, borne downstream). Live/non-hashed;
 * deterministic (sorted order); integer/rational only.
 */
/** One smog-drift pass: carry WIND_FRACTION of every air-pollution tile's load ONE tile downwind
 *  (along `state.wind`), so plumes streak away from their sources instead of only diffusing in place.
 *  A conservative transfer — what leaves a tile arrives at its downwind neighbour (smog at the map
 *  edge blows off the map and leaves the system); the normal POLL_DECAY then fades the whole plume
 *  with distance/time. Air ignores substrate — it drifts over land and water alike. Departures are
 *  computed from the pre-pass values and arrivals applied AFTER the scan, so it's a clean
 *  simultaneous update (no within-pass cascade). Live/non-hashed; gated to WIND_CADENCE by the
 *  caller. */
export function driftPollution(state: AmbientState, map: GameMap): void {
  driftField(state.pollution, state.wind, map, POLL_MAX);
}

/** {@link driftPollution} over any air field (smog, a spill's toxic smog). */
export function driftField(field: Map<number, number>, wind: { dx: number; dy: number }, map: GameMap, max: number): void {
  const { dx, dy } = wind;
  if (dx === 0 && dy === 0) return;
  if (field.size === 0) return;
  const arrivals: Array<[number, number]> = []; // (downwind tile, amount) — applied after the scan
  for (const [i, p] of field) {
    if (p <= 0) continue;
    const x = i % map.width;
    const y = (i - x) / map.width;
    const nx = x + dx;
    const ny = y + dy;
    if (!map.inBounds(nx, ny)) continue; // blows off the map edge — leaves the system (no wrap)
    const move = p * WIND_FRACTION;
    if (move <= 0) continue;
    arrivals.push([map.idx(nx, ny), move]);
    field.set(i, p - move);
  }
  for (const [ni, amt] of arrivals) layField(field, ni, amt, max);
}

/** Isotropic DIFFUSION of the smog field (Maddy: "smog diffuses in addition to blowing in the wind").
 *  Each tile sheds `coeff` of its value, split equally to its 4 neighbours; the share toward an
 *  off-map edge LEAVES the system (no wrap). Wind {@link driftPollution} streaks the plume downwind;
 *  this fattens/softens it so it isn't a hard streak. Departures from pre-pass values, arrivals after
 *  (a clean simultaneous update). Live/non-hashed; gated to WIND_CADENCE by the caller. */
export function diffusePollution(state: AmbientState, map: GameMap, coeff = POLL_DIFFUSE_COEFF): void {
  diffuseField(state.pollution, map, coeff, POLL_MAX);
}

/** {@link diffusePollution} over any air field. */
export function diffuseField(field: Map<number, number>, map: GameMap, coeff: number, max: number): void {
  if (field.size === 0 || coeff <= 0) return;
  const arrivals: Array<[number, number]> = [];
  for (const [i, p] of field) {
    if (p <= 0) continue;
    const x = i % map.width;
    const y = (i - x) / map.width;
    const share = (p * coeff) / 4; // each direction's share; off-map shares are lost
    if (share <= 0) continue;
    for (let d = 0; d < 4; d++) {
      const nx = x + DIR_DX[d]!;
      const ny = y + DIR_DY[d]!;
      if (!map.inBounds(nx, ny)) continue; // off-map → the share leaves the system
      arrivals.push([map.idx(nx, ny), share]);
    }
    field.set(i, p - p * coeff); // sheds the full coeff fraction; only in-bounds shares arrive
  }
  for (const [ni, amt] of arrivals) layField(field, ni, amt, max);
}

/** A RAIN event (Maddy): rain washes airborne smog DOWN onto the land, then mobilises ground
 *  contamination into runoff that SEEKS water — each conversion diluted by a fraction < 1, so the
 *  pollution RELOCATES (toward the low-lying redlined/industrial banks) rather than vanishing. Two
 *  passes: (1) smog→ground over land (× RAIN_SMOG_DILUTION); (2) ground→adjacent water, else downhill
 *  to a lower-elevation land neighbour (runoff travels), × RAIN_RUNOFF_DILUTION. Live/non-hashed;
 *  gated to RAIN_CADENCE by the caller. Reparable (WastewaterWorks, remediation, source removal). */
export function applyRain(state: AmbientState, map: GameMap): void {
  // 1. Smog → ground: rain washes a fraction of each LAND tile's airborne smog down onto it.
  const groundAdds: Array<[number, number]> = [];
  for (const [i, p] of state.pollution) {
    if (p <= 0 || map.water[i] !== 0) continue; // only over land (smog over water just falls into it)
    const wash = p * RAIN_SMOG_DILUTION;
    if (wash <= 0) continue;
    groundAdds.push([i, wash]);
    state.pollution.set(i, p - wash);
  }
  for (const [i, a] of groundAdds) layField(state.groundPollution, i, a, GROUND_POLL_MAX);

  // 2. Ground → runoff: mobilise ground pollution toward an adjacent water body, else downhill to the
  //    lowest lower-elevation land neighbour (the runoff travels; over passes it reaches the water).
  const waterAdds: Array<[number, number]> = [];
  const landAdds: Array<[number, number]> = [];
  for (const [i, p] of state.groundPollution) {
    if (p <= 0) continue;
    const x = i % map.width;
    const y = (i - x) / map.width;
    let waterTarget = -1;
    let lowLand = -1;
    let lowE = map.elevation[i]!;
    for (let d = 0; d < 4; d++) {
      const nx = x + DIR_DX[d]!;
      const ny = y + DIR_DY[d]!;
      if (!map.inBounds(nx, ny)) continue;
      const ni = map.idx(nx, ny);
      if (map.water[ni] !== 0) {
        waterTarget = ni; // a water neighbour is the sink — runoff reaches the bank
        break;
      }
      if (map.elevation[ni]! < lowE) {
        lowE = map.elevation[ni]!;
        lowLand = ni;
      }
    }
    const target = waterTarget !== -1 ? waterTarget : lowLand;
    if (target === -1) continue; // flat inland with no water neighbour → stays put this storm
    const move = p * RAIN_RUNOFF_DILUTION;
    if (move <= 0) continue;
    state.groundPollution.set(i, p - move);
    (waterTarget !== -1 ? waterAdds : landAdds).push([target, move]);
  }
  for (const [i, a] of waterAdds) layField(state.waterPollution, i, a, WATER_POLL_MAX);
  for (const [i, a] of landAdds) layField(state.groundPollution, i, a, GROUND_POLL_MAX);
}

export function flowWaterPollution(state: AmbientState, map: GameMap): void {
  if (state.waterPollution.size === 0) return;
  const tiles = [...state.waterPollution.keys()].filter((i) => map.water[i] !== 0);
  tiles.sort((a, b) => map.elevation[b]! - map.elevation[a]! || a - b);
  for (const i of tiles) {
    const p = state.waterPollution.get(i) ?? 0;
    if (p <= 0) continue;
    const x = i % map.width;
    const y = (i - x) / map.width;
    const e = map.elevation[i]!;
    const lower: number[] = [];
    for (let d = 0; d < 4; d++) {
      const nx = x + DIR_DX[d]!;
      const ny = y + DIR_DY[d]!;
      if (!map.inBounds(nx, ny)) continue;
      const ni = map.idx(nx, ny);
      if (map.water[ni] !== 0 && map.elevation[ni]! < e) lower.push(ni);
    }
    if (lower.length === 0) continue;
    const move = (p * WATER_FLOW_FRACTION) / lower.length;
    if (move <= 0) continue;
    for (const ni of lower) layField(state.waterPollution, ni, move, WATER_POLL_MAX);
    state.waterPollution.set(i, p - move * lower.length);
  }
}

/**
 * Reparation: a WastewaterWorks cleans contaminated water within WATER_TREAT_RADIUS,
 * strongest at the works and falling off with distance. The player's heal for the
 * poisoned creek — restore the water, restore the bankside community's land value and
 * health (the inverse of the harm). Rewilding the banks also helps implicitly (wild
 * ground sheds almost nothing). Live/non-hashed; few works, so cheap.
 */
export function treatWaterPollution(state: AmbientState, map: GameMap): void {
  if (state.waterPollution.size === 0) return;
  for (let wi = 0; wi < map.built.length; wi++) {
    if (map.built[wi] !== BuiltKind.WastewaterWorks) continue;
    const wx = wi % map.width;
    const wy = (wi - wx) / map.width;
    for (let dy = -WATER_TREAT_RADIUS; dy <= WATER_TREAT_RADIUS; dy++) {
      for (let dx = -WATER_TREAT_RADIUS; dx <= WATER_TREAT_RADIUS; dx++) {
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist > WATER_TREAT_RADIUS) continue;
        const nx = wx + dx;
        const ny = wy + dy;
        if (!map.inBounds(nx, ny)) continue;
        const ni = map.idx(nx, ny);
        if (map.water[ni] === 0) continue;
        const cur = state.waterPollution.get(ni);
        if (cur === undefined) continue;
        const nv = cur - WATER_TREAT_AMOUNT * (1 - dist / (WATER_TREAT_RADIUS + 1));
        if (nv <= 0) state.waterPollution.delete(ni);
        else state.waterPollution.set(ni, nv);
      }
    }
  }
}

/** Number of urban (road / parking / built) tiles in the 8-neighbourhood of (x, y). */
export function urbanNeighbours(map: GameMap, x: number, y: number): number {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!map.inBounds(nx, ny)) continue;
      const k = map.built[map.idx(nx, ny)]!;
      if (isRoadKind(k) || k === BuiltKind.ParkingLot || zoneTypeOf(k) !== ZoneType.None) n++;
    }
  }
  return n;
}

/** Seed the live decay a century of car-culture left BEFORE the player arrives, so the city
 *  starts degraded rather than pristine: empty urban ground is already trampled brown (wear,
 *  by how hemmed-in it is) and the shorelines are already polluted (runoff). Derived from the
 *  worldgen world; the live layers evolve from here as the player heals or neglects the city. */
export function seedDecay(state: AmbientState, map: GameMap): void {
  const PLOT_SEED_RADIUS = 5; // how far a home "feels" the plots around it
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const k = map.built[map.idx(x, y)]!;
      // Trampled urban ground: hemmed-in empty land is already a beaten path.
      if (k === BuiltKind.None && map.water[map.idx(x, y)] === 0) {
        const urban = urbanNeighbours(map, x, y);
        if (urban >= 2) state.wear.set(map.idx(x, y), Math.min(WEAR_MAX, urban * 26));
        continue;
      }
      // Precomputed home wellbeing: a century in this environment, summed from the plots a
      // home's citizens would visit nearby (industry drags it down, commerce/civic/new-urbanist
      // lift it) — so homes START with a wellbeing reflecting where they sit, not zero.
      if (zoneTypeOf(k) === ZoneType.Residential) {
        let h = 0;
        for (let dy = -PLOT_SEED_RADIUS; dy <= PLOT_SEED_RADIUS; dy++) {
          for (let dx = -PLOT_SEED_RADIUS; dx <= PLOT_SEED_RADIUS; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (!map.inBounds(nx, ny)) continue;
            h += visitValue(map.built[map.idx(nx, ny)]!);
          }
        }
        if (h !== 0) state.buildingHealth.set(map.idx(x, y), Math.max(-HEALTH_MAX, Math.min(HEALTH_MAX, h)));
      }
    }
  }
  // A century of runoff already in the water — saturate the urban shorelines.
  for (let n = 0; n < 60; n++) accumulateWaterRunoff(state, map);
  // …and a century of disinvestment already emptied the redlined homes: the inherited unhoused.
  seedInheritedOccupancy(state, map);
}
