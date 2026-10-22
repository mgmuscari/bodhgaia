// The unhoused have days (Maddy 2026-10-08: "unhoused people should go to commercial areas and that lowers commercial
// taxes where they visit"). A share of each camp is out at a time: from the camp to a commercial place nearby (spread
// over the nearest few, like anyone's trip), a while there, and back to the camp. Each visit is recorded where it
// happened (state.unhousedVisits, fading), and the economy thins the commercial tax base there — the cost of leaving
// people on the street lands on the street. Live layer: writes only its own state.

import type { GameMap } from '../engine/map';
import type { Rng } from '../engine/rng';
import type { AmbientState, Ped } from './types';
import { StopCategory } from '../citizens/itinerary';
import { TravelMode } from '../citizens/modes';
import { nearestOfCategory, nearestWalkable, nearestWhere, walkPath } from './pathing';
import { BuiltKind } from '../engine/fabric';
import { liveCaps } from './caps';

/** One in this many of the unhoused is out at a time (as the housed: a third). */
export const UNHOUSED_OUT_DIVISOR = 3;
/** A place's visit record keeps this share each occupancy pass (fading over a few in-game hours). */
export const VISIT_KEEP = 0.97;

/** What a day out is for, and where (Maddy 2026-10-21 "Unhoused as people": fuller days): a meal at a pantry or
 *  food bank, warmth at a library or civic hall, a clinic, a park — or the shops, as before. Weights out of 100;
 *  come evening (EVENING_FROM) warmth counts double. With none of an errand's places in reach, it's the shops. */
type Errand = NonNullable<Ped['errand']>;
const ERRANDS: readonly { errand: Exclude<Errand, 'shop'>; weight: number; kinds: ReadonlySet<number> }[] = [
  { errand: 'meal', weight: 30, kinds: new Set([BuiltKind.Pantry, BuiltKind.FoodBank]) },
  { errand: 'warmth', weight: 20, kinds: new Set([BuiltKind.Library, BuiltKind.Civic]) },
  { errand: 'care', weight: 10, kinds: new Set([BuiltKind.Clinic]) },
  { errand: 'rest', weight: 15, kinds: new Set([BuiltKind.Park, BuiltKind.CommunityGarden, BuiltKind.Parklet]) },
];
const SHOP_WEIGHT = 25;
export const EVENING_FROM = 17;

/** Top up the unhoused out on their day from the camps: a camp picked by how many live there, an errand, and a place
 *  for it near the camp that they can walk to. */
export function spawnUnhoused(state: AmbientState, map: GameMap, rng: Rng, hour?: number): void {
  // their days start from where they sleep: a camp, or a mutual-aid shelter
  const camps = new Map<number, number>([...(state.camps ?? new Map<number, number>()), ...(state.sheltered ?? new Map<number, number>())]);
  if (camps.size === 0) return;
  const target = Math.round(state.unhoused / UNHOUSED_OUT_DIVISOR);
  let out = 0;
  for (const p of state.peds) if (p.shelter !== undefined) out++;
  let total = 0;
  for (const n of camps.values()) total += n;
  if (total <= 0) return;
  const tiles = [...camps.keys()].sort((a, b) => a - b);
  for (let s = 0; s < liveCaps.spawnPerSubstep && out < target; s++) {
    let r = rng.next() * total;
    let camp = tiles[0]!;
    for (const t of tiles) {
      r -= camps.get(t)!;
      if (r < 0) {
        camp = t;
        break;
      }
    }
    // set off from the camp — or from a shelter's door, the open tile nearest it
    const door = state.sheltered?.has(camp) ? nearestWalkable(map, camp % map.width, Math.floor(camp / map.width)) : null;
    const cx = door ? door.x : camp % map.width;
    const cy = door ? door.y : (camp - cx) / map.width;
    // the errand: weighted, warmth doubled come evening; its nearest place, else the shops
    const evening = hour !== undefined && (hour >= EVENING_FROM || hour < 6);
    const weights = ERRANDS.map((e) => e.weight * (evening && e.errand === 'warmth' ? 2 : 1));
    let u = rng.next() * (weights.reduce((a, b) => a + b, 0) + SHOP_WEIGHT);
    let errand: Errand = 'shop';
    for (let k = 0; k < ERRANDS.length; k++) {
      u -= weights[k]!;
      if (u < 0) {
        errand = ERRANDS[k]!.errand;
        break;
      }
    }
    const pick = rng.nextInt(1 << 30);
    const want = ERRANDS.find((e) => e.errand === errand);
    let plot = want ? nearestWhere(map, cx, cy, (k) => want.kinds.has(k), state.landValue, pick) : null;
    if (!plot) {
      errand = 'shop';
      plot = nearestOfCategory(map, cx, cy, StopCategory.Shop, state.landValue, pick);
    }
    if (!plot || !walkPath(map, cx, cy, plot.x, plot.y)) continue; // nowhere they can walk to
    state.peds.push({
      x: cx,
      y: cy,
      dir: 0,
      tx: cx,
      ty: cy,
      shelter: camp,
      errand,
      phase: 'to-building',
      walkTo: { x: plot.x, y: plot.y },
      building: { x: plot.x, y: plot.y },
      mode: TravelMode.Walk,
    });
    out++;
  }
}

/** Someone unhoused spent a while at the place at `tile`: record it. */
export function recordVisit(state: AmbientState, tile: number): void {
  const m = (state.unhousedVisits ??= new Map());
  m.set(tile, (m.get(tile) ?? 0) + 1);
}

/** Visits fade (each occupancy pass). */
export function fadeVisits(state: AmbientState): void {
  const m = state.unhousedVisits;
  if (!m) return;
  for (const [t, v] of m) {
    const next = v * VISIT_KEEP;
    if (next < 0.05) m.delete(t);
    else m.set(t, next);
  }
}
