import { describe, it, expect } from 'vitest';
import { createEconomy, type CityReading } from '../../src/economy/model';
import { economyHour, practiceProject, practiceTerms, DEFAULT_LEVERS, type EconomyRun } from '../../src/economy/run';
import { startProject } from '../../src/economy/projects';

const city = (over: Partial<CityReading> = {}): CityReading => ({
  households: 1000, wellbeing: 0.5, landValue: 0.3, protectedShare: 0, base: { r: 1000, c: 300, i: 100 },
  upkeep: 50, tending: 0, socialInfra: 2, harms: { blackouts: 0, policeViolence: 0, takings: 0 }, repairs: 0, ...over,
});

describe('economyHour — one in-game hour of the economy', () => {
  it('projects draw their share, then the stocks step (taxes in, upkeep and project funds out)', () => {
    const run: EconomyRun = { state: { ...createEconomy(5000), effort: 500 }, projects: [startProject({ id: 'p', label: 'P', effort: 24, funds: 240, hours: 24, payload: null })], levers: DEFAULT_LEVERS };
    const { run: next, completed } = economyHour(run, city());
    expect(completed).toEqual([]);
    expect(next.projects[0]!.done).toBe(1);
    const revenue = 1000 * 0.07 + 300 * 0.07 + 100 * 0.07;
    expect(next.state.funds).toBeCloseTo(5000 + revenue - 50 - 10, 6);
  });

  it('a practice completes after its hours when staffed and funded', () => {
    let run: EconomyRun = { state: { ...createEconomy(1e6), effort: 1e4 }, projects: [practiceProject({ id: 'walkable-streets', name: 'Walkable Streets', cost: 10 })], levers: DEFAULT_LEVERS };
    const hours = run.projects[0]!.hours;
    let done: string[] = [];
    for (let h = 0; h < hours; h++) {
      const r = economyHour(run, city({ households: 100000 })); // plenty of effort regenerating
      run = r.run;
      done = done.concat(r.completed.map((p) => p.id));
    }
    expect(done).toEqual(['walkable-streets']);
  });

  it('a practice costs money once to begin, then effort over its days (Maddy 2026-10-07)', () => {
    const cheap = practiceTerms({ cost: 10 });
    const deep = practiceTerms({ cost: 80 });
    expect(cheap.upfront).toBeGreaterThan(0);
    expect(cheap.effort).toBeGreaterThan(0);
    expect(deep.upfront).toBeGreaterThan(cheap.upfront);
    expect(deep.effort).toBeGreaterThan(cheap.effort);
    expect(deep.hours).toBeGreaterThan(cheap.hours);
    // the project the work runs as draws effort only — the money was paid at the start
    const p = practiceProject({ id: 'a', name: 'A', cost: 10 });
    expect(p.funds).toBe(0);
    expect(p.effort).toBe(cheap.effort);
    expect(p.hours).toBe(cheap.hours);
  });
});
