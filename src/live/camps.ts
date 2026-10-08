// Encampments (Maddy 2026-10-08: "unhoused people must go to encampments … tents must correspond to unhoused
// people who are living in them"). The unhoused pool (AmbientState.unhoused, docs/design/rehoming.md) lives
// somewhere: `state.camps`, encampment tile → the people living there, always summing to the pool.
//
// - Someone put out of a home (leftHome) goes to the camp nearest it with room, within CAMP_REACH; failing that
//   they start one on the nearest open land.
// - Someone re-housed (wentHome) leaves the camp nearest their new home.
// - Anything else that moves the pool (a death, an arrest, an older save) is reconciled: losses come from the
//   largest camps, gains camp by the emptiest homes (where people were pushed out from).
// - A camp built over moves on.
// Tents are drawn from the camps (tentsAt) — never from desire-path wear. Live layer: writes only its own state.

import type { GameMap } from '../engine/map';
import { BuiltKind } from '../engine/fabric';
import type { AmbientState } from './types';

/** People sharing a tent. */
export const PEOPLE_PER_TENT = 4;
/** Tents a camp tile holds, and so the people it holds before the next camp starts beside it. */
export const TENTS_PER_CAMP = 3;
export const CAMP_CAP = PEOPLE_PER_TENT * TENTS_PER_CAMP;
/** How far (Manhattan) someone goes to join a camp before starting their own. */
export const CAMP_REACH = 6;
/** How far (Manhattan) from where they came someone looks for open land to camp on. */
const SITE_SEARCH = 24;
const EPS = 1e-6;

/** The tents a camp of `people` shows: one per PEOPLE_PER_TENT (a part-filled tent counts from half a person),
 *  at most TENTS_PER_CAMP. */
export function tentsAt(people: number): number {
  if (!(people >= 0.5)) return 0;
  return Math.min(TENTS_PER_CAMP, Math.ceil(people / PEOPLE_PER_TENT));
}

/** `n` people put out of the home at `tile`: they join the unhoused, and will camp near it. */
export function leftHome(state: AmbientState, tile: number, n: number): void {
  if (!(n > 0)) return;
  state.unhoused += n;
  const m = (state.campIn ??= new Map());
  m.set(tile, (m.get(tile) ?? 0) + n);
}

/** `n` of the unhoused housed at `tile`: they leave the pool, from the camp nearest that home. Clamped to the pool. */
export function wentHome(state: AmbientState, tile: number, n: number): number {
  return leftCamp(state, tile, n);
}

/** `n` of the unhoused leave the pool at or near `tile` (housed there, or died there), from the camp nearest it. */
export function leftCamp(state: AmbientState, tile: number, n: number): number {
  const take = Math.min(n, state.unhoused);
  if (!(take > 0)) return 0;
  state.unhoused -= take;
  const m = (state.campOut ??= new Map());
  m.set(tile, (m.get(tile) ?? 0) + take);
  return take;
}

const xy = (map: GameMap, t: number): [number, number] => [t % map.width, (t - (t % map.width)) / map.width];

/** Open land someone can camp on: dry, unbuilt, no one's lot, not under a flood. */
function campable(map: GameMap, state: AmbientState, t: number): boolean {
  return map.built[t] === BuiltKind.None && map.parcel[t] === 0 && map.water[t] === 0 && !state.flooded?.has(t);
}

/** The camp nearest (x, y) — within `reach`, with room if `withRoom` — or -1. Ties to the lower tile index. */
function nearestCamp(map: GameMap, camps: Map<number, number>, x: number, y: number, reach: number, withRoom: boolean): number {
  let best = -1;
  let bestD = Infinity;
  for (const [t, n] of camps) {
    if (withRoom && n >= CAMP_CAP - EPS) continue;
    const [cx, cy] = xy(map, t);
    const d = Math.abs(cx - x) + Math.abs(cy - y);
    if (d > reach) continue;
    if (d < bestD || (d === bestD && t < best)) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/** The nearest open land to (x, y) that isn't a camp yet, by Manhattan rings, ties to the lower tile index; or -1. */
function newSite(map: GameMap, state: AmbientState, camps: Map<number, number>, x: number, y: number): number {
  for (let d = 0; d <= SITE_SEARCH; d++) {
    let best = -1;
    for (let dy = -d; dy <= d; dy++) {
      const rest = d - Math.abs(dy);
      for (const dx of rest === 0 ? [0] : [-rest, rest]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!map.inBounds(nx, ny)) continue;
        const t = map.idx(nx, ny);
        if (camps.has(t) || !campable(map, state, t)) continue;
        if (best < 0 || t < best) best = t;
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** Camp `n` people who came from `from`: into camps near it with room, then new camps on open land nearby; if the
 *  city has no open land left near them, into the nearest camp whatever its size. */
function place(map: GameMap, state: AmbientState, camps: Map<number, number>, from: number, n: number): void {
  const [x, y] = xy(map, from);
  let left = n;
  while (left > EPS) {
    let c = nearestCamp(map, camps, x, y, CAMP_REACH, true);
    if (c < 0) {
      c = newSite(map, state, camps, x, y);
      if (c >= 0) camps.set(c, 0);
    }
    if (c < 0) c = nearestCamp(map, camps, x, y, Infinity, false);
    if (c < 0) return; // nowhere at all (no open land, no camp): reconciled next pass
    const cur = camps.get(c)!;
    const add = cur < CAMP_CAP ? Math.min(left, CAMP_CAP - cur) : left;
    camps.set(c, cur + add);
    left -= add;
  }
}

/** Take `n` people from the camps nearest (x, y), or (no place named) from the largest camps first. */
function take(map: GameMap, camps: Map<number, number>, n: number, at?: number): void {
  let left = n;
  while (left > EPS && camps.size > 0) {
    let c = -1;
    if (at !== undefined) {
      const [x, y] = xy(map, at);
      c = nearestCamp(map, camps, x, y, Infinity, false);
    } else {
      let most = -1;
      for (const [t, v] of camps) if (v > most + EPS || (Math.abs(v - most) <= EPS && t < c)) [c, most] = [t, v];
    }
    const v = camps.get(c)!;
    const out = Math.min(v, left);
    if (v - out <= EPS) camps.delete(c);
    else camps.set(c, v - out);
    left -= out;
  }
}

/** Bring the camps in line with the pool: move camps that were built over, take the re-housed from the camps
 *  nearest their homes, camp the newly unhoused near the homes they left, then reconcile whatever the pool
 *  gained or lost unattributed. Deterministic: tiles in ascending order. */
export function settleCamps(state: AmbientState, map: GameMap): void {
  const camps = (state.camps ??= new Map());
  // a camp built over (or flooded) moves on
  for (const t of [...camps.keys()].sort((a, b) => a - b)) {
    if (campable(map, state, t)) continue;
    const n = camps.get(t)!;
    camps.delete(t);
    place(map, state, camps, t, n);
  }
  for (const [t, n] of [...(state.campOut ?? new Map())].sort((a, b) => a[0] - b[0])) take(map, camps, n, t);
  for (const [t, n] of [...(state.campIn ?? new Map())].sort((a, b) => a[0] - b[0])) place(map, state, camps, t, n);
  state.campIn?.clear();
  state.campOut?.clear();
  let held = 0;
  for (const v of camps.values()) held += v;
  const gap = Math.max(0, state.unhoused) - held;
  if (gap < -EPS) take(map, camps, -gap);
  else if (gap > EPS) {
    // gained with no home named: camp by the homes with the most room — where people were pushed out
    const empty: [number, number][] = [];
    let room = 0;
    for (const h of state.households ?? []) {
      const t = map.idx(h.x, h.y);
      const r = h.count - (state.occupancy.get(t) ?? h.count);
      if (r > EPS) {
        empty.push([t, r]);
        room += r;
      }
    }
    if (room > 0) for (const [t, r] of empty.sort((a, b) => a[0] - b[0])) place(map, state, camps, t, (gap * r) / room);
    else place(map, state, camps, map.idx(map.width >> 1, map.height >> 1), gap);
  }
}
