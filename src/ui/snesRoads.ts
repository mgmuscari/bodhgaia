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

function asphaltBase(v: number, dark: boolean): Pixels {
  const p = blank(T, T);
  fill(p, dark ? C.asphaltLo : C.asphalt);
  for (let k = 0; k < 7; k++) px(p, hash2(k, 0, 7000 + v) % T, hash2(k, 1, 7000 + v) % T, dark ? C.asphalt : C.asphaltLo);
  for (let k = 0; k < 2; k++) px(p, hash2(k, 2, 7100 + v) % T, hash2(k, 3, 7100 + v) % T, C.slate);
  return p;
}

/** Paint `c` along each connected arm at the given offsets across the arm (cols for N/S, rows for E/W). */
function armLines(p: Pixels, mask: number, offs: readonly number[], c: RGB, dashed: boolean): void {
  const on = (t: number): boolean => !dashed || t % 6 < 3;
  for (const o of offs) {
    if (mask & N) for (let y = 0; y < 8; y++) if (on(y)) px(p, o, y, c);
    if (mask & S) for (let y = 8; y < T; y++) if (on(y)) px(p, o, y, c);
    if (mask & W) for (let x = 0; x < 8; x++) if (on(x)) px(p, x, o, c);
    if (mask & E) for (let x = 8; x < T; x++) if (on(x)) px(p, x, o, c);
  }
}

export function roadTile(kind: number, mask: number, wide: boolean, v: number): Pixels {
  const p = asphaltBase(v, kind === 3);
  const conns = (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1);
  if (wide || conns >= 3) return p; // slabs and junction boxes carry no centre paint
  if (mask === 0) {
    rect(p, 7, 7, 2, 2, C.line);
    return p;
  }
  switch (kind) {
    case 2: // avenue: double yellow
      armLines(p, mask, [6, 9], C.lineYellow, false);
      break;
    case 3: // 1-wide highway: double yellow + white edge lines
      armLines(p, mask, [6, 9], C.lineYellow, false);
      armLines(p, mask, [1, 14], C.line, false);
      break;
    case 7: // quiet street: a faint chalk dash
      armLines(p, mask, [7], C.paveLo, true);
      break;
    default: // street, ramp: white dashed centre
      armLines(p, mask, [7], C.line, true);
  }
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

function curb(mask: number): Pixels {
  const p = blank(T, T);
  sides(mask, (set) => {
    for (let a = 0; a < T; a++) {
      set(a, 0, a % 4 === 0 ? C.pave : C.paveHi); // sidewalk slab with expansion joints
      set(a, 1, C.pave);
      set(a, 2, C.asphaltLo); // gutter
    }
  }, p);
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

function freewayLane(axis: 'h' | 'v'): Pixels {
  const p = blank(T, T);
  for (let t = 0; t < T; t++) if (t % 8 < 4) (axis === 'h' ? px(p, t, 8, C.lineYellow) : px(p, 8, t, C.lineYellow));
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

function median(axis: 'h' | 'v'): Pixels {
  const p = blank(T, T);
  for (let t = 0; t < T; t++) {
    const put = (d: number, c: RGB): void => (axis === 'h' ? px(p, t, d, c) : px(p, d, t, c));
    put(7, C.paveHi);
    put(8, C.paveHi);
    put(9, C.ink);
  }
  return p;
}

// Poles stand ON THE SIDEWALK — the north curb of an E-W run, the west curb of an N-S run — seen from
// above: a crossarm across the sidewalk strip with the mast-top at its middle and insulators at its
// tips, never reaching into the carriageway. The wire leaves the crossarm and runs along the sidewalk
// to the next pole four tiles on, sagging two pixels mid-span; wire tiles are indexed by span position.
const WIRE_H = [1, 2, 3, 2];
const WIRE_V = [1, 2, 3, 2];

function pole(axis: 'h' | 'v'): Pixels {
  const p = blank(T, T);
  const put = (a: number, d: number, c: RGB): void => (axis === 'h' ? px(p, a, d, c) : px(p, d, a, c));
  for (let a = 6; a <= 10; a++) put(a, 1, C.roofBrown); // crossarm, along the curb
  put(8, 1, C.roofBrownLo); // mast top
  put(8, 2, C.roofBrownLo);
  put(6, 0, C.paveHi); // insulators
  put(10, 0, C.paveHi);
  outline(p, C.ink);
  return p;
}

function wire(axis: 'h' | 'v', k: number): Pixels {
  const p = blank(T, T);
  for (let t = 0; t < T; t++) (axis === 'h' ? px(p, t, WIRE_H[k]!, C.slateLo) : px(p, WIRE_V[k]!, t, C.slateLo)); // a light line, not a border
  return p;
}

/** Every SNES road tile + furniture overlay: atlas key → pixels. */
export function snesRoadTiles(out: Map<string, Pixels>, roadKinds: readonly number[], wideKinds: readonly number[]): void {
  for (let v = 0; v < 3; v++) {
    const sfx = v === 0 ? '' : `#${v}`;
    for (let m = 0; m < 16; m++) {
      for (const k of roadKinds) out.set(`road-${k}-${m}${sfx}`, roadTile(k, m, false, v));
      for (const k of wideKinds) out.set(`road-${k}-${m}-w${sfx}`, roadTile(k, m, true, v));
    }
  }
  for (let m = 1; m < 16; m++) {
    out.set(`@road/curb/${m}`, curb(m));
    out.set(`@road/divider/${m}`, divider(m));
    out.set(`@road/xing/${m}`, crossing(m));
  }
  for (const m of [E, S, E | S]) out.set(`@road/flaneEdge/${m}`, freewayLaneEdge(m));
  for (const a of ['h', 'v'] as const) {
    out.set(`@road/flane/${a}`, freewayLane(a));
    out.set(`@road/turn/${a}`, turnLane(a));
    out.set(`@road/median/${a}`, median(a));
    out.set(`@road/pole/${a}`, pole(a));
    for (let k = 0; k < 4; k++) out.set(`@road/wire/${a}${k}`, wire(a, k));
  }
}
