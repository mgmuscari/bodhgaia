import { describe, it, expect } from 'vitest';
import { budgetView } from '../../src/ui/budgetContent';
import { createEconomy, loanOffer, takeLoan, type CityReading, type Levers } from '../../src/economy/model';

const city: CityReading = {
  households: 1000, wellbeing: 0.5, landValue: 0.3, protectedShare: 0, base: { r: 1000, c: 300, i: 100 },
  upkeep: 100, tending: 0, socialInfra: 0, harms: { blackouts: 0, policeViolence: 0, takings: 0 }, repairs: 0,
};
const lev: Levers = { tax: { r: 0.1, c: 0.05, i: 0.05 }, police: 4, spendEffort: 0, spendFunds: 0 };

describe('budgetView — the Budget window', () => {
  it('the hourly ledger: each class’s revenue at its rate, upkeep, police, and the net', () => {
    const v = budgetView(createEconomy(1000), city, lev);
    expect(v.classes.map((c) => c.perHour)).toEqual([100, 15, 5]);
    expect(v.revenue).toBe(120);
    expect(v.net).toBe(120 - 100 - 4);
  });

  it('loan payments count in the ledger and the outstanding loans are listed', () => {
    const s0 = createEconomy(0);
    const s = takeLoan(s0, loanOffer(s0, city, lev), 2000)!;
    const v = budgetView(s, city, lev);
    expect(v.repayments).toBeCloseTo(s.loans[0]!.payment, 9);
    expect(v.net).toBeCloseTo(120 - 100 - 4 - s.loans[0]!.payment, 9);
    expect(v.loans).toHaveLength(1);
  });

  it('borrow options are round amounts within the credit limit', () => {
    const v = budgetView(createEconomy(0), city, lev);
    expect(v.borrow.length).toBeGreaterThan(0);
    for (const a of v.borrow) expect(a).toBeLessThanOrEqual(v.offer.limit);
    expect(new Set(v.borrow).size).toBe(v.borrow.length);
  });
});

describe('the way out of debt, said plainly', () => {
  it('names the relief grant once it has come, and the ways still open', () => {
    expect(budgetView(createEconomy(0), city, lev).relief).toBeNull();
    const taken = budgetView({ ...createEconomy(0), reliefTaken: true }, city, lev);
    expect(taken.relief).toMatch(/once/);
    expect(budgetView(createEconomy(0), city, lev).waysOut.join(' ')).toMatch(/freeway/i);
  });
});
