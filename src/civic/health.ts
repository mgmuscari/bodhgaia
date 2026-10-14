// Neighbourhood health (docs/design/interdependence.md §1; Maddy 2026-10-13: "one composite hub"). One score per
// neighbourhood, 0..255, the mean of its parts:
//   civic  — its belonging, voice and trust;
//   ground — its soil and flora;
//   repair — how well its buildings are kept (their mean condition);
//   work   — jobs within WORK_REACH for its working residents (more for a taught neighbourhood), capped at all of them;
//   care   — the share of its plots a fire station and a clinic reach;
//   food   — the share of its residents whose homes are fed (live/food.ts), once the food chain reports. Events read it; later, petitions and
// narratives. Deterministic, PURE: the live inputs (occupancy, coverage, each plot's jobs) arrive as accessors.

import type { GameMap } from '../engine/map';
import { isBuildingKind, BuiltKind, type ParcelStore } from '../engine/fabric';
import type { NeighborhoodMap } from './neighborhoods';

/** How far (Chebyshev, from a neighbourhood's centre) a job counts as within reach. */
export const WORK_REACH = 16;
/** The share of residents who work (as the indicators: economy/indicators.ts WORKING_SHARE). */
const WORKING = 0.5;
/** Plots that aren't buildings — no condition to keep. */
const UNBUILT = new Set<number>([BuiltKind.Yard, BuiltKind.ParkingLot, BuiltKind.VacantLot, BuiltKind.Site]);

export interface HealthInputs {
  map: GameMap;
  parcels: ParcelStore;
  partition: NeighborhoodMap;
  civic: { count(): number; getValues(id: number): { belonging: number; voice: number; trust: number } };
  occupancyAt(tile: number): number | undefined;
  /** Developed plot tiles a fire station and a clinic reach (the live coverage field). */
  coverage: ReadonlySet<number>;
  /** The jobs at parcel `i` (0 for a home or a green). */
  jobsAt(i: number): number;
  /** How much more of the jobs in reach a place at (x, y) gets for its schooling, ≥ 1 (live/school.ts learningLift) —
   *  absent: 1. */
  jobsLiftAt?(x: number, y: number): number;
  /** Home anchor tiles with food access (live/food.ts) — absent before the food chain's first hour. */
  foodAccess?: ReadonlySet<number>;
}

export interface HealthParts {
  civic: number;
  ground: number;
  repair: number;
  work: number;
  care: number;
  /** The share of its residents whose homes are fed (once the food chain reports). */
  food?: number;
}

export interface NeighbourhoodHealth {
  health: number;
  parts: HealthParts;
}

/** Each neighbourhood's health, indexed by id − 1. */
export function neighbourhoodHealth(inp: HealthInputs): NeighbourhoodHealth[] {
  const { map, parcels, partition } = inp;
  const n = partition.neighborhoods.length;
  const t2n = partition.tileToNeighborhood;
  const ground = new Float64Array(n);
  const tiles = new Float64Array(n);
  const cx = new Float64Array(n);
  const cy = new Float64Array(n);
  const plotTiles = new Float64Array(n);
  const covered = new Float64Array(n);
  for (let t = 0; t < t2n.length; t++) {
    const id = t2n[t]!;
    if (id === 0) continue;
    const k = id - 1;
    const x = t % map.width;
    tiles[k]! += 1;
    cx[k]! += x;
    cy[k]! += (t - x) / map.width;
    ground[k]! += (map.soilHealth[t]! + map.floraVitality[t]!) / 2;
    if (map.parcel[t] !== 0) {
      plotTiles[k]! += 1;
      if (inp.coverage.has(t)) covered[k]! += 1;
    }
  }
  const condition = new Float64Array(n);
  const buildings = new Float64Array(n);
  const workers = new Float64Array(n);
  const residents = new Float64Array(n);
  const fed = new Float64Array(n);
  const workplaces: { x: number; y: number; jobs: number }[] = [];
  for (const i of parcels.aliveIndices()) {
    const p = parcels.get(i);
    const anchor = map.idx(p.x, p.y);
    const jobs = inp.jobsAt(i);
    if (jobs > 0) workplaces.push({ x: p.x + p.width / 2, y: p.y + p.height / 2, jobs });
    const id = t2n[anchor]!;
    if (id === 0) continue;
    if (isBuildingKind(p.kind) && !UNBUILT.has(p.kind)) {
      condition[id - 1]! += p.condition;
      buildings[id - 1]! += 1;
    }
    const occ = inp.occupancyAt(anchor) ?? 0;
    workers[id - 1]! += occ * WORKING;
    if (occ > 0) {
      residents[id - 1]! += occ;
      if (inp.foodAccess?.has(anchor)) fed[id - 1]! += occ;
    }
  }
  const out: NeighbourhoodHealth[] = [];
  for (let k = 0; k < n; k++) {
    const v = inp.civic.getValues(k + 1);
    const mx = tiles[k]! > 0 ? cx[k]! / tiles[k]! : 0;
    const my = tiles[k]! > 0 ? cy[k]! / tiles[k]! : 0;
    let jobs = 0;
    for (const w of workplaces) if (Math.max(Math.abs(w.x - mx), Math.abs(w.y - my)) <= WORK_REACH) jobs += w.jobs;
    // schooling: a taught neighbourhood gets more of the jobs round it (up to half again — live/school.ts)
    jobs *= inp.jobsLiftAt?.(Math.round(mx), Math.round(my)) ?? 1;
    const parts: HealthParts = {
      civic: (v.belonging + v.voice + v.trust) / 3,
      ground: tiles[k]! > 0 ? ground[k]! / tiles[k]! : 0,
      repair: buildings[k]! > 0 ? condition[k]! / buildings[k]! : 0,
      work: workers[k]! > 0 ? Math.min(1, jobs / workers[k]!) * 255 : 0,
      care: plotTiles[k]! > 0 ? (covered[k]! / plotTiles[k]!) * 255 : 0,
    };
    if (inp.foodAccess) parts.food = residents[k]! > 0 ? (fed[k]! / residents[k]!) * 255 : 0;
    const all = Object.values(parts) as number[];
    const health = all.reduce((a, b) => a + b, 0) / all.length;
    out.push({ health, parts });
  }
  return out;
}
