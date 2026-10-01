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

export interface EconomyState {
  funds: number;
  effort: number;
  burnout: number;
  goodwill: number;
  approval: number;
  rent: number;
  /** Households displaced so far (feeds the unhoused count). */
  displaced: number;
  tick: number;
}

/** Rates and shapes — tuning data. */
export const ECON = {
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
} as const;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function createEconomy(funds = 2000): EconomyState {
  return { funds, effort: 0, burnout: 0, goodwill: ECON.goodwillNeutral, approval: 50, rent: 0.3, displaced: 0, tick: 0 };
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

/** One economy tick. Pure: returns the next state, never mutates `s`. */
export function stepEconomy(s: EconomyState, city: CityReading, lev: Levers): EconomyState {
  // ── Funds: taxes in; upkeep, police and projects out (it can go negative: debt, with consequences elsewhere)
  const funds = s.funds + taxRevenue(city, lev) - city.upkeep - lev.police - Math.min(lev.spendFunds, Math.max(0, s.funds));

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
  const burnout = clamp(s.burnout + (stretched ? ECON.burnoutGain * overdraw : -ECON.burnoutHeal), 0, 0.9);

  // ── Rent and displacement: rent chases unprotected land value (+ the tax that landlords pass on)
  const avgTax = (lev.tax.r + lev.tax.c + lev.tax.i) / 3;
  const rentTarget = clamp(city.landValue * (1 - city.protectedShare) + ECON.taxPassThrough * avgTax, 0, 1);
  const rent = s.rent + (rentTarget - s.rent) * ECON.rentLag;
  const bearable = 0.25 + 0.5 * city.wellbeing; // what households' means (tracked by wellbeing) can carry
  const displacedNow = city.households * (1 - city.protectedShare) * ECON.displaceRate * Math.max(0, rent - bearable);

  // ── Goodwill: slow drift home, slow gains, fast losses
  const policeCost = ECON.policeGoodwillCost * lev.police;
  const goodwill = clamp(
    s.goodwill +
      (ECON.goodwillNeutral - s.goodwill) * ECON.goodwillDrift +
      ECON.goodwillPerRepair * city.repairs -
      ECON.goodwillPerBlackout * city.harms.blackouts -
      ECON.goodwillPerViolence * city.harms.policeViolence -
      ECON.goodwillPerTaking * city.harms.takings -
      ECON.goodwillPerDisplaced * displacedNow -
      policeCost,
    0,
    100,
  );

  // ── Approval: perceived performance, a delayed read of wellbeing, goodwill, tax pain and the police bump
  // a neutral city (wellbeing ½, goodwill neutral, modest taxes) reads about 50
  const actual = clamp(
    30 + 40 * city.wellbeing + 0.4 * (goodwill - ECON.goodwillNeutral) - 100 * ECON.taxPain * avgTax + Math.min(ECON.policeLiftCap, ECON.policeLift * lev.police * 100),
    0,
    100,
  );
  const approval = s.approval + (actual - s.approval) * ECON.approvalLag;

  return { funds, effort, burnout, goodwill, approval, rent, displaced: s.displaced + displacedNow, tick: s.tick + 1 };
}
