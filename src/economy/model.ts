// The city economy as a stock-and-flow system (Donella Meadows, "Thinking in Systems"; Maddy 2026-09-30:
// "the community effort that just ticks up endlessly doesn't make an engaging gameplay loop"). Headless and
// pure: no DOM, no rng, no transcendental Math; the city hands in a few aggregate readings each economy tick
// and the player's levers, and gets back the next state. Time unit: one economy tick = one in-game hour.
//
// STOCKS (what accumulates)
//   funds      money in the treasury
//   effort     neighbours' organised time on hand — PERISHABLE: it fills toward a capacity and the excess is
//              simply not there (time unspent is time lived, not banked)
//   burnout    accumulated overwork, 0..1 — rises when the commons is asked for more than it regenerates
//              while its reserve is nearly gone (running on empty), heals slowly, and throttles
//              regeneration (a delay that makes over-extension overshoot)
//   goodwill   the city's trust in its government, 0..100 — earned slowly, lost fast
//   approval   the public's PERCEIVED performance, 0..100 — a first-order delay of what is actually happening
//   rent       the rent level households face, 0..1 — follows land value with a lag, unless land is protected
//
// LOOPS (what they make the game about)
//   R1 commons:      wellbeing → effort → commons works → wellbeing                      (reinforcing)
//   B1 limits:       commons works → tending upkeep → less free effort; overdraw → burnout (balancing, delayed)
//   R2 land value:   amenities → land value → tax base → funds → amenities                (reinforcing)
//   B2 displacement: land value → rent → displacement → unhoused → goodwill↓ wellbeing↓   (balancing, delayed)
//                    — protected housing (land trusts, co-ops) cuts rent off from land value
//   B3 tax burden:   tax rates → approval↓ and rents↑ (pass-through)
//   shifting the burden: police spending buys a quick approval bump and costs goodwill, which slows effort
//
// All magnitudes are TUNING DATA; the tested contract is the directional behaviour of each loop.

import { clamp } from '../engine/clamp';

/** What the city reports each economy tick (aggregates the sim already computes). */
export interface CityReading {
  /** Housed households (occupancy). */
  households: number;
  /** Wellbeing, normalised 0..1. */
  wellbeing: number;
  /** Mean land value, normalised 0..1. */
  landValue: number;
  /** Share of homes on protected land (land trust, co-op, commune), 0..1. */
  protectedShare: number;
  /** The assessed tax base per class (money). */
  base: { r: number; c: number; i: number };
  /** Money upkeep of the built fabric per tick (roads, transit, plants, services). */
  upkeep: number;
  /** Effort upkeep per tick of the commons (gardens, parklets, healing commons… need tending). */
  tending: number;
  /** Social infrastructure that lets neighbours organise (gathering places, circles), ≥ 0. */
  socialInfra: number;
  /** Harms this tick, each ≥ 0: blackout-hours, police-violence incidents, takings. */
  harms: { blackouts: number; policeViolence: number; takings: number };
  /** Repairs this tick (things the government fixed or delivered), ≥ 0. */
  repairs: number;
  /** Practices: multipliers on how much taxes weigh on approval, and on burnout's recovery (absent ⇒ 1). */
  taxPainMul?: number;
  burnoutHealMul?: number;
}

/** The player's levers. */
export interface Levers {
  /** Tax rates per class, 0..0.2. */
  tax: { r: number; c: number; i: number };
  /** Police budget per tick (money). */
  police: number;
  /** Effort the player commits to projects this tick (≤ what is on hand). */
  spendEffort: number;
  /** Money the player commits to projects this tick (≤ funds). */
  spendFunds: number;
}

/** A loan: repaid hourly over its term — the principal plus flat interest, in equal payments. */
export interface Loan {
  principal: number;
  ratePerDay: number;
  /** Money out each hour until it's repaid. */
  payment: number;
  hoursLeft: number;
  /** Principal still owed (falls evenly with the payments) — what counts against the credit limit. */
  principalLeft: number;
}

/** What the city can borrow right now, and on what terms. */
export interface LoanOffer {
  limit: number;
  ratePerDay: number;
  hours: number;
}

export interface EconomyState {
  funds: number;
  /** Loans being repaid. */
  loans: Loan[];
  effort: number;
  burnout: number;
  goodwill: number;
  approval: number;
  rent: number;
  /** Households displaced so far (feeds the unhoused count). */
  displaced: number;
  /** This hour's goodwill SHOCK — repairs, harms, displacement, police — without the drift toward neutral.
   *  The running city applies it to civic trust, which owns goodwill's slower dynamics. */
  shock: number;
  /** The one-time relief grant has been drawn (see ECON.reliefDays). */
  reliefTaken: boolean;
  tick: number;
}

/** Rates and shapes — tuning data. */
export const ECON = {
  /** Relief grant (Maddy 2026-10-01): the first hour the treasury goes under, this many days of upkeep
   *  arrive once from outside — under a receivership whose oversight costs this much approval. */
  reliefDays: 3,
  reliefApproval: 8,
  /** Effort regenerated per household per tick at full wellbeing, trust and rest. */
  regenPerHousehold: 0.02,
  /** Effort capacity: a base per household, multiplied up by social infrastructure. */
  capPerHousehold: 0.6,
  capPerInfra: 0.15,
  /** Burnout gain per unit of overdraw (demand beyond regeneration), and its slow recovery per tick. */
  burnoutGain: 0.004,
  burnoutHeal: 0.002,
  /** Goodwill: slow drift toward neutral, gain per repair, loss per harm (losses outweigh gains). */
  goodwillNeutral: 50,
  goodwillDrift: 0.01,
  goodwillPerRepair: 0.4,
  goodwillPerBlackout: 0.6,
  goodwillPerViolence: 1.5,
  goodwillPerTaking: 8,
  goodwillPerDisplaced: 0.25,
  /** Approval: the perceived level closes this fraction of the gap to the actual each tick (a ~2-day delay). */
  approvalLag: 0.02,
  /** How strongly taxes weigh on approval (per unit of average rate). */
  taxPain: 1.2,
  /** Police spending's quick approval lift (per money/tick, capped) — and its goodwill cost. */
  policeLift: 0.004,
  policeLiftCap: 8,
  policeGoodwillCost: 0.002,
  /** Rent follows unprotected land value (plus tax pass-through) closing this fraction per tick. */
  rentLag: 0.01,
  taxPassThrough: 0.8,
  /** Displacement per household per tick for each unit rent exceeds what wellbeing-backed income bears. */
  displaceRate: 0.002,
  /** Loans: repaid over this many days; the city may owe up to this many days of revenue; the daily rate
   *  runs from loanRateBest (full approval) up by loanRateSpread as approval falls to nothing. A 20-day term
   *  (was 5 — Maddy 2026-10-01: repayments outran her whole surplus): a full credit line costs ≤ ~⅙ of
   *  revenue an hour, 4–20% interest over the term. */
  loanDays: 20,
  creditDays: 3,
  loanRateBest: 0.002,
  loanRateSpread: 0.008,
} as const;

export function createEconomy(funds = 2000): EconomyState {
  return { funds, loans: [], effort: 0, burnout: 0, goodwill: ECON.goodwillNeutral, approval: 50, rent: 0.3, displaced: 0, shock: 0, reliefTaken: false, tick: 0 };
}

/** Effort capacity: how much organised time the city can hold at once. */
export function effortCapacity(city: CityReading): number {
  return city.households * ECON.capPerHousehold * (1 + ECON.capPerInfra * city.socialInfra);
}

/** Effort regenerated this tick: households × wellbeing × trust × (1 − burnout). */
export function effortRegen(city: CityReading, s: EconomyState): number {
  const trust = 0.4 + 0.6 * (s.goodwill / 100); // a distrusted government still gets some help
  return city.households * ECON.regenPerHousehold * city.wellbeing * trust * (1 - s.burnout);
}

/** Money in this tick: each class's base × its rate. */
export function taxRevenue(city: CityReading, lev: Levers): number {
  return city.base.r * lev.tax.r + city.base.c * lev.tax.c + city.base.i * lev.tax.i;
}

/** What the city may borrow now: a credit limit of a few days' revenue less what it still owes, at a rate
 *  that rises as approval falls — a city's credit tracks its standing. */
export function loanOffer(s: EconomyState, city: CityReading, lev: Levers): LoanOffer {
  const owed = s.loans.reduce((sum, l) => sum + l.principalLeft, 0);
  const limit = Math.max(0, taxRevenue(city, lev) * 24 * ECON.creditDays - owed);
  const ratePerDay = ECON.loanRateBest + ECON.loanRateSpread * (1 - clamp(s.approval, 0, 100) / 100);
  return { limit, ratePerDay, hours: ECON.loanDays * 24 };
}

/** Borrow `amount` on `offer`'s terms: the treasury gets it now; null if it's over the limit or not positive. */
export function takeLoan(s: EconomyState, offer: LoanOffer, amount: number): EconomyState | null {
  if (!(amount > 0) || amount > offer.limit + 1e-9) return null;
  const total = amount * (1 + offer.ratePerDay * (offer.hours / 24));
  const loan: Loan = { principal: amount, ratePerDay: offer.ratePerDay, payment: total / offer.hours, hoursLeft: offer.hours, principalLeft: amount };
  return { ...s, funds: s.funds + amount, loans: [...s.loans, loan] };
}

/** One economy tick. Pure: returns the next state, never mutates `s`. */
export function stepEconomy(s: EconomyState, city: CityReading, lev: Levers): EconomyState {
  // ── Funds: taxes in; upkeep, police and projects out (it can go negative: debt, with consequences elsewhere)
  // loan payments come due every hour, whether or not the treasury is in the red
  const repayments = s.loans.reduce((sum, l) => sum + l.payment, 0);
  const loans = s.loans
    .map((l) => ({ ...l, hoursLeft: l.hoursLeft - 1, principalLeft: Math.max(0, l.principalLeft - l.principal / (ECON.loanDays * 24)) }))
    .filter((l) => l.hoursLeft > 0);
  let funds =
    s.funds + taxRevenue(city, lev) - city.upkeep - lev.police - repayments - Math.min(lev.spendFunds, Math.max(0, s.funds));
  const relief = funds < 0 && !s.reliefTaken;
  if (relief) funds += ECON.reliefDays * 24 * city.upkeep;

  // ── Effort: regenerate, pay the commons' tending first, then projects; capped (perishable)
  const regen = effortRegen(city, s);
  const demand = city.tending + lev.spendEffort;
  const available = s.effort + regen;
  const cap = effortCapacity(city);
  const effort = clamp(available - demand, 0, cap);
  // Burnout comes from running on EMPTY, not from spending: drawing a saved reserve down for a project is
  // people giving time they had. Asking for more than regenerates while the reserve is nearly gone (the
  // buffer below a fifth of capacity) is what wears neighbours out; a healthy buffer lets them recover.
  const overdraw = Math.max(0, demand - regen);
  const stretched = effort < 0.2 * cap && overdraw > 0;
  const burnout = clamp(s.burnout + (stretched ? ECON.burnoutGain * overdraw : -ECON.burnoutHeal * (city.burnoutHealMul ?? 1)), 0, 0.9);

  // ── Rent and displacement: rent chases unprotected land value (+ the tax that landlords pass on)
  const avgTax = (lev.tax.r + lev.tax.c + lev.tax.i) / 3;
  const rentTarget = clamp(city.landValue * (1 - city.protectedShare) + ECON.taxPassThrough * avgTax, 0, 1);
  const rent = s.rent + (rentTarget - s.rent) * ECON.rentLag;
  const bearable = 0.25 + 0.5 * city.wellbeing; // what households' means (tracked by wellbeing) can carry
  const displacedNow = city.households * (1 - city.protectedShare) * ECON.displaceRate * Math.max(0, rent - bearable);

  // ── Goodwill: slow drift home, slow gains, fast losses
  const shock =
    ECON.goodwillPerRepair * city.repairs -
    ECON.goodwillPerBlackout * city.harms.blackouts -
    ECON.goodwillPerViolence * city.harms.policeViolence -
    ECON.goodwillPerTaking * city.harms.takings -
    ECON.goodwillPerDisplaced * displacedNow -
    ECON.policeGoodwillCost * lev.police;
  const goodwill = clamp(s.goodwill + (ECON.goodwillNeutral - s.goodwill) * ECON.goodwillDrift + shock, 0, 100);

  // ── Approval: perceived performance, a delayed read of wellbeing, goodwill, tax pain and the police bump
  // a neutral city (wellbeing ½, goodwill neutral, modest taxes) reads about 50
  const actual = clamp(
    30 + 40 * city.wellbeing + 0.4 * (goodwill - ECON.goodwillNeutral) - 100 * ECON.taxPain * (city.taxPainMul ?? 1) * avgTax + Math.min(ECON.policeLiftCap, ECON.policeLift * lev.police * 100),
    0,
    100,
  );
  const approval = s.approval + (actual - s.approval) * ECON.approvalLag - (relief ? ECON.reliefApproval : 0);

  return {
    funds,
    loans,
    effort,
    burnout,
    goodwill,
    approval,
    rent,
    displaced: s.displaced + displacedNow,
    shock,
    reliefTaken: s.reliefTaken || relief,
    tick: s.tick + 1,
  };
}
