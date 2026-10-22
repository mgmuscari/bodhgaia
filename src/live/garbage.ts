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
/** The truckloads a new city's landfill already holds — decades of the city's garbage (live/fields/pollution.ts
 *  seedDecay) — and the fill at which its harm has doubled (it keeps harming more past it, to that double). */
export const LANDFILL_HISTORY = 60;
export const LANDFILL_FULL = 300;

/** How much worse a landfill's harm is for its fill: 1 when empty, 2 once full. */
export function landfillHarm(state: AmbientState): number {
  return 1 + Math.min(1, landfillFill(state) / LANDFILL_FULL);
}

/** Substeps a truck stands at the landfill, dumping (~2 s). */
export const DUMP = seconds(2);
/** The share of every load a compost hub and a maker space each keep out of the landfill, and the ceiling. */
export const COMPOST_DIVERT = 0.15;
export const MAKER_DIVERT = 0.1;
export const DIVERT_MAX = 0.8;
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
      // to the landfill with the load (Maddy 2026-10-21), if the city has one it can reach; else straight home
      const fill = nearestLandfill(map, Math.round(k.x), Math.round(k.y));
      const to = fill === null ? null : roadNear(map, fill % map.width, Math.floor(fill / map.width), 3, 3);
      const there = to ? roadPath(map, Math.round(k.x), Math.round(k.y), to.x, to.y, state.traffic) : null;
      if (fill !== null && there && board(k, there, map)) {
        k.job = 'haul';
        k.landfill = fill;
        return true;
      }
      if (fill !== null && to && Math.round(k.x) === to.x && Math.round(k.y) === to.y) {
        dump(state, map, fill); // already at its gate
      }
      return homeward(k);
    }
    if (k.job === 'haul') {
      if (drive(k, map)) {
        k.job = 'dumping';
        k.wait = DUMP;
        k.path = undefined;
      }
      return true;
    }
    if (k.job === 'dumping') {
      if (--k.wait > 0) return true;
      if (k.landfill !== undefined) dump(state, map, k.landfill);
      return homeward(k);
    }
    return !drive(k, map); // home at the depot: gone
  });

  /** Set a truck on its way back to the depot; false if it's there already (or can't get there): gone. */
  function homeward(k: GarbageTruck): boolean {
    const back = roadPath(map, Math.round(k.x), Math.round(k.y), k.home.x, k.home.y, state.traffic);
    if (!back || !board(k, back, map)) return false;
    k.job = 'back';
    return true;
  }
}

/** The landfill nearest (x, y) — its anchor tile (top-left) — or null if the city has none. */
function nearestLandfill(map: GameMap, x: number, y: number): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (let t = 0; t < map.built.length; t++) {
    if (map.built[t] !== BuiltKind.Landfill) continue;
    const tx = t % map.width;
    const ty = (t - tx) / map.width;
    if (tx > 0 && map.built[t - 1] === BuiltKind.Landfill) continue; // the anchor only
    if (ty > 0 && map.built[t - map.width] === BuiltKind.Landfill) continue;
    const d = Math.abs(tx - x) + Math.abs(ty - y);
    if (d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/** The share of a load kept out of the landfill: each compost hub and maker space in the city takes some, to a ceiling. */
export function divertShare(map: GameMap): number {
  const seen = new Set<number>();
  let compost = 0;
  let makers = 0;
  for (let t = 0; t < map.built.length; t++) {
    const k = map.built[t];
    if (k !== BuiltKind.CompostHub && k !== BuiltKind.MakerSpace) continue;
    const id = map.parcel[t]!;
    if (id !== 0 && seen.has(id)) continue;
    seen.add(id);
    if (k === BuiltKind.CompostHub) compost++;
    else makers++;
  }
  return Math.min(DIVERT_MAX, compost * COMPOST_DIVERT + makers * MAKER_DIVERT);
}

/** A load reaches landfill `t`: it fills by what wasn't diverted. */
function dump(state: AmbientState, map: GameMap, t: number): void {
  state.landfill.set(t, (state.landfill.get(t) ?? 0) + (1 - divertShare(map)));
}

/** All the city's landfills' fill, in loads. */
export function landfillFill(state: AmbientState): number {
  let n = 0;
  for (const v of state.landfill.values()) n += v;
  return n;
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
