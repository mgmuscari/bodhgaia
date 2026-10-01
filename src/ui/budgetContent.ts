// The Budget window's content (PURE — pure-ui allowlist): the hourly ledger — each tax class's revenue at
// its rate, upkeep, police, loan repayments and the net — plus the loans being repaid and what the city could
// borrow now (Maddy 2026-10-01: "we need taxes and loans, once you go negative you can't dig back out").

import { loanOffer, type CityReading, type EconomyState, type Levers, type Loan, type LoanOffer } from '../economy/model';

export interface BudgetView {
  classes: Array<{ id: 'r' | 'c' | 'i'; label: string; rate: number; perHour: number }>;
  revenue: number;
  upkeep: number;
  police: number;
  repayments: number;
  net: number;
  loans: Loan[];
  offer: LoanOffer;
  /** Round sums the city could borrow now (within the limit). */
  borrow: number[];
}

const CLASSES = [
  ['r', 'Residential'],
  ['c', 'Commercial'],
  ['i', 'Industrial'],
] as const;

export function budgetView(s: EconomyState, city: CityReading, lev: Levers): BudgetView {
  const classes = CLASSES.map(([id, label]) => ({ id, label, rate: lev.tax[id], perHour: city.base[id] * lev.tax[id] }));
  const revenue = classes.reduce((sum, c) => sum + c.perHour, 0);
  const repayments = s.loans.reduce((sum, l) => sum + l.payment, 0);
  const offer = loanOffer(s, city, lev);
  const round = (v: number): number => Math.floor(v / 1000) * 1000;
  const borrow = [...new Set([5000, 10000, 25000, round(offer.limit)].filter((a) => a >= 1000 && a <= offer.limit))].sort((a, b) => a - b);
  return {
    classes,
    revenue,
    upkeep: city.upkeep,
    police: lev.police,
    repayments,
    net: revenue - city.upkeep - lev.police - repayments,
    loans: s.loans,
    offer,
    borrow,
  };
}
