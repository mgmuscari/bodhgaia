// Pure render-decoration predicates: the DECISION half of the renderer's road paint, curb, crossing
// and power-pole decoration pass. Each is a deterministic function of (map, x, y)
// alone — DOM-free and transcendental-Math-free, so the renderer shell (renderer.ts)
// holds ZERO branching of its own and these can be headless-tested over GameMap
// fixtures. On the architecture pure-ui allowlist (tests/architecture.test.ts).

import type { GameMap } from '../engine/map';
import { isRoadKind, BuiltKind, isLimitedAccessBoundary, freewayCrossing } from '../engine/fabric';

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

// ── Curb-side power poles ──────────────────────────────────────────────────────────────────────
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
  if (!map.inBounds(x, y)) return 0;
  const k = map.getBuilt(x, y);
  // people cross streets and avenues (of any width), and a freeway where it meets the street grid at grade
  // (a stroad) — never mid-freeway, never on its ramps
  const freeway = k === BuiltKind.RoadHighway;
  if (k !== BuiltKind.RoadStreet && k !== BuiltKind.RoadAvenue && k !== BuiltKind.QuietStreet && !freeway) return 0;
  if (junctionBox(map, x, y) || endCapMask(map, x, y) !== 0) return 0;
  const legacyJunction = (jx: number, jy: number): boolean => lineRoadAt(map, jx, jy) && roadNeighbours(map, jx, jy).length >= 3;
  const oneWide = !wideRoadAt(map, x, y) && roadNeighbours(map, x, y).length <= 2;
  let m = 0;
  for (const [dx, dy, bit] of [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]] as const) {
    const nx = x + dx;
    const ny = y + dy;
    // an approach: the road runs toward the box (narrow across, so this is a lane meeting it, not a band
    // alongside it)
    const approaching = runAcross(map, x, y, dx !== 0) < JUNCTION_RUN;
    const box = freeway ? stroadBox(map, nx, ny) : junctionBox(map, nx, ny) || (oneWide && legacyJunction(nx, ny));
    if (approaching && box) m |= bit;
  }
  return m;
}

/** Traffic runs this many tiles through a tile both ways before it counts as a junction box — longer than
 *  any band is wide (freeways are 3), so a wide road's own width never reads as a crossing. */
const JUNCTION_RUN = 4;

/** Can traffic pass between these two adjacent road tiles? Not across a limited-access barrier — except where
 *  the freeway tile belongs to a ramped at-grade crossing (a 2-row avenue's second row over a freeway stays
 *  freeway beside the ramp row, and is still the crossing: lotus (98, 37)). */
function passable(map: GameMap, ax: number, ay: number, bx: number, by: number): boolean {
  if (!roadish(map, bx, by)) return false;
  if (!isLimitedAccessBoundary(map.getBuilt(ax, ay), map.getBuilt(bx, by))) return true;
  const [fx, fy] = map.getBuilt(ax, ay) === BuiltKind.RoadHighway ? [ax, ay] : [bx, by];
  return freewayCrossing(map, fx, fy);
}

/** Contiguous passable road through (x, y) along one axis, counting at most JUNCTION_RUN − 1 each way. */
function run(map: GameMap, x: number, y: number, horizontal: boolean): number {
  const [dx, dy] = horizontal ? [1, 0] : [0, 1];
  let n = 1;
  for (const s of [1, -1]) {
    let px = x;
    let py = y;
    for (let i = 0; i < JUNCTION_RUN - 1; i++) {
      if (!passable(map, px, py, px + s * dx, py + s * dy)) break;
      px += s * dx;
      py += s * dy;
      n++;
    }
  }
  return n;
}

/** The road's run ACROSS an approach direction (perpendicular to it). */
const runAcross = (map: GameMap, x: number, y: number, approachHorizontal: boolean): number => run(map, x, y, !approachHorizontal);

/**
 * Is (x, y) inside a junction box — where roads cross, of any width? True when traffic runs at least
 * JUNCTION_RUN tiles through it both ways (Maddy 2026-10-01: 2-wide streets/avenues, 3-wide freeways,
 * freeways meeting freeways). Runs stop at limited-access barriers, so a frontage road beside a freeway
 * isn't a crossing. The renderer clears a box of lane paint and draws crosswalks on its approaches.
 */
export function junctionBox(map: GameMap, x: number, y: number): boolean {
  if (!roadish(map, x, y)) return false;
  return run(map, x, y, true) >= JUNCTION_RUN && run(map, x, y, false) >= JUNCTION_RUN;
}

/** A STROAD box: a junction box more than one tile across — where a wide road, a freeway or an avenue is
 *  involved — rather than the single tile where two 1-wide streets meet. */
export function stroadBox(map: GameMap, x: number, y: number): boolean {
  if (!junctionBox(map, x, y)) return false;
  return junctionBox(map, x, y - 1) || junctionBox(map, x + 1, y) || junctionBox(map, x, y + 1) || junctionBox(map, x - 1, y);
}

/** How many passable road tiles lie on each side of (x, y) across its band (west/east, or north/south). */
function bandSides(map: GameMap, x: number, y: number, horizontal: boolean): { before: number; after: number } {
  const [dx, dy] = horizontal ? [1, 0] : [0, 1];
  const count = (s: number): number => {
    let n = 0;
    let px = x;
    let py = y;
    while (n < JUNCTION_RUN - 1 && passable(map, px, py, px + s * dx, py + s * dy)) {
      px += s * dx;
      py += s * dy;
      n++;
    }
    return n;
  };
  return { before: count(-1), after: count(1) };
}

/**
 * Stop bars, on the lanes ENTERING a stroad box (Maddy 2026-10-01: stroad intersection vibes). Only wide
 * approaches (a band ≥ 2 tiles: freeways, avenues, 2-wide streets — a 1-wide street keeps its plain
 * crosswalk), and only the half of the band whose traffic heads into the box under right-hand driving:
 * northbound runs on the east, southbound on the west, eastbound on the south, westbound on the north. A
 * band's centre tile (a freeway spine, the median) carries no lane. Bits N=1 E=2 S=4 W=8: the edge the bar
 * sits at (the box side). Lane arrows go on the same lanes.
 */
export function stopBarMask(map: GameMap, x: number, y: number): number {
  if (!roadish(map, x, y) || map.getBuilt(x, y) === BuiltKind.RoadRamp || junctionBox(map, x, y)) return 0;
  if (endCapMask(map, x, y) !== 0) return 0; // a stub that leads nowhere has no lane into the box
  let m = 0;
  for (const [dx, dy, bit] of [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]] as const) {
    if (!stroadBox(map, x + dx, y + dy)) continue;
    const across = bandSides(map, x, y, dx === 0); // a N/S approach's band runs west–east, and vice versa
    if (across.before + across.after + 1 < 2) continue; // a 1-wide approach
    // entering lanes: N → the east half (more road to the west), S → the west half, E → the south half,
    // W → the north half
    const entering =
      bit === 1 ? across.before > across.after : bit === 4 ? across.before < across.after : bit === 2 ? across.before > across.after : across.before < across.after;
    if (entering) m |= bit;
  }
  return m;
}

/**
 * An END CAP: a wide road's last row past a junction box, leading nowhere (Maddy 2026-10-01: the freeway
 * stub at lotus (96–98, 57)). Returns the dead-end edge's bit (N=1 E=2 S=4 W=8) — the side facing away from
 * the box, where the road just stops — or 0. Only wide bands (≥ 2 across): a 1-wide street running past a
 * junction keeps its ordinary dead-end paint. The renderer draws an end cap as plain asphalt with a barrier
 * and hazard chevrons across the dead end, and nothing points traffic into it.
 */
export function endCapMask(map: GameMap, x: number, y: number): number {
  if (!roadish(map, x, y) || junctionBox(map, x, y)) return 0;
  for (const [dx, dy, deadBit] of [[0, -1, 4], [1, 0, 8], [0, 1, 1], [-1, 0, 2]] as const) {
    // the box on one side (dx, dy), and no road at all on the other
    if (!junctionBox(map, x + dx, y + dy) || roadish(map, x - dx, y - dy)) continue;
    const across = bandSides(map, x, y, dx === 0);
    if (across.before + across.after + 1 >= 2) return deadBit;
  }
  return 0;
}

/**
 * Traffic signals at the outer corners of a stroad box, on the sidewalk corner — the diagonal pair, NW=1 and
 * SE=4 — for each such corner whose two edges face out of the box and whose diagonal is off the road.
 */
export function signalCorners(map: GameMap, x: number, y: number): number {
  if (!stroadBox(map, x, y)) return 0;
  const box = (px: number, py: number): boolean => junctionBox(map, px, py);
  let m = 0;
  // the diagonal pair (NW, SE): a signal on every corner read as clutter at this scale
  for (const [cx, cy, bit] of [[-1, -1, 1], [1, 1, 4]] as const) {
    if (!box(x, y + cy) && !box(x + cx, y) && !roadish(map, x + cx, y + cy)) m |= bit;
  }
  return m;
}

/**
 * Where an encampment's sprites sit inside its 16-px tile, in WHOLE art pixels (so they land on the same
 * pixel grid as the tiles) and never overlapping (Maddy 2026-09-30: all pixel art on one scale). The tile
 * is four 8×8 quadrants, dealt out in a per-tile hashed order: each tent takes a quadrant; junk takes the
 * next free quadrant, two junk pieces sharing one (top and bottom halves) when the tents have the rest.
 * Each sprite is jittered within its cell. Sizes are art pixels; tents must fit 8×8, junk 8×4.
 */
export function encampmentLayout(tileHash: number, sizes: ReadonlyArray<{ w: number; h: number }>): Array<{ x: number; y: number }> {
  const h0 = tileHash >>> 0;
  // a hashed permutation of the four quadrants
  const quads = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = (Math.imul(h0 ^ (i * 0x9e3779b1), 0x85ebca6b) >>> 0) % (i + 1);
    [quads[i], quads[j]] = [quads[j]!, quads[i]!];
  }
  const jitter = (k: number, span: number): number =>
    span <= 0 ? 0 : (Math.imul(h0 ^ Math.imul(k + 1, 0x27d4eb2f), 0x165667b1) >>> 0) % (span + 1);
  const out: Array<{ x: number; y: number }> = [];
  let q = 0;
  let sharedQuad = -1; // a quadrant holding one junk piece in its top half
  sizes.forEach((sz, i) => {
    const isTent = sz.h > 4;
    let quad: number;
    let top = 0;
    let cellH = 8;
    if (isTent || q < 4) {
      quad = quads[Math.min(q, 3)]!;
      q++;
      if (!isTent) {
        sharedQuad = quad;
        cellH = 4; // junk keeps to the top half, leaving the bottom for a second piece
      }
    } else {
      quad = sharedQuad >= 0 ? sharedQuad : quads[3]!;
      top = 4;
      cellH = 4;
    }
    const qx = (quad & 1) * 8;
    const qy = (quad >> 1) * 8;
    out.push({ x: qx + jitter(i * 2, 8 - sz.w), y: qy + top + jitter(i * 2 + 1, cellH - sz.h) });
  });
  return out;
}
