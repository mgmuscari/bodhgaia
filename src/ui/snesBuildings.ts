// SNES-skin buildings (PURE — pure-ui allowlist). Each building kind paints a WHOLE footprint image
// (16·w × 16·h px) in the Super Famicom city-builder idiom — ground lot, soft drop shadow, then an
// ink-outlined mass seen in 3/4 view (roof on top, front wall below with its windows and door) — and
// snesTileset slices it into per-cell atlas tiles so a multi-tile building reads as ONE picture.
//
// Type is carried by the drawing (gable houses, brick walk-ups, glass offices, sawtooth factories,
// smokestacks…), which is why the skin turns the R1/C2 glyphs off. Condition tier 1 runs every image
// through `derelict`: boarded windows, holed roofs, a lot gone to dirt and weeds.

import { blank, blit, disc, fill, hash2, hline, outline, px, rect, vline, type Pixels, type RGB } from './pixelArt';
import { C } from './snesPalette';
import { BASE_TILE } from './camera';

const T = BASE_TILE;
type Ramp = readonly [RGB, RGB, RGB]; // hi, mid, lo

const ROOF_RED: Ramp = [C.roofRedHi, C.roofRed, C.roofRedLo];
const ROOF_BLUE: Ramp = [C.roofBlueHi, C.roofBlue, C.roofBlueLo];
const ROOF_BROWN: Ramp = [C.roofBrownHi, C.roofBrown, C.roofBrownLo];
const ROOF_SLATE: Ramp = [C.slateHi, C.slate, C.slateLo];
const ROOF_GREEN: Ramp = [C.grassHi, C.grassMid, C.grassLo];
const HOUSE_ROOFS: readonly Ramp[] = [ROOF_RED, ROOF_BLUE, ROOF_BROWN, ROOF_SLATE, ROOF_RED, ROOF_GREEN];
const CONCRETE: Ramp = [C.paveHi, C.pave, C.paveLo];

const key = (c: RGB): number => (c[0] << 16) | (c[1] << 8) | c[2];

// ── Ground ─────────────────────────────────────────────────────────────────────────────────────────

type Lot = 'grass' | 'lawn' | 'pave' | 'dirt' | 'asphalt' | 'meadow';

function lot(W: number, H: number, kind: Lot, seed: number): Pixels {
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
const SHADE = new Map<number, RGB>([
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
function place(dst: Pixels, layer: Pixels): void {
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
function gable(L: Pixels, x: number, y: number, w: number, h: number, r: Ramp): void {
  const back = Math.max(1, h >> 1);
  rect(L, x, y, w, back, r[0]);
  rect(L, x, y + back, w, h - back, r[1]);
  hline(L, x, x + w - 1, y + h - 1, r[2]);
}

/** A flat roof: deck, a lit parapet rim, and a rooftop box (HVAC / stair head). */
function flat(L: Pixels, x: number, y: number, w: number, h: number, r: Ramp, seed: number): void {
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
function sawtooth(L: Pixels, x: number, y: number, w: number, h: number): void {
  for (let i = 0; i < w; i++) {
    const phase = i % 4;
    const c = phase === 3 ? C.ink : phase === 0 ? C.slateHi : C.slate;
    vline(L, x + i, y, y + h - 1, c);
  }
  hline(L, x, x + w - 1, y + h - 1, C.slateLo);
}

/** A front wall with a darker plinth course. */
function wall(L: Pixels, x: number, y: number, w: number, h: number, c: RGB, lo: RGB): void {
  rect(L, x, y, w, h, c);
  hline(L, x, x + w - 1, y + h - 1, lo);
}

/** A grid of `ww`×`wh` windows stepping (sx, sy) inside a wall region; glint on the top-left pixel. */
function windows(L: Pixels, x: number, y: number, w: number, h: number, sx: number, sy: number, ww: number, wh: number): void {
  for (let yy = y; yy + wh <= y + h; yy += sy) {
    for (let xx = x; xx + ww <= x + w; xx += sx) {
      rect(L, xx, yy, ww, wh, C.glass);
      px(L, xx, yy, C.glassHi);
      if (wh > 1) hline(L, xx, xx + ww - 1, yy + wh - 1, C.glassLo);
    }
  }
}

function door(L: Pixels, x: number, y: number, w: number, h: number): void {
  rect(L, x, y, w, h, C.door);
}

function tree(L: Pixels, cx: number, cy: number, r: number): void {
  disc(L, cx, cy, r, C.leafLo);
  disc(L, cx - 1, cy - 1, Math.max(0, r - 1), C.leaf);
  px(L, cx - 1, cy - 2, C.leafHi);
}

/** A tall round stack seen from above-front: body with bands, dark mouth on top. */
function stack(L: Pixels, x: number, top: number, bottom: number, w: number): void {
  rect(L, x, top, w, bottom - top + 1, C.pave);
  vline(L, x, top, bottom, C.paveHi);
  for (let y = top + 1; y <= top + 2 && y <= bottom; y++) hline(L, x, x + w - 1, y, C.signal);
  hline(L, x, x + w - 1, top, C.ink);
}

/** A disc tank seen from above: lit rim, shaded body. */
function tank(L: Pixels, cx: number, cy: number, r: number, body: RGB, rim: RGB): void {
  disc(L, cx, cy, r, rim);
  disc(L, cx + 1, cy + 1, Math.max(0, r - 1), body);
}

// ── Kinds ──────────────────────────────────────────────────────────────────────────────────────────
// Each painter: (W, H, v) → pristine footprint image. W/H are pixel sizes (16·tiles). `v` is the
// variant index; painters derive all choices from it through hash2 so a variant is stable.

type Painter = (W: number, H: number, v: number) => Pixels;

function houseAt(L: Pixels, ox: number, oy: number, hash: number, small = false): void {
  const h = hash >>> 0;
  const roof = HOUSE_ROOFS[h % HOUSE_ROOFS.length]!;
  const walls: ReadonlyArray<readonly [RGB, RGB]> = [
    [C.cream, C.creamLo],
    [C.paveHi, C.pave],
    [C.brick, C.brickLo],
  ];
  const [wc, wl] = walls[(h >>> 3) % walls.length]!;
  const inset = small ? 2 : 0;
  const x = ox + 2 + inset;
  const w = 11 - inset * 2;
  const top = oy + 2 + inset;
  const roofH = small ? 4 : 6;
  const wallH = small ? 3 : 4;
  if ((h >>> 5) & 1) rect(L, x + w - 4, top - 2, 2, 3, C.brickLo); // chimney, behind the roof line
  gable(L, x, top, w, roofH, roof);
  wall(L, x, top + roofH, w, wallH, wc, wl);
  const wy = top + roofH + 1;
  door(L, x + (w >> 1), wy, 2, wallH - 1);
  rect(L, x + 1, wy, 2, 2, C.glass);
  px(L, x + 1, wy, C.glassHi);
  if (!small) {
    rect(L, x + w - 3, wy, 2, 2, C.glass);
    px(L, x + w - 3, wy, C.glassHi);
  }
  if ((h >>> 6) & 1) tree(L, ox + 13, oy + 13, 2);
}

const house: Painter = (W, H, v) => {
  const p = lot(W, H, 'grass', 100 + v);
  const L = blank(W, H);
  for (let cy = 0; cy < H; cy += T) {
    for (let cx = 0; cx < W; cx += T) {
      const h = hash2(cx, cy, 7 + v) ^ v; // neighbours inside one parcel differ; variant stays stable
      houseAt(L, cx, cy, (h & ~7) | ((v + (cx >> 4) * 3 + (cy >> 4) * 5) % HOUSE_ROOFS.length));
      rect(p, cx + 7, cy + 13, 2, 3, C.pave); // front path to the street
    }
  }
  place(p, L);
  return p;
};

const adu: Painter = (W, H, v) => {
  const p = lot(W, H, 'grass', 150 + v);
  const L = blank(W, H);
  for (let cy = 0; cy < H; cy += T) for (let cx = 0; cx < W; cx += T) houseAt(L, cx, cy, hash2(cx, cy, 55) + v, true);
  // a vegetable bed beside the cottage
  for (let cy = 0; cy < H; cy += T) for (let cx = 0; cx < W; cx += T) rect(p, cx + 1, cy + 12, 4, 3, C.dirtLo);
  place(p, L);
  for (let cy = 0; cy < H; cy += T) for (let cx = 0; cx < W; cx += T) hline(p, cx + 1, cx + 4, cy + 13, C.leaf);
  return p;
};

/** A walk-up / block: flat roof over a gridded wall, entrance centred. */
function block(p: Pixels, x: number, y: number, w: number, h: number, roofFrac: number, wc: RGB, wl: RGB, r: Ramp, seed: number, glassWall = false): void {
  const L = blank(p.w, p.h);
  const roofH = Math.max(3, (h * roofFrac) >> 4);
  flat(L, x, y, w, roofH, r, seed);
  const wy = y + roofH;
  const wh = h - roofH;
  if (glassWall) {
    rect(L, x, wy, w, wh, C.glassLo);
    for (let xx = x + 1; xx < x + w; xx += 2) vline(L, xx, wy, wy + wh - 2, C.glass);
    for (let yy = wy + 2; yy < wy + wh - 1; yy += 3) hline(L, x, x + w - 1, yy, C.slateLo);
    px(L, x + 1, wy, C.glassHi);
    hline(L, x, x + w - 1, wy + wh - 1, C.slateLo);
  } else {
    wall(L, x, wy, w, wh, wc, wl);
    windows(L, x + 1, wy + 1, w - 2, wh - 3, 3, 3, 2, 2);
  }
  door(L, x + (w >> 1) - 1, wy + wh - 3, 2, 2);
  place(p, L);
}

const apartments: Painter = (W, H, v) => {
  const p = lot(W, H, 'pave', 170 + v);
  const [wc, wl] = v % 2 === 0 ? [C.brick, C.brickLo] : [C.cream, C.creamLo];
  block(p, 1, 1, W - 4, H - 3, 6, wc, wl, CONCRETE, 17 + v);
  return p;
};

const projects: Painter = (W, H, v) => {
  const p = lot(W, H, 'lawn', 180 + v);
  // towers in the park: grey slabs standing apart on a thin lawn, footpaths between
  hline(p, 0, W - 1, H - 3, C.pave);
  vline(p, W >> 1, 0, H - 1, C.pave);
  const n = W >= 32 ? 2 : 1;
  const sw = Math.max(8, ((W - 4) / n) | 0) - 3;
  for (let i = 0; i < n; i++) block(p, 2 + i * (sw + 4), 1, sw, H - 5, 3, C.pave, C.paveLo, CONCRETE, 18 + v + i);
  return p;
};

const commercial: Painter = (W, H, v) => {
  const p = lot(W, H, 'pave', 190 + v);
  const L = blank(W, H);
  const x = 1;
  const w = W - 3;
  const roofH = Math.max(4, H >> 2);
  const y = Math.max(1, H - 12 - roofH);
  flat(L, x, y, w, roofH, ROOF_SLATE, 19 + v);
  const sign = v % 3 === 0 ? C.gold : v % 3 === 1 ? C.cyan : C.signal;
  hline(L, x, x + w - 1, y + roofH, sign); // the sign band
  const wy = y + roofH + 1;
  // striped awning over the shopfront
  for (let i = 0; i < w; i++) {
    const stripe = ((i >> 1) & 1) === 0 ? (v % 2 === 0 ? C.signal : C.roofBlue) : C.line;
    vline(L, x + i, wy, wy + 1, stripe);
  }
  wall(L, x, wy + 2, w, 5, C.cream, C.creamLo);
  rect(L, x + 1, wy + 3, w - 2, 2, C.glass);
  for (let i = x + 1; i < x + w - 1; i += 5) px(L, i, wy + 3, C.glassHi);
  for (let d = x + 3; d < x + w - 2; d += 9) door(L, d, wy + 3, 2, 3);
  place(p, L);
  // parking stripes in front
  for (let sx = 3; sx < W - 2; sx += 4) vline(p, sx, H - 3, H - 2, C.line);
  return p;
};

const offices: Painter = (W, H, v) => {
  const p = lot(W, H, 'pave', 200 + v);
  block(p, 2, 1, W - 5, H - 3, 5, C.pave, C.paveLo, CONCRETE, 20 + v, true);
  return p;
};

const industrial: Painter = (W, H, v) => {
  const p = lot(W, H, 'dirt', 210 + v);
  const L = blank(W, H);
  const x = 1;
  const w = W - 4;
  const roofH = Math.max(5, (H * 7) >> 4);
  const y = 3;
  sawtooth(L, x, y, w, roofH);
  wall(L, x, y + roofH, w, Math.max(4, H - roofH - 6), C.brick, C.brickLo);
  rect(L, x + 2, y + roofH + 1, 4, Math.max(2, H - roofH - 8), C.slateLo); // loading door
  hline(L, x + 2, x + 5, y + roofH + 1, C.slate);
  windows(L, x + 8, y + roofH + 1, w - 9, 2, 3, 3, 2, 1);
  stack(L, x + w - 3, 0, y + roofH - 1, 2 + (W >> 5));
  place(p, L);
  // drums in the yard
  for (let bx = 2; bx < W - 3; bx += 6) {
    px(p, bx, H - 2, C.roofBlue);
    px(p, bx + 1, H - 2, C.roofBlueLo);
  }
  return p;
};

const parking: Painter = (W, H) => {
  const p = lot(W, H, 'asphalt', 220);
  rect(p, 0, 0, W, 1, C.pave);
  rect(p, 0, 0, 1, H, C.pave);
  rect(p, W - 1, 0, 1, H, C.paveLo);
  rect(p, 0, H - 1, W, 1, C.paveLo);
  for (let y = 2; y < H - 2; y += 8) for (let x = 3; x < W - 1; x += 4) vline(p, x, y, y + 4, C.line);
  // attendant's booth + light posts
  const L = blank(W, H);
  rect(L, W - 5, H - 6, 3, 3, C.paveHi);
  px(L, W - 4, H - 5, C.glass);
  for (let x = 1; x < W - 6; x += 16) px(L, x + 1, 1, C.lineYellow);
  place(p, L);
  return p;
};

const civic: Painter = (W, H, v) => {
  const p = lot(W, H, 'lawn', 230 + v);
  const L = blank(W, H);
  const x = 2;
  const w = W - 5;
  const roofH = Math.max(4, H >> 2);
  const y = 4;
  flat(L, x, y, w, roofH, CONCRETE, 23);
  disc(L, x + (w >> 1), y + 1, Math.max(2, W >> 3), C.cyan); // copper dome
  disc(L, x + (w >> 1) - 1, y, Math.max(1, (W >> 3) - 2), C.glassHi);
  const wy = y + roofH;
  const wh = Math.max(5, H - wy - 5);
  wall(L, x, wy, w, wh, C.paveHi, C.pave);
  for (let cx = x + 1; cx < x + w - 1; cx += 3) vline(L, cx, wy + 1, wy + wh - 2, C.pave); // colonnade
  door(L, x + (w >> 1) - 1, wy + wh - 3, 3, 2);
  place(p, L);
  rect(p, x + (w >> 1) - 1, wy + wh + 1, 3, H - wy - wh - 1, C.paveHi); // front steps + walk
  px(p, 3, 3, C.signal); // flag
  vline(p, 2, 2, 5, C.ink);
  return p;
};

/** A civic service hall: a 2-storey building with a coloured roof and a signature detail. */
function service(p: Pixels, roof: Ramp, wc: RGB, wl: RGB, detail: (L: Pixels, x: number, y: number, w: number, roofH: number, wy: number, wh: number) => void): void {
  const W = p.w;
  const H = p.h;
  const L = blank(W, H);
  const x = 1;
  const w = W - 4;
  const y = 2;
  const roofH = Math.max(4, (H * 5) >> 4);
  gable(L, x, y, w, roofH, roof);
  const wy = y + roofH;
  const wh = Math.max(5, H - wy - 4);
  wall(L, x, wy, w, wh, wc, wl);
  windows(L, x + 1, wy + 1, w - 2, 2, 3, 3, 2, 1);
  detail(L, x, y, w, roofH, wy, wh);
  place(p, L);
}

const precinct: Painter = (W, H, v) => {
  const p = lot(W, H, 'pave', 310 + v);
  service(p, ROOF_BLUE, C.paveHi, C.pave, (L, x, y, w, roofH, wy, wh) => {
    const cx = x + (w >> 1);
    px(L, cx, y + (roofH >> 1) - 1, C.gold); // badge star
    hline(L, cx - 1, cx + 1, y + (roofH >> 1), C.gold);
    px(L, cx, y + (roofH >> 1) + 1, C.gold);
    door(L, cx - 1, wy + wh - 3, 3, 2);
  });
  return p;
};

const fireStation: Painter = (W, H, v) => {
  const p = lot(W, H, 'pave', 320 + v);
  service(p, ROOF_RED, C.brick, C.brickLo, (L, x, _y, w, _r, wy, wh) => {
    for (let gx = x + 2; gx + 4 < x + w; gx += 6) {
      rect(L, gx, wy + wh - 5, 4, 4, C.signal); // engine bay doors
      hline(L, gx, gx + 3, wy + wh - 4, C.roofRedLo);
      hline(L, gx, gx + 3, wy + wh - 2, C.roofRedLo);
    }
  });
  return p;
};

const clinic: Painter = (W, H, v) => {
  const p = lot(W, H, 'pave', 330 + v);
  const L = blank(W, H);
  const roofH = Math.max(5, (H * 6) >> 4);
  flat(L, 1, 2, W - 4, roofH, CONCRETE, 33);
  const cx = 1 + ((W - 4) >> 1);
  const cy = 2 + (roofH >> 1);
  hline(L, cx - 2, cx + 2, cy, C.signal); // red cross on the roof
  vline(L, cx, cy - 2, cy + 2, C.signal);
  const wy = 2 + roofH;
  wall(L, 1, wy, W - 4, Math.max(5, H - wy - 4), C.paveHi, C.pave);
  windows(L, 2, wy + 1, W - 6, H - wy - 7, 3, 3, 2, 1);
  door(L, cx - 1, H - 7, 3, 3);
  place(p, L);
  return p;
};

const library: Painter = (W, H, v) => {
  const p = lot(W, H, 'lawn', 340 + v);
  service(p, ROOF_BROWN, C.cream, C.creamLo, (L, x, _y, w, _r, wy, wh) => {
    for (let cx = x + 1; cx < x + w - 1; cx += 2) vline(L, cx, wy + 3, wy + wh - 2, C.creamLo); // columns
    door(L, x + (w >> 1) - 1, wy + wh - 3, 2, 2);
  });
  return p;
};

const school: Painter = (W, H, v) => {
  const p = lot(W, H, 'grass', 350 + v);
  // the playing field with its lines
  const fx = W >> 1;
  rect(p, fx, H - 7, W - fx - 1, 5, C.grassHi);
  hline(p, fx, W - 2, H - 5, C.line);
  const L = blank(W, H);
  const w = Math.max(8, fx + 2);
  flat(L, 1, 2, w, 4, ROOF_BROWN, 35);
  wall(L, 1, 6, w, Math.max(5, H - 12), C.brick, C.brickLo);
  windows(L, 2, 7, w - 2, Math.max(2, H - 15), 3, 3, 2, 1);
  place(p, L);
  return p;
};

const coalPlant: Painter = (W, H, v) => {
  const p = lot(W, H, 'dirt', 240 + v);
  // coal heap
  disc(p, W - 6, H - 5, Math.max(2, W >> 4), C.ink);
  disc(p, W - 7, H - 6, Math.max(1, (W >> 4) - 1), C.asphaltLo);
  const L = blank(W, H);
  const w = Math.max(8, (W * 9) >> 4);
  const y = Math.max(4, H >> 3);
  flat(L, 1, y, w, Math.max(4, H >> 2), ROOF_SLATE, 24);
  wall(L, 1, y + Math.max(4, H >> 2), w, Math.max(4, H >> 2), C.brickLo, C.ink);
  windows(L, 2, y + Math.max(4, H >> 2) + 1, w - 2, 2, 4, 3, 2, 1);
  for (let i = 0; i < (W >= 32 ? 2 : 1); i++) stack(L, w + 3 + i * 5, 0, y + (H >> 1), 3);
  place(p, L);
  return p;
};

const gasPlant: Painter = (W, H, v) => {
  const p = lot(W, H, 'pave', 250 + v);
  const L = blank(W, H);
  const r = Math.max(2, (Math.min(W, H) >> 3) + 1);
  for (let ty = r + 1; ty + r < H - 2; ty += r * 2 + 3) {
    for (let tx = r + 1; tx + r < W - 1; tx += r * 2 + 3) tank(L, tx, ty, r, C.pave, C.paveHi);
  }
  place(p, L);
  for (let y = 2; y < H - 1; y += 6) hline(p, 0, W - 1, y, C.gold); // pipe runs
  return p;
};

const hydroPlant: Painter = (W, H, v) => {
  const p = lot(W, H, 'pave', 260 + v);
  rect(p, 0, 0, W, H >> 2, C.water); // the reservoir behind the dam
  hline(p, 2, 5, 2, C.wave);
  const L = blank(W, H);
  rect(L, 0, H >> 2, W, 3, C.paveHi); // dam crest
  wall(L, 1, (H >> 2) + 3, W - 3, Math.max(5, H >> 2), C.pave, C.paveLo);
  for (let x = 3; x < W - 4; x += 5) rect(L, x, (H >> 2) + 4, 2, 3, C.waterShallow); // spillway gates
  place(p, L);
  rect(p, 0, H - 4, W, 3, C.waterShallow); // tailrace
  hline(p, 1, W - 2, H - 3, C.foam);
  return p;
};

const nuclearPlant: Painter = (W, H, v) => {
  const p = lot(W, H, 'pave', 270 + v);
  const L = blank(W, H);
  const r = Math.max(3, W >> 3);
  tank(L, r + 2, r + 2, r, C.pave, C.paveHi); // cooling tower, seen from above
  disc(L, r + 2, r + 2, Math.max(1, r - 2), C.paveLo); // its throat
  tank(L, W - r - 3, H - r - 4, Math.max(2, r - 1), C.paveHi, C.line); // reactor dome
  const bx = 2;
  const by = Math.min(H - 8, 2 * r + 6);
  flat(L, bx, by, Math.max(6, W >> 1), 4, CONCRETE, 27);
  wall(L, bx, by + 4, Math.max(6, W >> 1), 3, C.pave, C.paveLo);
  place(p, L);
  px(p, W - r - 3, H - r - 4, C.gold);
  return p;
};

const windTurbine: Painter = (W, H, v) => {
  const p = lot(W, H, 'grass', 280 + v);
  const L = blank(W, H);
  for (let cy = 0; cy < H; cy += T) {
    for (let cx = 0; cx < W; cx += T) {
      const hx = cx + 8;
      const hy = cy + 6;
      vline(L, hx, hy, cy + 13, C.paveHi); // tower
      // three blades (fixed pixel spokes — no trig in pure modules)
      vline(L, hx, cy + 1, hy - 1, C.line);
      for (let k = 1; k <= 4; k++) {
        px(L, hx + k, hy + ((k + 1) >> 1), C.line);
        px(L, hx - k, hy + ((k + 1) >> 1), C.line);
      }
      disc(L, hx, hy, 1, C.pave);
    }
  }
  place(p, L);
  return p;
};

const solarPlant: Painter = (W, H, v) => {
  const p = lot(W, H, 'grass', 290 + v);
  const L = blank(W, H);
  for (let y = 2; y + 4 < H; y += 6) {
    rect(L, 2, y, W - 5, 4, C.roofBlue);
    hline(L, 2, W - 4, y, C.roofBlueHi);
    for (let x = 5; x < W - 3; x += 4) vline(L, x, y + 1, y + 3, C.roofBlueLo);
  }
  place(p, L);
  return p;
};

const fusionPlant: Painter = (W, H, v) => {
  const p = lot(W, H, 'pave', 300 + v);
  const L = blank(W, H);
  const cx = W >> 1;
  const cy = (H >> 1) - 2;
  const r = Math.max(3, (Math.min(W, H) >> 2) + 1);
  disc(L, cx, cy, r, C.paveHi);
  disc(L, cx, cy, r - 1, C.cyan); // the plasma ring
  disc(L, cx, cy, Math.max(1, r - 3), C.paveHi);
  disc(L, cx, cy, Math.max(0, r - 5), C.glassHi);
  flat(L, 2, H - 9, W - 5, 3, CONCRETE, 30);
  wall(L, 2, H - 6, W - 5, 3, C.paveHi, C.pave);
  place(p, L);
  return p;
};

// Greens and the commons — mostly ground art; structures kept small so the green reads.

const parklet: Painter = (W, H, v) => {
  const p = lot(W, H, 'grass', 480 + v);
  rect(p, 0, H - 4, W, 4, C.pave);
  const L = blank(W, H);
  for (let cx = 0; cx < W; cx += T) {
    rect(L, cx + 3, H - 6, 5, 1, C.roofBrown); // bench
    tree(L, cx + 11, 5, 3);
    px(L, cx + 4, 4, C.flower);
    px(L, cx + 6, 6, C.petal);
  }
  place(p, L);
  return p;
};

const garden: Painter = (W, H, v) => {
  const p = lot(W, H, 'dirt', 490 + v);
  for (let y = 2; y < H - 1; y += 3) {
    for (let x = 1; x < W - 1; x++) px(p, x, y, (x + y + v) % 5 === 0 ? C.flower : C.leaf);
    for (let x = 1; x < W - 1; x += 2) px(p, x, y - 1, C.leafHi);
  }
  const L = blank(W, H);
  rect(L, W - 6, 1, 4, 3, C.roofRed); // tool shed
  rect(L, W - 6, 4, 4, 2, C.roofBrownHi);
  place(p, L);
  return p;
};

const compostHub: Painter = (W, H, v) => {
  const p = lot(W, H, 'dirt', 500 + v);
  const L = blank(W, H);
  for (let x = 2; x + 3 < W; x += 5) {
    rect(L, x, 4, 3, 5, C.leafLo); // bins
    hline(L, x, x + 2, 4, C.leafHi);
  }
  place(p, L);
  for (let x = 2; x < W - 2; x += 3) px(p, x, H - 3, C.dirtLo);
  return p;
};

const verticalFarm: Painter = (W, H, v) => {
  const p = lot(W, H, 'pave', 510 + v);
  const L = blank(W, H);
  flat(L, 2, 1, W - 5, 4, ROOF_GREEN, 51);
  rect(L, 2, 5, W - 5, H - 8, C.glassLo);
  for (let y = 6; y < H - 3; y += 2) hline(L, 2, W - 4, y, (y >> 1) % 2 ? C.leaf : C.leafHi); // grow floors
  place(p, L);
  return p;
};

const wastewater: Painter = (W, H, v) => {
  const p = lot(W, H, 'pave', 520 + v);
  const L = blank(W, H);
  const r = Math.max(2, (Math.min(W, H) >> 2) - 1);
  tank(L, r + 2, r + 2, r, C.waterShallow, C.paveHi);
  tank(L, W - r - 3, H - r - 3, r, C.water, C.paveHi);
  place(p, L);
  px(p, r + 2, r + 2, C.foam);
  return p;
};

const energyNode: Painter = (W, H, v) => {
  const p = lot(W, H, 'pave', 530 + v);
  const L = blank(W, H);
  rect(L, 2, 3, W - 5, 4, C.roofBlue); // solar canopy
  for (let x = 4; x < W - 3; x += 3) vline(L, x, 3, 6, C.roofBlueLo);
  rect(L, 4, 7, W - 9, H - 11, C.paveHi); // battery cabinet
  for (let x = 5; x < W - 5; x += 2) px(L, x, 9, C.lineYellow);
  place(p, L);
  return p;
};

const aiNode: Painter = (W, H, v) => {
  const p = lot(W, H, 'pave', 540 + v);
  const L = blank(W, H);
  flat(L, 2, 2, W - 5, 4, ROOF_SLATE, 54);
  wall(L, 2, 6, W - 5, H - 9, C.slate, C.slateLo);
  for (let y = 7; y < H - 4; y += 2) for (let x = 3; x < W - 4; x += 2) px(L, x, y, (x + y + v) % 3 === 0 ? C.cyan : C.slateLo);
  place(p, L);
  return p;
};

const coop: Painter = (W, H, v) => {
  const p = lot(W, H, 'grass', 560 + v);
  const L = blank(W, H);
  // a courtyard block: four wings around a garden, rooftop greens
  const wing = Math.max(4, W >> 3);
  flat(L, 1, 1, W - 4, wing, ROOF_GREEN, 56);
  wall(L, 1, 1 + wing, W - 4, 3, C.cream, C.creamLo);
  windows(L, 2, 2 + wing, W - 6, 1, 3, 3, 2, 1);
  rect(L, 1, 4 + wing, wing, H - wing - 8, C.roofBrown);
  rect(L, W - 3 - wing, 4 + wing, wing, H - wing - 8, C.roofBrown);
  place(p, L);
  tree(p, W >> 1, (H >> 1) + 2, Math.max(1, W >> 4));
  return p;
};

const commune: Painter = (W, H, v) => {
  const p = lot(W, H, 'meadow', 570 + v);
  const L = blank(W, H);
  const cells: Array<[number, number]> = [];
  for (let cy = 0; cy < H; cy += T) for (let cx = 0; cx < W; cx += T) cells.push([cx, cy]);
  cells.forEach(([cx, cy], k) => {
    if (W >= 32 && H >= 32 && cx === (W >> 1) - 8 && cy === (H >> 1) - 8) {
      tree(L, cx + 8, cy + 8, 4); // the shared green's big tree
    } else houseAt(L, cx, cy, hash2(k, v, 57), true);
  });
  place(p, L);
  return p;
};

const bazaar: Painter = (W, H, v) => {
  const p = lot(W, H, 'pave', 580 + v);
  const L = blank(W, H);
  const cols: readonly RGB[] = [C.signal, C.gold, C.roofBlue, C.leaf, C.cyan];
  let k = v;
  for (let y = 2; y + 5 < H; y += 7) {
    for (let x = 1; x + 5 < W; x += 7) {
      const c = cols[k++ % cols.length]!;
      rect(L, x, y, 5, 3, c); // stall awning
      for (let i = 0; i < 5; i += 2) px(L, x + i, y + 2, C.line);
      rect(L, x + 1, y + 3, 3, 1, C.roofBrown); // counter
    }
  }
  place(p, L);
  return p;
};

const makerSpace: Painter = (W, H, v) => {
  const p = lot(W, H, 'pave', 590 + v);
  const L = blank(W, H);
  const roofH = Math.max(5, (H * 6) >> 4);
  sawtooth(L, 1, 2, W - 4, roofH);
  wall(L, 1, 2 + roofH, W - 4, Math.max(5, H - roofH - 5), C.brick, C.brickLo);
  // the mural on the front wall
  const wy = 3 + roofH;
  for (let x = 2; x < W - 4; x++) px(L, x, wy + 1 + ((x >> 2) & 1), [C.flower, C.cyan, C.signal][(x >> 2) % 3]!);
  door(L, (W >> 1) - 2, H - 6, 4, 3);
  place(p, L);
  return p;
};

const healingCommons: Painter = (W, H, v) => {
  const p = lot(W, H, 'grass', 600 + v);
  const L = blank(W, H);
  // an open-cornered cloister around a garden with a pond
  const b = Math.max(5, W >> 3);
  gable(L, 1, 1, W - 4, b, ROOF_BROWN);
  wall(L, 1, 1 + b, W - 4, 3, C.cream, C.creamLo);
  gable(L, 1, H - b - 6, (W >> 1) - 3, b, ROOF_BROWN);
  wall(L, 1, H - 6, (W >> 1) - 3, 3, C.cream, C.creamLo);
  place(p, L);
  disc(p, W >> 1, H >> 1, Math.max(1, W >> 4), C.waterShallow);
  px(p, (W >> 1) - 1, (H >> 1) - 1, C.wave);
  tree(p, W - 6, (H >> 1) + 1, 2);
  return p;
};

const park: Painter = (W, H, v) => {
  const p = lot(W, H, 'grass', 610 + v);
  // a winding footpath and groves
  for (let x = 0; x < W; x++) px(p, x, (H >> 1) + ((x >> 3) & 1), C.dirtHi);
  const L = blank(W, H);
  for (let cy = 0; cy < H; cy += T) {
    for (let cx = 0; cx < W; cx += T) {
      const h = hash2(cx, cy, 61 + v);
      tree(L, cx + 4 + (h % 3), cy + 4, 3);
      if (h & 16) tree(L, cx + 12, cy + 12, 2);
    }
  }
  place(p, L);
  return p;
};

const rewilded: Painter = (W, H, v) => {
  const p = lot(W, H, 'meadow', 620 + v);
  for (let k = 0; k < (W * H) >> 5; k++) {
    const x = hash2(k, 2, 62 + v) % W;
    const y = hash2(k, 3, 62 + v) % H;
    px(p, x, y, k % 3 === 0 ? C.flower : k % 3 === 1 ? C.petal : C.meadowHi);
  }
  const L = blank(W, H);
  for (let cy = 0; cy < H; cy += T) for (let cx = 0; cx < W; cx += T) disc(L, cx + 11, cy + 5, 2, C.leaf); // shrubs
  place(p, L);
  return p;
};

const median: Painter = (W, H, v) => {
  const p = lot(W, H, 'grass', 110 + v);
  frame(p, 0, 0, W, H, C.pave); // curbed island
  for (let cy = 0; cy < H; cy += T) for (let cx = 0; cx < W; cx += T) disc(p, cx + 8, cy + 8, 2, C.leaf);
  return p;
};

function frame(p: Pixels, x: number, y: number, w: number, h: number, c: RGB): void {
  hline(p, x, x + w - 1, y, c);
  hline(p, x, x + w - 1, y + h - 1, c);
  vline(p, x, y, y + h - 1, c);
  vline(p, x + w - 1, y, y + h - 1, c);
}

/** Kind → [painter, variant count]. */
export const BUILDING_PAINTERS: ReadonlyMap<number, readonly [Painter, number]> = new Map<number, readonly [Painter, number]>([
  [11, [median, 1]],
  [16, [house, 6]],
  [17, [apartments, 2]],
  [18, [projects, 1]],
  [19, [commercial, 3]],
  [20, [offices, 1]],
  [21, [industrial, 2]],
  [22, [parking, 1]],
  [23, [civic, 1]],
  [24, [coalPlant, 1]],
  [25, [gasPlant, 1]],
  [26, [hydroPlant, 1]],
  [27, [nuclearPlant, 1]],
  [28, [windTurbine, 1]],
  [29, [solarPlant, 1]],
  [30, [fusionPlant, 1]],
  [31, [precinct, 1]],
  [32, [fireStation, 1]],
  [33, [clinic, 1]],
  [34, [library, 1]],
  [35, [school, 1]],
  [48, [parklet, 1]],
  [49, [garden, 1]],
  [50, [compostHub, 1]],
  [51, [verticalFarm, 1]],
  [52, [wastewater, 1]],
  [53, [energyNode, 1]],
  [54, [aiNode, 1]],
  [55, [adu, 2]],
  [56, [coop, 1]],
  [57, [commune, 1]],
  [58, [bazaar, 2]],
  [59, [makerSpace, 1]],
  [60, [healingCommons, 1]],
  [61, [park, 2]],
  [62, [rewilded, 1]],
]);

// ── Derelict ───────────────────────────────────────────────────────────────────────────────────────
// Condition tier 1 — disinvestment made visible, not a separate drawing: windows boarded or broken,
// roofs holed and faded, lots gone to dirt and weeds, walls stained. Hash-placed, so it's stable.

const GLASS = new Set([key(C.glass), key(C.glassHi), key(C.glassLo)]);
const ROOF_TOPS = new Map<number, RGB>([
  [key(C.roofRedHi), C.roofRed],
  [key(C.roofBlueHi), C.roofBlue],
  [key(C.roofBrownHi), C.roofBrown],
  [key(C.slateHi), C.slate],
  [key(C.grassHi), C.grassMid],
]);
const ROOFS = new Set([key(C.roofRed), key(C.roofBlue), key(C.roofBrown), key(C.slate), key(C.pave)]);
const LOT = new Set([key(C.grass), key(C.grassMid), key(C.meadow)]);
const WALLS = new Map<number, RGB>([
  [key(C.cream), C.creamLo],
  [key(C.paveHi), C.pave],
  [key(C.brick), C.brickLo],
]);

export function derelict(src: Pixels, seed: number): Pixels {
  const p: Pixels = { w: src.w, h: src.h, data: new Uint8ClampedArray(src.data) };
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4;
      const k = (p.data[i]! << 16) | (p.data[i + 1]! << 8) | p.data[i + 2]!;
      const h = hash2(x, y, seed);
      if (GLASS.has(k)) {
        // per PANE (not per pixel): a third survive grimy (and still light at night — people live
        // here), a third are boarded, a third broken
        const pane = hash2(x >> 1, y >> 1, seed) % 3;
        if (pane === 0) px(p, x, y, C.glassLo);
        else px(p, x, y, pane === 1 ? C.roofBrownLo : C.ink);
      } else if (ROOF_TOPS.has(k)) {
        px(p, x, y, h % 7 === 0 ? C.ink : ROOF_TOPS.get(k)!); // faded + holed
      } else if (ROOFS.has(k) && h % 9 === 0) {
        px(p, x, y, C.ink);
      } else if (LOT.has(k)) {
        if (h % 3 === 0) px(p, x, y, C.dirt);
        else if (h % 7 === 0) px(p, x, y, C.grassLo);
      } else if (k === key(C.leaf) || k === key(C.leafHi) || k === key(C.flower)) {
        if (h % 2 === 0) px(p, x, y, h % 3 === 0 ? C.dirtLo : C.meadow); // withered, gone to seed
      } else if (k === key(C.asphalt) || k === key(C.line)) {
        if (h % 5 === 0) px(p, x, y, C.asphaltLo); // cracked, faded paint
        else if (h % 17 === 0) px(p, x, y, C.grassMid); // weeds through the cracks
      } else if (WALLS.has(k) && h % 5 === 0) {
        px(p, x, y, WALLS.get(k)!); // grime
      }
    }
  }
  return p;
}

// ── Night lights ───────────────────────────────────────────────────────────────────────────────────
// The emission map is DERIVED from the building's own pixels, so light always sits exactly where the
// art put a window: glass panes light warm (most), TV-blue (some) or stay dark (a few), decided per
// pane so a window lights as a unit; boarded derelict windows have no glass, so they stay dark. Stack
// tops (the red band under the ink mouth) become the blinking aviation beacons; the fusion ring and
// the AI node's cyan racks glow too.

const WARM: RGB = C.lineYellow;
const WARM_HI: RGB = C.flower;
const TV: RGB = C.glassHi;

export interface Emission {
  lit: Pixels | null;
  blink: Pixels | null;
}

export function emissionOf(img: Pixels, kind: number, seed: number): Emission {
  const lit = blank(img.w, img.h);
  const blink = blank(img.w, img.h);
  let nLit = 0;
  let nBlink = 0;
  const at = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= img.w || y >= img.h) return -1;
    const i = (y * img.w + x) * 4;
    return (img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!;
  };
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const k = at(x, y);
      if (GLASS.has(k)) {
        const pane = hash2(x >> 1, y >> 1, seed) % 10; // ~2-px panes light as a unit
        if (pane < 1) continue; // dark window
        px(lit, x, y, pane < 3 ? TV : k === key(C.glassHi) ? WARM_HI : WARM);
        nLit++;
      } else if (k === key(C.signal) && at(x, y - 1) === key(C.ink) && (kind >= 21 && kind <= 30)) {
        px(blink, x, y, C.signal); // stack-top beacon
        nBlink++;
      } else if (k === key(C.cyan) && (kind === 30 || kind === 54)) {
        px(lit, x, y, C.cyan);
        nLit++;
      }
    }
  }
  return { lit: nLit > 0 ? lit : null, blink: nBlink > 0 ? blink : null };
}

/** Paint kind `kind` at footprint W×H px, variant v, condition tier. */
export function paintBuilding(kind: number, W: number, H: number, v: number, tier: number): Pixels {
  const entry = BUILDING_PAINTERS.get(kind);
  if (!entry) throw new Error(`no SNES painter for building kind ${kind}`);
  const img = entry[0](W, H, v);
  return tier === 1 ? derelict(img, kind * 131 + v) : img;
}
