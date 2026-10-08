// Prayer flags (PURE — pure-ui allowlist; Maddy 2026-10-08: "tiny prayer flag strings, single pixel style"): the
// art pixels of one string of flags between two points (in art pixels): a string one pixel thick that sags in the
// middle, and a one-pixel flag hanging below it every other pixel in the five colours in order — blue, white, red,
// green, yellow — with alternate flags lifting a pixel on the flutter frame. Integer math only.

import { C } from './snesPalette';
import type { RGB } from './pixelArt';

export const FLAG_COLOURS: readonly RGB[] = [C.roofBlue, C.petal, C.signal, C.leaf, C.flower];
export const FLAG_STRING: RGB = C.paveHi; // light: the line must read against dark asphalt

export interface FlagPixel {
  x: number;
  y: number;
  kind: 'string' | 'flag';
  /** For a flag: its index into FLAG_COLOURS. */
  colour: number;
}

/** The pixels of a string of flags from (ax, ay) to (bx, by), art pixels; `frame` 0/1 flutters them. */
export function prayerFlagPixels(ax: number, ay: number, bx: number, by: number, frame: number): FlagPixel[] {
  const n = Math.max(1, Math.max(Math.abs(bx - ax), Math.abs(by - ay)));
  const sag = Math.max(1, Math.floor(n / 8)); // a gentle droop: an eighth of the span
  const out: FlagPixel[] = [];
  let flag = 0;
  for (let i = 0; i <= n; i++) {
    const x = ax + Math.round(((bx - ax) * i) / n);
    const y = ay + Math.round(((by - ay) * i) / n) + Math.round((4 * sag * i * (n - i)) / (n * n));
    out.push({ x, y, kind: 'string', colour: 0 });
    if (i % 2 === 1 && i < n) {
      const lift = (flag + frame) % 2 === 0 ? 0 : 1; // alternate flags catch the wind
      out.push({ x, y: y + 2 - lift, kind: 'flag', colour: flag % FLAG_COLOURS.length });
      flag++;
    }
  }
  return out;
}
