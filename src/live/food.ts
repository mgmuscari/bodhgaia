// The food chain's flows (docs/design/interdependence.md §2; Maddy 2026-10-13: "as outlined"). Once an in-game hour:
//   - gardens, vertical farms and urban farms grow food (PRODUCE);
//   - a producer beside a pantry or a food bank feeds it, with ADJACENT_BONUS; else the nearest pantry within
//     PANTRY_FEED (carried over on foot); else the nearest food bank within BANK_REACH; else it feeds only its street;
//   - a food bank shares its stock out to the pantries within BANK_REACH, the emptiest first — each a delivery (the
//     vans the live layer draws);
//   - a stocked pantry feeds the homes within PANTRY_REACH (each resident eats FOOD_PER_RESIDENT); a garden or farm
//     feeds the homes within GROW_REACH directly.
// The homes fed have food access — a part of neighbourhood health (civic/health.ts). Deterministic: parcels in index
// order, ties by tile. Live, renderer-side state (the stocks); the world is only read.

import type { GameMap } from '../engine/map';
import { BuiltKind, type ParcelStore } from '../engine/fabric';
import { ZoneType, zoneTypeOf } from '../engine/zone';
import { pairedWith } from '../engine/pairings';

/** Food grown an hour, by producer kind. */
export const PRODUCE: ReadonlyMap<number, number> = new Map<number, number>([
  [BuiltKind.CommunityGarden, 2],
  [BuiltKind.VerticalFarm, 6],
  [BuiltKind.UrbanFarm, 8],
]);
/** A producer right beside a pantry or bank (Maddy's list: "farm/garden adjacency bonuses for pantries and banks"). */
export const ADJACENT_BONUS = 1.5;
/** Reaches, Chebyshev tiles between footprints. */
export const PANTRY_FEED = 6;
export const BANK_REACH = 20;
export const PANTRY_REACH = 6;
export const GROW_REACH = 4;
/** Stock caps, and what a resident eats an hour from a pantry. */
export const PANTRY_CAP = 40;
export const BANK_CAP = 200;
export const FOOD_PER_RESIDENT = 0.05;
/** Lane pairings (interdependence §9): a compost hub beside a garden or farm lifts its harvest; co-op housing beside a
 *  pantry stretches its reach. */
export const COMPOST_PAIR_BONUS = 1.25;
export const COOP_PAIR_REACH = 2;

export interface FoodState {
  /** Each pantry's and food bank's stock, by anchor tile. */
  stock: Map<number, number>;
}

export interface FoodHour {
  /** Home anchor tiles with food access this hour. */
  access: Set<number>;
  /** A food bank's van run to a pantry (anchor tiles), and what it carried. */
  deliveries: { from: number; to: number; amount: number }[];
}

interface Plot {
  i: number;
  kind: number;
  x: number;
  y: number;
  w: number;
  h: number;
  anchor: number;
}

/** Chebyshev distance between two footprints (0 when they touch or overlap). */
function gap(a: Plot, b: Plot): number {
  const dx = Math.max(0, a.x - (b.x + b.w - 1), b.x - (a.x + a.w - 1));
  const dy = Math.max(0, a.y - (b.y + b.h - 1), b.y - (a.y + a.h - 1));
  return Math.max(dx, dy);
}

/** The nearest of `among` within `reach` of `p` (ties to the lower tile), or undefined. */
function nearest(p: Plot, among: readonly Plot[], reach: number): Plot | undefined {
  let best: Plot | undefined;
  let bestD = Infinity;
  for (const q of among) {
    const d = gap(p, q);
    if (d <= reach && (d < bestD || (d === bestD && best !== undefined && q.anchor < best.anchor))) [best, bestD] = [q, d];
  }
  return best;
}

/** One in-game hour of the food chain. Updates `food.stock`; returns who is fed and the deliveries made. */
export function foodHour(food: FoodState, map: GameMap, parcels: ParcelStore, residentsAt: (anchor: number) => number): FoodHour {
  const producers: Plot[] = [];
  const pantries: Plot[] = [];
  const banks: Plot[] = [];
  const homes: Plot[] = [];
  for (const i of parcels.aliveIndices()) {
    const p = parcels.get(i);
    const plot: Plot = { i, kind: p.kind, x: p.x, y: p.y, w: p.width, h: p.height, anchor: map.idx(p.x, p.y) };
    if (PRODUCE.has(p.kind)) producers.push(plot);
    else if (p.kind === BuiltKind.Pantry) pantries.push(plot);
    else if (p.kind === BuiltKind.FoodBank) banks.push(plot);
    else if (zoneTypeOf(p.kind) === ZoneType.Residential) homes.push(plot);
  }
  const stock = food.stock;
  const standing = new Set([...pantries, ...banks].map((q) => q.anchor));
  for (const t of [...stock.keys()]) if (!standing.has(t)) stock.delete(t); // a pantry or bank gone: its stock too
  const add = (q: Plot, amount: number): void => {
    const cap = q.kind === BuiltKind.Pantry ? PANTRY_CAP : BANK_CAP;
    stock.set(q.anchor, Math.min(cap, (stock.get(q.anchor) ?? 0) + amount));
  };
  // 1. the harvest goes to a neighbour (with the bonus), a pantry on foot, or a bank
  const distributors = [...pantries, ...banks];
  for (const p of producers) {
    const grown = PRODUCE.get(p.kind)! * (pairedWith(map, p, BuiltKind.CompostHub) ? COMPOST_PAIR_BONUS : 1);
    const beside = nearest(p, distributors, 1);
    if (beside) add(beside, grown * ADJACENT_BONUS);
    else {
      const to = nearest(p, pantries, PANTRY_FEED) ?? nearest(p, banks, BANK_REACH);
      if (to) add(to, grown);
    }
  }
  // 2. each bank shares out to the emptiest pantries in reach (vans)
  const deliveries: FoodHour['deliveries'] = [];
  for (const b of banks) {
    const mine = pantries.filter((q) => gap(b, q) <= BANK_REACH).sort((a, c) => (stock.get(a.anchor) ?? 0) - (stock.get(c.anchor) ?? 0) || a.anchor - c.anchor);
    for (const q of mine) {
      const have = stock.get(b.anchor) ?? 0;
      const room = PANTRY_CAP - (stock.get(q.anchor) ?? 0);
      const amount = Math.min(have, room);
      if (amount < 1) continue;
      stock.set(b.anchor, have - amount);
      add(q, amount);
      deliveries.push({ from: b.anchor, to: q.anchor, amount });
    }
  }
  // 3. who is fed: by a stocked pantry (which they eat from), or a garden or farm on their street
  const access = new Set<number>();
  for (const q of pantries) {
    const reach = PANTRY_REACH + (pairedWith(map, q, BuiltKind.CoopHousing) ? COOP_PAIR_REACH : 0);
    const served = homes.filter((h) => gap(q, h) <= reach);
    const need = served.reduce((s, h) => s + residentsAt(h.anchor) * FOOD_PER_RESIDENT, 0);
    const have = stock.get(q.anchor) ?? 0;
    if (have <= 0) continue;
    for (const h of served) access.add(h.anchor);
    stock.set(q.anchor, Math.max(0, have - need));
  }
  for (const p of producers) for (const h of homes) if (gap(p, h) <= GROW_REACH) access.add(h.anchor);
  return { access, deliveries };
}
