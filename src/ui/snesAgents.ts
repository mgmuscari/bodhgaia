// SNES-skin agents (PURE — pure-ui allowlist): cars, police cruisers, pedestrians and cyclists as native
// pixel art, drawn at exactly one art pixel per tile pixel (Maddy 2026-09-30: all pixel art on one
// scale). Vehicles turn continuously (moverPose), and a rotated pixel sprite smears — so, the SNES way,
// each vehicle has 8 HEADING frames and the renderer shows the one nearest its heading (heading8). A car
// is sized to the car footprint (CAR_LENGTH × CAR_WIDTH ≈ 7 × 4 art px). People are 3-px figures with a
// two-frame walk; heading doesn't read at that size.
//
// Keys: @sprite/car/{tint}/{dir8}, @sprite/car-light/{dir8} (headlights + taillights, additive at night),
// @sprite/cop/{dir8}/{phase}, @sprite/ped/{tone}/{shirt}/{frame}, @sprite/bike/{tone}/{shirt}/{frame},
// @sprite/train/{loco|car}/{dir8}, @sprite/bird/{frame}, @sprite/smog/{size}/{variant},
// @sprite/firetruck/{dir8}/{phase}, @sprite/fire/{frame}, @sprite/drop, @sprite/toxic/{size}/{variant},
// @sprite/rain/{0 light|1 heavy}, @sprite/debris.
// dir8: 0 = N, clockwise (2 = E, 4 = S, 6 = W).

import { blank, hash2, px, type Pixels, type RGB } from './pixelArt';
import { C } from './snesPalette';

/** Car body colourways (hi, mid, lo). A car's `tint` picks one, modulo the count. */
const BODIES: ReadonlyArray<readonly [RGB, RGB, RGB]> = [
  [C.roofRedHi, C.roofRed, C.roofRedLo],
  [C.roofBlueHi, C.roofBlue, C.roofBlueLo],
  [C.paveHi, C.pave, C.paveLo], // silver
  [C.flower, C.gold, C.roofBrown], // a yellow cab
  [C.leafHi, C.leaf, C.leafLo],
  [C.cream, C.creamLo, C.dirtLo],
  [C.slateHi, C.slate, C.slateLo],
  [C.roofBrownHi, C.roofBrown, C.roofBrownLo],
];
export const AGENT_TINTS = BODIES.length;

// Glyphs: k edge (body lo), b body, r roof (body hi), g windshield, w rear window, L/M light bar halves,
// H headlight, T taillight (lights frames only).
const CAR_E = ['.kkkkk.', 'kbwrrgb', 'kbwrrgb', '.kkkkk.'];
const CAR_NE = ['...kkk', '..kbgk', '.kbrbk', 'kbrbk.', 'kwbk..', 'kkk...'];
const COP_E = ['.kkkkk.', 'kbwLrgb', 'kbwMrgb', '.kkkkk.'];
const COP_NE = ['...kkk', '..kbgk', '.kbLbk', 'kbMbk.', 'kwbk..', 'kkk...'];
// Fire trucks: a cruiser's frame in red, a ladder (l) along the back, the light bar (L/M) behind the cab.
const TRUCK_E = ['.kkkkk.', 'kllLbgb', 'kllMbgb', '.kkkkk.'];
const TRUCK_NE = ['...kkk', '..kbgk', '.kLbbk', 'klMbk.', 'kllk..', 'kkk...'];
const LIGHT_E = ['.......', 'T.....H', 'T.....H', '.......'];
const LIGHT_NE = ['....H.', '.....H', '......', '......', 'T.....', '.T....'];

function glyph(rows: readonly string[], colours: Record<string, RGB>): Pixels {
  const p = blank(rows[0]!.length, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = colours[row[x]!];
      if (c) px(p, x, y, c);
    }
  });
  return p;
}

/** Rotate a sprite 90° clockwise (screen y-down): input (x, y) → output (h − 1 − y, x). */
function rotCW(p: Pixels): Pixels {
  const out = blank(p.h, p.w);
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4;
      const o = (x * out.w + (p.h - 1 - y)) * 4;
      out.data.set(p.data.subarray(i, i + 4), o);
    }
  }
  return out;
}

/** All 8 heading frames from an east-facing and a north-east-facing drawing. */
function eightWays(east: Pixels, northEast: Pixels): Pixels[] {
  const frames: Pixels[] = new Array(8);
  frames[2] = east;
  frames[4] = rotCW(frames[2]!);
  frames[6] = rotCW(frames[4]!);
  frames[0] = rotCW(frames[6]!);
  frames[1] = northEast;
  frames[3] = rotCW(frames[1]!);
  frames[5] = rotCW(frames[3]!);
  frames[7] = rotCW(frames[5]!);
  return frames;
}

const SKIN_TONES: readonly RGB[] = [C.cream, C.dirtHi, C.roofBrown];
const SHIRTS: readonly RGB[] = [C.signal, C.roofBlue, C.leaf, C.gold, C.cyan, C.slateHi];
const PED_FRAMES = [
  ['.h.', 'sss', 'l.l'],
  ['.h.', 'sss', '.l.'],
];
const BIKE_FRAMES = [
  ['.h.', 'sss', '.k.', '.k.'],
  ['.h.', 'sss', '.k.', 'k.k'],
];

/** The 8-way frame (0 = N, clockwise) nearest a heading — trig-free: a component within tan 22.5° of
 *  zero is "on axis". */
export function heading8(hx: number, hy: number): number {
  const ax = Math.abs(hx);
  const ay = Math.abs(hy);
  const T22 = 0.41421356; // tan 22.5°
  if (ax <= ay * T22) return hy < 0 ? 0 : 4;
  if (ay <= ax * T22) return hx > 0 ? 2 : 6;
  return hx > 0 ? (hy < 0 ? 1 : 3) : hy < 0 ? 7 : 5;
}

/** Smog billow sizes (art px across): a plume grows as it drifts downwind, so the renderer steps up
 *  through these rather than scaling one sprite (scaling breaks the art-pixel grid). */
const SMOG_PX = [6, 10, 14] as const;
export const SMOG_SIZES = SMOG_PX.length;

/** One smog puff: three overlapping lobes, shaded dark-below / light-above, the rim frayed by a hash so
 *  it reads as vapour, not a disc. Drawn translucent by the renderer. `shades` is (hi, mid, lo): slate for
 *  smog, sickly yellow-greens for a spill's toxic cloud. */
function smogPuff(size: number, variant: number, shades: readonly [RGB, RGB, RGB] = [C.slateHi, C.slate, C.slateLo]): Pixels {
  const p = blank(size, size);
  const r = size / 4;
  const lobes = [
    [size * 0.32, size * 0.58, r * 1.15],
    [size * 0.68, size * 0.6, r * 1.05],
    [size * 0.5, size * 0.38, r * 1.25],
  ] as const;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let best = 2; // normalized distance to the nearest lobe centre (<1 = inside)
      for (const [cx, cy, lr] of lobes) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        best = Math.min(best, (dx * dx + dy * dy) / (lr * lr));
      }
      if (best >= 1) continue;
      const h = hash2(x, y, size * 7 + variant) & 255;
      if (best > 0.55 && h < (best - 0.55) * 560) continue; // fray the rim
      const t = y / size; // light from above
      px(p, x, y, t < 0.4 ? shades[0] : t < 0.7 ? shades[1] : shades[2]);
    }
  }
  return p;
}

// Trains: a locomotive (cab window at the nose) and silver carriages, ~0.8 tile long, as wide as the
// rail gauge. k edge, b body, w window, r/m loco body + roof gear, g windshield.
const TRAIN_CAR_E = ['.kkkkkkkkkkk.', 'kbbbbbbbbbbbk', 'kbwbwbwbwbwbk', 'kbwbwbwbwbwbk', 'kbbbbbbbbbbbk', '.kkkkkkkkkkk.'];
const TRAIN_LOCO_E = ['.kkkkkkkkkkk.', 'krrrrrrrrrrgk', 'krmmmmmmmrrgk', 'krmmmmmmmrrgk', 'krrrrrrrrrrgk', '.kkkkkkkkkkk.'];

/** The north-east frame of an east-facing body: the drawing laid along the diagonal, each target pixel
 *  taking the nearest source pixel (a pixel-art turn — jaggies, never a blur). `len`/`wid` are the
 *  turned body's size in art pixels (a diagonal reads longer per pixel, so it is drawn a little shorter). */
function turnNE(east: Pixels, len: number, wid: number): Pixels {
  const n = Math.ceil((len + wid) / Math.SQRT2);
  const out = blank(n, n);
  const c = n / 2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const u = (dx - dy) / Math.SQRT2; // along the heading (north-east)
      const v = (dx + dy) / Math.SQRT2; // across, to its right (south-east)
      if (Math.abs(u) > len / 2 || Math.abs(v) > wid / 2) continue;
      const sx = Math.min(east.w - 1, Math.floor(((u + len / 2) / len) * east.w));
      const sy = Math.min(east.h - 1, Math.floor(((v + wid / 2) / wid) * east.h));
      const i = (sy * east.w + sx) * 4;
      if (east.data[i + 3] === 0) continue;
      out.data.set(east.data.subarray(i, i + 4), (y * n + x) * 4);
    }
  }
  return out;
}

/** Flame frames (art px): FIRE_W × FIRE_H, a few tongues licking up from a burning tile. */
const FIRE_W = 10;
const FIRE_H = 12;
export const FIRE_FRAMES = 4;

/** One flame frame: tongues of uneven height (taller in the middle), each banded from a pale core up through
 *  gold and red to dark tips, a spark or two above — the bands and tips shift frame to frame, so the frames
 *  cycled read as flicker. */
function flame(frame: number): Pixels {
  const p = blank(FIRE_W, FIRE_H);
  const c = (FIRE_W - 1) / 2;
  for (let x = 0; x < FIRE_W; x++) {
    const lateral = Math.abs(x - c) / c;
    const jitter = (hash2(x, frame, 71) % 5) - 2;
    const height = Math.max(2, Math.round(FIRE_H * (0.45 + 0.45 * (1 - lateral))) + jitter);
    for (let k = 0; k < height; k++) {
      const y = FIRE_H - 1 - k;
      const d = k / height; // 0 at the base, →1 at the tip
      const col =
        d > 0.8 ? C.roofRedLo
        : d > 0.55 || lateral > 0.75 ? C.signal
        : d > 0.3 || lateral > 0.45 ? C.gold
        : lateral < 0.25 && d < 0.2 ? C.petal
        : C.flower;
      px(p, x, y, col);
    }
  }
  // a spark or two lifted off the tips
  for (let s = 0; s < 2; s++) {
    const h = hash2(s, frame, 113);
    px(p, 2 + (h % (FIRE_W - 4)), (h >> 4) % 3, s === 0 ? C.flower : C.gold);
  }
  return p;
}

// Birds: a five-pixel gull, wings up / wings down.
const BIRD_FRAMES = [
  ['k...k', '.k.k.', '..k..'],
  ['..k..', '.k.k.', 'k...k'],
];

/** Paint every SNES agent sprite into `out`. */
export function paintSnesAgents(out: Map<string, Pixels>): void {
  BODIES.forEach(([hi, mid, lo], t) => {
    const cols = { k: lo, b: mid, r: hi, g: C.glassLo, w: C.glass };
    eightWays(glyph(CAR_E, cols), glyph(CAR_NE, cols)).forEach((f, d) => out.set(`@sprite/car/${t}/${d}`, f));
  });
  const lights = { H: C.lineYellow, T: C.signal };
  eightWays(glyph(LIGHT_E, lights), glyph(LIGHT_NE, lights)).forEach((f, d) => out.set(`@sprite/car-light/${d}`, f));
  for (const phase of [0, 1]) {
    const cols = {
      k: C.ink,
      b: C.line,
      r: C.ink,
      g: C.glassLo,
      w: C.glass,
      L: phase === 0 ? C.signal : C.roofBlue,
      M: phase === 0 ? C.roofBlue : C.signal,
    };
    eightWays(glyph(COP_E, cols), glyph(COP_NE, cols)).forEach((f, d) => out.set(`@sprite/cop/${d}/${phase}`, f));
  }
  for (const phase of [0, 1]) {
    const cols = { k: C.roofRedLo, b: C.roofRed, l: C.paveHi, g: C.glassLo, L: phase === 0 ? C.signal : C.line, M: phase === 0 ? C.line : C.signal };
    eightWays(glyph(TRUCK_E, cols), glyph(TRUCK_NE, cols)).forEach((f, d) => out.set(`@sprite/firetruck/${d}/${phase}`, f));
  }
  for (let f = 0; f < FIRE_FRAMES; f++) out.set(`@sprite/fire/${f}`, flame(f));
  out.set('@sprite/drop', glyph(['w'], { w: C.foam }));
  // a crash's debris: broken glass and a bit of trim on the road
  out.set('@sprite/debris', glyph(['g.p.g', '.g.p.'], { g: C.glassHi, p: C.paveHi }));
  // rain: a streak one art pixel wide, a pale head over a glassier tail; a heavy storm's is longer
  out.set('@sprite/rain/0', glyph(['h', 'g', 'g'], { h: C.glassHi, g: C.glass }));
  out.set('@sprite/rain/1', glyph(['h', 'h', 'g', 'g', 'g'], { h: C.glassHi, g: C.glass }));
  const carCols = { k: C.slateLo, b: C.paveHi, w: C.glassLo };
  const locoCols = { k: C.roofRedLo, r: C.roofRed, m: C.slate, g: C.glass };
  for (const [part, rows, cols] of [['car', TRAIN_CAR_E, carCols], ['loco', TRAIN_LOCO_E, locoCols]] as const) {
    const east = glyph(rows, cols);
    eightWays(east, turnNE(east, 11, 5)).forEach((f, d) => out.set(`@sprite/train/${part}/${d}`, f));
  }
  BIRD_FRAMES.forEach((rows, f) => out.set(`@sprite/bird/${f}`, glyph(rows, { k: C.ink })));
  SMOG_PX.forEach((size, i) => {
    for (const v of [0, 1]) {
      out.set(`@sprite/smog/${i}/${v}`, smogPuff(size, v));
      out.set(`@sprite/toxic/${i}/${v}`, smogPuff(size, v, [C.meadowHi, C.meadow, C.grassMid]));
    }
  });
  SKIN_TONES.forEach((h, tone) => {
    SHIRTS.forEach((s, shirt) => {
      PED_FRAMES.forEach((rows, f) => out.set(`@sprite/ped/${tone}/${shirt}/${f}`, glyph(rows, { h, s, l: C.slateLo })));
      BIKE_FRAMES.forEach((rows, f) => out.set(`@sprite/bike/${tone}/${shirt}/${f}`, glyph(rows, { h, s, k: C.ink })));
    });
  });
}

/** The ped/bike sprite key for a stable per-person seed and walk frame. */
export function personKey(kind: 'ped' | 'bike', seed: number, frame: number): string {
  const s = seed >>> 0;
  return `@sprite/${kind}/${s % SKIN_TONES.length}/${(s >>> 4) % SHIRTS.length}/${frame & 1}`;
}
