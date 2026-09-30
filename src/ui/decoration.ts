// Pure render-decoration predicates: the DECISION half of the renderer's wide-body
// slab + power-line decoration pass. Each is a deterministic function of (map, x, y)
// alone — DOM-free and transcendental-Math-free, so the renderer shell (renderer.ts)
// holds ZERO branching of its own and these can be headless-tested over GameMap
// fixtures. On the architecture pure-ui allowlist (tests/architecture.test.ts).

import type { GameMap } from '../engine/map';
import { isRoadKind, BuiltKind } from '../engine/fabric';

/** Power poles fall every Nth tile along a street/avenue run. */
export const POLE_SPACING = 4;

/** True iff (x, y) is in-bounds and holds a road kind (street/avenue/highway). */
function roadAt(map: GameMap, x: number, y: number): boolean {
  return map.inBounds(x, y) && isRoadKind(map.getBuilt(x, y));
}

/**
 * True iff the tile at (x, y) is a road (isRoadKind) AND is a member of at least
 * one 2×2 block of all-road tiles. Checks the four 2×2 squares that include (x, y)
 * — the four diagonal sign combos — counting a square only if all four cells are
 * in-bounds road tiles. Orientation-free: true for interior/edge tiles of a 2-row
 * or 3-row corridor, false for a 1-wide road and for a `+` of two 1-wide roads (the
 * diagonal cell is not road). Mixed road kinds count (it is a 2×2 of road tiles
 * regardless of which road kind each cell holds).
 */
export function wideRoadAt(map: GameMap, x: number, y: number): boolean {
  if (!roadAt(map, x, y)) return false;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      if (roadAt(map, x + sx, y) && roadAt(map, x, y + sy) && roadAt(map, x + sx, y + sy)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * True iff a power pole falls on the tile at (x, y): the tile must be a RoadStreet
 * or RoadAvenue (NOT highway, NOT rail/transit, NOT building/empty/water), and the
 * pole spacing must land here. A tile with an E or W road neighbour runs
 * horizontally → pole iff x % POLE_SPACING === 0; else a tile with an N or S road
 * neighbour runs vertically → pole iff y % POLE_SPACING === 0; an isolated road
 * tile carries no pole. Deterministic in (map, x, y) only.
 */
export function powerPoleAt(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  const self = map.getBuilt(x, y);
  if (self !== BuiltKind.RoadStreet && self !== BuiltKind.RoadAvenue) return false;
  if (roadAt(map, x + 1, y) || roadAt(map, x - 1, y)) return x % POLE_SPACING === 0;
  if (roadAt(map, x, y + 1) || roadAt(map, x, y - 1)) return y % POLE_SPACING === 0;
  return false; // isolated road tile
}

/**
 * The wire segments to draw from a pole at (x, y): the subset of {[1,0], [0,1]}
 * (E, S) whose neighbour is a road tile of the same run. The renderer shell just
 * draws a segment toward each returned offset — this is the ONLY wire decision, so
 * the shell holds no branching logic. Empty when {@link powerPoleAt} is false.
 */
export function poleWireDirs(map: GameMap, x: number, y: number): ReadonlyArray<readonly [number, number]> {
  if (!powerPoleAt(map, x, y)) return [];
  const out: Array<readonly [number, number]> = [];
  if (roadAt(map, x + 1, y)) out.push([1, 0]);
  if (roadAt(map, x, y + 1)) out.push([0, 1]);
  return out;
}

// ── Curb-side power poles (skin path) ──────────────────────────────────────────────────────────────
// Poles are PROPS (no wires — Maddy 2026-09-30: wires were clutter) standing on the OUTER curb of a
// street — the north curb of an E-W run, the west curb of an N-S run — mid-block, never mid-road on a
// multi-row avenue, and tucked into the tile corner where they land on a T. Independent of how the
// street grid happens to align with the pole spacing (the old centre-line poles fell exactly on the
// intersections of a period-4 grid).

/** A street or avenue tile (the kinds that carry distribution lines — not highways, not transit). */
function lineRoadAt(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  const k = map.getBuilt(x, y);
  return k === BuiltKind.RoadStreet || k === BuiltKind.RoadAvenue;
}

/** Part of an E-W run (a road neighbour east or west) / an N-S run. */
function hRun(map: GameMap, x: number, y: number): boolean {
  return lineRoadAt(map, x, y) && (roadAt(map, x + 1, y) || roadAt(map, x - 1, y));
}
function vRun(map: GameMap, x: number, y: number): boolean {
  return lineRoadAt(map, x, y) && (roadAt(map, x, y + 1) || roadAt(map, x, y - 1));
}

/** Position 0..POLE_SPACING-1 along a run; 0 is where a pole stands (mid-block on a period-4 grid). */
function spanPos(t: number): number {
  return (((t - 2) % POLE_SPACING) + POLE_SPACING) % POLE_SPACING;
}

/**
 * The pole at (x, y), if any: on the curb of a run at span position 0, where the curb side is open
 * ground (no road beyond it — so never in a crossing's junction box, and on a multi-row avenue only
 * the outer row qualifies). 'h' for an E-W run's
 * north-curb pole, 'v' for an N-S run's west-curb pole.
 */
export function curbPoleAt(map: GameMap, x: number, y: number): 'h' | 'v' | 'nw' | null {
  if (hRun(map, x, y) && !roadAt(map, x, y - 1) && spanPos(x) === 0) {
    // a side street leaving south makes this a T: stand the pole on the corner, clear of the mouth
    return roadAt(map, x, y + 1) && !hRun(map, x, y + 1) ? 'nw' : 'h';
  }
  if (vRun(map, x, y) && !roadAt(map, x - 1, y) && spanPos(y) === 0) {
    return roadAt(map, x + 1, y) && !vRun(map, x + 1, y) ? 'nw' : 'v';
  }
  return null;
}

/**
 * The inner block corners of a street/avenue tile: each diagonal (NE=16, SE=32, SW=64, NW=128) that is
 * NOT road while both orthogonal neighbours flanking it ARE road — where the sidewalks of two meeting
 * streets wrap a block corner that no single curb edge covers.
 */
export function innerCornerMask(map: GameMap, x: number, y: number): number {
  if (!lineRoadAt(map, x, y)) return 0;
  // ramps / quiet streets are road too — a ramp deck across a freeway is not a block corner
  const n = roadish(map, x, y - 1);
  const e = roadish(map, x + 1, y);
  const s = roadish(map, x, y + 1);
  const w = roadish(map, x - 1, y);
  let m = 0;
  if (n && e && !roadish(map, x + 1, y - 1)) m |= 16;
  if (s && e && !roadish(map, x + 1, y + 1)) m |= 32;
  if (s && w && !roadish(map, x - 1, y + 1)) m |= 64;
  if (n && w && !roadish(map, x - 1, y - 1)) m |= 128;
  return m;
}

/** Road-like tiles for the paint-link walk: the classic roads plus quiet streets and ramps. */
function roadish(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  const k = map.getBuilt(x, y);
  return isRoadKind(k) || k === BuiltKind.QuietStreet || k === BuiltKind.RoadRamp;
}

/** A connector kind worldgen uses to join highway runs (plain street, or a ramp tile at a bend). */
function isLinkKind(k: number): boolean {
  return k === BuiltKind.RoadStreet || k === BuiltKind.RoadRamp;
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function roadNeighbours(map: GameMap, x: number, y: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [dx, dy] of DIRS) if (roadish(map, x + dx, y + dy)) out.push([x + dx, y + dy]);
  return out;
}

/** Longest connector chain followed when deciding whether a link tile belongs to a highway. */
const LINK_WALK = 8;

/**
 * The road class a tile should be PAINTED as. Worldgen joins the straight runs of a country highway
 * with connector tiles at every bend — plain streets, or RAMP tiles, sometimes a staircase of two or
 * three. A connector that is not a junction (≤ 2 road neighbours), on a chain of such connectors whose
 * BOTH ends reach highway, is a link in that highway: it wears highway paint (and, with the curved lane
 * geometry, the bend reads as one road). A chain touching a street or a dead end keeps its own paint.
 * Cosmetic only — traffic still treats each tile as the kind it is.
 */
export function roadPaintKind(map: GameMap, x: number, y: number): number {
  const self = map.getBuilt(x, y);
  if (!isLinkKind(self)) return self;
  const start = roadNeighbours(map, x, y);
  if (start.length === 0 || start.length > 2) return self;
  for (const first of start) {
    // walk away from (x, y) along degree-≤2 connectors until something else
    let px = x;
    let py = y;
    let [cx, cy] = first;
    let ok = false;
    for (let step = 0; step < LINK_WALK; step++) {
      const k = map.getBuilt(cx, cy);
      if (k === BuiltKind.RoadHighway) {
        ok = true;
        break;
      }
      if (!isLinkKind(k)) break;
      const next = roadNeighbours(map, cx, cy).filter(([nx, ny]) => nx !== px || ny !== py);
      if (next.length !== 1) break; // a junction or a dead end
      [px, py] = [cx, cy];
      [cx, cy] = next[0]!;
    }
    if (!ok) return self;
  }
  return start.length === 2 ? BuiltKind.RoadHighway : self; // a dead-end connector keeps its own paint
}

/**
 * Zebra crossings for a LOCAL street tile: the sides (N=1 E=2 S=4 W=8) whose neighbour is a junction box
 * (a street/avenue tile with 3+ road neighbours) — the approaches where people cross. Only 1-wide
 * streets that aren't junctions themselves; highways and wide slabs get none.
 */
export function crosswalkMask(map: GameMap, x: number, y: number): number {
  if (!map.inBounds(x, y) || map.getBuilt(x, y) !== BuiltKind.RoadStreet) return 0;
  if (wideRoadAt(map, x, y) || roadNeighbours(map, x, y).length > 2) return 0;
  const junction = (jx: number, jy: number): boolean => lineRoadAt(map, jx, jy) && roadNeighbours(map, jx, jy).length >= 3;
  let m = 0;
  if (junction(x, y - 1)) m |= 1;
  if (junction(x + 1, y)) m |= 2;
  if (junction(x, y + 1)) m |= 4;
  if (junction(x - 1, y)) m |= 8;
  return m;
}
