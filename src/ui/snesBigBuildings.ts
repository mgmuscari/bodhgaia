// SNES-skin LARGE buildings (PURE — pure-ui allowlist): power plants, industry, shops and offices drawn
// as real site plans rather than one block on a bare lot (Maddy 2026-09-30: "really nice sprites with an
// appropriate industrial or commercial look"). Each painter lays its structures out in proportion to the
// footprint (tuned for the sizes the game places: coal + gas 3×3, nuclear 4×4, hydro 2×2, offices 2×2,
// shops 1–2×1, industry 1×1 and 3×3) and `place`s them back to front — one layer per structure, so each
// keeps its own ink outline and drop shadow. Small footprints fall back to a compact drawing.
//
// The extra parts here (3/4-view tanks and spheres, cooling towers, pipe runs, fences, trucks, parked
// cars, rooftop plant, pylons) are the industrial/commercial vocabulary; the shared kit is snesParts.ts.

import { blank, disc, hash2, hline, px, rect, vline, type Pixels, type RGB } from './pixelArt';
import { C } from './snesPalette';
import { ROOF_SLATE, CONCRETE, lot, place, flat, sawtooth, wall, windows, door, tree, stack, type Ramp } from './snesParts';

type Painter = (W: number, H: number, v: number) => Pixels;

const STEEL: Ramp = [C.paveHi, C.pave, C.paveLo];
const TANK_WHITE: Ramp = [C.line, C.paveHi, C.pave];
const CAR_BODIES: readonly RGB[] = [C.roofRed, C.roofBlue, C.paveHi, C.gold, C.leaf, C.slateHi, C.cream, C.roofBrown];

/** A fresh structure layer (transparent), composited onto the lot with `place` once drawn. */
const layer = (p: Pixels): Pixels => blank(p.w, p.h);

/** Clamp to [lo, hi] and floor — layout fractions land on whole art pixels. */
const at = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.floor(v)));

// ── Parts ──────────────────────────────────────────────────────────────────────────────────────────

/** Half-width of an ellipse row `j` of `rows`, for a shape `w` wide (√ is exactly rounded — allowlisted). */
function ellipseHalf(j: number, rows: number, w: number): number {
  const t = ((j + 0.5) / rows) * 2 - 1;
  return (w / 2) * Math.sqrt(Math.max(0, 1 - t * t));
}

/** A vertical storage tank in 3/4 view: lit left flank, shaded right, a domed elliptical lid on top. */
function cylinder(L: Pixels, x: number, y: number, w: number, h: number, r: Ramp): void {
  const cap = Math.max(2, w >> 2);
  const cx = x + w / 2;
  for (let yy = y + (cap >> 1); yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const f = (xx - x) / w;
      px(L, xx, yy, f < 0.25 ? r[0] : f < 0.7 ? r[1] : r[2]);
    }
  }
  hline(L, x, x + w - 1, y + h - 1, r[2]);
  for (let j = 0; j < cap; j++) {
    const half = ellipseHalf(j, cap, w);
    for (let xx = Math.ceil(cx - half); xx < cx + half; xx++) px(L, xx, y + j, j === 0 ? r[1] : r[0]);
  }
  // a ladder up the flank and a band near the top
  for (let yy = y + cap + 1; yy < y + h - 1; yy += 2) px(L, x + w - 2, yy, C.slateLo);
  if (h >= 7) hline(L, x, x + w - 1, y + cap, r[2]);
}

/** A spherical (Horton) gas tank on legs: shaded ball, a highlight, stubby legs below. */
function sphere(L: Pixels, cx: number, cy: number, r: number): void {
  for (const dx of [-r + 1, r - 1]) vline(L, cx + dx, cy, cy + r + 1, C.slateLo);
  disc(L, cx, cy, r, C.pave);
  disc(L, cx - 1, cy - 1, Math.max(1, r - 1), C.paveHi);
  disc(L, cx - 1, cy - 2, Math.max(0, r - 3), C.line);
  px(L, cx - (r >> 1), cy - (r >> 1), C.line);
  hline(L, cx - r + 2, cx + r - 2, cy + r, C.paveLo);
}

/** A hyperboloid cooling tower in 3/4 view: flared base, pinched waist, dark throat at the lip. */
function coolingTower(L: Pixels, x: number, y: number, w: number, h: number): void {
  const lip = Math.max(2, w >> 3);
  for (let j = lip >> 1; j < h; j++) {
    const t = j / h; // 0 top .. 1 base
    const waist = 0.62;
    const u = (t - waist) / (1 - waist);
    const k = t < waist ? 0.78 + (0.7 - 0.78) * (t / waist) : 0.7 + (1 - 0.7) * u * u;
    const half = (w / 2) * k;
    const cx = x + w / 2;
    for (let xx = Math.ceil(cx - half); xx < cx + half; xx++) {
      const f = (xx - (cx - half)) / (2 * half);
      px(L, xx, y + j, f < 0.22 ? C.paveHi : f < 0.68 ? C.pave : C.paveLo);
    }
  }
  // the lip: an ellipse ring around a dark throat
  const topHalf = (w / 2) * 0.78;
  for (let j = 0; j < lip; j++) {
    const half = ellipseHalf(j, lip, topHalf * 2);
    const inner = Math.max(0, half - 2);
    const cx = x + w / 2;
    for (let xx = Math.ceil(cx - half); xx < cx + half; xx++) {
      px(L, xx, y + j, Math.abs(xx + 0.5 - cx) < inner ? C.slateLo : C.paveHi);
    }
  }
}

/** A drifting steam plume, drawn straight on the lot after `place` (vapour has no ink outline). */
function steam(p: Pixels, cx: number, top: number, w: number, seed: number): void {
  const puffs = Math.max(2, w >> 2);
  for (let k = 0; k < puffs; k++) {
    const r = Math.max(1, (w >> 2) - (k >> 1));
    const x = cx + k * 2 - (hash2(k, seed, 77) % 2);
    const y = top - k * 2;
    disc(p, x, y, r, C.paveHi);
    disc(p, x - 1, y - 1, Math.max(0, r - 1), C.line);
  }
}

/** A 2-px pipe along an orthogonal polyline, lit on top/left, with a flange every 4 px. On the lot. */
function pipeRun(p: Pixels, pts: ReadonlyArray<readonly [number, number]>, lit: RGB, body: RGB): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    if (y0 === y1) {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
        px(p, x, y0, lit);
        px(p, x, y0 + 1, (x & 3) === 0 ? C.slateLo : body);
      }
    } else {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        px(p, x0, y, lit);
        px(p, x0 + 1, y, (y & 3) === 0 ? C.slateLo : body);
      }
    }
  }
}

/** A chain-link perimeter fence: a slate line with paler posts every 3 px. On the lot. */
function fence(p: Pixels, x: number, y: number, w: number, h: number): void {
  for (let i = 0; i < w; i++) {
    const c = i % 3 === 0 ? C.paveHi : C.slate;
    px(p, x + i, y, c);
    px(p, x + i, y + h - 1, c);
  }
  for (let j = 0; j < h; j++) {
    const c = j % 3 === 0 ? C.paveHi : C.slate;
    px(p, x, y + j, c);
    px(p, x + w - 1, y + j, c);
  }
}

/** An east-facing box truck (8×4): coloured cab, white box with a dark rear door. */
function truck(L: Pixels, x: number, y: number, cab: RGB): void {
  rect(L, x, y, 6, 4, C.paveHi);
  hline(L, x, x + 5, y, C.line);
  vline(L, x, y, y + 3, C.paveLo);
  rect(L, x + 6, y + 1, 2, 3, cab);
  px(L, x + 7, y + 1, C.glass);
}

/** An asphalt parking lot with painted stalls on both sides of an aisle and a hash-picked mix of cars. */
function parkingLot(p: Pixels, x: number, y: number, w: number, h: number, seed: number): void {
  rect(p, x, y, w, h, C.asphalt);
  // stall rows back to back in pairs, a 3-px drive aisle between pairs
  const rows: number[] = [];
  for (let ry = y + 1; ry + 3 <= y + h; ry += 9) {
    rows.push(ry);
    if (ry + 6 <= y + h) rows.push(ry + 3);
  }
  for (const ry of rows) {
    for (let sx = x + 1; sx + 3 <= x + w; sx += 3) {
      const aisleEnd = (ry - y - 1) % 9 === 0 ? ry + 2 : ry; // the stall's mouth, toward the aisle
      px(p, sx, aisleEnd, C.paveLo); // a painted tick at the stall mouth, not a full line
      if (hash2(sx, ry, seed) % 3 !== 0) {
        const body = CAR_BODIES[hash2(sx, ry, seed + 1) % CAR_BODIES.length]!;
        rect(p, sx + 1, ry, 2, 3, body);
        px(p, sx + 1, ry + ((ry - y - 1) % 9 === 0 ? 2 : 0), C.glassLo); // windscreen faces the aisle
      }
    }
  }
  // lamp posts down the aisle
  for (let ay = y + 7; ay < y + h; ay += 9) for (let lx = x + 4; lx < x + w - 2; lx += 12) px(p, lx, ay, C.lineYellow);
}

/** A rooftop unit (HVAC / fan housing) on a flat roof. */
function hvac(L: Pixels, x: number, y: number): void {
  rect(L, x, y, 3, 2, C.slateHi);
  hline(L, x, x + 2, y + 1, C.slate);
  px(L, x + 1, y, C.slateLo);
}

/** A little lattice transmission pylon (5×6). */
function pylon(L: Pixels, x: number, y: number): void {
  hline(L, x, x + 4, y + 1, C.slateLo);
  vline(L, x + 1, y + 1, y + 5, C.slateLo);
  vline(L, x + 3, y + 1, y + 5, C.slateLo);
  px(L, x + 2, y, C.slateLo);
  px(L, x + 2, y + 3, C.slateLo);
}

/** A coal heap: a dark mound with glinting lumps, wider at the foot. On the lot. */
function coalPile(p: Pixels, cx: number, cy: number, r: number, seed: number): void {
  const rows = Math.max(3, r);
  for (let j = 0; j < rows; j++) {
    const half = r * (0.45 + 0.55 * (j / rows));
    for (let xx = Math.ceil(cx - half); xx < cx + half; xx++) {
      const h = hash2(xx, j, seed);
      px(p, xx, cy - rows + j + 1, h % 9 === 0 ? C.slate : j < rows / 3 ? C.asphalt : h % 3 === 0 ? C.asphaltLo : C.ink);
    }
  }
}

/** A Bresenham belt from (x0,y0) to (x1,y1): a 2-px conveyor with a lit edge. */
function conveyor(L: Pixels, x0: number, y0: number, x1: number, y1: number): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    px(L, x, y, C.slateHi);
    px(L, x, y + 1, C.slateLo);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** A gravel switchyard: transformers in a row and a pylon or two. Structures go on `L`. */
function switchyard(p: Pixels, L: Pixels, x: number, y: number, w: number, h: number, seed: number): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px(p, xx, yy, hash2(xx, yy, seed) % 5 === 0 ? C.paveLo : C.pave);
  fence(p, x, y, w, h);
  for (let tx = x + 2; tx + 3 < x + w - 1; tx += 5) {
    rect(L, tx, y + h - 5, 3, 3, C.slate);
    hline(L, tx, tx + 2, y + h - 5, C.slateHi);
    px(L, tx + 1, y + h - 6, C.paveHi); // bushing
  }
  if (w >= 9) pylon(L, x + w - 7, y + 1);
}

/** A big block in 3/4 view: flat roof (with rooftop plant), front wall, windows, doors. */
function hall(L: Pixels, x: number, y: number, w: number, roofH: number, wallH: number, r: Ramp, wc: RGB, wl: RGB, seed: number): void {
  flat(L, x, y, w, roofH, r, seed);
  for (let hx = x + 2; hx + 3 < x + w - 1; hx += 7) if (hash2(hx, y, seed) % 2 === 0) hvac(L, hx, y + roofH - 3);
  wall(L, x, y + roofH, w, wallH, wc, wl);
}

// ── Power ──────────────────────────────────────────────────────────────────────────────────────────

export const coalPlant: Painter = (W, H, v) => {
  const p = lot(W, H, 'dirt', 240 + v);
  if (W < 32 || H < 32) {
    // compact: a boiler house and its stack beside a coal heap
    coalPile(p, W - 5, H - 2, 4, 240);
    const L = layer(p);
    hall(L, 1, 4, W - 6, 3, Math.max(4, H - 12), ROOF_SLATE, C.brickLo, C.ink, 24);
    windows(L, 2, 8, W - 9, 2, 3, 3, 2, 1);
    stack(L, W - 4, 0, H - 6, 2);
    place(p, L);
    return p;
  }
  fence(p, 0, 0, W, H);
  // the coal yard (back left) feeding the boiler house up a conveyor; a rail spur of hoppers in front
  const pileR = at(W * 0.17, 5, 12);
  coalPile(p, pileR + 3, at(H * 0.36, 8, H), pileR, 241 + v);
  coalPile(p, pileR * 2 + 2, at(H * 0.3, 7, H), at(pileR * 0.7, 3, 9), 242 + v);
  const railY = H - 6;
  hline(p, 1, W - 2, railY, C.paveHi);
  hline(p, 1, W - 2, railY + 3, C.paveHi);
  for (let x = 2; x < W - 2; x += 3) vline(p, x, railY, railY + 3, C.roofBrownLo);
  const Lr = layer(p);
  for (let hx = 3; hx + 6 < at(W * 0.62, 10, W); hx += 8) {
    rect(Lr, hx, railY - 1, 6, 4, C.asphaltLo); // hopper cars heaped with coal
    hline(Lr, hx, hx + 5, railY - 1, C.ink);
  }
  place(p, Lr);
  // boiler house (tall, back right) + its two banded stacks
  const bx = at(W * 0.46, 16, W - 18);
  const bw = at(W * 0.3, 12, W - bx - 6);
  const Lb = layer(p);
  const by = 6;
  hall(Lb, bx, by, bw, 5, at(H * 0.36, 10, H - 20), ROOF_SLATE, C.brickLo, C.ink, 241 + v);
  for (let wx = bx + 2; wx < bx + bw - 2; wx += 4) {
    rect(Lb, wx, by + 7, 2, at(H * 0.36, 10, H) - 5, C.glassLo); // tall boiler-house window strips
    px(Lb, wx, by + 7, C.glass);
  }
  conveyor(Lb, pileR + 4, at(H * 0.36, 8, H) - pileR, bx, by + 9);
  const sx = bx + bw + 2;
  stack(Lb, sx, 0, by + 16, 3);
  if (sx + 7 < W) stack(Lb, sx + 4, 1, by + 16, 3);
  place(p, Lb);
  // turbine hall (front, long and low)
  const Lt = layer(p);
  const ty = at(H * 0.56, 22, H - 16);
  hall(Lt, at(W * 0.35, 12, W), ty, at(W * 0.58, 16, W) - 2, 4, 6, CONCRETE, C.paveHi, C.pave, 243 + v);
  windows(Lt, at(W * 0.35, 12, W) + 1, ty + 5, at(W * 0.58, 16, W) - 5, 2, 4, 3, 2, 1);
  door(Lt, at(W * 0.35, 12, W) + 3, ty + 7, 3, 3);
  place(p, Lt);
  return p;
};

export const gasPlant: Painter = (W, H, v) => {
  const p = lot(W, H, 'pave', 250 + v);
  if (W < 32 || H < 32) {
    const L = layer(p);
    cylinder(L, 2, 4, 8, 9, TANK_WHITE);
    stack(L, W - 5, 0, H - 5, 2);
    place(p, L);
    pipeRun(p, [[10, H - 4], [W - 4, H - 4]], C.flower, C.gold);
    return p;
  }
  fence(p, 0, 0, W, H);
  // turbine hall (back left) with two heat-recovery boilers and their slim stacks (back right)
  const hallW = at(W * 0.5, 16, W - 18);
  const Lh = layer(p);
  hall(Lh, 2, 5, hallW, 5, 8, ROOF_SLATE, C.paveHi, C.pave, 251 + v);
  windows(Lh, 3, 11, hallW - 3, 1, 4, 3, 2, 1);
  for (let dx = 4; dx + 5 < hallW; dx += 10) {
    rect(Lh, dx, 14, 5, 4, C.slateLo); // roll-up doors
    hline(Lh, dx, dx + 4, 15, C.slate);
  }
  place(p, Lh);
  const Lb = layer(p);
  const hx = hallW + 4;
  for (let k = 0; k < 2 && hx + k * 9 + 7 < W - 1; k++) {
    const x = hx + k * 9;
    hall(Lb, x, 7, 7, 3, 9, STEEL, C.slateHi, C.slate, 252 + k);
    for (let yy = 11; yy < 18; yy += 2) hline(Lb, x + 1, x + 5, yy, C.slate); // boiler cladding ribs
    stack(Lb, x + 2, 0, 9, 2);
  }
  place(p, Lb);
  // the pipe rack: from the tank farm up to the turbine hall, routed around the units — never ruled across
  const rackY = at(H * 0.52, 24, H - 18);
  const rackEnd = at(W * 0.78, 20, W - 6);
  pipeRun(p, [[8, 20], [8, rackY], [rackEnd, rackY], [rackEnd, rackY + 6]], C.flower, C.gold); // hall ← spheres
  pipeRun(p, [[hx + 3, 19], [hx + 3, rackY]], C.flower, C.gold); // boilers tie into the rack
  // tank farm: storage cylinders (front left), Horton spheres (front right)
  const Lt = layer(p);
  const ty = rackY + 4;
  const cw = at(W * 0.17, 7, 10);
  for (let k = 0; k < 2; k++) cylinder(Lt, 2 + k * (cw + 2), ty, cw, at(H - ty - 3, 6, 14), TANK_WHITE);
  const sr = at(W * 0.09, 3, 6);
  for (let k = 0; k < 2; k++) sphere(Lt, at(W * 0.62, 18, W) + k * (sr * 2 + 3), H - sr - 5, sr);
  place(p, Lt);
  return p;
};

export const nuclearPlant: Painter = (W, H, v) => {
  const p = lot(W, H, 'pave', 270 + v);
  if (W < 32 || H < 32) {
    const L = layer(p);
    coolingTower(L, 1, 2, Math.min(W, H) - 4, Math.min(W, H) - 4);
    place(p, L);
    steam(p, W >> 1, 4, Math.min(W, H) >> 1, 270);
    return p;
  }
  // a lawn verge, the security fence, a staff car park along the front
  const lawnH = 3;
  rect(p, 0, H - lawnH, W, lawnH, C.grassMid);
  fence(p, 0, 0, W, H - lawnH);
  parkingLot(p, 2, H - lawnH - 10, at(W * 0.45, 12, W), 9, 271 + v);
  // two cooling towers (back left) with their steam
  const tw = at(W * 0.3, 14, 22);
  const th = at(H * 0.42, 16, 28);
  const L1 = layer(p);
  coolingTower(L1, 2, 4, tw, th);
  coolingTower(L1, tw + 4, 8, tw - 2, th - 3);
  place(p, L1);
  // containment building (back right): a drum under a hemispherical dome
  const L2 = layer(p);
  const dw = at(W * 0.28, 12, 20);
  const dx = W - dw - 4;
  const domeH = dw >> 1;
  const drumY = 5 + domeH;
  cylinder(L2, dx, drumY - 2, dw, at(H * 0.2, 9, 14), TANK_WHITE);
  for (let j = 0; j < domeH; j++) {
    const t = (domeH - j - 0.5) / domeH;
    const half = (dw / 2) * Math.sqrt(Math.max(0, 1 - t * t));
    const cx = dx + dw / 2;
    for (let xx = Math.ceil(cx - half); xx < cx + half; xx++) {
      const f = (xx - (cx - half)) / (2 * half);
      px(L2, xx, 5 + j, f < 0.3 && j < domeH - 1 ? C.line : f < 0.75 ? C.paveHi : C.pave);
    }
  }
  px(L2, dx + (dw >> 1), 5, C.signal); // aviation light on the dome
  place(p, L2);
  // the admin block among trees (middle left)
  const La = layer(p);
  const ay = at(H * 0.5, 26, H - 24);
  flat(La, 3, ay, at(W * 0.3, 12, 20), 3, ROOF_SLATE, 276 + v);
  wall(La, 3, ay + 3, at(W * 0.3, 12, 20), 5, C.cream, C.creamLo);
  windows(La, 4, ay + 4, at(W * 0.3, 12, 20) - 2, 2, 3, 3, 2, 1);
  place(p, La);
  for (let tx = 5; tx < at(W * 0.3, 12, 20) + 3; tx += 5) tree(p, tx, ay + 11, 2);
  const L3 = layer(p);
  const hy = at(H * 0.55, 30, H - 22);
  hall(L3, at(W * 0.48, 26, W), hy, W - at(W * 0.48, 26, W) - 3, 4, 7, CONCRETE, C.paveHi, C.pave, 272 + v);
  windows(L3, at(W * 0.48, 26, W) + 1, hy + 5, W - at(W * 0.48, 26, W) - 6, 1, 4, 3, 2, 1);
  switchyard(p, L3, at(W * 0.5, 26, W), H - lawnH - 11, W - at(W * 0.5, 26, W) - 2, 10, 273 + v);
  place(p, L3);
  steam(p, 2 + (tw >> 1), 3, tw, 274 + v);
  steam(p, tw + 4 + ((tw - 2) >> 1), 7, tw - 4, 275 + v);
  return p;
};

export const hydroPlant: Painter = (W, H, v) => {
  const p = lot(W, H, 'pave', 260 + v);
  // the reservoir behind the dam, with wavelets
  const resH = at(H * 0.28, 4, H);
  rect(p, 0, 0, W, resH, C.water);
  for (let k = 0; k < (W * resH) >> 4; k++) {
    const x = hash2(k, 0, 261 + v) % W;
    const y = hash2(k, 1, 261 + v) % resH;
    hline(p, x, x + 1, y, C.wave);
  }
  // the dam: a lit crest road, then the stepped face down to the powerhouse
  const L = layer(p);
  const crest = resH;
  rect(L, 0, crest, W, 2, C.paveHi);
  for (let x = 1; x < W; x += 4) px(L, x, crest, C.lineYellow); // crest-road lamps
  const faceH = at(H * 0.28, 4, H);
  for (let j = 0; j < faceH; j++) hline(L, 0, W - 1, crest + 2 + j, j % 3 === 2 ? C.paveLo : C.pave);
  // penstocks down the face into the powerhouse
  for (let x = 4; x + 2 < W - 3; x += Math.max(6, W >> 2)) {
    vline(L, x, crest + 2, crest + 2 + faceH, C.slate);
    vline(L, x + 1, crest + 2, crest + 2 + faceH, C.slateLo);
  }
  place(p, L);
  const Lp = layer(p);
  const py = crest + 2 + faceH;
  hall(Lp, 2, py, W - 6, 3, at(H * 0.18, 4, 8), CONCRETE, C.paveHi, C.pave, 262 + v);
  windows(Lp, 3, py + 4, W - 9, 1, 3, 3, 2, 1);
  if (W >= 32) pylon(Lp, W - 7, py - 6);
  place(p, Lp);
  // the tailrace: white water out of the outlets, settling downstream
  const tr = py + 3 + at(H * 0.18, 4, 8);
  rect(p, 0, tr, W, H - tr, C.waterShallow);
  for (let x = 0; x < W; x++) {
    if (hash2(x, tr, 263) % 3 !== 0) px(p, x, tr, C.foam);
    if (hash2(x, tr + 1, 263) % 4 === 0) px(p, x, tr + 1, C.wave);
  }
  return p;
};

// ── Industry ───────────────────────────────────────────────────────────────────────────────────────

export const industrial: Painter = (W, H, v) => {
  const p = lot(W, H, 'dirt', 210 + v);
  if (W < 32 || H < 32) {
    // a workshop: sawtooth shed, a loading door with a truck backed up, drums and a stub stack
    const L = layer(p);
    sawtooth(L, 1, 2, W - 5, 5);
    wall(L, 1, 7, W - 5, Math.max(4, H - 11), C.brick, C.brickLo);
    rect(L, 2, 8, 4, Math.max(2, H - 13), C.slateLo);
    hline(L, 2, 5, 8, C.slate);
    windows(L, 7, 8, W - 12, 1, 3, 3, 2, 1);
    stack(L, W - 4, 0, 6, 2);
    place(p, L);
    for (let bx = 2; bx < W - 3; bx += 4) px(p, bx, H - 2, C.roofBlue);
    return p;
  }
  fence(p, 0, 0, W, H);
  const warehouse = v % 2 === 1;
  const mainW = at(W * 0.72, 22, W - 6);
  const roofH = at(H * 0.34, 10, 20);
  const wallH = at(H * 0.2, 6, 12);
  const L = layer(p);
  if (warehouse) {
    hall(L, 2, 3, mainW, roofH, wallH, ROOF_SLATE, C.paveHi, C.pave, 211 + v);
    for (let sx = 5; sx + 4 < mainW; sx += 6) hline(L, sx, sx + 3, 3 + (roofH >> 1), C.glassLo); // skylights
  } else {
    sawtooth(L, 2, 3, mainW, roofH);
    wall(L, 2, 3 + roofH, mainW, wallH, C.brick, C.brickLo);
  }
  // loading docks along the front wall
  const dy = 3 + roofH + wallH - 5;
  for (let dx = 4; dx + 5 < mainW; dx += 8) {
    rect(L, dx, dy, 5, 4, C.slateLo);
    for (let yy = dy; yy < dy + 4; yy += 2) hline(L, dx, dx + 4, yy, C.slate);
  }
  windows(L, 3, 4 + roofH, mainW - 2, 1, 4, 3, 2, 1);
  place(p, L);
  // office annex (glass front) and silo / stack on the right
  const La = layer(p);
  const ax = 2 + mainW + 2;
  if (ax + 6 <= W - 2) {
    cylinder(La, ax, 4, W - ax - 2, at(H * 0.4, 10, 20), STEEL);
    if (!warehouse) stack(La, ax + 1, 0, 8, 2);
  }
  const oy = 3 + roofH + wallH + 2;
  flat(La, 3, oy, 10, 3, CONCRETE, 213);
  rect(La, 3, oy + 3, 10, 4, C.glassLo);
  for (let xx = 4; xx < 13; xx += 2) vline(La, xx, oy + 3, oy + 5, C.glass);
  door(La, 7, oy + 5, 2, 2);
  place(p, La);
  // the yard: trucks at the docks, stacked crates and drums
  const Ly = layer(p);
  for (let tx = 16; tx + 8 < W - 4; tx += 14) truck(Ly, tx, oy + 1, hash2(tx, v, 214) % 2 ? C.roofRed : C.roofBlue);
  for (let cx = W - 12; cx < W - 3; cx += 3) {
    rect(Ly, cx, H - 7, 2, 2, C.roofBrown); // crates
    px(Ly, cx, H - 7, C.roofBrownHi);
  }
  place(p, Ly);
  for (let bx = 4; bx < 16; bx += 2) px(p, bx, H - 3, bx % 4 ? C.roofBlue : C.signal); // drums
  return p;
};

// ── Commerce ───────────────────────────────────────────────────────────────────────────────────────

const AWNINGS: readonly RGB[] = [C.signal, C.roofBlue, C.leaf, C.gold, C.roofBrown, C.cyan];
const SIGNS: readonly RGB[] = [C.gold, C.cyan, C.signal, C.line, C.flower];

/** One shopfront `w` wide: its own sign band, striped awning, display glass and door. */
function shopfront(L: Pixels, x: number, y: number, w: number, seed: number): void {
  const awn = AWNINGS[seed % AWNINGS.length]!;
  hline(L, x, x + w - 1, y, SIGNS[(seed >> 3) % SIGNS.length]!); // sign band
  for (let i = 1; i < w - 1; i += 3) px(L, x + i, y, C.ink); // lettering
  for (let i = 0; i < w; i++) vline(L, x + i, y + 1, y + 2, ((i >> 1) & 1) === 0 ? awn : C.line);
  wall(L, x, y + 3, w, 5, C.cream, C.creamLo);
  rect(L, x + 1, y + 4, w - 2, 2, C.glass);
  px(L, x + 1, y + 4, C.glassHi);
  door(L, x + (w >> 1), y + 5, 2, 2);
  vline(L, x + w - 1, y, y + 7, C.creamLo); // party wall
}

export const commercial: Painter = (W, H, v) => {
  const p = lot(W, H, 'pave', 190 + v);
  const L = layer(p);
  const big = H >= 32;
  const roofH = big ? at(H * 0.22, 6, 12) : 4;
  const y = 1;
  flat(L, 1, y, W - 3, roofH, ROOF_SLATE, 19 + v);
  for (let hx = 3; hx + 3 < W - 3; hx += 7) hvac(L, hx, y + 1);
  // a row of distinct shops, one per tile (or per half tile on a big box front)
  const step = big ? T2(W) : 16;
  for (let sx = 1, k = 0; sx < W - 3; sx += step, k++) {
    shopfront(L, sx, y + roofH, Math.min(step, W - 3 - sx), hash2(k, v, 191) % 997);
  }
  place(p, L);
  // sidewalk + lamps along the frontage; a car park in front of a big store
  const walk = y + roofH + 9;
  rect(p, 0, walk, W, 2, C.paveHi);
  for (let lx = 3; lx < W; lx += 8) px(p, lx, walk, C.lineYellow);
  if (big && H - walk - 3 >= 5) parkingLot(p, 1, walk + 2, W - 2, H - walk - 3, 192 + v);
  else for (let sx = 2; sx < W - 2; sx += 5) if (hash2(sx, v, 193) % 2) {
    rect(p, sx, H - 3, 3, 2, CAR_BODIES[hash2(sx, v, 194) % CAR_BODIES.length]!); // kerbside cars
    px(p, sx + 2, H - 3, C.glassLo);
  }
  return p;
};

/** Shop width on a big-box front: half a tile per shop reads busier than one per tile. */
function T2(W: number): number {
  return W >= 48 ? 12 : 16;
}

export const offices: Painter = (W, H, v) => {
  const p = lot(W, H, 'pave', 200 + v);
  // a paved plaza with planters and a fountain
  for (let x = 2; x < W - 2; x += 6) for (let y = H - 4; y < H; y += 6) tree(p, x + 1, y + 1, 1);
  const stone = v % 2 === 1;
  if (W < 32 || H < 32) {
    const L = layer(p);
    flat(L, 2, 1, W - 5, 3, CONCRETE, 20);
    curtainWall(L, 2, 4, W - 5, H - 8, stone);
    place(p, L);
    return p;
  }
  // a low annex (back right) and the tower (front left) rising over it
  const La = layer(p);
  const ax = at(W * 0.58, 18, W - 10);
  flat(La, ax, 3, W - ax - 3, 3, CONCRETE, 201 + v);
  hvac(La, ax + 2, 3);
  wall(La, ax, 6, W - ax - 3, 9, stone ? C.cream : C.paveHi, stone ? C.creamLo : C.pave);
  windows(La, ax + 1, 7, W - ax - 5, 6, 3, 3, 2, 2);
  place(p, La);
  disc(p, ax + ((W - ax) >> 1), H - 9, 2, C.waterShallow); // fountain
  px(p, ax + ((W - ax) >> 1), H - 10, C.foam);
  const Lt = layer(p);
  const tw = at(W * 0.55, 14, W - 12);
  // penthouse + roof (with a helipad mark on the big ones), then the long curtain-wall facade
  flat(Lt, 2, 0, tw, 5, ROOF_SLATE, 202 + v);
  rect(Lt, 4, 1, 5, 3, C.slateHi);
  if (tw >= 16) {
    disc(Lt, tw - 4, 2, 1, C.line);
    px(Lt, tw - 4, 2, C.slate);
  }
  curtainWall(Lt, 2, 5, tw, H - 12, stone);
  // the lobby: a darker podium with a glazed entrance and canopy
  rect(Lt, 2, H - 9, tw, 3, C.slateLo);
  rect(Lt, 2 + (tw >> 1) - 3, H - 9, 6, 3, C.glass);
  hline(Lt, 2 + (tw >> 1) - 4, 2 + (tw >> 1) + 3, H - 10, C.slateHi);
  place(p, Lt);
  return p;
};

/** An office facade: glass curtain wall with mullions and floor lines, or stone with punched windows. */
function curtainWall(L: Pixels, x: number, y: number, w: number, h: number, stone: boolean): void {
  if (stone) {
    wall(L, x, y, w, h, C.cream, C.creamLo);
    windows(L, x + 1, y + 1, w - 2, h - 2, 3, 2, 2, 1);
    for (let xx = x; xx < x + w; xx += 6) vline(L, xx, y, y + h - 1, C.creamLo); // pilasters
    return;
  }
  rect(L, x, y, w, h, C.glassLo);
  for (let xx = x + 1; xx < x + w; xx += 2) vline(L, xx, y, y + h - 1, C.glass);
  for (let yy = y + 2; yy < y + h; yy += 3) hline(L, x, x + w - 1, yy, C.slateLo); // floor lines
  for (let j = 0; j < Math.min(h, 6); j++) px(L, x + 1 + j, y + j, C.glassHi); // a sky reflection
  vline(L, x + w - 1, y, y + h - 1, C.slateLo);
}
