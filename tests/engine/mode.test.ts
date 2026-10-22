// A city's mode (interdependence §10, Maddy 2026-10-21 "Sandbox + difficulty"): a difficulty — gentle, standard,
// hard — chosen at New city, scaling build costs, disaster rates and how much damage the history stage leaves; and
// sandbox: no money or effort limits, the whole tech tree open. Standard reproduces today's game exactly.
import { describe, it, expect } from 'vitest';
import { STANDARD_MODE, parseMode, scaleCost, disasterDraws, historyPct, type CityMode } from '../../src/engine/mode';

const m = (difficulty: CityMode['difficulty'], sandbox = false): CityMode => ({ difficulty, sandbox });

describe('city mode', () => {
  it('standard changes nothing', () => {
    expect(STANDARD_MODE).toEqual({ difficulty: 'standard', sandbox: false });
    for (const c of [0, 1, 7, 120, 5000]) expect(scaleCost(c, STANDARD_MODE)).toBe(c);
    for (let roll = 0; roll < 100; roll++) expect(disasterDraws(STANDARD_MODE, roll)).toBe(1);
    expect(historyPct(STANDARD_MODE)).toBe(100);
  });

  it('gentle costs less, draws fewer disasters, starts less damaged; hard the other way', () => {
    expect(scaleCost(100, m('gentle'))).toBeLessThan(100);
    expect(scaleCost(100, m('hard'))).toBeGreaterThan(100);
    const mean = (d: CityMode['difficulty']) => Array.from({ length: 100 }, (_, r) => disasterDraws(m(d), r)).reduce((a, b) => a + b, 0) / 100;
    expect(mean('gentle')).toBeLessThan(1);
    expect(mean('hard')).toBeGreaterThan(1);
    expect(historyPct(m('gentle'))).toBeLessThan(100);
    expect(historyPct(m('hard'))).toBeGreaterThan(100);
  });

  it('costs stay whole numbers, and a priced thing never becomes free', () => {
    for (const c of [1, 3, 17, 99]) {
      for (const d of ['gentle', 'hard'] as const) {
        expect(Number.isInteger(scaleCost(c, m(d)))).toBe(true);
        expect(scaleCost(c, m(d))).toBeGreaterThanOrEqual(1);
      }
    }
    expect(scaleCost(0, m('hard'))).toBe(0);
  });

  it('a sandbox keeps its difficulty\'s prices (its money never runs short instead, so sites still take their hours)', () => {
    expect(scaleCost(500, m('hard', true))).toBe(scaleCost(500, m('hard')));
  });

  it('disaster chances scale with difficulty, standard unchanged', async () => {
    const { disasterRatePct } = await import('../../src/engine/mode');
    expect(disasterRatePct(STANDARD_MODE)).toBe(100);
    expect(disasterRatePct(m('gentle'))).toBeLessThan(100);
    expect(disasterRatePct(m('hard'))).toBeGreaterThan(100);
  });

  it('reads a saved or stored mode, falling back to standard for anything else', () => {
    expect(parseMode({ difficulty: 'hard', sandbox: true })).toEqual({ difficulty: 'hard', sandbox: true });
    expect(parseMode(undefined)).toEqual(STANDARD_MODE);
    expect(parseMode({ difficulty: 'nightmare', sandbox: 'yes' })).toEqual(STANDARD_MODE);
    expect(parseMode({ difficulty: 'gentle' })).toEqual({ difficulty: 'gentle', sandbox: false });
  });
});
