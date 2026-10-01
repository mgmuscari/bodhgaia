import { describe, it, expect } from 'vitest';
import { createEconomy, stepEconomy, loanOffer, takeLoan, type CityReading, type Levers } from '../../src/economy/model';

// Taxes and loans (Maddy 2026-10-01: "once you go negative you can't dig back out"). A loan adds to the
// treasury now and is repaid hourly with interest over its term; the rate rises as approval falls (a
// city's credit tracks its standing), so debt is a reinforcing loop of its own.
const city: CityReading = {
  households: 1000, wellbeing: 0.5, landValue: 0.3, protectedShare: 0, base: { r: 1000, c: 300, i: 100 },
  upkeep: 100, tending: 0, socialInfra: 0, harms: { blackouts: 0, policeViolence: 0, takings: 0 }, repairs: 0,
};
const lev: Levers = { tax: { r: 0.07, c: 0.07, i: 0.07 }, police: 0, spendEffort: 0, spendFunds: 0 };

describe('loans', () => {
  it('borrowing adds the principal to the treasury and records the loan', () => {
    const s = createEconomy(-500); // already in the red: borrowing is the way out
    const offer = loanOffer(s, city, lev);
    expect(offer.limit).toBeGreaterThan(0);
    const next = takeLoan(s, offer, 5000)!;
    expect(next.funds).toBe(4500);
    expect(next.loans).toHaveLength(1);
  });

  it('is repaid hourly over its term, costing more than was borrowed, then gone', () => {
    let s = takeLoan(createEconomy(0), loanOffer(createEconomy(0), city, lev), 5000)!;
    const term = s.loans[0]!.hoursLeft;
    let paid = 0;
    const noLoanNet = stepEconomy(createEconomy(0), city, lev).funds; // the hour's net without the loan
    for (let h = 0; h < term; h++) {
      const before = s.funds;
      s = stepEconomy(s, city, lev);
      paid += noLoanNet - (s.funds - before);
    }
    expect(s.loans).toHaveLength(0);
    expect(paid).toBeGreaterThan(5000);
  });

  it('the rate rises as approval falls', () => {
    const liked = loanOffer({ ...createEconomy(0), approval: 75 }, city, lev);
    const disliked = loanOffer({ ...createEconomy(0), approval: 25 }, city, lev);
    expect(disliked.ratePerDay).toBeGreaterThan(liked.ratePerDay);
  });

  it('the credit limit scales with revenue and shrinks with what is already owed', () => {
    const s = createEconomy(0);
    const offer = loanOffer(s, city, lev);
    const richer = loanOffer(s, { ...city, base: { r: 3000, c: 900, i: 300 } }, lev);
    expect(richer.limit).toBeGreaterThan(offer.limit);
    const owing = takeLoan(s, offer, offer.limit / 2)!;
    expect(loanOffer(owing, city, lev).limit).toBeCloseTo(offer.limit / 2, 6);
  });

  it('refuses a loan over the limit', () => {
    const s = createEconomy(0);
    const offer = loanOffer(s, city, lev);
    expect(takeLoan(s, offer, offer.limit + 1)).toBeNull();
  });
});
