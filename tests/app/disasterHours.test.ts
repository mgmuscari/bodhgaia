// Difficulty (Maddy 2026-10-21): crashes, violent crime and spills are drawn once a game hour — on gentle only in
// some hours, on hard twice in many. The count is drawn once per hour from its own stream.
import { describe, it, expect } from 'vitest';
import { createDisasterHours } from '../../src/app/disasterHours';
import { createRng } from '../../src/engine/rng';
import { STANDARD_MODE } from '../../src/engine/mode';

describe('disaster draws per hour', () => {
  it('standard: one draw every hour', () => {
    const d = createDisasterHours(STANDARD_MODE, createRng('d'));
    for (let h = 0; h < 50; h++) expect(d.draws(h)).toBe(1);
  });
  it('the same hour asked twice gives the same count', () => {
    const d = createDisasterHours({ difficulty: 'hard', sandbox: false }, createRng('d'));
    const a = d.draws(7);
    expect(d.draws(7)).toBe(a);
  });
  it('gentle skips hours, hard doubles some', () => {
    const total = (difficulty: 'gentle' | 'hard') => {
      const d = createDisasterHours({ difficulty, sandbox: false }, createRng('d'));
      let n = 0;
      for (let h = 0; h < 400; h++) n += d.draws(h);
      return n;
    };
    expect(total('gentle')).toBeLessThan(400);
    expect(total('hard')).toBeGreaterThan(400);
  });
});
