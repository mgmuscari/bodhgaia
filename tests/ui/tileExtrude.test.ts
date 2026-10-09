// Maddy 2026-10-08 (photo, Windows on a 5K display at a fractional scale): a thin dark line along every tile edge,
// moving with the zoom. Chrome on Windows samples a hair past a small image's edge when it scales it by a fraction, and
// what lies there is not the tile. Every tile is drawn from inside a 1-px border that repeats its own edge, so the hair
// past the edge is the tile's own colour.
import { describe, expect, it } from 'vitest';
import { extrudeBlits, TILE_PAD } from '../../src/ui/tileExtrude';

/** Apply blits to a w×h image of distinct values, into a padded grid; return the padded grid. */
function apply(w: number, h: number): number[][] {
  const src = (x: number, y: number) => y * w + x + 1;
  const W = w + 2 * TILE_PAD;
  const H = h + 2 * TILE_PAD;
  const out = Array.from({ length: H }, () => new Array<number>(W).fill(0));
  for (const b of extrudeBlits(w, h)) {
    for (let j = 0; j < b.sh; j++) for (let i = 0; i < b.sw; i++) out[b.dy + j]![b.dx + i] = src(b.sx + i, b.sy + j);
  }
  return out;
}

describe('a tile is drawn from inside a border of its own edge pixels', () => {
  it('the inside is the tile, untouched; every border pixel repeats the nearest edge pixel; nothing is left empty', () => {
    const w = 16;
    const h = 16;
    const out = apply(w, h);
    const clamp = (v: number, n: number) => Math.min(n - 1, Math.max(0, v));
    for (let y = 0; y < h + 2; y++)
      for (let x = 0; x < w + 2; x++) {
        const sx = clamp(x - TILE_PAD, w);
        const sy = clamp(y - TILE_PAD, h);
        expect(out[y]![x], `(${x},${y})`).toBe(sy * w + sx + 1);
      }
  });
});
