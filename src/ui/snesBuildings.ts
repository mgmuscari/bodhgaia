// SNES-skin buildings (PURE — pure-ui allowlist). Each building kind paints a WHOLE footprint image
// (16·w × 16·h px) in the Super Famicom city-builder idiom — ground lot, soft drop shadow, then an
// ink-outlined mass seen in 3/4 view (roof on top, front wall below with its windows and door) — and
// snesTileset slices it into per-cell atlas tiles so a multi-tile building reads as ONE picture.
//
// Type is carried by the drawing (gable houses, brick walk-ups, glass offices, sawtooth factories,
// smokestacks…), which is why the skin turns the R1/C2 glyphs off. Condition tier 1 runs every image
// through `derelict`: boarded windows, holed roofs, a lot gone to dirt and weeds.

import { blank, disc, hash2, hline, px, rect, vline, type Pixels, type RGB } from './pixelArt';
import { C } from './snesPalette';
import {
  T, ROOF_RED, ROOF_BLUE, ROOF_BROWN, ROOF_SLATE, ROOF_GREEN, HOUSE_ROOFS, CONCRETE, key,
  lot, place, gable, flat, sawtooth, wall, windows, door, tree, tank, frame,
  type Ramp,
} from './snesParts';

// The shared parts kit (lot, place, roofs, walls, windows, stacks, tanks…) lives in snesParts.ts; the
// large site-plan buildings (power, industry, shops, offices) in snesBigBuildings.ts.
import { coalPlant, gasPlant, hydroPlant, nuclearPlant, industrial, commercial, offices } from './snesBigBuildings';

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

/** A retention pond (Maddy 2026-10-08): open water in an oval basin, a shallow rim, a muddy bank with reeds,
 *  and a concrete outfall where it lets the stored storm water out slowly. Calm water — no ripple marks. */
const retentionPond: Painter = (W, H, v) => {
  const p = lot(W, H, 'grass', 660 + v);
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  const rx = W / 2 - 3;
  const ry = H / 2 - 4;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = ((x - cx) * (x - cx)) / (rx * rx) + ((y - cy) * (y - cy)) / (ry * ry);
      if (d < 0.62) px(p, x, y, C.water);
      else if (d < 1) px(p, x, y, C.waterShallow);
      else if (d < 1.3) {
        const h = hash2(x, y, 66 + v);
        px(p, x, y, h % 3 === 0 ? C.dirt : C.dirtHi); // the bank
        if (h % 7 === 0 && y > 1) {
          px(p, x, y, C.leafLo); // a reed clump
          px(p, x, y - 1, h & 8 ? C.leaf : C.leafHi);
        }
      }
    }
  }
  rect(p, (W >> 1) - 2, H - 3, 4, 2, C.paveHi); // the outfall
  hline(p, (W >> 1) - 1, (W >> 1), H - 3, C.slateLo);
  px(p, Math.round(cx - rx / 2), Math.round(cy - ry / 3), C.glassHi); // a glint
  return p;
};

/** A construction site (Maddy 2026-10-08: commons projects take time): bare earth behind an orange-and-white
 *  barrier fence, a scaffold frame going up and a stack of timber. */
const site: Painter = (W, H, v) => {
  const p = lot(W, H, 'dirt', 670 + v);
  for (let a = 0; a < W; a++) {
    const c = (a >> 1) % 2 === 0 ? C.signal : C.paveHi; // the barrier, in stripes
    px(p, a, 0, c);
    px(p, a, H - 1, c);
  }
  for (let a = 0; a < H; a++) {
    const c = (a >> 1) % 2 === 0 ? C.signal : C.paveHi;
    px(p, 0, a, c);
    px(p, W - 1, a, c);
  }
  const L = blank(W, H);
  const x0 = 3;
  const y0 = 3;
  const x1 = W - 6;
  const y1 = H - 5;
  for (let x = x0; x <= x1; x++) for (const y of [y0, (y0 + y1) >> 1, y1]) px(L, x, y, C.slate); // scaffold boards
  for (let y = y0; y <= y1; y++) for (const x of [x0, x1]) px(L, x, y, C.slateLo); // its poles
  for (let k = 0; k < 3; k++) hline(L, W - 5, W - 3, H - 4 + k - 1, k % 2 ? C.roofBrown : C.roofBrownHi); // timber
  place(p, L);
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

const tinyHomes: Painter = (W, H, v) => {
  const p = lot(W, H, 'meadow', 630 + v);
  const L = blank(W, H);
  // a shared path down the middle, small cabins either side of it, a kitchen garden at the end
  rect(L, (W >> 1) - 1, 1, 2, H - 2, C.paveHi);
  const roofs = HOUSE_ROOFS;
  let k = 0;
  for (let y = 2; y + 6 <= H - 1; y += 7) {
    for (const x of [2, (W >> 1) + 3]) {
      if (x + 8 > W) continue;
      const h = hash2(k++, v, 63);
      gable(L, x, y, 7, 3, roofs[h % roofs.length]!);
      wall(L, x, y + 3, 7, 3, C.cream, C.creamLo);
      door(L, x + 3, y + 4, 1, 2);
    }
  }
  place(p, L);
  tree(p, W - 3, H - 3, 1);
  return p;
};

const yard: Painter = (W, H, v) => {
  const p = lot(W, H, 'grass', 640 + v);
  const L = blank(W, H);
  // a picket fence round a back lawn: a tree, or a vegetable bed and a washing line
  for (let x = 0; x < W; x += 2) {
    px(L, x, 0, C.cream);
    px(L, x, H - 1, C.cream);
  }
  for (let y = 0; y < H; y += 2) {
    px(L, 0, y, C.cream);
    px(L, W - 1, y, C.cream);
  }
  if (v % 2 === 0) tree(L, W - 5, 5, 2);
  else {
    rect(L, 3, H - 6, W - 6, 3, C.dirt);
    for (let x = 4; x < W - 4; x += 2) px(L, x, H - 5, C.leaf);
    hline(L, 3, W - 4, 4, C.paveLo);
    px(L, 5, 5, C.petal);
    px(L, 8, 5, C.roofBlueHi);
  }
  place(p, L);
  return p;
};

/** A ruin (Maddy 2026-10-08): a lost house, still recognisably a house — its own drawing turned dingy grey and
 *  brown, the roof holed through to the dark inside, windows black, rubble at its feet, the yard gone to dirt. */
const ruin: Painter = (W, H, v) => {
  const p = house(W, H, v + 3);
  const holes: [number, number, number, number][] = [];
  for (let cy = 0; cy < H; cy += T) {
    for (let cx = 0; cx < W; cx += T) {
      // two or three chunks gone from each house: roof and a wall corner
      const n = 2 + (hash2(cx, cy, 660 + v) % 2);
      for (let k = 0; k < n; k++) {
        const h = hash2(cx + k, cy, 661 + v);
        holes.push([cx + 3 + (h % 8), cy + 2 + ((h >>> 4) % 7), 2 + ((h >>> 8) % 3), 2 + ((h >>> 11) % 2)]);
      }
    }
  }
  const inHole = (x: number, y: number): boolean => holes.some(([hx, hy, hw, hh]) => x >= hx && x < hx + hw && y >= hy && y < hy + hh);
  const greys = [C.ink, C.asphaltLo, C.slateLo, C.paveLo, C.slate] as const; // dark → light
  const browns = [C.ink, C.roofBrownLo, C.dirtLo, C.dirt, C.creamLo] as const;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (p.data[i + 3] === 0) continue;
      const k = key([p.data[i]!, p.data[i + 1]!, p.data[i + 2]!] as RGB);
      const h = hash2(x, y, 662 + v);
      if (LOT.has(k) || k === key(C.grassHi) || k === key(C.grassLo) || k === key(C.flower) || k === key(C.leaf) || k === key(C.leafHi)) {
        // the yard: dirt, weeds, scattered rubble
        px(p, x, y, h % 9 === 0 ? C.paveLo : h % 4 === 0 ? C.grassLo : h % 3 === 0 ? C.dirtLo : C.dirt);
        continue;
      }
      if (inHole(x, y)) {
        px(p, x, y, h % 3 === 0 ? C.asphaltLo : C.ink); // open to the dark inside
        continue;
      }
      if (GLASS.has(k)) {
        px(p, x, y, C.ink); // every window gone
        continue;
      }
      // everything else: the same shape, its colour leached to grey or brown by brightness
      const lum = (p.data[i]! * 3 + p.data[i + 1]! * 6 + p.data[i + 2]!) / 10;
      const band = lum < 60 ? 0 : lum < 100 ? 1 : lum < 150 ? 2 : lum < 200 ? 3 : 4;
      const set = hash2(x >> 2, y >> 2, 663 + v) % 3 === 0 ? browns : greys;
      px(p, x, y, set[band]!);
    }
  }
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
  [66, [retentionPond, 2]],
  [67, [site, 1]],
  [53, [energyNode, 1]],
  [54, [aiNode, 1]],
  [55, [adu, 2]],
  [56, [coop, 1]],
  [57, [commune, 1]],
  [63, [tinyHomes, 1]],
  [64, [yard, 2]],
  [65, [ruin, 3]],
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
      } else if (k === key(C.dirt) && h % 6 === 0) {
        px(p, x, y, C.grassLo); // bare ground going to weeds (a ruin's yard keeps decaying too)
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
