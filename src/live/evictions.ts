// Evictions you can see (Maddy 2026-10-21 "Unhoused as people"): people put out of a home — by rent, a home torn
// down, a flood — are seen to go. Displacement arrives in fractions (rent takes a little from many homes); per home it
// builds until a whole person is out, then they walk from the home's door to the camp they joined (live/camps.ts
// settleCamps names it), carrying what they can, and are gone from the street there — they live in the camp now.
// Off for the opening's inherited crisis (evictionsShown). Live layer: writes only its own state.

import type { GameMap } from '../engine/map';
import type { AmbientState } from './types';
import { nearestWalkable } from './pathing';
import { TravelMode } from '../citizens/modes';

/** At most this many walk out of one home at once (the rest are counted, not drawn). */
export const EVICTION_WALKERS = 3;
const EPS = 1e-6;

/** `n` people from home `from` were camped at `camp` (settleCamps): note it, and queue a walk once a whole person is
 *  out. Not for the opening, and not for someone already unhoused (a rescue returned to a camp or a shelter). */
export function noteEviction(state: AmbientState, from: number, camp: number, n: number, campTiles: ReadonlyMap<number, number>): void {
  if (!state.evictionsShown || !(n > 0)) return;
  if (campTiles.has(from) || state.sheltered?.has(from)) return;
  const due = (state.evictDue ??= new Map());
  const d = due.get(from) ?? { n: 0, camp };
  d.n += n;
  d.camp = camp;
  if (d.n >= 1 - EPS) {
    const people = Math.floor(d.n + EPS);
    d.n -= people;
    (state.evictWalks ??= []).push({ from, to: camp, people });
  }
  if (d.n <= EPS) due.delete(from);
  else due.set(from, d);
}

/** Walk this pass's evictions out: from each home's door toward its camp, with what they carry. */
export function spawnEvictions(state: AmbientState, map: GameMap): void {
  const walks = state.evictWalks;
  if (!walks?.length) return;
  state.evictWalks = [];
  for (const w of walks) {
    const fx = w.from % map.width;
    const fy = (w.from - fx) / map.width;
    const door = nearestWalkable(map, fx, fy);
    if (!door) continue;
    const cx = w.to % map.width;
    const cy = (w.to - cx) / map.width;
    for (let k = 0; k < Math.min(EVICTION_WALKERS, w.people); k++) {
      state.peds.push({ x: door.x, y: door.y, dir: 0, tx: door.x, ty: door.y, shelter: w.to, carrying: true, phase: 'to-home', walkTo: { x: cx, y: cy }, mode: TravelMode.Walk });
    }
    state.events?.push({ kind: 'eviction', x: fx, y: fy, w: 1, h: 1 });
  }
}
