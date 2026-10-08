// Tech effects: what each practice actually changes in the simulation, as one flat record of named
// coefficients. Pure module — no DOM, no rng, no transcendental Math, no imports outside src/tech.
//
// A node declares its effects as data ({ key, op, value }); resolveEffects folds every unlocked node
// over NEUTRAL_EFFECTS (the city with no practices — today's coefficients). The host hands the
// resolved numbers to the layers that read them (live, civic, economy, tools), so none of those
// layers imports tech, and the tech panel renders the same declarations as exact text — the
// explanation can't drift from the mechanic.
//
// Building nodes need no entry here: a building's effect is its kind's row in the sim's own tables.

import { TECH_TREE } from './tree';

export interface TechEffects {
  /** Walk-range multiplier for mode choice (Walkable Streets). */
  walkStretch: number;
  /** Civic voice every neighbourhood gains per civic tick (Circles, Participatory Budgeting, Gift Circles). */
  voicePerTick: number;
  /** Social infrastructure added to the economy's effort capacity (Circles, Participatory Budgeting). */
  socialInfra: number;
  /** The classic road conversions — avenue ↔ street, planted median (Road Diets). */
  roadConversions: boolean;
  /** Homes near a co-op, commune or healing commons are rent-protected (Community Land Trust). */
  landTrust: boolean;
  /** Multiplier on the commons' tending effort (Gift Circles). */
  tendingMul: number;
  /** Social infrastructure each maker space and bazaar adds (Craft Fairs). */
  craftInfra: number;
  /** Multiplier on how much taxes weigh on approval (Participatory Budgeting). */
  taxPainMul: number;
  /** Multiplier on burnout's recovery (Shared Table). */
  burnoutHealMul: number;
  /** Cycling-range multiplier for mode choice (Bike Shares). */
  bikeStretch: number;
  /** Share of police stops that go to a circle instead of an arrest (Circles). */
  arrestRelease: number;
  /** Share of driven shopping trips delivered instead (Drone Deliveries). */
  droneShopDrop: number;
  /** The fraction of a home's baseline it never thins below (Mutual Aid). */
  occFloor: number;
  /** The wellbeing a citizen brings home from a day at industry (Collective Ownership). */
  industryVisit: number;
  /** Multiplier on home power demand by day (Sun and Wire). */
  homeDayDemand: number;
  /** Multiplier on hydro, wind and solar output (Renewable Energy). */
  renewableOutput: number;
  /** Homes around an energy node are served first in a blackout (Local Grids). */
  localGrids: boolean;
  /** Multiplier on soil's per-tick recovery (Soil and Soul). */
  soilRecovery: number;
  /** The soil ceiling on sealed tiles (Soil and Soul raises it). */
  pavedSoilCap: number;
}

export type EffectKey = keyof TechEffects;

export type Effect =
  | { key: EffectKey; op: 'mul' | 'add'; value: number }
  | { key: EffectKey; op: 'set'; value: number | boolean };

/** The city with no practices: exactly the coefficients the sim ran on before tech existed. */
export const NEUTRAL_EFFECTS: Readonly<TechEffects> = Object.freeze({
  walkStretch: 1,
  voicePerTick: 0,
  socialInfra: 0,
  roadConversions: false,
  landTrust: false,
  tendingMul: 1,
  craftInfra: 0,
  taxPainMul: 1,
  burnoutHealMul: 1,
  bikeStretch: 1,
  arrestRelease: 0,
  droneShopDrop: 0,
  occFloor: 0.4, // = live OCC_FLOOR (pinned by tests/tech/effects.test.ts)
  industryVisit: -4, // = visitValue(Industrial) (pinned likewise)
  homeDayDemand: 1,
  renewableOutput: 1,
  localGrids: false,
  soilRecovery: 1,
  pavedSoilCap: 40, // = ecology PAVED_CAP (pinned by tests/tech/effects.test.ts)
});

/** Each practice's effects, by node id. */
export const NODE_EFFECTS: Readonly<Record<string, readonly Effect[]>> = {
  'walkable-streets': [{ key: 'walkStretch', op: 'mul', value: 1.5 }],
  'road-diets': [{ key: 'roadConversions', op: 'set', value: true }],
  circles: [
    { key: 'arrestRelease', op: 'set', value: 0.5 },
    { key: 'voicePerTick', op: 'add', value: 1 },
    { key: 'socialInfra', op: 'add', value: 2 },
  ],
  'participatory-budgeting': [
    { key: 'taxPainMul', op: 'mul', value: 0.5 },
    { key: 'voicePerTick', op: 'add', value: 2 },
    { key: 'socialInfra', op: 'add', value: 2 },
  ],
  'gift-circles': [
    { key: 'tendingMul', op: 'mul', value: 0.75 },
    { key: 'voicePerTick', op: 'add', value: 1 },
  ],
  'community-land-trust': [{ key: 'landTrust', op: 'set', value: true }],
  'shared-table': [{ key: 'burnoutHealMul', op: 'mul', value: 2 }],
  'craft-fairs': [{ key: 'craftInfra', op: 'add', value: 2 }],
  'bike-shares': [{ key: 'bikeStretch', op: 'mul', value: 1.5 }],
  'drone-deliveries': [{ key: 'droneShopDrop', op: 'set', value: 0.5 }],
  'mutual-aid': [{ key: 'occFloor', op: 'set', value: 0.5 }],
  'collective-ownership': [{ key: 'industryVisit', op: 'set', value: -1 }],
  'sun-and-wire': [{ key: 'homeDayDemand', op: 'mul', value: 0.75 }],
  'renewable-energy': [{ key: 'renewableOutput', op: 'mul', value: 1.25 }],
  'local-grids': [{ key: 'localGrids', op: 'set', value: true }],
  'soil-and-soul': [
    { key: 'soilRecovery', op: 'mul', value: 2 },
    { key: 'pavedSoilCap', op: 'set', value: 60 },
  ],
};

function apply(out: Record<string, number | boolean>, e: Effect): void {
  if (e.op === 'set') out[e.key] = e.value;
  else if (e.op === 'mul') out[e.key] = (out[e.key] as number) * e.value;
  else out[e.key] = (out[e.key] as number) + e.value;
}

/** Fold the unlocked practices over the neutral record, in tree order (so the result never depends on
 *  the order they were unlocked in). Unknown ids are ignored. */
export function resolveEffects(unlocked: Iterable<string>): TechEffects {
  const have = new Set(unlocked);
  const out: Record<string, number | boolean> = { ...NEUTRAL_EFFECTS };
  for (const n of TECH_TREE) {
    if (!have.has(n.id)) continue;
    for (const e of NODE_EFFECTS[n.id] ?? []) apply(out, e);
  }
  return out as unknown as TechEffects;
}
