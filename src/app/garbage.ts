// App shell: the neighbours and the piles on their street (Maddy 2026-10-21, garbage: "trucks + neighbours"). Once a
// game hour: where Mutual Aid is practised and a neighbourhood belongs, its people clear the piles on its streets, a
// few an hour (the trucks, live/garbage.ts, are the city's way; this is the commons'); and a pile left standing a day
// costs its neighbourhood belonging. The piles live in the live state (live/evictions.ts); belonging in the civic.

import type { GameMap } from '../engine/map';
import type { Rng } from '../engine/rng';
import type { AmbientState } from '../live/types';
import type { CivicState } from '../civic/state';
import type { NeighborhoodMap } from '../civic/neighborhoods';
import { SEED_BELONGING } from '../civic/state';
import { seconds } from '../live/tuning';

/** Belonging (0..1 above the opening level) a neighbourhood needs before its people clear their street. */
export const NEIGHBOUR_BELONGING = 0.3;
/** The chance an hour a pile goes, at that belonging (rising with it). */
export const NEIGHBOUR_CLEAR = 0.1;
/** A pile older than this (substeps — a game day) costs its neighbourhood belonging each hour. */
export const PILE_STALE = seconds(157);
/** Belonging lost an hour per stale pile, and at most this much an hour per neighbourhood. */
export const STALE_BELONGING = 1;
export const STALE_BELONGING_MAX = 3;

export interface GarbageHourDeps {
  live: AmbientState;
  map: GameMap;
  partition: NeighborhoodMap;
  civic: CivicState;
  practised(id: string): boolean;
  rng: Rng;
  news(text: string): void;
}

const above = (v: number): number => (v <= SEED_BELONGING ? 0 : (v - SEED_BELONGING) / (255 - SEED_BELONGING));

/** One game hour of the street's piles: the neighbours clear some; the ones left a day cost belonging. */
export function garbageHour(d: GarbageHourDeps): void {
  const piles = d.live.evictedPiles;
  if (!piles?.length) return;
  const { map, partition, civic } = d;
  // a pile is on the street; its neighbourhood is the home's it came from (a street may be in none)
  const hoodOf = (p: (typeof piles)[number]): number => {
    const at = partition.tileToNeighborhood[map.idx(p.x, p.y)] ?? 0;
    if (at > 0) return at;
    const hx = p.x + (p.hx ?? 0);
    const hy = p.y + (p.hy ?? 0);
    return map.inBounds(hx, hy) ? (partition.tileToNeighborhood[map.idx(hx, hy)] ?? 0) : 0;
  };
  const valid = (h: number): boolean => h > 0 && h <= civic.count();
  let cleared = 0;
  if (d.practised('mutual-aid')) {
    d.live.evictedPiles = piles.filter((p) => {
      const h = hoodOf(p);
      if (!valid(h)) return true;
      const b = above(civic.getValues(h).belonging);
      if (b < NEIGHBOUR_BELONGING || d.rng.next() >= NEIGHBOUR_CLEAR * (0.5 + b)) return true;
      cleared++;
      return false;
    });
  }
  if (cleared > 0) d.news(cleared === 1 ? 'Neighbours cleared a pile from their street' : `Neighbours cleared ${cleared} piles from their streets`);
  // the ones left a day: the street shows it's been left
  const stale = new Map<number, number>();
  for (const p of d.live.evictedPiles ?? []) {
    if (p.age < PILE_STALE) continue;
    const h = hoodOf(p);
    if (valid(h)) stale.set(h, (stale.get(h) ?? 0) + 1);
  }
  for (const [h, n] of stale) {
    const v = civic.getValues(h);
    civic.setValues(h, { ...v, belonging: Math.max(0, v.belonging - Math.min(STALE_BELONGING_MAX, n * STALE_BELONGING)) });
  }
}
