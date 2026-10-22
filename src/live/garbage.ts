// Garbage trucks (Maddy 2026-10-21: "trash cluttering the streets. makes me wonder about garbage trucks"): the piles
// left on the street (an eviction's things, live/evictions.ts) stay until they're cleared. A sanitation depot keeps up
// to TRUCKS_PER_DEPOT trucks on the road, each sent to the nearest pile within DEPOT_REACH no other truck has taken:
// out, a moment loading (the pile is gone), back to the depot, gone. A pile beyond every depot's reach stays.
// Live layer: writes only its own state.

import type { GameMap } from '../engine/map';
import type { AmbientState, GarbageTruck } from './types';
import { BuiltKind } from '../engine/fabric';
import { roadPath } from './pathing';
import { board, drive, roadNear } from './trucks';
import { seconds } from './tuning';

/** How far (Manhattan, tiles) a depot's trucks go for a pile. */
export const DEPOT_REACH = 25;
/** Trucks a depot keeps on the road at once. */
export const TRUCKS_PER_DEPOT = 2;
/** Substeps a truck stands at a pile, loading it (~2.5 s). */
export const LOAD = seconds(2.5);
/** How often (substeps) the depots look for work. */
const DISPATCH_EVERY = seconds(1);

/** The depots' anchor tiles (each 2×2 depot once: its top-left tile). */
function depots(map: GameMap): number[] {
  const out: number[] = [];
  for (let t = 0; t < map.built.length; t++) {
    if (map.built[t] !== BuiltKind.SanitationDepot) continue;
    const x = t % map.width;
    const y = (t - x) / map.width;
    const leftIsDepot = x > 0 && map.built[t - 1] === BuiltKind.SanitationDepot && map.parcel[t - 1] === map.parcel[t];
    const upIsDepot = y > 0 && map.built[t - map.width] === BuiltKind.SanitationDepot && map.parcel[t - map.width] === map.parcel[t];
    if (!leftIsDepot && !upIsDepot) out.push(t);
  }
  return out;
}

/** Send trucks out, drive them, clear the piles they reach. Once a substep. */
export function stepGarbage(state: AmbientState, map: GameMap): void {
  if (!state.evictedPiles?.length && !state.garbageTrucks?.length) return; // nothing on the street, nobody out
  state.garbageTick = (state.garbageTick ?? 0) + 1;
  if (state.garbageTick % DISPATCH_EVERY === 0 && state.evictedPiles?.length) dispatch(state, map);
  const trucks = state.garbageTrucks;
  if (!trucks?.length) return;
  state.garbageTrucks = trucks.filter((k) => {
    if (k.job === 'out') {
      if (drive(k, map)) {
        k.job = 'loading';
        k.wait = LOAD;
        k.path = undefined;
      }
      return true;
    }
    if (k.job === 'loading') {
      if (--k.wait > 0) return true;
      state.evictedPiles = (state.evictedPiles ?? []).filter((p) => p.x !== k.pile.x || p.y !== k.pile.y); // loaded up
      const back = roadPath(map, Math.round(k.x), Math.round(k.y), k.home.x, k.home.y, state.traffic);
      if (!back || !board(k, back, map)) return false;
      k.job = 'back';
      return true;
    }
    return !drive(k, map); // home at the depot: gone
  });
}

function dispatch(state: AmbientState, map: GameMap): void {
  const trucks = (state.garbageTrucks ??= []);
  const taken = new Set(trucks.map((k) => `${k.pile.x},${k.pile.y}`));
  for (const d of depots(map)) {
    const out = trucks.filter((k) => k.depot === d).length;
    for (let n = out; n < TRUCKS_PER_DEPOT; n++) {
      const dx = d % map.width;
      const dy = (d - dx) / map.width;
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (const p of state.evictedPiles ?? []) {
        if (taken.has(`${p.x},${p.y}`)) continue;
        const dist = Math.abs(p.x - dx) + Math.abs(p.y - dy);
        if (dist > DEPOT_REACH || dist >= bestD) continue;
        best = p;
        bestD = dist;
      }
      if (!best) break;
      const from = roadNear(map, dx, dy, 2, 2);
      const to = roadNear(map, best.x, best.y, 1, 1);
      if (!from || !to) break;
      const path = roadPath(map, from.x, from.y, to.x, to.y, state.traffic);
      const k: GarbageTruck = { x: from.x, y: from.y, dir: 1, tx: from.x, ty: from.y, job: 'out', home: from, wait: 0, depot: d, pile: { x: best.x, y: best.y } };
      taken.add(`${best.x},${best.y}`);
      if (!path || !board(k, path, map)) {
        // at the depot's own door: loaded where it stands
        state.evictedPiles = (state.evictedPiles ?? []).filter((p) => p.x !== best!.x || p.y !== best!.y);
        continue;
      }
      trucks.push(k);
    }
  }
}
