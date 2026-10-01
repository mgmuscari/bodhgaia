// SNES-skin building PARTS (PURE — pure-ui allowlist): the shared kit every building painter composes —
// ground lots, the ink-outline + drop-shadow composite (`place`), roofs, walls, windows, doors, trees,
// stacks, tanks. A painter draws structures onto a transparent layer with these, then `place`s the layer
// on its lot.

import { blank, blit, disc, fill, hash2, hline, outline, px, rect, vline, type Pixels, type RGB } from './pixelArt';
import { C } from './snesPalette';
import { BASE_TILE } from './camera';

export const T = BASE_TILE;
export type Ramp = readonly [RGB, RGB, RGB]; // hi, mid, lo

export const ROOF_RED: Ramp = [C.roofRedHi, C.roofRed, C.roofRedLo];
export const ROOF_BLUE: Ramp = [C.roofBlueHi, C.roofBlue, C.roofBlueLo];
export const ROOF_BROWN: Ramp = [C.roofBrownHi, C.roofBrown, C.roofBrownLo];
export const ROOF_SLATE: Ramp = [C.slateHi, C.slate, C.slateLo];
export const ROOF_GREEN: Ramp = [C.grassHi, C.grassMid, C.grassLo];
export const HOUSE_ROOFS: readonly Ramp[] = [ROOF_RED, ROOF_BLUE, ROOF_BROWN, ROOF_SLATE, ROOF_RED, ROOF_GREEN];
export const CONCRETE: Ramp = [C.paveHi, C.pave, C.paveLo];

export const key = (c: RGB): number => (c[0] << 16) | (c[1] << 8) | c[2];

// ── Ground ─────────────────────────────────────────────────────────────────────────────────────────

export type Lot = 'grass' | 'lawn' | 'pave' | 'dirt' | 'asphalt' | 'meadow';

export function lot(W: number, H: number, kind: Lot, seed: number): Pixels {
  const p = blank(W, H);
  const base: RGB =
    kind === 'grass' ? C.grass : kind === 'lawn' ? C.grassMid : kind === 'pave' ? C.pave : kind === 'dirt' ? C.dirt : kind === 'meadow' ? C.meadow : C.asphalt;
  fill(p, base);
  const n = (W * H) >> 6;
  for (let k = 0; k < n; k++) {
    const x = hash2(k, 0, seed) % W;
    const y = hash2(k, 1, seed) % H;
    if (kind === 'grass' || kind === 'lawn' || kind === 'meadow') {
      px(p, x, y, C.grassLo);
      px(p, x + 2, y, C.grassLo);
      px(p, x + 1, y + 1, C.grassLo);
    } else if (kind === 'dirt') {
      px(p, x, y, C.dirtLo);
      px(p, x, y - 1, C.dirtHi);
    } else if (kind === 'pave') {
      if (k % 3 === 0) px(p, x, y, C.paveLo);
    }
  }
  return p;
}

// Drop shadows darken whatever ground they fall on by one step of its own ramp.
export const SHADE = new Map<number, RGB>([
  [key(C.grassHi), C.grassMid],
  [key(C.grass), C.grassLo],
  [key(C.grassMid), C.grassLo],
  [key(C.meadow), C.grassMid],
  [key(C.meadowHi), C.meadow],
  [key(C.dirtHi), C.dirt],
  [key(C.dirt), C.dirtLo],
  [key(C.paveHi), C.pave],
  [key(C.pave), C.paveLo],
  [key(C.line), C.paveLo],
  [key(C.asphalt), C.asphaltLo],
]);

/** Composite a structure layer onto the lot: ink outline, a 2-right/1-down drop shadow, then the mass. */
export function place(dst: Pixels, layer: Pixels): void {
  outline(layer, C.ink);
  for (let y = 0; y < layer.h; y++) {
    for (let x = 0; x < layer.w; x++) {
      if (layer.data[(y * layer.w + x) * 4 + 3] === 0) continue;
      for (const [sx, sy] of [[x + 2, y + 1], [x + 1, y + 1]] as const) {
        if (sx >= dst.w || sy >= dst.h) continue;
        const i = (sy * dst.w + sx) * 4;
        const s = SHADE.get((dst.data[i]! << 16) | (dst.data[i + 1]! << 8) | dst.data[i + 2]!);
        if (s) px(dst, sx, sy, s);
      }
    }
  }
  blit(dst, layer, 0, 0);
}

// ── Parts ──────────────────────────────────────────────────────────────────────────────────────────

/** A pitched roof seen from the front-top: lit back slope, mid front slope, dark eave. */
export function gable(L: Pixels, x: number, y: number, w: number, h: number, r: Ramp): void {
  const back = Math.max(1, h >> 1);
  rect(L, x, y, w, back, r[0]);
  rect(L, x, y + back, w, h - back, r[1]);
  hline(L, x, x + w - 1, y + h - 1, r[2]);
}

/** A flat roof: deck, a lit parapet rim, and a rooftop box (HVAC / stair head). */
export function flat(L: Pixels, x: number, y: number, w: number, h: number, r: Ramp, seed: number): void {
  rect(L, x, y, w, h, r[1]);
  hline(L, x, x + w - 1, y, r[0]);
  vline(L, x, y, y + h - 1, r[0]);
  hline(L, x, x + w - 1, y + h - 1, r[2]);
  if (w >= 6 && h >= 4) {
    const bx = x + 2 + (hash2(w, h, seed) % Math.max(1, w - 5));
    rect(L, bx, y + 1, 3, 2, r[2]);
    hline(L, bx, bx + 2, y + 1, r[0]);
  }
}

/** Factory sawtooth: alternating lit/shadow bays with an ink valley between. */
export function sawtooth(L: Pixels, x: number, y: number, w: number, h: number): void {
  for (let i = 0; i < w; i++) {
    const phase = i % 4;
    const c = phase === 3 ? C.ink : phase === 0 ? C.slateHi : C.slate;
    vline(L, x + i, y, y + h - 1, c);
  }
  hline(L, x, x + w - 1, y + h - 1, C.slateLo);
}

/** A front wall with a darker plinth course. */
export function wall(L: Pixels, x: number, y: number, w: number, h: number, c: RGB, lo: RGB): void {
  rect(L, x, y, w, h, c);
  hline(L, x, x + w - 1, y + h - 1, lo);
}

/** A grid of `ww`×`wh` windows stepping (sx, sy) inside a wall region; glint on the top-left pixel. */
export function windows(L: Pixels, x: number, y: number, w: number, h: number, sx: number, sy: number, ww: number, wh: number): void {
  for (let yy = y; yy + wh <= y + h; yy += sy) {
    for (let xx = x; xx + ww <= x + w; xx += sx) {
      rect(L, xx, yy, ww, wh, C.glass);
      px(L, xx, yy, C.glassHi);
      if (wh > 1) hline(L, xx, xx + ww - 1, yy + wh - 1, C.glassLo);
    }
  }
}

export function door(L: Pixels, x: number, y: number, w: number, h: number): void {
  rect(L, x, y, w, h, C.door);
}

export function tree(L: Pixels, cx: number, cy: number, r: number): void {
  disc(L, cx, cy, r, C.leafLo);
  disc(L, cx - 1, cy - 1, Math.max(0, r - 1), C.leaf);
  px(L, cx - 1, cy - 2, C.leafHi);
}

/** A tall round stack seen from above-front: body with bands, dark mouth on top. */
export function stack(L: Pixels, x: number, top: number, bottom: number, w: number): void {
  rect(L, x, top, w, bottom - top + 1, C.pave);
  vline(L, x, top, bottom, C.paveHi);
  for (let y = top + 1; y <= top + 2 && y <= bottom; y++) hline(L, x, x + w - 1, y, C.signal);
  hline(L, x, x + w - 1, top, C.ink);
}

/** A disc tank seen from above: lit rim, shaded body. */
export function tank(L: Pixels, cx: number, cy: number, r: number, body: RGB, rim: RGB): void {
  disc(L, cx, cy, r, rim);
  disc(L, cx + 1, cy + 1, Math.max(0, r - 1), body);
}

export function frame(p: Pixels, x: number, y: number, w: number, h: number, c: RGB): void {
  hline(p, x, x + w - 1, y, c);
  hline(p, x, x + w - 1, y + h - 1, c);
  vline(p, x, y, y + h - 1, c);
  vline(p, x + w - 1, y, y + h - 1, c);
}
