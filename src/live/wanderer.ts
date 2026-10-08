// The opening's night walker (bodhgaia-opening.md §3): one unhoused resident, starting at an encampment, walks
// the streets from one place to the next along real foot routes, until their time (`life` substeps) is up — then
// they die where they are (the death mechanic), leaving the unhoused. Live layer: writes only its own state.

import type { GameMap } from '../engine/map';
import type { Rng } from '../engine/rng';
import type { AmbientState } from './types';
import { ENCAMPMENT_WEAR, PED_SPEED } from './tuning';
import { walkPath } from './pathing';
import { isWalkable } from './network';
import { residentDies } from './death';


/** Begin the walk at the heaviest encampment (else the walkable tile nearest the map's centre). False if the
 *  city has nowhere to walk. */
export function startWanderer(state: AmbientState, map: GameMap, rng: Rng, life: number): boolean {
  let best = -1;
  let bestWear = ENCAMPMENT_WEAR - 1;
  for (const [t, w] of state.wear) {
    if (w > bestWear || (w === bestWear && t < best)) {
      best = t;
      bestWear = w;
    }
  }
  const cx = best >= 0 ? best % map.width : map.width >> 1;
  const cy = best >= 0 ? (best - cx) / map.width : map.height >> 1;
  for (let r = 0; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!isWalkable(map, x, y)) continue;
        state.wanderer = { x, y, path: [], i: 0, age: 0, life, seed: rng.nextInt(1 << 20) };
        return true;
      }
    }
  }
  return false;
}

/** A new destination 6..14 tiles away with a foot route to it. */
function nextRoute(state: AmbientState, map: GameMap, rng: Rng, x: number, y: number): number[] {
  for (let tries = 0; tries < 24; tries++) {
    const d = 6 + rng.nextInt(9);
    const a = rng.nextInt(4);
    const gx = x + (a === 0 ? d : a === 1 ? -d : rng.nextInt(2 * d + 1) - d);
    const gy = y + (a === 2 ? d : a === 3 ? -d : rng.nextInt(2 * d + 1) - d);
    if (!map.inBounds(gx, gy) || !isWalkable(map, gx, gy)) continue;
    const path = walkPath(map, x, y, gx, gy, state.wear, state.traffic, state.pollution);
    if (path && path.length > 2) return path;
  }
  return [];
}

/** One substep of the walk; the walker dies when their time is up. */
export function stepWanderer(state: AmbientState, map: GameMap, rng: Rng): void {
  const w = state.wanderer;
  if (!w) return;
  w.age++;
  if (w.age >= w.life) {
    const x = Math.round(w.x);
    const y = Math.round(w.y);
    state.wanderer = undefined;
    if (state.unhoused >= 1) state.unhoused -= 1;
    residentDies(state, x, y);
    return;
  }
  if (w.i >= w.path.length) {
    w.path = nextRoute(state, map, rng, Math.round(w.x), Math.round(w.y));
    w.i = 1;
    if (w.path.length === 0) return; // nowhere to go this step: they pause
  }
  const t = w.path[w.i]!;
  const tx = t % map.width;
  const ty = (t - tx) / map.width;
  const dx = tx - w.x;
  const dy = ty - w.y;
  const dist = Math.abs(dx) + Math.abs(dy);
  const step = PED_SPEED * 0.8; // an unhurried, tired walk
  if (dist <= step) {
    w.x = tx;
    w.y = ty;
    w.i++;
  } else if (Math.abs(dx) >= Math.abs(dy)) w.x += Math.sign(dx) * step;
  else w.y += Math.sign(dy) * step;
}
