import { describe, it, expect } from 'vitest';
import { clamp, clamp01, clampByte, floorClampByte } from '../../src/engine/clamp';

describe('clamp family (one home for every range clamp)', () => {
  it('clamp passes in-range values through and pins to the bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(12.5, 0, 10)).toBe(10);
    expect(clamp(0.25, 0, 1)).toBe(0.25); // fractions untouched
  });

  it('clamp01 is clamp to [0, 1]', () => {
    expect(clamp01(-0.1)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(1.7)).toBe(1);
  });

  it('clampByte pins to [0, 255] WITHOUT flooring (callers hand it integers)', () => {
    expect(clampByte(-1)).toBe(0);
    expect(clampByte(300)).toBe(255);
    expect(clampByte(128)).toBe(128);
    expect(clampByte(12.75)).toBe(12.75); // the no-floor variant: a fraction passes through
  });

  it('floorClampByte pins to [0, 255] AND floors in-range fractions', () => {
    expect(floorClampByte(-1)).toBe(0);
    expect(floorClampByte(300)).toBe(255);
    expect(floorClampByte(12.75)).toBe(12);
    expect(floorClampByte(254.999)).toBe(254);
  });

  it('both byte variants agree on every integer (only fractions differ)', () => {
    for (let v = -300; v <= 600; v++) expect(floorClampByte(v)).toBe(clampByte(v));
  });
});
