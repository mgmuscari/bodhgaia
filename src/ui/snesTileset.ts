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
import type { PaintedSkin } from './tileset';
import { blank, disc, dither, fill, hash2, getPx, isOpaque, outline, px, slice, type Pixels, type RGB } from './pixelArt';
import { C } from './snesPalette';
import { BUILDING_PAINTERS, emissionOf, paintBuilding } from './snesBuildings';
import { snesRoadTiles } from './snesRoads';
import { paintSnesAgents } from './snesAgents';
import { paintUiIcons } from './uiIcons';
import { builtRenderKey, emissionKey, footprintCellKey, edgeKey, BLOB, BLOB_MASKS } from './renderKey';

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

/** Every building / light-map key the skin can paint — enumerated without painting anything. */
function buildingKeys(): string[] {
  const keys: string[] = [];
  for (const [kind, [, variants]] of BUILDING_PAINTERS) {
    for (const tier of [0, 1]) {
      for (let v = 0; v < variants; v++) {
        const sfx = v === 0 ? '' : `#${v}`;
        for (let h = 1; h <= MAX_FOOTPRINT; h++) {
          for (let w = 1; w <= MAX_FOOTPRINT; w++) {
            keys.push(emissionKey(kind, w, h, tier) + sfx, `${emissionKey(kind, w, h, tier)}/blink${sfx}`);
            for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) keys.push(footprintCellKey(kind, w, h, c, r, tier) + sfx);
          }
        }
      }
      for (const pos of ['c', 'e', 'k'] as const) keys.push(builtRenderKey(kind, 0, pos, tier));
    }
  }
  return keys;
}

const CELL_KEY = /^b-(\d+)-(\d)x(\d)-c(\d)-r(\d)-(\d)(?:#(\d+))?$/;
const POS_KEY = /^b-(\d+)-[cek]-(\d)$/;
const EMIT_KEY = /^@emit\/b-(\d+)-(\d)x(\d)-(\d)(\/blink)?(?:#(\d+))?$/;

/** A lazy painter for building tiles: paints each whole footprint once (cached) and slices on request. */
function buildingPainter(): (key: string) => Pixels | null {
  const footprints = new Map<string, Pixels>();
  const footprint = (kind: number, w: number, h: number, v: number, tier: number): Pixels => {
    const k = `${kind}/${w}x${h}/${v}/${tier}`;
    let img = footprints.get(k);
    if (!img) footprints.set(k, (img = paintBuilding(kind, w * T, h * T, v, tier)));
    return img;
  };
  return (key) => {
    let m = CELL_KEY.exec(key);
    if (m) {
      const [kind, w, h, c, r, tier, v] = m.slice(1).map((n) => Number(n ?? 0)) as number[];
      if (!BUILDING_PAINTERS.has(kind!)) return null;
      return slice(footprint(kind!, w!, h!, v!, tier!), c!, r!, T);
    }
    m = POS_KEY.exec(key);
    if (m) {
      const kind = Number(m[1]);
      return BUILDING_PAINTERS.has(kind) ? slice(footprint(kind, 1, 1, 0, Number(m[2])), 0, 0, T) : null;
    }
    m = EMIT_KEY.exec(key);
    if (m) {
      const kind = Number(m[1]);
      const w = Number(m[2]);
      const h = Number(m[3]);
      const tier = Number(m[4]);
      const v = Number(m[6] ?? 0);
      if (!BUILDING_PAINTERS.has(kind)) return null;
      const { lit, blink } = emissionOf(footprint(kind, w, h, v, tier), kind, kind * 977 + w * 31 + h * 7 + v);
      return (m[5] ? blink : lit) ?? null;
    }
    return null;
  };
}

// ── Transport ────────────────────────────────────────────────────────────────────────────────────
// Roads are full mask tiles with their lane paint (snesRoads.ts), as are rail, streetcar, elevated rail,
// bike paths and promenades. Mask bits: N=1 E=2 S=4 W=8.

function asphalt(v: number): Pixels {
  const p = blank(T, T);
  fill(p, C.asphalt);
  for (const [x, y] of scatter(7, 6000 + v)) pxw(p, x, y, C.asphaltLo);
  for (const [x, y] of scatter(2, 6100 + v)) pxw(p, x, y, C.slate); // aggregate glint
  return p;
}

/** Call `f(x, y)` for every pixel of each arm running from the tile centre toward a connected edge,
 *  `half` px either side of the centre line. A mask of 0 draws just the centre stub. */
function arms(mask: number, half: number, f: (x: number, y: number) => void): void {
  const lo = 8 - half;
  const hi = 7 + half;
  const box = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) f(x, y);
  };
  box(lo, lo, hi, hi);
  if (mask & 1) box(lo, 0, hi, hi);
  if (mask & 4) box(lo, lo, hi, T - 1);
  if (mask & 8) box(0, lo, hi, hi);
  if (mask & 2) box(lo, lo, T - 1, hi);
}

/** Twin rails (+ optional ties) along each connected axis. */
function track(p: Pixels, mask: number, ties: RGB | null, rail: RGB, shadow: RGB): void {
  const vert = (mask & 5) !== 0 || mask === 0;
  const horz = (mask & 10) !== 0;
  if (ties) {
    arms(mask, 5, (x, y) => {
      if ((vert && (y % 3 === 1) && x >= 3 && x <= 12) || (horz && (x % 3 === 1) && y >= 3 && y <= 12)) px(p, x, y, ties);
    });
  }
  arms(mask, 3, (x, y) => {
    const onV = (mask & 5) !== 0 || mask === 0 ? x === 5 || x === 10 : false;
    const onH = (mask & 10) !== 0 ? y === 5 || y === 10 : false;
    if (onV && (y < 8 ? (mask & 1) || y >= 5 : (mask & 4) || y <= 10)) {
      px(p, x, y, rail);
      px(p, x + 1, y, shadow);
    }
    if (onH && (x < 8 ? (mask & 8) || x >= 5 : (mask & 2) || x <= 10)) {
      px(p, x, y, rail);
      px(p, x, y + 1, shadow);
    }
  });
}

function railTile(mask: number): Pixels {
  const p = blank(T, T);
  fill(p, C.grass);
  arms(mask, 6, (x, y) => px(p, x, y, hash2(x, y, 6200) % 4 === 0 ? C.dirtLo : C.dirt)); // ballast bed
  track(p, mask, C.roofBrownLo, C.paveHi, C.slateLo);
  return p;
}

function streetcarTile(mask: number): Pixels {
  const p = asphalt(1);
  track(p, mask, null, C.paveHi, C.asphaltLo);
  return p;
}

function elevTile(mask: number): Pixels {
  const p = blank(T, T);
  fill(p, C.grassLo); // the shadow the viaduct throws on the ground
  arms(mask, 6, (x, y) => px(p, x, y, C.pave)); // deck
  arms(mask, 6, (x, y) => {
    const edge = x === 2 || x === 13 || y === 2 || y === 13;
    if (edge) px(p, x, y, C.paveHi); // parapet
  });
  track(p, mask, null, C.line, C.paveLo);
  return p;
}

function bikeTile(mask: number): Pixels {
  const p = blank(T, T);
  fill(p, C.grass);
  arms(mask, 4, (x, y) => px(p, x, y, C.leafLo)); // painted green lane
  arms(mask, 0, (x, y) => {
    if ((x + y) % 4 < 2) px(p, x, y, C.line); // dashed centre line
  });
  return p;
}

function pedTile(mask: number): Pixels {
  const p = blank(T, T);
  fill(p, C.grass);
  arms(mask, 5, (x, y) => px(p, x, y, (x + y) % 2 === 0 ? C.paveHi : C.pave)); // pavers
  if (mask === 0 || mask === 15) {
    px(p, 3, 3, C.flower); // a planter on a plaza tile
    px(p, 12, 12, C.flower);
  }
  return p;
}

/** A level crossing: the road's asphalt band across the track, with the rails (on the rail tile's own
 *  rows) running through it. `axis` is the ROAD's direction; drawn over the rail tile. */
function crossingBand(axis: 'v' | 'h'): Pixels {
  const p = blank(T, T);
  for (let a = 0; a < T; a++) {
    for (let b = 4; b <= 11; b++) {
      const [x, y] = axis === 'v' ? [b, a] : [a, b];
      px(p, x, y, hash2(x, y, 6400) % 7 === 0 ? C.asphaltLo : C.asphalt);
    }
  }
  for (const r of [5, 10]) {
    for (let b = 4; b <= 11; b++) {
      // the rails cross perpendicular to the road: rail on row r, its shadow on the next
      const [x, y] = axis === 'v' ? [b, r] : [r, b];
      const [sx, sy] = axis === 'v' ? [b, r + 1] : [r + 1, b];
      px(p, x, y, C.paveHi);
      px(p, sx, sy, C.slateLo);
    }
  }
  return p;
}

/** Polluted-water palette swaps, one per level: the water tile's own pixels, recoloured toward murk —
 *  no marks added, so a polluted bay tessellates as calmly as clean water (Maddy 2026-09-30). */
const MURK_SWAPS: ReadonlyArray<ReadonlyMap<string, RGB>> = [
  new Map<string, RGB>([['wave', C.murkHi]]),
  new Map<string, RGB>([['wave', C.murkHi], ['water', C.murk], ['waterShallow', C.murkHi]]),
  new Map<string, RGB>([['wave', C.murkHi], ['water', C.murk], ['waterShallow', C.murk], ['waterDeep', C.murkLo], ['foam', C.murkHi]]),
];

/** Add `{waterKey}~m{1..3}` murk recolours for every painted water tile in `out`. */
function murkTiles(out: Map<string, Pixels>): void {
  const swaps = MURK_SWAPS.map((m) => {
    const byKey = new Map<number, RGB>();
    for (const [name, to] of m) {
      const from = C[name as keyof typeof C];
      byKey.set((from[0] << 16) | (from[1] << 8) | from[2], to);
    }
    return byKey;
  });
  for (const [k, clean] of [...out]) {
    if (!/^(ocean|lake|river)-\d(#\d+)?$/.test(k)) continue;
    swaps.forEach((swap, i) => {
      const m: Pixels = { w: clean.w, h: clean.h, data: new Uint8ClampedArray(clean.data) };
      for (let o = 0; o < m.data.length; o += 4) {
        const to = swap.get((m.data[o]! << 16) | (m.data[o + 1]! << 8) | m.data[o + 2]!);
        if (to) m.data.set(to, o);
      }
      out.set(`${k}~m${i + 1}`, m);
    });
  }
}

/** A clumpy value-noise field over one tile (0..255 per pixel): hashed lattice values every 4 px,
 *  bilinearly blended, wrapping at the tile edge so a patch never ends in a hard tile seam. */
function clumpField(seed: number): number[] {
  const L = 4; // lattice step (px); T / L lattice cells, wrapping
  const n = T / L;
  const lat = (i: number, j: number): number => hash2(((i % n) + n) % n, ((j % n) + n) % n, seed) & 255;
  const field: number[] = [];
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const i = Math.floor(x / L);
      const j = Math.floor(y / L);
      const fx = (x % L) / L;
      const fy = (y % L) / L;
      const top = lat(i, j) * (1 - fx) + lat(i + 1, j) * fx;
      const bot = lat(i, j + 1) * (1 - fx) + lat(i + 1, j + 1) * fx;
      field.push(top * (1 - fy) + bot * fy);
    }
  }
  return field;
}

/** The pixels of a clump field above its `cover` quantile — the patch, sized exactly to that coverage. */
function patch(field: readonly number[], cover: number): boolean[] {
  const cut = [...field].sort((a, b) => b - a)[Math.max(0, Math.round(field.length * cover) - 1)]!;
  return field.map((v) => v >= cut);
}

/** Ground washes — the pixel-art twin of a translucent tile tint: clumped patches (cracked asphalt mats,
 *  algae slicks) in three thicknesses × three variants the renderer picks per tile, so a district-wide
 *  wash reads as patchy ground rather than a uniform screen. Plus the half-tone overpass shadow. */
function washTiles(out: Map<string, Pixels>): void {
  const COVER = [0.18, 0.38, 0.62]; // one entry per level
  // open ground stays mostly green (Maddy 2026-09-30): paved-over mats are scattered, never a carpet
  const PAVED = [0.05, 0.11, 0.2];
  for (let v = 0; v < 3; v++) {
    const af = clumpField(6600 + v);
    COVER.forEach((_cover, i) => {
      // redlined open ground paved over: asphalt mats creeping across the grass, cracked
      const asphalt = blank(T, T);
      patch(af, PAVED[i]!).forEach((on, k) => {
        const x = k % T;
        const y = Math.floor(k / T);
        if (on) px(asphalt, x, y, hash2(x, y, 6700 + v) % 6 === 0 ? C.asphaltLo : C.asphalt);
      });
      out.set(`@wash/asphalt/${i + 1}/${v}`, asphalt);
    });
  }
  const shadow = blank(T, T); // a half-tone drop shadow (the overpass deck's — small, so a dither reads)
  dither(shadow, 0, 0, T, T, C.ink, 8);
  out.set('@wash/shadow', shadow);
}

function transportTiles(out: Map<string, Pixels>): void {
  out.set('@road/xband/v', crossingBand('v'));
  out.set('@road/xband/h', crossingBand('h'));
  // full road tiles (lane paint in the palette) + the per-tile street furniture overlays
  snesRoadTiles(out, [1, 2, 3, 7, 10], [1, 2, 3]);
  for (let m = 0; m < 16; m++) {
    out.set(`rail-${m}`, railTile(m));
    out.set(`streetcar-${m}`, streetcarTile(m));
    out.set(`elev-${m}`, elevTile(m));
    out.set(`bike-${m}`, bikeTile(m));
    out.set(`ped-${m}`, pedTile(m));
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

// ── Encampment sprites + worn ground ─────────────────────────────────────────────────────────────
// Native-resolution pixel art drawn at exactly one art pixel per tile pixel (Maddy 2026-09-30: all pixel
// art on one scale). Tents are homes — dome tents in a few colours with a door, and a tarp lean-to over
// a crate — ink-outlined like the buildings; junk is a few loose pixels. Glyph rows: '#' body, '+' lit,
// '-' shade, 'd' door/dark, plus per-sprite extras. Desire-path WEAR is a dithered beaten-earth overlay
// in three depths instead of a translucent wash.

function glyphSprite(rows: readonly string[], colours: Record<string, RGB>, ink: boolean): Pixels {
  const w = Math.max(...rows.map((r) => r.length));
  const pad = ink ? 1 : 0;
  const p = blank(w + pad * 2, rows.length + pad * 2);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = colours[row[x]!];
      if (c) px(p, x + pad, y + pad, c);
    }
  });
  if (ink) outline(p, C.ink);
  return p;
}

const DOME = ['.++#.', '++###', '+#d##', '-#d--'];
const TENTS: ReadonlyArray<Pixels> = [
  glyphSprite(DOME, { '+': C.roofBlueHi, '#': C.roofBlue, '-': C.roofBlueLo, d: C.ink }, true),
  glyphSprite(DOME, { '+': C.leafHi, '#': C.leaf, '-': C.leafLo, d: C.ink }, true),
  // the tarp lean-to: a blue tarp on two poles over a crate
  glyphSprite(['+++##', '#####', 'p.c.p', 'p.c.p'], { '+': C.roofBlueHi, '#': C.roofBlue, p: C.roofBrownLo, c: C.roofBrownHi }, true),
];

const JUNK: ReadonlyArray<Pixels> = [
  glyphSprite(['ccccc', 'c-c-c', 'ccccc'], { c: C.cream, '-': C.creamLo }, false), // a mattress
  glyphSprite(['b...b', 'bbbbb', 'bbbbb'], { b: C.roofBrown }, false), // an old couch
  glyphSprite(['.s.', 'sds', 'dsd'], { s: C.slate, d: C.slateLo }, false), // bin bags
  glyphSprite(['.p..', 'ppd.', 'dppd'], { p: C.paveLo, d: C.dirtLo }, false), // debris
];

/** Beaten earth at wear depth 1..3: a hashed dither of dirt over the grass, denser as the path deepens. */
function wear(level: number): Pixels {
  const p = blank(T, T);
  const density = [0, 3, 6, 10][level]!; // of 16
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const h = hash2(x, y, 9000 + level) % 16;
      if (h < density) px(p, x, y, h < density / 3 ? C.dirtLo : C.dirt);
    }
  }
  return p;
}

function encampmentTiles(out: Map<string, Pixels>): void {
  TENTS.forEach((t, i) => out.set(`@sprite/tent/${i}`, t));
  JUNK.forEach((t, i) => out.set(`@sprite/junk/${i}`, t));
  for (let level = 1; level <= 3; level++) out.set(`@wear/${level}`, wear(level));
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

/** The SNES skin as the renderer loads it: terrain, roads, edges and icons up front; buildings and
 *  their light maps LAZILY (≈10k tiles a city mostly never draws — materializing them all as canvases
 *  up front exhausted the browser and blanked the view). */
export function paintSnesSkin(): PaintedSkin {
  const eager = new Map<string, Pixels>();
  terrainTiles(eager);
  murkTiles(eager);
  transportTiles(eager);
  edgeTiles(eager);
  encampmentTiles(eager);
  washTiles(eager);
  paintSnesAgents(eager);
  for (const name of Object.keys(ICONS)) eager.set(`@icon/${name}`, icon(name));
  for (const [k, p] of paintUiIcons()) eager.set(k, p); // the tool palette's icons
  return { eager, lazy: { keys: buildingKeys(), paint: buildingPainter() } };
}

/** Paint the WHOLE SNES skin eagerly: atlas key → pixel buffer (tests; the renderer loads paintSnesSkin). */
export function paintSnesTileset(): Map<string, Pixels> {
  const skin = paintSnesSkin();
  const out = new Map(skin.eager);
  for (const k of skin.lazy!.keys) {
    const px = skin.lazy!.paint(k);
    if (px) out.set(k, px);
  }
  return out;
}
