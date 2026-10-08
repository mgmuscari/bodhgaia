// Death and memorial (docs/design/bodhgaia-opening.md §2). A resident who dies lies down where they fell; after
// FALL_SUBSTEPS a street memorial — a candle and flowers — takes their place and stays MEMORIAL_SUBSTEPS. The
// unhoused can die of exposure at night: once per in-game hour, a share of them scaled by how many there are,
// at the encampments, never within reach of shelter. Live layer: writes only its own state (never hashed).

import type { GameMap } from '../engine/map';
import type { Rng } from '../engine/rng';
import { BuiltKind } from '../engine/fabric';
import type { AmbientState } from './types';
import {
  ENCAMPMENT_WEAR,
  EXPOSURE_PER_PERSON_HOUR,
  FALL_SUBSTEPS,
  MEMORIAL_SUBSTEPS,
  NIGHT_FROM,
  NIGHT_TO,
  SHELTER_RADIUS,
} from './tuning';
import { nearKind } from './pathing';

/** A resident dies at (x, y): they lie down there (the caller has already taken them out of their household or
 *  the unhoused). */
export function residentDies(state: AmbientState, x: number, y: number): void {
  (state.fallen ??= []).push({ x, y, t: 0 });
  state.deaths = (state.deaths ?? 0) + 1;
  state.events?.push({ kind: 'death', x, y, w: 1, h: 1 });
}

/** Advance the fallen (lying → memorial) and the memorials (→ gone), one substep. */
export function stepDeaths(state: AmbientState): void {
  // age the standing memorials first, so one laid this substep starts at age 0
  if (state.memorials?.length) {
    state.memorials = state.memorials.filter((m) => ++m.age < MEMORIAL_SUBSTEPS);
  }
  if (state.fallen?.length) {
    const still: { x: number; y: number; t: number }[] = [];
    for (const f of state.fallen) {
      if (f.t + 1 >= FALL_SUBSTEPS) (state.memorials ??= []).push({ x: f.x, y: f.y, age: 0 });
      else still.push({ ...f, t: f.t + 1 });
    }
    state.fallen = still;
  }
}

/** Expected exposure deaths in one night hour among `unhoused` people. */
export function exposureDeathsPerHour(unhoused: number): number {
  return unhoused > 0 ? unhoused * EXPOSURE_PER_PERSON_HOUR : 0;
}

const isNight = (h: number): boolean => h >= NIGHT_FROM || h < NIGHT_TO;

/** The encampment tiles where nobody is within reach of shelter. */
function exposedCamps(state: AmbientState, map: GameMap): number[] {
  const out: number[] = [];
  for (const [t, w] of state.wear) {
    if (w < ENCAMPMENT_WEAR) continue;
    const x = t % map.width;
    const y = (t - x) / map.width;
    if (nearKind(map, x, y, BuiltKind.HealingCommons, SHELTER_RADIUS) || nearKind(map, x, y, BuiltKind.TinyHomes, SHELTER_RADIUS)) continue;
    out.push(t);
  }
  return out.sort((a, b) => a - b);
}

/** Draw this hour's exposure deaths — once per in-game hour, at night only, and only with a clock. */
export function stepExposure(state: AmbientState, map: GameMap, rng: Rng): void {
  const h = state.hour;
  if (h === undefined || h === state.exposureHour) return;
  state.exposureHour = h;
  if (!isNight(h) || state.unhoused < 1) return;
  const expected = exposureDeathsPerHour(state.unhoused);
  const n = Math.floor(expected) + (rng.next() < expected - Math.floor(expected) ? 1 : 0);
  if (n === 0) return;
  const camps = exposedCamps(state, map);
  for (let k = 0; k < n && camps.length > 0 && state.unhoused >= 1; k++) {
    const t = camps[rng.nextInt(camps.length)]!;
    const x = t % map.width;
    state.unhoused -= 1;
    residentDies(state, x, (t - x) / map.width);
  }
}
