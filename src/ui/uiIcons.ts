// Pixel icons for the left tool palette (PURE — pure-ui allowlist), in the shared palette (Maddy
// 2026-09-30: "icons instead of text for buttons"). Build tools use their own game tiles as icons; these
// are the rest: the modes (inspect, bulldoze), the map toggles and the panels. 16×16, ink-outlined like
// the buildings, keyed `@ui/<name>`.

import { blank, disc, hline, outline, px, rect, vline, type Pixels, type RGB } from './pixelArt';
import { C } from './snesPalette';

export const UI_ICONS = [
  'inspect',
  'bulldoze',
  'transit',
  'tech',
  'eco',
  'civic',
  'redline',
  'police',
  'coverage',
  'power',
  'life',
  'help',
  'settings',
  'restore',
  'budget',
  'saves',
] as const;
export type UiIcon = (typeof UI_ICONS)[number];

/** Draw a glyph (rows of chars → colours; '.' is clear) at (ox, oy). */
function glyph(p: Pixels, ox: number, oy: number, rows: readonly string[], cols: Record<string, RGB>): void {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = cols[row[x]!];
      if (c) px(p, ox + x, oy + y, c);
    }
  });
}

/** A 1-px line by Bresenham (handles, spokes). */
function line(p: Pixels, x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    px(p, x0, y0, c);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

const PAINT: Record<UiIcon, (p: Pixels) => void> = {
  inspect: (p) => {
    for (let k = 0; k < 4; k++) {
      line(p, 9 + k, 10 + k, 10 + k, 10 + k, C.roofBrown); // the handle
      px(p, 10 + k, 11 + k, C.roofBrownLo);
    }
    disc(p, 6, 6, 5, C.slate); // the rim
    disc(p, 6, 6, 4, C.glass); // the lens
    disc(p, 5, 5, 1, C.glassHi);
  },
  bulldoze: (p) => {
    rect(p, 4, 5, 7, 5, C.gold); // body
    rect(p, 6, 2, 4, 3, C.flower); // cab
    rect(p, 7, 3, 2, 1, C.glass);
    rect(p, 1, 6, 2, 6, C.slateLo); // blade
    hline(p, 3, 4, 8, C.slate);
    rect(p, 3, 10, 10, 3, C.ink); // track
    for (let x = 4; x < 13; x += 2) px(p, x, 11, C.slate);
    vline(p, 12, 4, 7, C.slate); // exhaust
  },
  transit: (p) => {
    rect(p, 2, 3, 12, 8, C.leaf); // a streetcar
    hline(p, 2, 13, 3, C.leafHi);
    for (let x = 3; x < 13; x += 3) rect(p, x, 5, 2, 2, C.glass);
    rect(p, 2, 9, 12, 2, C.leafLo);
    disc(p, 4, 12, 1, C.ink);
    disc(p, 11, 12, 1, C.ink);
    hline(p, 7, 8, 1, C.slate); // pantograph
    vline(p, 8, 1, 2, C.slate);
  },
  tech: (p) => {
    rect(p, 4, 11, 8, 4, C.roofBrown); // a pot
    hline(p, 3, 12, 11, C.roofBrownHi);
    vline(p, 8, 4, 10, C.leafLo); // stem
    glyph(p, 3, 2, ['..ll.', '.lLLl', 'lLLl.', '.ll..'], { l: C.leaf, L: C.leafHi });
    glyph(p, 9, 4, ['.ll.', 'lLLl', '.lLl', '..l.'], { l: C.leaf, L: C.leafHi });
  },
  eco: (p) => {
    glyph(p, 2, 1, [
      '.........ll',
      '......lllLl',
      '....llLLLl.',
      '...lLLlLLl.',
      '..lLLlLLll.',
      '..lLlLLll..',
      '.lLlLLll...',
      '.llLll.....',
      '.lll.......',
      'll.........',
      'l..........',
    ], { l: C.leaf, L: C.leafHi });
    line(p, 2, 12, 11, 3, C.leafLo); // the vein
  },
  civic: (p) => {
    // two neighbours talking: each a head over a neck (the outline row between) over a body, a speech bubble
    // above and between them, clear of both heads
    for (const [ox, shirt] of [[1, C.roofBlue], [10, C.signal]] as const) {
      glyph(p, ox, 4, ['.hhh.', 'hhhhh', 'hhhhh', '.hhh.', '.....', 'sssss', 'sssss', 'sssss', 'sssss'], { h: C.cream, s: shirt });
    }
    glyph(p, 5, 1, ['lllll', '..l..'], { l: C.line }); // the bubble, its tail pointing down between them
  },
  redline: (p) => {
    rect(p, 2, 2, 12, 12, C.cream); // an old survey sheet
    for (let k = 3; k < 14; k += 4) {
      hline(p, 2, 13, k, C.creamLo);
      vline(p, k, 2, 13, C.creamLo);
    }
    for (let k = 4; k <= 11; k++) {
      px(p, k, 4, C.signal);
      px(p, k, 11, C.signal);
      px(p, 4, k, C.signal);
      px(p, 11, k, C.signal);
    }
    rect(p, 5, 5, 6, 6, C.roofRedLo); // the district drawn in red
  },
  police: (p) => {
    // a symmetric five-point badge: the top point as long as the arms
    glyph(p, 1, 1, [
      '......y......',
      '.....yYy.....',
      '.....yYy.....',
      'yyyyyYYYyyyyy',
      '.yYYYYYYYYYy.',
      '..yYYYoYYYy..',
      '...yYYYYYy...',
      '...yYYYYYy...',
      '..yYYyyyYYy..',
      '..yYy...yYy..',
      '.yy.......yy.',
    ], { y: C.gold, Y: C.flower, o: C.roofBlue });
  },
  coverage: (p) => {
    disc(p, 8, 8, 6, C.line);
    disc(p, 8, 8, 5, C.paveHi);
    rect(p, 6, 3, 4, 10, C.signal); // the cross
    rect(p, 3, 6, 10, 4, C.signal);
  },
  power: (p) => {
    glyph(p, 3, 0, [
      '.....yyyy',
      '....yYYy.',
      '...yYYy..',
      '..yYYy...',
      '.yYYYyyyy',
      'yyyyYYYy.',
      '...yYYy..',
      '..yYYy...',
      '..yYy....',
      '.yYy.....',
      '.yy......',
      'yy.......',
    ], { y: C.gold, Y: C.flower });
  },
  life: (p) => {
    disc(p, 8, 3, 2, C.cream); // head
    rect(p, 6, 6, 4, 5, C.roofBlue); // coat
    line(p, 6, 7, 3, 10, C.cream); // swinging arm
    line(p, 9, 7, 12, 9, C.cream);
    line(p, 7, 11, 5, 14, C.slateLo); // striding legs
    line(p, 9, 11, 11, 14, C.slateLo);
  },
  help: (p) => {
    disc(p, 8, 8, 6, C.roofBlue);
    glyph(p, 5, 4, ['.www.', 'w...w', '....w', '...w.', '..w..', '.....', '..w..'], { w: C.line });
  },
  settings: (p) => {
    // symmetric about the centre pixel (8, 8) and inside 2..14, so its outline is never clipped on one side:
    // eight teeth, 3-wide on the axes and 2×2 on the diagonals, round a body of radius 4 with a hub
    for (const [x, y, w, h] of [[7, 2, 3, 2], [7, 13, 3, 2], [2, 7, 2, 3], [13, 7, 2, 3], [4, 4, 2, 2], [11, 4, 2, 2], [4, 11, 2, 2], [11, 11, 2, 2]] as const) rect(p, x, y, w, h, C.slate);
    disc(p, 8, 8, 4, C.slateHi); // the gear
    disc(p, 8, 8, 1, C.ink); // the hub
    px(p, 6, 6, C.line); // a glint
  },
  budget: (p) => {
    disc(p, 8, 8, 6, C.roofBrown); // a gold coin, its rim
    disc(p, 8, 8, 5, C.gold);
    disc(p, 7, 7, 3, C.flower); // the shine
    glyph(p, 6, 4, ['.ww.', 'w...', '.ww.', '...w', 'www.'], { w: C.roofBrownLo }); // an S…
    vline(p, 7, 3, 9, C.roofBrownLo); // …struck through: $
  },
  saves: (p) => {
    rect(p, 2, 2, 12, 12, C.slate); // a floppy disk
    rect(p, 4, 2, 7, 5, C.slateHi); // its shutter…
    rect(p, 8, 3, 2, 3, C.ink); // …and window
    rect(p, 4, 9, 8, 4, C.cream); // the label
    hline(p, 5, 10, 6, C.creamLo);
  },
  restore: (p) => {
    rect(p, 2, 3, 12, 10, C.cream); // a chart, rising
    for (let x = 3; x < 13; x++) px(p, x, 11, C.creamLo);
    const ys = [9, 8, 9, 7, 6, 6, 5, 4, 4];
    ys.forEach((y, i) => {
      px(p, 3 + i, y, C.leafLo);
      px(p, 3 + i, y + 1, C.leaf);
    });
  },
};

/** Room around the 16-px art while it is outlined, so no outline pixel falls off an edge. */
const ROOM = 4;

/** An icon drawn with room to spare: the 16-px art at (ROOM, ROOM) on a larger canvas, outlined — nothing clipped. */
export function iconArt(name: UiIcon): Pixels {
  const art = blank(16, 16);
  PAINT[name](art);
  const big = blank(16 + 2 * ROOM, 16 + 2 * ROOM);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const i = (y * 16 + x) * 4;
    if (art.data[i + 3]) big.data.set(art.data.subarray(i, i + 4), ((y + ROOM) * big.w + x + ROOM) * 4);
  }
  outline(big, C.ink);
  return big;
}

/** The icon as the button shows it (Maddy 2026-10-08: "match the button drawable area"): the outlined drawing,
 *  whole and centred on the 16×16 canvas — however its painter placed it. */
function paintIcon(name: UiIcon): Pixels {
  const big = iconArt(name);
  let x0 = big.w, y0 = big.h, x1 = -1, y1 = -1;
  for (let y = 0; y < big.h; y++) for (let x = 0; x < big.w; x++) if (big.data[(y * big.w + x) * 4 + 3]) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const p = blank(16, 16);
  const ox = Math.floor((16 - (x1 - x0 + 1)) / 2) - x0;
  const oy = Math.floor((16 - (y1 - y0 + 1)) / 2) - y0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * big.w + x) * 4;
    if (big.data[i + 3] && x + ox >= 0 && y + oy >= 0 && x + ox < 16 && y + oy < 16) p.data.set(big.data.subarray(i, i + 4), ((y + oy) * 16 + x + ox) * 4);
  }
  return p;
}

/** Every UI icon as `@ui/<name>` → pixels. */
export function paintUiIcons(): Array<[string, Pixels]> {
  return UI_ICONS.map((n) => [`@ui/${n}`, paintIcon(n)]);
}
