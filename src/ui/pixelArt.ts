// Pixel-art primitives for code-painted tilesets (PURE — no DOM, no transcendental Math → pure-ui
// allowlist). A painter builds RGBA buffers with these; the tileset loader materializes them into
// canvases. Everything is integer and binary-alpha: pixel art has no anti-aliasing, so neither do we.

export type RGB = readonly [number, number, number];

/** A w×h RGBA8 buffer, row-major (the same layout as ImageData.data). */
export interface Pixels {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;
}

/** A fully transparent w×h buffer. */
export function blank(w: number, h: number): Pixels {
  return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}

/** One opaque pixel (silently clipped outside the buffer). */
export function px(p: Pixels, x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  const i = (y * p.w + x) * 4;
  p.data[i] = c[0];
  p.data[i + 1] = c[1];
  p.data[i + 2] = c[2];
  p.data[i + 3] = 255;
}

/** [r, g, b, a] at (x, y); transparent black outside the buffer. */
export function getPx(p: Pixels, x: number, y: number): [number, number, number, number] {
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return [0, 0, 0, 0];
  const i = (y * p.w + x) * 4;
  return [p.data[i]!, p.data[i + 1]!, p.data[i + 2]!, p.data[i + 3]!];
}

export function isOpaque(p: Pixels, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < p.w && y < p.h && p.data[(y * p.w + x) * 4 + 3]! > 0;
}

/** Clear one pixel back to transparent. */
export function clearPx(p: Pixels, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  p.data.fill(0, (y * p.w + x) * 4, (y * p.w + x) * 4 + 4);
}

export function rect(p: Pixels, x: number, y: number, w: number, h: number, c: RGB): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px(p, xx, yy, c);
}

export function fill(p: Pixels, c: RGB): void {
  rect(p, 0, 0, p.w, p.h, c);
}

/** 1-px rectangle border. */
export function frame(p: Pixels, x: number, y: number, w: number, h: number, c: RGB): void {
  rect(p, x, y, w, 1, c);
  rect(p, x, y + h - 1, w, 1, c);
  rect(p, x, y, 1, h, c);
  rect(p, x + w - 1, y, 1, h, c);
}

export function hline(p: Pixels, x0: number, x1: number, y: number, c: RGB): void {
  for (let x = x0; x <= x1; x++) px(p, x, y, c);
}

export function vline(p: Pixels, x: number, y0: number, y1: number, c: RGB): void {
  for (let y = y0; y <= y1; y++) px(p, x, y, c);
}

/** Filled integer disc: every pixel whose centre offset satisfies dx²+dy² ≤ r² + r (the "round"
 *  pixel-art circle — rounder than ≤ r² at small radii). */
export function disc(p: Pixels, cx: number, cy: number, r: number, c: RGB): void {
  const lim = r * r + r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= lim) px(p, cx + dx, cy + dy, c);
  }
}

/** Ink every transparent pixel that is 4-adjacent to an opaque one (a sprite outline). Reads a
 *  snapshot of the alpha first, so the new outline pixels don't themselves spawn outline. */
export function outline(p: Pixels, c: RGB): void {
  const alpha = new Uint8Array(p.w * p.h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = p.data[i * 4 + 3]! > 0 ? 1 : 0;
  const on = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < p.w && y < p.h && alpha[y * p.w + x] === 1;
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      if (on(x, y)) continue;
      if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) px(p, x, y, c);
    }
  }
}

/** Composite `src` onto `dst` at (dx, dy) with binary alpha: opaque source pixels win. */
export function blit(dst: Pixels, src: Pixels, dx: number, dy: number): void {
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      if (src.data[i + 3]! === 0) continue;
      px(dst, dx + x, dy + y, [src.data[i]!, src.data[i + 1]!, src.data[i + 2]!]);
    }
  }
}

/** A copy of cell (col, row) of a grid of `size`-px cells. */
export function slice(p: Pixels, col: number, row: number, size: number): Pixels {
  const out = blank(size, size);
  for (let y = 0; y < size; y++) {
    const from = ((row * size + y) * p.w + col * size) * 4;
    out.data.set(p.data.subarray(from, from + size * 4), y * size * 4);
  }
  return out;
}

// 4×4 Bayer thresholds (0..15) — ordered dither, the SNES-era way to fake a third colour.
const BAYER4: readonly number[] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Ordered-dither colour `c` over a rect at `density`/16 coverage (0 = none, 16 = solid). Anchored
 *  to buffer coordinates, so adjacent tiles painted with the same density tile seamlessly. */
export function dither(p: Pixels, x: number, y: number, w: number, h: number, c: RGB, density: number): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) if (BAYER4[(yy & 3) * 4 + (xx & 3)]! < density) px(p, xx, yy, c);
  }
}

/** Deterministic non-negative integer hash of (x, y, seed) — direction-neutral, adjacent inputs land
 *  far apart. The painter's only source of "randomness" (no rng, no Math.random). */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul((x | 0) ^ 0x9e3779b1, 0x85ebca6b);
  h = Math.imul(h ^ ((y | 0) + 0x27d4eb2f), 0xc2b2ae35);
  h = Math.imul(h ^ (seed | 0), 0x165667b1);
  h ^= h >>> 15;
  return h >>> 0;
}
