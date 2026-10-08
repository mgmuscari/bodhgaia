import { describe, it, expect } from 'vitest';
import { createEconomy, stepEconomy, effortCapacity, effortRegen, taxRevenue, type CityReading, type Levers } from '../../src/economy/model';

// The economy's loops, pinned by direction (magnitudes are tuning data). Maddy 2026-09-30: model it on
// Donella Meadows / dynamical systems, not an effort counter that ticks up forever.
const city = (over: Partial<CityReading> = {}): CityReading => ({
  households: 400,
  wellbeing: 0.5,
  landValue: 0.4,
  protectedShare: 0,
  base: { r: 100, c: 50, i: 30 },
  upkeep: 5,
  tending: 0,
  socialInfra: 0,
  harms: { blackouts: 0, policeViolence: 0, takings: 0 },
  repairs: 0,
  ...over,
});
const lev = (over: Partial<Levers> = {}): Levers => ({ tax: { r: 0.07, c: 0.07, i: 0.07 }, police: 0, spendEffort: 0, spendFunds: 0, ...over });
const run = (n: number, c: CityReading, l: Levers, s = createEconomy()) => {
  for (let i = 0; i < n; i++) s = stepEconomy(s, c, l);
  return s;
};

describe('effort is a perishable, capped stock (not an endless counter)', () => {
  it('fills toward capacity and holds there when unspent', () => {
    const c = city();
    const s = run(2000, c, lev());
    expect(s.effort).toBeCloseTo(effortCapacity(c), 6);
    expect(run(100, c, lev(), s).effort).toBeCloseTo(effortCapacity(c), 6);
  });
  it('social infrastructure raises the capacity', () => {
    expect(effortCapacity(city({ socialInfra: 4 }))).toBeGreaterThan(effortCapacity(city()));
  });
  it('regenerates with households, wellbeing and trust, and less when burnt out', () => {
    const s = createEconomy();
    expect(effortRegen(city({ wellbeing: 0.8 }), s)).toBeGreaterThan(effortRegen(city({ wellbeing: 0.4 }), s));
    expect(effortRegen(city(), { ...s, goodwill: 90 })).toBeGreaterThan(effortRegen(city(), { ...s, goodwill: 20 }));
    expect(effortRegen(city(), { ...s, burnout: 0.5 })).toBeLessThan(effortRegen(city(), s));
  });
});

describe('burnout comes from running on empty, not from spending (limits to growth)', () => {
  it('spending a healthy reserve on a project burns no one out', () => {
    const c = city();
    const full = run(2000, c, lev());
    const after = stepEconomy(full, c, lev({ spendEffort: effortCapacity(c) * 0.5 }));
    expect(after.burnout).toBe(0);
  });
  it('tending more than regenerates, with the reserve gone, builds burnout — which then cuts regeneration', () => {
    const c = city({ tending: 50 });
    const s = run(200, c, lev());
    expect(s.burnout).toBeGreaterThan(0.3);
    expect(effortRegen(c, s)).toBeLessThan(effortRegen(c, createEconomy()));
  });
  it('rest heals it', () => {
    const tired = { ...createEconomy(), burnout: 0.5 };
    expect(run(100, city(), lev(), tired).burnout).toBeLessThan(0.5);
  });
});

describe('rent and displacement: a delayed loop that protection cuts', () => {
  it('rent moves toward land value gradually (a lag), not in one step', () => {
    const s0 = createEconomy();
    const s1 = stepEconomy(s0, city({ landValue: 1 }), lev());
    expect(s1.rent).toBeGreaterThan(s0.rent);
    // the target is 1 (land value 1, clamped); one hour closes only a small part of the 0.7 gap
    expect((s1.rent - s0.rent) / (1 - s0.rent)).toBeLessThan(0.1);
  });
  it('high land value with no protection displaces households over time; full protection displaces none', () => {
    const hot = city({ landValue: 1, wellbeing: 0.3 });
    expect(run(600, hot, lev()).displaced).toBeGreaterThan(0);
    expect(run(600, { ...hot, protectedShare: 1 }, lev()).displaced).toBe(0);
  });
  it('taxes pass through to rent', () => {
    const lo = run(400, city(), lev({ tax: { r: 0.02, c: 0.02, i: 0.02 } }));
    const hi = run(400, city(), lev({ tax: { r: 0.18, c: 0.18, i: 0.18 } }));
    expect(hi.rent).toBeGreaterThan(lo.rent);
  });
});

describe('goodwill is earned slowly and lost fast', () => {
  it('one taking costs more than ten repairs earn', () => {
    const s = createEconomy();
    const gain = stepEconomy(s, city({ repairs: 10 }), lev()).goodwill - s.goodwill;
    const loss = s.goodwill - stepEconomy(s, city({ harms: { blackouts: 0, policeViolence: 0, takings: 1 } }), lev()).goodwill;
    expect(loss).toBeGreaterThan(gain);
  });
  it('drifts back toward neutral when nothing happens', () => {
    expect(run(500, city(), lev(), { ...createEconomy(), goodwill: 90 }).goodwill).toBeLessThan(90);
    expect(run(500, city(), lev(), { ...createEconomy(), goodwill: 10 }).goodwill).toBeGreaterThan(10);
  });
});

describe('approval is a delayed perception', () => {
  it('closes only a small part of the gap each tick', () => {
    const s0 = { ...createEconomy(), approval: 0 };
    const s1 = stepEconomy(s0, city({ wellbeing: 1 }), lev());
    expect(s1.approval).toBeGreaterThan(0);
    expect(s1.approval).toBeLessThan(5);
  });
  it('heavier taxes lower where it settles', () => {
    const lo = run(1500, city(), lev({ tax: { r: 0.03, c: 0.03, i: 0.03 } }));
    const hi = run(1500, city(), lev({ tax: { r: 0.15, c: 0.15, i: 0.15 } }));
    expect(hi.approval).toBeLessThan(lo.approval);
  });
});

describe('funds: taxes in, upkeep and police out', () => {
  it('revenue scales with each class rate × base', () => {
    expect(taxRevenue(city(), lev({ tax: { r: 0.1, c: 0, i: 0 } }))).toBeCloseTo(10, 9);
  });
  it('police spending drains the treasury and costs goodwill', () => {
    const none = run(100, city(), lev());
    const heavy = run(100, city(), lev({ police: 5 }));
    expect(heavy.funds).toBeLessThan(none.funds);
    expect(heavy.goodwill).toBeLessThan(none.goodwill);
  });
});

describe('goodwill shock — the part the city applies to civic trust (one trust stock, not two)', () => {
  it('a taking is a negative shock; a quiet hour is none', () => {
    const s = createEconomy();
    expect(stepEconomy(s, city({ harms: { blackouts: 0, policeViolence: 0, takings: 1 } }), lev()).shock).toBeLessThan(0);
    expect(stepEconomy(s, city(), lev()).shock).toBe(0);
  });
  it('excludes the drift toward neutral (civic trust has its own dynamics)', () => {
    const high = { ...createEconomy(), goodwill: 90 };
    expect(stepEconomy(high, city(), lev()).shock).toBe(0);
  });
});

describe('the practices in the model', () => {
  it('Participatory Budgeting: taxes cost half the approval', () => {
    const taxed = lev({ tax: { r: 0.15, c: 0.15, i: 0.15 } });
    const plain = run(200, city(), taxed);
    const budgeted = run(200, city({ taxPainMul: 0.5 }), taxed);
    expect(budgeted.approval).toBeGreaterThan(plain.approval);
    // and exactly neutral at ×1
    expect(run(50, city({ taxPainMul: 1 }), taxed)).toEqual(run(50, city(), taxed));
  });

  it('Shared Table: burnout heals twice as fast', () => {
    const tired = { ...createEconomy(), burnout: 0.5 };
    const a = stepEconomy(tired, city(), lev());
    const b = stepEconomy(tired, city({ burnoutHealMul: 2 }), lev());
    expect(0.5 - b.burnout).toBeCloseTo(2 * (0.5 - a.burnout), 9);
  });
});

describe('effort regeneration counts the communes twice', () => {
  it('regen follows regenHouseholds when given', () => {
    const s = createEconomy();
    expect(effortRegen(city({ regenHouseholds: 800 }), s)).toBeCloseTo(2 * effortRegen(city(), s), 9);
  });
});
