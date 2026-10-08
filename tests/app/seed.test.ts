import { describe, it, expect } from 'vitest';
import { randomSeed, chooseSeed, MIN_HOMES } from '../../src/app/seed';

describe('a new city’s seed', () => {
  it('is random: different draws give different seeds, in a safe charset', () => {
    let k = 0;
    const rand = () => ((k = (k * 9301 + 49297) % 233280) / 233280);
    const a = randomSeed(rand);
    const b = randomSeed(rand);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[a-z0-9-]+$/);
  });

  it(`takes the first seed whose city has at least ${MIN_HOMES} homes`, () => {
    const seeds = ['tiny', 'small', 'good', 'better'];
    let i = 0;
    const homes: Record<string, number> = { tiny: 40, small: MIN_HOMES - 1, good: MIN_HOMES, better: 900 };
    expect(chooseSeed(() => seeds[i++]!, (s) => homes[s]!)).toBe('good');
  });

  it('gives up after a few tries and keeps the last (a small city beats no city)', () => {
    let n = 0;
    expect(chooseSeed(() => `s${n++}`, () => 10, 5)).toBe('s4');
    expect(n).toBe(5);
  });
});
