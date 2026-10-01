// SNES-skin roads (PURE — pure-ui allowlist): full road tiles with their lane paint, and the street
// furniture the renderer lays per tile — curbs, freeway barriers, stop lines, freeway lanes, the
// centre turn lane, the median, and the power poles with their wires — all as 16×16 art-grid tiles in
// the shared palette. Keyed `@road/<feature>/<mask|axis>`; a skin that omits a key keeps the renderer's
// procedural drawing for that feature. Mask bits: N=1 E=2 S=4 W=8.

import { blank, fill, hash2, outline, px, rect, type Pixels, type RGB } from './pixelArt';
import { C } from './snesPalette';
import { BASE_TILE } from './camera';

const T = BASE_TILE;
const L = T - 1;
const N = 1;
const E = 2;
const S = 4;
const W = 8;

// ── Road tiles ─────────────────────────────────────────────────────────────────────────────────────

function asphaltBase(v: number): Pixels {
  const p = blank(T, T);
  fill(p, C.asphalt);
  for (let k = 0; k < 7; k++) px(p, hash2(k, 0, 7000 + v) % T, hash2(k, 1, 7000 + v) % T, C.asphaltLo);
  for (let k = 0; k < 2; k++) px(p, hash2(k, 2, 7100 + v) % T, hash2(k, 3, 7100 + v) % T, C.slate);
  return p;
}

// Lane lines are painted from GEOMETRY, not per arm: each pixel's signed lateral offset `s` from the
// road's centre path — a straight line through a straight tile, a quarter-circle of radius 8 round the
// inside corner of a turn, a half-arm on a dead end — and a line is every pixel within half a pixel of
// its offset. So a line leaving one tile at a given offset enters the next at the same offset, and
// curves continuously through a bend. Offsets are symmetric about the centre path (sign-free).

interface Line {
  /** Lateral offset from the centre path (px). */
  d: number;
  /** Half thickness (px). */
  half: number;
  c: RGB;
  dashed: boolean;
}

/** Signed lateral offset + an along-path parameter for pixel (x, y), or null where no lane runs. */
export function pathFrame(mask: number, x: number, y: number): { s: number; t: number } | null {
  const px = x + 0.5;
  const py = y + 0.5;
  if (mask === (N | S)) return { s: px - 8, t: py };
  if (mask === (E | W)) return { s: py - 8, t: px };
  const turn: Record<number, readonly [number, number]> = { [N | E]: [16, 0], [E | S]: [16, 16], [S | W]: [0, 16], [W | N]: [0, 0] };
  const corner = turn[mask];
  if (corner) {
    const ax = Math.abs(px - corner[0]);
    const ay = Math.abs(py - corner[1]);
    const r = Math.sqrt(ax * ax + ay * ay);
    // along-arc parameter without trig: the ay/(ax+ay) ratio runs 0→1 round the quarter-circle (monotone,
    // near-linear in angle) × its arc length 4π ≈ 12.6 px, so a turn carries whole dashes like a straight
    return { s: r - 8, t: (ay / Math.max(1e-6, ax + ay)) * 12.6 };
  }
  // dead ends: the half-arm from the open edge to the centre
  if (mask === N && py <= 9) return { s: px - 8, t: py };
  if (mask === S && py >= 7) return { s: px - 8, t: py };
  if (mask === W && px <= 9) return { s: py - 8, t: px };
  if (mask === E && px >= 7) return { s: py - 8, t: px };
  return null;
}

function paintLines(p: Pixels, mask: number, lines: readonly Line[]): void {
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const f = pathFrame(mask, x, y);
      if (!f) continue;
      for (const l of lines) {
        if (Math.abs(Math.abs(f.s) - l.d) >= l.half) continue;
        // 4 on / 4 off, centred (rows 2–5, 10–13): the period divides the tile so joins stay even, and every
        // tile end has a 2-px gap, so no dash pokes into a junction box
        if (l.dashed && (Math.floor(f.t) + 6) % 8 >= 4) continue;
        px(p, x, y, l.c);
      }
    }
  }
}

const CENTRE_DASH: Line = { d: 0, half: 1, c: C.line, dashed: true };
const DOUBLE_YELLOW: Line = { d: 1.5, half: 0.5, c: C.lineYellow, dashed: false };
const EDGE_WHITE: Line = { d: 6.5, half: 0.5, c: C.line, dashed: false };
const QUIET_DASH: Line = { d: 0, half: 0.5, c: C.paveLo, dashed: true };

const LINES: Record<number, readonly Line[]> = {
  1: [CENTRE_DASH], // street
  2: [DOUBLE_YELLOW], // avenue
  3: [DOUBLE_YELLOW, EDGE_WHITE], // single-lane highway
  7: [QUIET_DASH], // quiet street
  10: [CENTRE_DASH], // ramp
};

/** A multi-row corridor's centre seam: on the row whose partner lane lies to one side, a line along
 *  that side (2 rows ⇒ a double line straddling the seam). Freeway slabs (kind 3) get their lanes from
 *  the @road/flane overlays instead; junction/interior slabs stay clear. */
function paintSeam(p: Pixels, kind: number, mask: number): void {
  if (kind !== 1 && kind !== 2) return;
  const h = (mask & (E | W)) === (E | W) && ((mask & N) !== 0) !== ((mask & S) !== 0);
  const v = (mask & (N | S)) === (N | S) && ((mask & E) !== 0) !== ((mask & W) !== 0);
  // a two-row street IS the avenue form, so both wear the avenue's double yellow: one line either side
  // of the seam, 3 px apart
  for (let t = 0; t < T; t++) {
    if (h) px(p, t, mask & S ? L - 1 : 1, C.lineYellow);
    else if (v) px(p, mask & E ? L - 1 : 1, t, C.lineYellow);
  }
}

export function roadTile(kind: number, mask: number, wide: boolean, v: number): Pixels {
  const p = asphaltBase(v); // one asphalt for every class — the paint tells them apart
  if (wide) {
    paintSeam(p, kind, mask);
    return p;
  }
  const conns = (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1);
  if (conns >= 3) return p; // junction boxes carry no centre paint
  if (mask === 0) {
    rect(p, 7, 7, 2, 2, C.line);
    return p;
  }
  // local streets (street, quiet street, ramp) paint no centre line round a corner — a dashed arc just
  // crumbles into diagonal specks; avenues and highways keep their solid lines through the bend
  const turn = conns === 2 && (mask === (N | E) || mask === (E | S) || mask === (S | W) || mask === (W | N));
  if (turn && kind !== 2 && kind !== 3) return p;
  paintLines(p, mask, LINES[kind] ?? [CENTRE_DASH]);
  return p;
}

// ── Street furniture overlays ──────────────────────────────────────────────────────────────────────

/** Run `f(along, across)` in each masked side's frame: along 0..15 parallel to the edge, across 0 at it. */
function sides(mask: number, f: (set: (along: number, across: number, c: RGB) => void) => void, p: Pixels): void {
  if (mask & N) f((a, d, c) => px(p, a, d, c));
  if (mask & S) f((a, d, c) => px(p, a, L - d, c));
  if (mask & W) f((a, d, c) => px(p, d, a, c));
  if (mask & E) f((a, d, c) => px(p, L - d, a, c));
}

/** Distance-to-corner functions for the four tile corners (0 at the corner pixel). */
const CORNERS: ReadonlyArray<readonly [number, number, (x: number, y: number) => number]> = [
  [N, W, (x, y) => x + y],
  [N, E, (x, y) => L - x + y],
  [S, E, (x, y) => L - x + (L - y)],
  [S, W, (x, y) => x + (L - y)],
];

function curb(mask: number): Pixels {
  const p = blank(T, T);
  // an outer corner (curbs on two adjacent sides) rounds off with a 45° sidewalk bulge first…
  for (const [a, b, dist] of CORNERS) {
    if (!(mask & a) || !(mask & b)) continue;
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const d = dist(x, y);
        if (d <= 5) px(p, x, y, C.paveHi);
        else if (d === 6) px(p, x, y, C.asphaltLo);
      }
    }
  }
  // …then the straight sidewalk strips over it
  sides(mask, (set) => {
    for (let a = 0; a < T; a++) {
      set(a, 0, a % 4 === 0 ? C.pave : C.paveHi); // sidewalk slab with expansion joints
      set(a, 1, C.pave);
      set(a, 2, C.asphaltLo); // gutter
    }
  }, p);
  return p;
}

/** The inner block corner at each masked diagonal (NE=16 SE=32 SW=64 NW=128): the two sidewalks of the
 *  neighbouring road tiles meet here, so the corner gets a small quarter-round of pavement. */
/** Zebra crossing on each masked side — the approach edge into a junction: a 4-px band of bars running
 *  with the traffic, across the carriageway between the sidewalks. */
function zebra(mask: number): Pixels {
  const p = blank(T, T);
  sides(mask, (set) => {
    for (let d = 0; d < 4; d++) {
      for (const a of [7, 9]) set(a, d, C.asphalt); // wipe the centre dash out of the crossing
      for (let a = 4; a <= 12; a += 2) set(a, d, C.paveHi);
    }
  }, p);
  return p;
}

function curbCorner(mask: number): Pixels {
  const p = blank(T, T);
  const at: Array<[number, (x: number, y: number) => number]> = [
    [16, (x, y) => L - x + y],
    [32, (x, y) => L - x + (L - y)],
    [64, (x, y) => x + (L - y)],
    [128, (x, y) => x + y],
  ];
  for (const [bit, dist] of at) {
    if (!(mask & bit)) continue;
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const d = dist(x, y);
        if (d <= 2) px(p, x, y, C.paveHi);
        else if (d === 3) px(p, x, y, C.asphaltLo);
      }
    }
  }
  return p;
}

function divider(mask: number): Pixels {
  const p = blank(T, T);
  sides(mask, (set) => {
    for (let a = 0; a < T; a++) {
      set(a, 0, C.paveHi);
      set(a, 1, C.paveHi);
      set(a, 2, C.ink); // the barrier's shadow on the carriageway
    }
  }, p);
  return p;
}

function crossing(mask: number): Pixels {
  const p = blank(T, T);
  sides(mask, (set) => {
    for (let a = 4; a < 12; a++) set(a, 2, C.line); // the stop line before the tracks
  }, p);
  return p;
}

/** The lane divider down a freeway carriageway tile: white dashes between same-direction lanes (the
 *  yellow belongs to the median edge, US-style). */
function freewayLane(axis: 'h' | 'v'): Pixels {
  const p = blank(T, T);
  for (let t = 0; t < T; t++) if (t % 8 < 4) (axis === 'h' ? px(p, t, 8, C.line) : px(p, 8, t, C.line));
  return p;
}

function freewayLaneEdge(mask: number): Pixels {
  const p = blank(T, T);
  for (let t = 0; t < T; t++) {
    if (t % 8 >= 4) continue;
    if (mask & E) px(p, L, t, C.line);
    if (mask & S) px(p, t, L, C.line);
  }
  return p;
}

function turnLane(axis: 'h' | 'v'): Pixels {
  const p = blank(T, T);
  for (let t = 0; t < T; t++) {
    const put = (d: number, c: RGB): void => (axis === 'h' ? px(p, t, d, c) : px(p, d, t, c));
    put(0, C.lineYellow);
    put(L, C.lineYellow);
    if (t % 6 < 3) {
      put(2, C.lineYellow);
      put(L - 2, C.lineYellow);
    }
  }
  return p;
}

/** The median: a jersey barrier down the spine with a solid yellow edge line on each carriageway side. */
function median(axis: 'h' | 'v'): Pixels {
  const p = blank(T, T);
  for (let t = 0; t < T; t++) {
    const put = (d: number, c: RGB): void => (axis === 'h' ? px(p, t, d, c) : px(p, d, t, c));
    put(4, C.lineYellow);
    put(7, C.paveHi);
    put(8, C.paveHi);
    put(9, C.ink);
    put(11, C.lineYellow);
  }
  return p;
}

// Poles are props standing ON THE SIDEWALK — the north curb of an E-W run, the west curb of an N-S run —
// seen from above: a crossarm across the sidewalk strip with the mast-top at its middle and insulators
// at its tips, never reaching into the carriageway. No wires (too much clutter at 16 px).

/** A pole: 'h'/'v' mid-block on the north/west curb; 'nw' tucked into a junction tile's corner. */
/** A stop bar across the lane, just behind the crosswalk (which takes depth 0–3 from the box edge). */
function stopBar(edge: number): Pixels {
  const p = blank(T, T);
  sides(edge, (set) => {
    for (let a = 0; a < T; a++) {
      set(a, 5, C.line);
      set(a, 6, C.line);
    }
  }, p);
  return p;
}

/** A lane arrow pointing at the box edge (straight ahead into the junction). */
function laneArrow(edge: number): Pixels {
  const p = blank(T, T);
  sides(edge, (set) => {
    const rows: Array<[number, number]> = [[8, 0], [9, 1], [10, 2]]; // the head: depth → half-width
    for (const [d, hw] of rows) for (let a = 7 - hw; a <= 8 + hw; a++) set(a, d, C.line);
    for (let d = 11; d <= 14; d++) for (const a of [7, 8]) set(a, d, C.line); // the shaft
  }, p);
  return p;
}

/** A traffic signal on the corner of a stroad box: a pole on the sidewalk corner, a mast arm reaching over
 *  the lanes, and a three-lamp head (red, amber, green). Corner bits NW=1 NE=2 SE=4 SW=8. */
function signal(corner: number): Pixels {
  const p = blank(T, T);
  const flipX = corner === 2 || corner === 4;
  const flipY = corner === 4 || corner === 8;
  const put = (x: number, y: number, c: RGB): void => px(p, flipX ? L - x : x, flipY ? L - y : y, c);
  put(1, 1, C.slateLo); // the pole
  put(1, 2, C.slateLo);
  for (let x = 2; x <= 8; x++) put(x, 1, C.slate); // the mast arm
  for (let y = 2; y <= 5; y++) for (let x = 8; x <= 9; x++) put(x, y, C.ink); // the head
  put(8, 2, C.signal);
  put(8, 3, C.gold);
  put(8, 4, C.leafHi);
  outline(p, C.ink);
  return p;
}

function pole(spot: 'h' | 'v' | 'nw'): Pixels {
  const p = blank(T, T);
  const put = (a: number, d: number, c: RGB): void => (spot === 'v' ? px(p, d, a, c) : px(p, a, d, c));
  const at = spot === 'nw' ? 2 : 8; // crossarm centre along the curb
  for (let a = at - 2; a <= at + 2; a++) put(a, 1, C.roofBrown); // crossarm, along the curb
  put(at, 1, C.roofBrownLo); // mast top
  put(at, 2, C.roofBrownLo);
  put(at - 2, 0, C.paveHi); // insulators
  put(at + 2, 0, C.paveHi);
  outline(p, C.ink);
  return p;
}

/** Every SNES road tile + furniture overlay: atlas key → pixels. */
export function snesRoadTiles(out: Map<string, Pixels>, roadKinds: readonly number[], wideKinds: readonly number[]): void {
  // every surface variant under its explicit `#v` key (the renderer cycles `road-…#0..#2` when a skin
  // has surface variants), plus the bare key as variant 0 for any lookup without a variant
  for (let v = 0; v < 3; v++) {
    for (let m = 0; m < 16; m++) {
      for (const k of roadKinds) {
        const t = roadTile(k, m, false, v);
        out.set(`road-${k}-${m}#${v}`, t);
        if (v === 0) out.set(`road-${k}-${m}`, t);
      }
      for (const k of wideKinds) {
        const t = roadTile(k, m, true, v);
        out.set(`road-${k}-${m}-w#${v}`, t);
        if (v === 0) out.set(`road-${k}-${m}-w`, t);
      }
    }
  }
  for (let m = 16; m < 256; m += 16) out.set(`@road/curbCorner/${m}`, curbCorner(m));
  out.set('@road/pole/nw', pole('nw'));
  for (let m = 1; m < 16; m++) {
    out.set(`@road/curb/${m}`, curb(m));
    out.set(`@road/zebra/${m}`, zebra(m));
    out.set(`@road/divider/${m}`, divider(m));
    out.set(`@road/xing/${m}`, crossing(m));
  }
  for (const m of [E, S, E | S]) out.set(`@road/flaneEdge/${m}`, freewayLaneEdge(m));
  for (const e of [N, E, S, W]) {
    out.set(`@road/stop/${e}`, stopBar(e));
    out.set(`@road/arrow/${e}`, laneArrow(e));
  }
  for (const c of [1, 2, 4, 8]) out.set(`@road/signal/${c}`, signal(c));
  for (const a of ['h', 'v'] as const) {
    out.set(`@road/flane/${a}`, freewayLane(a));
    out.set(`@road/turn/${a}`, turnLane(a));
    out.set(`@road/median/${a}`, median(a));
    out.set(`@road/pole/${a}`, pole(a));
  }
}
