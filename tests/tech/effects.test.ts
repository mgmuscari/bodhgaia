import { describe, it, expect } from 'vitest';
import { NEUTRAL_EFFECTS, NODE_EFFECTS, resolveEffects } from '../../src/tech/effects';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';

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
