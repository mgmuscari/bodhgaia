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
    for (const [cx, shirt] of [[5, C.roofBlue], [11, C.signal]] as const) {
      disc(p, cx, 4, 2, C.cream); // head
      rect(p, cx - 2, 7, 5, 6, shirt); // body
      hline(p, cx - 2, cx + 2, 7, C.line);
    }
    rect(p, 6, 0, 4, 2, C.line); // a speech bubble between them
    px(p, 8, 2, C.line);
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
    glyph(p, 1, 1, [
      '......y.......',
      '.....yYy......',
      'yyyyyYYYyyyyy.',
      '.yYYYYYYYYYy..',
      '..yYYYoYYYy...',
      '...yYYYYYy....',
      '...yYYYYYy....',
      '..yYYyyyYYy...',
      '..yYy...yYy...',
      '.yy.......yy..',
    ], { y: C.gold, Y: C.flower, o: C.roofBlue });
  },
  coverage: (p) => {
    disc(p, 8, 8, 7, C.line);
    disc(p, 8, 8, 6, C.paveHi);
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
    line(p, 7, 11, 5, 15, C.slateLo); // striding legs
    line(p, 9, 11, 11, 15, C.slateLo);
  },
  help: (p) => {
    disc(p, 8, 8, 7, C.roofBlue);
    glyph(p, 5, 3, ['.www.', 'w...w', '....w', '...w.', '..w..', '.....', '..w..'], { w: C.line });
  },
  settings: (p) => {
    for (const [x, y] of [[7, 1], [7, 13], [1, 7], [13, 7], [3, 3], [11, 3], [3, 11], [11, 11]] as const) rect(p, x, y, 2, 2, C.slate);
    disc(p, 8, 8, 5, C.slateHi); // the gear
    disc(p, 8, 8, 2, C.ink);
    px(p, 6, 5, C.line);
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

function paintIcon(name: UiIcon): Pixels {
  const p = blank(16, 16);
  PAINT[name](p);
  outline(p, C.ink);
  return p;
}

/** Every UI icon as `@ui/<name>` → pixels. */
export function paintUiIcons(): Array<[string, Pixels]> {
  return UI_ICONS.map((n) => [`@ui/${n}`, paintIcon(n)]);
}
