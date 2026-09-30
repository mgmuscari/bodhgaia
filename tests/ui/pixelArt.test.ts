import { describe, it, expect } from 'vitest';
import { blank, blit, disc, fill, outline, rect, slice, getPx, hash2, dither } from '../../src/ui/pixelArt';

const RED = [200, 40, 40] as const;
const INK = [16, 16, 24] as const;

describe('pixelArt primitives', () => {
  it('blank is fully transparent at the requested size', () => {
    const p = blank(4, 3);
    expect(p.w).toBe(4);
    expect(p.h).toBe(3);
    expect(p.data.length).toBe(4 * 3 * 4);
    expect(p.data.every((v) => v === 0)).toBe(true);
  });

  it('fill + rect write opaque RGB, clipped to the buffer', () => {
    const p = blank(4, 4);
    rect(p, 2, 2, 5, 5, RED); // overhangs the edge — must clip, not throw
    expect(getPx(p, 3, 3)).toEqual([200, 40, 40, 255]);
    expect(getPx(p, 1, 1)).toEqual([0, 0, 0, 0]);
    fill(p, INK);
    expect(getPx(p, 0, 0)).toEqual([16, 16, 24, 255]);
  });

  it('disc is symmetric about its centre (integer circle, no transcendental Math)', () => {
    const p = blank(9, 9);
    disc(p, 4, 4, 3, RED);
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        expect(getPx(p, x, y)[3], `(${x},${y}) vs mirror`).toBe(getPx(p, 8 - x, y)[3]);
        expect(getPx(p, x, y)[3]).toBe(getPx(p, x, 8 - y)[3]);
      }
    }
    expect(getPx(p, 4, 4)[3]).toBe(255);
    expect(getPx(p, 0, 0)[3]).toBe(0);
  });

  it('outline inks only transparent pixels 4-adjacent to opaque ones', () => {
    const p = blank(5, 5);
    rect(p, 2, 2, 1, 1, RED);
    outline(p, INK);
    expect(getPx(p, 2, 2)).toEqual([200, 40, 40, 255]); // interior untouched
    for (const [x, y] of [[1, 2], [3, 2], [2, 1], [2, 3]]) expect(getPx(p, x!, y!)).toEqual([16, 16, 24, 255]);
    expect(getPx(p, 1, 1)[3]).toBe(0); // diagonal stays clear (4-adjacency)
  });

  it('blit composites with binary alpha (transparent source pixels keep the destination)', () => {
    const dst = blank(3, 3);
    fill(dst, INK);
    const src = blank(2, 2);
    rect(src, 0, 0, 1, 1, RED);
    blit(dst, src, 1, 1);
    expect(getPx(dst, 1, 1)).toEqual([200, 40, 40, 255]);
    expect(getPx(dst, 2, 2)).toEqual([16, 16, 24, 255]);
  });

  it('slice cuts one cell of a multi-tile image', () => {
    const p = blank(32, 16);
    rect(p, 16, 0, 16, 16, RED);
    const right = slice(p, 1, 0, 16);
    expect(right.w).toBe(16);
    expect(getPx(right, 0, 0)).toEqual([200, 40, 40, 255]);
    expect(getPx(slice(p, 0, 0, 16), 0, 0)[3]).toBe(0);
  });

  it('dither density 0 paints nothing and 16 paints the whole rect', () => {
    const p = blank(4, 4);
    dither(p, 0, 0, 4, 4, RED, 0);
    expect(p.data.every((v) => v === 0)).toBe(true);
    dither(p, 0, 0, 4, 4, RED, 16);
    for (let i = 3; i < p.data.length; i += 4) expect(p.data[i]).toBe(255);
  });

  it('hash2 is deterministic and spreads neighbours', () => {
    expect(hash2(3, 4, 1)).toBe(hash2(3, 4, 1));
    expect(hash2(3, 4, 1)).not.toBe(hash2(4, 4, 1));
    expect(hash2(3, 4, 1)).not.toBe(hash2(3, 4, 2));
    expect(hash2(3, 4, 1)).toBeGreaterThanOrEqual(0);
  });
});
