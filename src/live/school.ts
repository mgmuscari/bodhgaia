// Schools (Maddy 2026-10-14: "we need to give schools a function"). Each school's learning grows a little each civic
// tick it stands, to LEARN_MAX (state.learning, saved with the city); a neighbourhood within SCHOOL_REACH gets up to
// LEARNING_BOOST more of the jobs round it — the work part of its health, and the city's employment. (Schools also
// raise their neighbourhood's voice — civic/dynamics — and children walk to them, live/schoolRun.)

import type { GameMap } from '../engine/map';
import { BuiltKind } from '../engine/fabric';
import type { AmbientState } from './types';
import { pairedWith } from '../engine/pairings';

/** How far (Chebyshev, from the school's anchor) a school's learning reaches. */
export const SCHOOL_REACH = 12;
/** Learning gained a civic tick, and its ceiling. */
export const LEARN_RATE = 2;
export const LEARN_MAX = 255;
/** At full learning, a neighbourhood gets this much more of the jobs in reach (1 + boost). */
export const LEARNING_BOOST = 0.5;

/** The anchor tile of each school standing (its footprint's first tile). */
function schoolAnchors(map: GameMap): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (let t = 0; t < map.built.length; t++) {
    if (map.built[t] !== BuiltKind.School) continue;
    const pid = map.parcel[t]!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    out.push(t);
  }
  return out;
}

/** A civic tick of learning: each school standing learns LEARN_RATE more; a school gone, its learning with it. */
export function stepLearning(state: AmbientState, map: GameMap): void {
  const anchors = schoolAnchors(map);
  const standing = new Set(anchors);
  for (const t of [...state.learning.keys()]) if (!standing.has(t)) state.learning.delete(t);
  for (const t of anchors) {
    const x = t % map.width;
    // a library beside it: twice the learning (lane pairing, interdependence §9)
    const rate = LEARN_RATE * (pairedWith(map, { x, y: (t - x) / map.width, w: 2, h: 2 }, BuiltKind.Library) ? 2 : 1);
    state.learning.set(t, Math.min(LEARN_MAX, (state.learning.get(t) ?? 0) + rate));
  }
}

/** The best learning of the schools within SCHOOL_REACH of (x, y), 0..LEARN_MAX. */
export function learningNear(state: AmbientState, map: GameMap, x: number, y: number): number {
  let best = 0;
  for (const [t, v] of state.learning) {
    const sx = t % map.width;
    if (Math.max(Math.abs(sx - x), Math.abs((t - sx) / map.width - y)) <= SCHOOL_REACH && v > best) best = v;
  }
  return best;
}

/** How much more of the jobs in reach a place gets for its learning: 1 at none, 1 + LEARNING_BOOST at the most. */
export function learningLift(level: number): number {
  return 1 + (LEARNING_BOOST * Math.min(LEARN_MAX, Math.max(0, level))) / LEARN_MAX;
}
