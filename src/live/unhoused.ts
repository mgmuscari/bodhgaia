// The unhoused have days (Maddy 2026-10-08: "unhoused people should go to commercial areas and that lowers commercial
// taxes where they visit"). A share of each camp is out at a time: from the camp to a commercial place nearby (spread
// over the nearest few, like anyone's trip), a while there, and back to the camp. Each visit is recorded where it
// happened (state.unhousedVisits, fading), and the economy thins the commercial tax base there — the cost of leaving
// people on the street lands on the street. Live layer: writes only its own state.

import type { GameMap } from '../engine/map';
import type { Rng } from '../engine/rng';
import type { AmbientState } from './types';
import { StopCategory } from '../citizens/itinerary';
import { TravelMode } from '../citizens/modes';
import { nearestOfCategory, walkPath } from './pathing';
import { liveCaps } from './caps';

/** One in this many of the unhoused is out at a time (as the housed: a third). */
export const UNHOUSED_OUT_DIVISOR = 3;
/** A place's visit record keeps this share each occupancy pass (fading over a few in-game hours). */
export const VISIT_KEEP = 0.97;

/** Top up the unhoused out on their day from the camps: a camp picked by how many live there, a commercial place
 *  near it that they can walk to. */
export function spawnUnhoused(state: AmbientState, map: GameMap, rng: Rng): void {
  const camps = state.camps;
  if (!camps || camps.size === 0) return;
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
    const cx = camp % map.width;
    const cy = (camp - cx) / map.width;
    const plot = nearestOfCategory(map, cx, cy, StopCategory.Shop, state.landValue, rng.nextInt(1 << 30));
    if (!plot || !walkPath(map, cx, cy, plot.x, plot.y)) continue; // nowhere they can walk to
    state.peds.push({
      x: cx,
      y: cy,
      dir: 0,
      tx: cx,
      ty: cy,
      shelter: camp,
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
