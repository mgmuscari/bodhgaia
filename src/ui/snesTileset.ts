// The SNES tileset — a code-painted skin channelling the classic city-builder on the Super Famicom (PURE — no DOM, no
// transcendental Math → pure-ui allowlist). Every tile is drawn here, in integer pixel ops, from ONE
// shared limited palette: bright saturated grass with dark tufts, round-crowned forest, deep blue water
// with wave marks, and (later increments) ink-outlined 3/4-view buildings. Deterministic by
// construction — no rng; per-tile variety comes from hash2 over fixed seeds.
//
// paintSnesTileset() returns Map<atlasKey, Pixels>; the tileset loader materializes each buffer into a
// canvas and layers it over the procedural atlas like any other skin. Keys it omits fall back to the
// procedural painter, so the set can grow increment by increment.

import { BASE_TILE } from './camera';
import { blank, disc, fill, hash2, getPx, isOpaque, outline, px, slice, type Pixels, type RGB } from './pixelArt';
import { C } from './snesPalette';
import { BUILDING_PAINTERS, paintBuilding } from './snesBuildings';
import { builtRenderKey, footprintCellKey, edgeKey, BLOB, BLOB_MASKS } from './renderKey';

const T = BASE_TILE;

export { C, SNES_PALETTE } from './snesPalette';

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

// ── Buildings ────────────────────────────────────────────────────────────────────────────────────
// Every kind is painted as a whole image per footprint size (1..MAX_FOOTPRINT tiles a side) and sliced
// into its segmented cell keys, so a multi-tile building is one picture. Variants (#n) are painted per
// whole footprint — the renderer picks them by the parcel anchor, so a footprint never mixes variants.
// The pos/tier keys get the 1×1 image as the fallback for any footprint larger than we paint.

const MAX_FOOTPRINT = 4;

function buildingTiles(out: Map<string, Pixels>): void {
  for (const [kind, [, variants]] of BUILDING_PAINTERS) {
    for (const tier of [0, 1]) {
      for (let v = 0; v < variants; v++) {
        for (let h = 1; h <= MAX_FOOTPRINT; h++) {
          for (let w = 1; w <= MAX_FOOTPRINT; w++) {
            const img = paintBuilding(kind, w * T, h * T, v, tier);
            for (let r = 0; r < h; r++) {
              for (let c = 0; c < w; c++) {
                const k = footprintCellKey(kind, w, h, c, r, tier);
                out.set(v === 0 ? k : `${k}#${v}`, slice(img, c, r, T));
              }
            }
          }
        }
      }
      const one = out.get(footprintCellKey(kind, 1, 1, 0, 0, tier))!;
      for (const pos of ['c', 'e', 'k'] as const) out.set(builtRenderKey(kind, 0, pos, tier), one);
    }
  }
}

// ── Terrain edges ────────────────────────────────────────────────────────────────────────────────
// Transparent overlays keyed by blob mask (renderKey.blobMask) that soften the square terrain steps:
// SHORE on a water cell beside land (sand, a broken foam line, then chop), CANOPY on open land beside
// forest (scalloped crowns hanging in from the forest side, with their shadow on the grass).

/** Distance (px) from (x, y) to the nearest edge in `mask` — sides are straight, corners roundish. */
function edgeDistance(mask: number, x: number, y: number): number {
  const L = T - 1;
  let d = 99;
  if (mask & BLOB.N) d = Math.min(d, y);
  if (mask & BLOB.S) d = Math.min(d, L - y);
  if (mask & BLOB.W) d = Math.min(d, x);
  if (mask & BLOB.E) d = Math.min(d, L - x);
  const corner = (dx: number, dy: number): number => (dx + dy + Math.max(dx, dy)) >> 1;
  if (mask & BLOB.NE) d = Math.min(d, corner(L - x, y));
  if (mask & BLOB.SE) d = Math.min(d, corner(L - x, L - y));
  if (mask & BLOB.SW) d = Math.min(d, corner(x, L - y));
  if (mask & BLOB.NW) d = Math.min(d, corner(x, y));
  // inside corners (land on two adjacent sides) are chamfered at 45° — with the land-side `coast`
  // chamfer on the convex corners, a stair-stepped coastline reads as a diagonal
  const chamfer = (a: number, b: number): number => a + b - (T >> 1) + 1;
  if ((mask & BLOB.N) && (mask & BLOB.W)) d = Math.min(d, chamfer(x, y));
  if ((mask & BLOB.N) && (mask & BLOB.E)) d = Math.min(d, chamfer(L - x, y));
  if ((mask & BLOB.S) && (mask & BLOB.W)) d = Math.min(d, chamfer(x, L - y));
  if ((mask & BLOB.S) && (mask & BLOB.E)) d = Math.min(d, chamfer(L - x, L - y));
  return d;
}

function shore(mask: number): Pixels {
  const p = blank(T, T);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const wobble = hash2(x * 3 + y, x + y * 5, 77) % 3 === 0 ? 1 : 0; // beaches aren't ruler-straight
      const d = edgeDistance(mask, x, y) - wobble;
      if (d <= 0) px(p, x, y, C.dirtHi);
      else if (d === 1) px(p, x, y, hash2(x, y, 78) % 5 === 0 ? C.dirt : C.dirtHi);
      else if (d === 2) {
        if (hash2(x, y, 79) % 4 !== 0) px(p, x, y, C.foam); // surf line, broken
      } else if (d === 4 && hash2(x, y, 80) % 5 === 0) px(p, x, y, C.wave); // chop just offshore
    }
  }
  return p;
}

function canopy(mask: number): Pixels {
  const crowns = blank(T, T);
  const L = T - 1;
  // two crowns per side at different depths (a deep one and a shallow one), so the forest's edge
  // scallops into the clearing instead of drawing a hedge line along it
  const along: ReadonlyArray<readonly [number, number]> = [
    [3, 2],
    [11, 1],
  ];
  const centres: Array<[number, number]> = [];
  if (mask & BLOB.N) for (const [a, o] of along) centres.push([a, -o]);
  if (mask & BLOB.S) for (const [a, o] of along) centres.push([L - a, L + o]);
  if (mask & BLOB.W) for (const [a, o] of along) centres.push([-o, L - a]);
  if (mask & BLOB.E) for (const [a, o] of along) centres.push([L + o, a]);
  if (mask & BLOB.NE) centres.push([L + 2, -2]);
  if (mask & BLOB.SE) centres.push([L + 2, L + 2]);
  if (mask & BLOB.SW) centres.push([-2, L + 2]);
  if (mask & BLOB.NW) centres.push([-2, -2]);
  for (const [cx, cy] of centres) disc(crowns, cx, cy, 4, C.leafDk);
  for (const [cx, cy] of centres) disc(crowns, cx, cy - 1, 3, C.leafLo);
  for (const [cx, cy] of centres) disc(crowns, cx - 1, cy - 2, 2, C.leaf);
  for (const [cx, cy] of centres) px(crowns, cx - 2, cy - 3, C.leafHi);
  // the crowns' shadow falls one pixel down-right onto the open ground
  const p = blank(T, T);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) if (isOpaque(crowns, x - 1, y - 1) && !isOpaque(crowns, x, y)) px(p, x, y, C.grassLo);
  }
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const [r, g, b, a] = getPx(crowns, x, y);
      if (a) px(p, x, y, [r, g, b]);
    }
  }
  return p;
}

/** COAST, on a land cell with water on two adjacent sides: round that convex corner off into a sandy
 *  point (sand only — no water pixels, so it can never mismatch the sea's own shade). */
function coast(mask: number): Pixels | null {
  const L = T - 1;
  const corners: Array<(x: number, y: number) => number> = [];
  if ((mask & BLOB.N) && (mask & BLOB.E)) corners.push((x, y) => L - x + y);
  if ((mask & BLOB.S) && (mask & BLOB.E)) corners.push((x, y) => L - x + (L - y));
  if ((mask & BLOB.S) && (mask & BLOB.W)) corners.push((x, y) => x + (L - y));
  if ((mask & BLOB.N) && (mask & BLOB.W)) corners.push((x, y) => x + y);
  if (corners.length === 0) return null;
  const p = blank(T, T);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const d = Math.min(...corners.map((f) => f(x, y)));
      if (d <= 5) px(p, x, y, hash2(x, y, 82) % 5 === 0 ? C.dirt : C.dirtHi);
      else if (d === 6 && hash2(x, y, 83) % 2 === 0) px(p, x, y, C.dirt); // ragged inland lip
    }
  }
  return p;
}

function edgeTiles(out: Map<string, Pixels>): void {
  for (const m of BLOB_MASKS) {
    if (m === 0) continue;
    out.set(edgeKey('shore', m), shore(m));
    out.set(edgeKey('canopy', m), canopy(m));
    const c = coast(m);
    if (c) out.set(edgeKey('coast', m), c);
  }
}

// ── Status icons ─────────────────────────────────────────────────────────────────────────────────
// 8×8 badges on a transparent ground, drawn as 6×6 glyphs then ink-outlined: the blinking lightning bolt
// of an unpowered zone (straight out of the SNES original), a heart for a thriving home, a raincloud for
// a suffering one. Rows are strings so the glyph is legible in the source: '#' body, '+' highlight.

const ICONS: Record<string, { rows: readonly string[]; body: RGB; hi: RGB }> = {
  unpowered: { rows: ['...++.', '..##..', '.####.', '..##..', '.##...', '.#....'], body: C.gold, hi: C.lineYellow },
  thriving: { rows: ['.##.##', '#+####', '######', '.####.', '..##..', '......'], body: C.signal, hi: C.petal },
  suffering: { rows: ['..++..', '.####.', '######', '######', '.w..w.', '.w..w.'], body: C.slate, hi: C.slateHi },
};

function icon(name: string): Pixels {
  const { rows, body, hi } = ICONS[name]!;
  const p = blank(8, 8);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '#') px(p, x + 1, y + 1, body);
      else if (ch === '+') px(p, x + 1, y + 1, hi);
      else if (ch === 'w') px(p, x + 1, y + 1, C.glass);
    }
  });
  outline(p, C.ink);
  return p;
}

/** Paint the whole SNES skin: atlas key → pixel buffer. */
export function paintSnesTileset(): Map<string, Pixels> {
  const out = new Map<string, Pixels>();
  terrainTiles(out);
  buildingTiles(out);
  edgeTiles(out);
  for (const name of Object.keys(ICONS)) out.set(`@icon/${name}`, icon(name));
  return out;
}
