import { describe, it, expect } from 'vitest';
import { NEUTRAL_EFFECTS, NODE_EFFECTS, resolveEffects } from '../../src/tech/effects';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';
import { NEUTRAL_ECONOMY_PRACTICES } from '../../src/economy/readings';
import { NEUTRAL_PRACTICES } from '../../src/live/types';
import { NEUTRAL_POWER_PRACTICES } from '../../src/growth/power';
import { NEUTRAL_ECOLOGY_PRACTICES } from '../../src/ecology/tick';

const ids = new Set(TECH_TREE.map((n) => n.id));

describe('tech effects', () => {
  it('resolves to the neutral record when nothing is unlocked', () => {
    expect(resolveEffects([])).toEqual(NEUTRAL_EFFECTS);
  });

  it('declares effects only for real tree nodes, with keys the record knows', () => {
    for (const [id, effects] of Object.entries(NODE_EFFECTS)) {
      expect(ids.has(id), id).toBe(true);
      for (const e of effects) expect(e.key in NEUTRAL_EFFECTS, `${id}: ${e.key}`).toBe(true);
    }
  });

  it('Walkable Streets stretches the walk range by half again', () => {
    expect(resolveEffects(['walkable-streets']).walkStretch).toBe(1.5);
  });

  it('Road Diets unlocks the road conversions', () => {
    expect(NEUTRAL_EFFECTS.roadConversions).toBe(false);
    expect(resolveEffects(['road-diets']).roadConversions).toBe(true);
  });

  it('the participatory practices add voice and social infrastructure', () => {
    const e = resolveEffects(['circles', 'participatory-budgeting', 'gift-circles']);
    expect(e.voicePerTick).toBe(4); // 1 + 2 + 1
    expect(e.socialInfra).toBe(4); // circles 2 + budgeting 2
    expect(resolveEffects(['gift-circles']).socialInfra).toBe(0);
  });

  it('the economy practices', () => {
    const e = resolveEffects(['participatory-budgeting', 'gift-circles', 'community-land-trust', 'shared-table', 'craft-fairs']);
    expect(e.taxPainMul).toBe(0.5);
    expect(e.tendingMul).toBe(0.75);
    expect(e.landTrust).toBe(true);
    expect(e.burnoutHealMul).toBe(2);
    expect(e.craftInfra).toBe(2);
  });

  it('the live layer reads exactly its neutral practices from the neutral effects', () => {
    for (const [k, v] of Object.entries(NEUTRAL_PRACTICES)) expect(NEUTRAL_EFFECTS[k as keyof typeof NEUTRAL_EFFECTS], k).toBe(v);
  });

  it('the live practices', () => {
    const e = resolveEffects(['circles', 'bike-shares', 'drone-deliveries', 'mutual-aid', 'collective-ownership']);
    expect(e.arrestRelease).toBe(0.5);
    expect(e.bikeStretch).toBe(1.5);
    expect(e.droneShopDrop).toBe(0.5);
    expect(e.occFloor).toBe(0.5);
    expect(e.industryVisit).toBe(-1);
  });

  it('the power grid reads exactly its neutral practices from the neutral effects', () => {
    for (const [k, v] of Object.entries(NEUTRAL_POWER_PRACTICES)) expect(NEUTRAL_EFFECTS[k as keyof typeof NEUTRAL_EFFECTS], k).toBe(v);
    const e = resolveEffects(['sun-and-wire', 'renewable-energy', 'local-grids']);
    expect([e.homeDayDemand, e.renewableOutput, e.localGrids]).toEqual([0.75, 1.25, true]);
  });

  it('the ecology reads exactly its neutral practices from the neutral effects', () => {
    for (const [k, v] of Object.entries(NEUTRAL_ECOLOGY_PRACTICES)) expect(NEUTRAL_EFFECTS[k as keyof typeof NEUTRAL_EFFECTS], k).toBe(v);
    expect(resolveEffects(['soil-and-soul'])).toMatchObject({ soilRecovery: 2, pavedSoilCap: 60 });
  });

  it('the economy reads exactly its neutral practices from the neutral effects', () => {
    for (const [k, v] of Object.entries(NEUTRAL_ECONOMY_PRACTICES)) expect(NEUTRAL_EFFECTS[k as keyof typeof NEUTRAL_EFFECTS], k).toBe(v);
  });

  it('ignores unknown ids and is independent of unlock order', () => {
    expect(resolveEffects(['no-such-node'])).toEqual(NEUTRAL_EFFECTS);
    expect(resolveEffects(['gift-circles', 'circles'])).toEqual(resolveEffects(['circles', 'gift-circles']));
  });
});

describe('TechState.effects()', () => {
  it('tracks unlock, grant and restore', () => {
    const s = createTechState(TECH_TREE);
    expect(s.effects()).toEqual(NEUTRAL_EFFECTS);
    s.effort = 100;
    s.unlock('walkable-streets');
    expect(s.effects().walkStretch).toBe(1.5);
    s.grant('circles');
    expect(s.effects().voicePerTick).toBe(1);
    s.restore([], 0);
    expect(s.effects()).toEqual(NEUTRAL_EFFECTS);
  });
});
