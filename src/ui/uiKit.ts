// The UI kit (PURE — pure-ui allowlist): the chrome every menu, panel and button is built from,
// painted from the same shared palette as the map so the interface reads as part of the pixel art, in
// the idiom of 16-bit console city-builders (Maddy 2026-09-30). Frames are tiny 9-slice images — outline, bevel, inner rim,
// fill — that the DOM shell (uiTheme.ts) serves as CSS border-images at a whole-pixel scale; theme
// variables give text and accents the same palette.

import { blank, px, type Pixels, type RGB } from './pixelArt';
import { C } from './snesPalette';

/** A frame image is FRAME_SIZE square; its corners (FRAME_SLICE square) stay put, the bands stretch. */
export const FRAME_SIZE = 12;
export const FRAME_SLICE = 4;

export const FRAME_KINDS = ['panel', 'title', 'button', 'buttonDown', 'inset', 'tooltip'] as const;
export type FrameKind = (typeof FRAME_KINDS)[number];

interface FrameStyle {
  outline: RGB;
  light: RGB; // the bevel's lit top/left edge
  dark: RGB; // its shaded bottom/right edge
  rim: RGB; // the inner rim line
  fill: RGB;
}

const BUTTON: FrameStyle = { outline: C.ink, light: C.line, dark: C.slate, rim: C.paveHi, fill: C.pave };

const STYLES: Record<FrameKind, FrameStyle> = {
  // deep-blue panels with a lit bevel, like the SNES city-builder's menus
  panel: { outline: C.ink, light: C.roofBlueHi, dark: C.ink, rim: C.roofBlue, fill: C.roofBlueLo },
  title: { outline: C.ink, light: C.glassHi, dark: C.roofBlueLo, rim: C.roofBlueHi, fill: C.roofBlue },
  button: BUTTON,
  buttonDown: { ...BUTTON, light: BUTTON.dark, dark: BUTTON.light, rim: C.pave, fill: C.paveLo },
  // a sunken well for readouts and the minimap
  inset: { outline: C.ink, light: C.ink, dark: C.roofBlue, rim: C.ink, fill: C.ink },
  tooltip: { outline: C.ink, light: C.cream, dark: C.creamLo, rim: C.cream, fill: C.cream },
};

/** Paint one 9-slice frame: ink outline with clipped corners, bevel, inner rim, fill. */
export function framePixels(kind: FrameKind): Pixels {
  const s = STYLES[kind];
  const N = FRAME_SIZE;
  const p = blank(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const corner = (x === 0 || x === N - 1) && (y === 0 || y === N - 1);
      if (corner) continue; // rounded: the outer corner pixel stays clear
      const d = Math.min(x, y, N - 1 - x, N - 1 - y);
      let c: RGB;
      if (d === 0) c = s.outline;
      else if (d === 1) {
        const shaded = y === N - 2 || x === N - 2; // bottom or right edge
        const lit = y === 1 || x === 1; // top or left edge
        c = shaded && lit ? s.rim : shaded ? s.dark : s.light; // the two mixed corners take the rim
      }
      else if (d === 2) c = s.rim;
      else c = s.fill;
      px(p, x, y, c);
    }
  }
  return p;
}

const css = (c: RGB): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

/** The UI colour roles as CSS custom properties, all from the shared palette. */
export function themeVars(): Record<string, string> {
  return {
    '--ui-ink': css(C.ink),
    '--ui-panel': css(C.roofBlueLo),
    '--ui-panel-hi': css(C.roofBlue),
    '--ui-text': css(C.cream),
    '--ui-text-dark': css(C.ink),
    '--ui-muted': css(C.slateHi),
    '--ui-accent': css(C.gold),
    '--ui-face': css(C.pave),
    '--ui-good': css(C.leafHi),
    '--ui-bad': css(C.signal),
    '--ui-water': css(C.water),
  };
}
