// The SNES tileset — a code-painted skin channelling SimCity on the Super Famicom (PURE — no DOM, no
// transcendental Math → pure-ui allowlist). Every tile is drawn here, in integer pixel ops, from ONE
// shared limited palette: bright saturated grass with dark tufts, round-crowned forest, deep blue water
// with wave marks, and (later increments) ink-outlined 3/4-view buildings. Deterministic by
// construction — no rng; per-tile variety comes from hash2 over fixed seeds.
//
// paintSnesTileset() returns Map<atlasKey, Pixels>; the tileset loader materializes each buffer into a
// canvas and layers it over the procedural atlas like any other skin. Keys it omits fall back to the
// procedural painter, so the set can grow increment by increment.

import { BASE_TILE } from './camera';
import { blank, fill, hash2, px, type Pixels, type RGB } from './pixelArt';

const T = BASE_TILE;

// ── Palette ──────────────────────────────────────────────────────────────────────────────────────
// Channel values sit on the SNES 5-bit grid (multiples of 8) — part of the look, and it keeps the
// palette honest. Every pixel the painter writes must come from here (test-enforced).
export const C = {
  ink: [24, 24, 40],
  // grass
  grassHi: [152, 208, 88],
  grass: [112, 176, 64],
  grassMid: [88, 152, 56],
  grassLo: [64, 120, 48],
  // meadow
  meadowHi: [200, 208, 104],
  meadow: [160, 184, 72],
  flower: [248, 216, 88],
  petal: [248, 248, 232],
  // bare ground
  dirtHi: [216, 184, 128],
  dirt: [184, 152, 104],
  dirtLo: [144, 112, 80],
  // forest canopy
  leafHi: [120, 184, 72],
  leaf: [64, 136, 56],
  leafLo: [40, 104, 48],
  leafDk: [24, 72, 40],
  // water
  waterDeep: [32, 64, 152],
  water: [40, 80, 184],
  waterShallow: [56, 104, 208],
  wave: [104, 152, 232],
  foam: [200, 224, 248],
} as const satisfies Record<string, RGB>;

export const SNES_PALETTE: readonly RGB[] = Object.values(C);

// ── Seamless (wrapping) helpers ──────────────────────────────────────────────────────────────────
// Terrain repeats tile-to-tile, so anything drawn near an edge must continue on the opposite edge.

function pxw(p: Pixels, x: number, y: number, c: RGB): void {
  px(p, ((x % p.w) + p.w) % p.w, ((y % p.h) + p.h) % p.h, c);
}

function discw(p: Pixels, cx: number, cy: number, r: number, c: RGB): void {
  const lim = r * r + r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= lim) pxw(p, cx + dx, cy + dy, c);
  }
}

/** `n` hashed positions inside a tile, stable per (seed). */
function scatter(n: number, seed: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let k = 0; k < n; k++) out.push([hash2(k, 0, seed) % T, hash2(k, 1, seed) % T]);
  return out;
}

// ── Terrain ──────────────────────────────────────────────────────────────────────────────────────
// Elevation bands 0..3 (low → high). Land reads a touch lusher low and sunnier high; water reads
// deeper low. Subtle on purpose: SNES terrain is flat colour, relief is a hint, not a gradient.
// Each kind paints TERRAIN_VARIANTS interchangeable tiles (base + #1..#n-1); the renderer picks one per
// cell by position hash, so a field never shows the 16-px grid. `v` seeds the scatter per variant.

const TERRAIN_VARIANTS = 4;

function grass(band: number, v: number): Pixels {
  const p = blank(T, T);
  fill(p, band === 0 ? C.grassMid : C.grass);
  // dark 'v' tufts with a highlight blade — the SNES grass texture
  for (const [x, y] of scatter(3 + (hash2(v, band, 7) % 3), 1000 + band * 16 + v)) {
    pxw(p, x, y, C.grassLo);
    pxw(p, x + 2, y, C.grassLo);
    pxw(p, x + 1, y + 1, C.grassLo);
    pxw(p, x + 1, y - 1, band >= 2 ? C.grassHi : C.grassMid);
  }
  return p;
}

function meadow(band: number, v: number): Pixels {
  const p = blank(T, T);
  fill(p, C.meadow);
  for (const [x, y] of scatter(5, 2000 + band * 16 + v)) {
    pxw(p, x, y, C.grassMid);
    pxw(p, x + 1, y - 1, C.meadowHi);
  }
  // flowers: a yellow heart with a white petal above — reads as a bloom, not a dash
  for (const [x, y] of scatter(1 + ((band + v) & 1), 2100 + band * 16 + v)) {
    pxw(p, x, y, C.flower);
    pxw(p, x, y - 1, C.petal);
  }
  return p;
}

function bare(band: number, v: number): Pixels {
  const p = blank(T, T);
  fill(p, C.dirt);
  for (const [x, y] of scatter(4 + (v & 1), 3000 + band * 16 + v)) {
    pxw(p, x, y, C.dirtLo);
    pxw(p, x + 1, y, C.dirtLo);
    pxw(p, x, y - 1, C.dirtHi);
  }
  return p;
}

// Forest crowns in one tile, (cx, cy, r), listed top → bottom so lower crowns overlap upper ones
// (the 3/4 depth cue). Positions wrap, so a canopy of forest tiles reads as one continuous mass.
const CROWNS: ReadonlyArray<readonly [number, number, number]> = [
  [12, 1, 4],
  [4, 3, 4],
  [9, 8, 4],
  [1, 11, 4],
  [14, 13, 3],
  [6, 14, 4],
];

function forest(band: number, v: number): Pixels {
  const p = blank(T, T);
  fill(p, C.leafDk);
  for (let k = 0; k < CROWNS.length; k++) {
    const [cx, cy, r] = CROWNS[k]!;
    // each variant nudges every crown by a hashed pixel or two, so no two neighbours share a canopy
    const h = hash2(k, v, 4000 + band);
    const x = cx + (h % 3) - 1;
    const y = cy + ((h >>> 4) % 3) - 1;
    discw(p, x, y + 1, r, C.leafDk); // drop shadow under the crown
    discw(p, x, y, r, C.leafLo);
    discw(p, x - 1, y - 1, r - 1, C.leaf);
    pxw(p, x - 2, y - 2, C.leafHi);
    pxw(p, x - 1, y - 2, C.leafHi);
    pxw(p, x - 2, y - 1, C.leafHi);
  }
  return p;
}

function water(base: RGB, seed: number, sparkle: boolean): Pixels {
  const p = blank(T, T);
  fill(p, base);
  // short wave crests: a 3-px highlight with a 1-px trough under its middle
  for (const [x, y] of scatter(2 + (seed & 1), seed)) {
    pxw(p, x, y, C.wave);
    pxw(p, x + 1, y, C.wave);
    pxw(p, x + 2, y, C.wave);
    pxw(p, x + 1, y + 1, base === C.waterDeep ? C.water : C.waterDeep);
  }
  if (sparkle) {
    const [sx, sy] = scatter(1, seed + 7)[0]!;
    pxw(p, sx, sy, C.foam);
  }
  return p;
}

function terrainTiles(out: Map<string, Pixels>): void {
  for (let b = 0; b < 4; b++) {
    for (let v = 0; v < TERRAIN_VARIANTS; v++) {
      const key = (kind: string): string => (v === 0 ? `${kind}-${b}` : `${kind}-${b}#${v}`);
      out.set(key('grass'), grass(b, v));
      out.set(key('meadow'), meadow(b, v));
      out.set(key('bare'), bare(b, v));
      out.set(key('forest'), forest(b, v));
      out.set(key('ocean'), water(b < 2 ? C.waterDeep : C.water, 5000 + b * 16 + v, b === 3 && v === 1));
      out.set(key('lake'), water(C.water, 5100 + b * 16 + v, v === 2));
      out.set(key('river'), water(C.waterShallow, 5200 + b * 16 + v, v === 1));
    }
  }
}

/** Paint the whole SNES skin: atlas key → pixel buffer. */
export function paintSnesTileset(): Map<string, Pixels> {
  const out = new Map<string, Pixels>();
  terrainTiles(out);
  return out;
}
