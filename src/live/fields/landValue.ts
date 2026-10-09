// Live-layer LAND VALUE fields: fire/health service coverage, the derived per-plot land value (the
// healed land + amenity greens, minus the live nuisances) and its periodic recompute, and road decay
// (roads crumble where nobody cares for them). Cut verbatim from ui/ambientContent.ts; the stepper
// sets the cadence.

import type { GameMap } from '../../engine/map';
import { BuiltKind, isRoadKind, isServiceStation } from '../../engine/fabric';
import { ZoneType, zoneTypeOf } from '../../engine/zone';
import { layField, sampleField } from '../../citizens/field';
import {
  AMENITY_KINDS,
  LV_RUIN,
  COVERAGE_RADIUS,
  LV_AMENITY,
  LV_BASE,
  LV_COVERAGE_PEN,
  LV_FAUNA,
  LV_FLORA,
  LV_MAX,
  LV_POLL_PEN,
  LV_RADIUS,
  LV_ROAD_PEN,
  LV_TRAFFIC_PEN,
  LV_WATER_PEN,
  LV_WEAR_PEN,
  POLL_MAX,
  ROAD_CARED_LV,
  ROAD_CRUMBLE_RATE,
  ROAD_DECAY_MAX,
  ROAD_RECOVER_RATE,
  TRAFFIC_MAX,
  WATER_POLL_MAX,
  WEAR_MAX,
} from '../tuning';
import { DIR_DX, DIR_DY } from '../geometry';
import type { AmbientState } from '../types';

/**
 * The set of tiles within COVERAGE_RADIUS of a fire station / healing commons — the live fire/health
 * SERVICE COVERAGE. Worldgen provides stations to the greenlined districts and withholds them from
 * the redlined, so the redlined zones start UNDER-served (uncovered → a land-value drag); the player
 * extends coverage by building stations, which repairs it. Built fresh from the map (sparse stations).
 */
export function computeCoverage(map: GameMap): Set<number> {
  const covered = new Set<number>();
  for (let i = 0; i < map.built.length; i++) {
    if (!isServiceStation(map.built[i]!)) continue;
    const cx = i % map.width;
    const cy = (i - cx) / map.width;
    for (let dy = -COVERAGE_RADIUS; dy <= COVERAGE_RADIUS; dy++) {
      for (let dx = -COVERAGE_RADIUS; dx <= COVERAGE_RADIUS; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > COVERAGE_RADIUS) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (map.inBounds(nx, ny)) covered.add(map.idx(nx, ny));
      }
    }
  }
  return covered;
}

/** A plot tile's DERIVED land value (0..LV_MAX, pure decision seam): the healed land it sits on +
 *  a bonus per adjacent amenity green, MINUS the live nuisances under/over it (air pollution, traffic
 *  congestion, trampled-ground decay). The live fields are optional so the contract is unit-testable
 *  in isolation; absent ⇒ no nuisance. This is the readout the city's desirability emerges from. */
export function landValueAt(
  map: GameMap,
  x: number,
  y: number,
  pollution?: ReadonlyMap<number, number>,
  traffic?: ReadonlyMap<number, number>,
  wear?: ReadonlyMap<number, number>,
  water?: ReadonlyMap<number, number>,
  road?: ReadonlyMap<number, number>,
  coverage?: ReadonlySet<number>,
): number {
  const i = map.idx(x, y);
  let v = LV_BASE + (map.floraVitality[i]! / 255) * LV_FLORA + (map.faunaPresence[i]! / 255) * LV_FAUNA;
  // Under-served: an inhabited plot with no fire/health station in reach is a real drag.
  if (coverage && !coverage.has(i)) v -= LV_COVERAGE_PEN;
  // Amenities and nuisances are felt over a RADIUS, not just on the plot tile — a building's smog and
  // congestion come from the ROADS beside it, and a park lifts a whole block. Amenities sum (with a
  // linear falloff: more greens near = nicer); nuisances take the worst nearby (one jammed/smoggy road
  // is enough to drag a plot down).
  let amenity = 0;
  let ruins = 0; // empty shells nearby: a dead street drags a living one
  let pollNear = 0;
  let trafNear = 0;
  let wearNear = 0;
  let waterNear = 0;
  let roadNear = 0;
  for (let dy = -LV_RADIUS; dy <= LV_RADIUS; dy++) {
    for (let dx = -LV_RADIUS; dx <= LV_RADIUS; dx++) {
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist > LV_RADIUS) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!map.inBounds(nx, ny)) continue;
      const ni = map.idx(nx, ny);
      const falloff = 1 - dist / (LV_RADIUS + 1); // 1 on the tile → ~0 at the edge of the radius
      if (AMENITY_KINDS.has(map.built[ni]!) || map.deck[ni] === BuiltKind.Parklet) amenity += falloff; // a kerb parklet too
      else if (map.built[ni] === BuiltKind.Ruin) ruins += falloff;
      // Nuisances felt by distance: the worst weighted road nearby sets the drag (one jam is enough).
      if (pollution) pollNear = Math.max(pollNear, sampleField(pollution, ni) * falloff);
      if (traffic) trafNear = Math.max(trafNear, sampleField(traffic, ni) * falloff);
      if (wear) wearNear = Math.max(wearNear, sampleField(wear, ni) * falloff);
      // The contaminated creek on the banks: the worst nearby water pollution drags the plot.
      if (water) waterNear = Math.max(waterNear, sampleField(water, ni) * falloff);
      // Crumbling road frontage drags the plot (disinvested infrastructure).
      if (road) roadNear = Math.max(roadNear, sampleField(road, ni) * falloff);
    }
  }
  v += amenity * LV_AMENITY;
  v -= ruins * LV_RUIN;
  v -= (pollNear / POLL_MAX) * LV_POLL_PEN;
  v -= (trafNear / TRAFFIC_MAX) * LV_TRAFFIC_PEN;
  v -= (wearNear / WEAR_MAX) * LV_WEAR_PEN;
  v -= (waterNear / WATER_POLL_MAX) * LV_WATER_PEN;
  v -= (roadNear / ROAD_DECAY_MAX) * LV_ROAD_PEN;
  return v < 0 ? 0 : v > LV_MAX ? LV_MAX : v;
}

/** Recompute the land-value field over every inhabited PLOT tile (zoneTypeOf !== None), reading the
 *  current live nuisance fields. Rebuilt fresh each pass (cleared first) so a demolished plot drops
 *  out. Whole-map scan — gated to LV_CADENCE by the caller (a slow, cheap readout). */
export function recomputeLandValue(state: AmbientState, map: GameMap): void {
  state.landValue.clear();
  recomputeRows(state, map, 0, map.height);
}

/** Band `k` of `bands` (rows [k·H/bands, (k+1)·H/bands)): its plots recomputed, its demolished plots dropped. The step
 *  runs one band a substep, so a second of substeps covers the map exactly as recomputeLandValue did — without the
 *  once-a-second spike of every plot's neighbourhood in one substep (the scaling pass, Maddy 2026-10-08). */
export function recomputeLandValueBand(state: AmbientState, map: GameMap, k: number, bands: number): void {
  const y0 = Math.floor((k * map.height) / bands);
  const y1 = Math.floor(((k + 1) * map.height) / bands);
  recomputeRows(state, map, y0, y1, true);
}

/** Recompute rows [y0, y1); `drop` deletes the value of any tile there that is no longer a plot. */
function recomputeRows(state: AmbientState, map: GameMap, y0: number, y1: number, drop = false): void {
  const W = map.width;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < W; x++) {
      const i = map.idx(x, y);
      if (zoneTypeOf(map.built[i]!) === ZoneType.None) {
        if (drop) state.landValue.delete(i); // demolished since its band last came round
        continue; // only inhabited plots carry a value
      }
      state.landValue.set(
        i,
        landValueAt(
          map, x, y, state.pollution, state.traffic, state.wear, state.waterPollution, state.roadDecay, state.coverage,
        ),
      );
    }
  }
}

/**
 * Step road decay: each road tile crumbles (scaled by its redline grade — redlined roads
 * crumble, greenlined stay sound) UNLESS its neighborhood is cared-for (the best adjacent plot's
 * land value is at/above ROAD_CARED_LV), in which case the pavement recovers. So the player's
 * existing healing — raising a redlined district's land value — also fixes its roads; no separate
 * repair tool. Live/non-hashed; reads land value + grade, writes only roadDecay.
 */
export function stepRoadDecay(state: AmbientState, map: GameMap): void {
  const W = map.width;
  const H = map.height;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = map.idx(x, y);
      if (!isRoadKind(map.built[i]!)) continue;
      // Local care = the best land value among the plots this road serves (4-neighbours).
      let caredLV = 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIR_DX[d]!;
        const ny = y + DIR_DY[d]!;
        if (!map.inBounds(nx, ny)) continue;
        caredLV = Math.max(caredLV, state.landValue.get(map.idx(nx, ny)) ?? 0);
      }
      if (caredLV >= ROAD_CARED_LV) {
        const cur = state.roadDecay.get(i);
        if (cur === undefined) continue;
        const nv = cur - ROAD_RECOVER_RATE;
        if (nv <= 0) state.roadDecay.delete(i);
        else state.roadDecay.set(i, nv);
      } else {
        const crumble = ROAD_CRUMBLE_RATE * (map.redline[i]! / 255); // redlined crumbles, greenlined ~0
        if (crumble > 0) layField(state.roadDecay, i, crumble, ROAD_DECAY_MAX);
      }
    }
  }
}
