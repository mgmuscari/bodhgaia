// Prayer flags (Maddy 2026-10-08: "tiny prayer flag strings, single pixel style"): a sagging string one art pixel
// thick, one-pixel flags hanging from it every other pixel in the five colours in order, fluttering.
import { describe, it, expect } from 'vitest';
import { prayerFlagPixels, FLAG_COLOURS } from '../../src/ui/prayerFlags';
import { C } from '../../src/ui/snesPalette';

describe('prayer flags', () => {
  const px = prayerFlagPixels(0, 0, 40, 0, 0);
  const string = px.filter((p) => p.kind === 'string');
  const flags = px.filter((p) => p.kind === 'flag');

  it('the five colours, in order — blue, white, red, green, yellow — from the palette', () => {
    expect(FLAG_COLOURS).toEqual([C.roofBlue, C.petal, C.signal, C.leaf, C.flower]);
    expect(flags.slice(0, 5).map((f) => f.colour)).toEqual([0, 1, 2, 3, 4]);
    expect(flags[5]!.colour).toBe(0);
  });

  it('one pixel each, every other pixel along the string, hanging just below it', () => {
    for (let i = 1; i < flags.length; i++) expect(flags[i]!.x - flags[i - 1]!.x).toBe(2);
    for (const f of flags) {
      const s = string.find((q) => q.x === f.x)!;
      expect(f.y - s.y).toBeGreaterThanOrEqual(1);
      expect(f.y - s.y).toBeLessThanOrEqual(2);
    }
  });

  it('the string sags in the middle', () => {
    const mid = string.find((q) => q.x === 20)!;
    expect(mid.y).toBeGreaterThan(string[0]!.y + 1);
  });

  it('flutters: every other flag is lifted, and the other half on the next frame — a ripple', () => {
    const lifted = (frame: number): boolean[] => {
      const all = prayerFlagPixels(0, 0, 40, 0, frame);
      return all.filter((p) => p.kind === 'flag').map((f) => f.y - all.find((q) => q.kind === 'string' && q.x === f.x)!.y === 1);
    };
    const a = lifted(0);
    const b = lifted(1);
    for (let i = 1; i < a.length; i++) expect(a[i]).toBe(!a[i - 1]); // alternate flags
    a.forEach((up, i) => expect(b[i]).toBe(!up)); // and they swap
  });
});
