import { describe, it, expect } from 'vitest';
import { TECH_TREE } from '../../src/tech/tree';
import { BuiltKind } from '../../src/engine/fabric';
import { solarFactor } from '../../src/growth/power';
import { kindEffectLines, nodeEffectLines, practiceEffectLines } from '../../src/ui/techEffectsContent';

/** Building pairs that still read the same (the design splits them in batch 3). */
const PENDING_DUPLICATES: readonly [string, string][] = [
  ['urban-bazaars', 'maker-spaces'],
  ['coop-housing', 'communes'],
];

describe('every tech says exactly what it does', () => {
  for (const n of TECH_TREE) {
    it(`${n.id} names at least one effect`, () => {
      expect(nodeEffectLines(n).effects.length).toBeGreaterThan(0);
    });
  }

  it('no two building techs read the same, except the pairs still to be split', () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const n of TECH_TREE) {
      if (!n.grants.kinds?.length) continue;
      const key = kindEffectLines(n.grants.kinds[0]!).effects.join('|');
      const prior = seen.get(key);
      if (prior) dupes.push([prior, n.id].sort().join('+'));
      else seen.set(key, n.id);
    }
    expect(dupes.sort()).toEqual(PENDING_DUPLICATES.map((p) => [...p].sort().join('+')).sort());
  });
});

describe('effect text uses the numbers the sim runs on', () => {
  it('Walkable Streets: the walk range before and after', () => {
    expect(practiceEffectLines('walkable-streets')).toEqual(['People walk up to 15 tiles before riding (was 10)']);
  });

  it('Circles: voice and effort capacity', () => {
    const lines = practiceEffectLines('circles');
    expect(lines.some((l) => /voice \+1/.test(l))).toBe(true);
    expect(lines.some((l) => /Effort capacity \+30%/.test(l))).toBe(true);
  });

  it('a power plant names its output and that it burns nothing', () => {
    expect(kindEffectLines(BuiltKind.SolarPlant).effects).toContain('Generates 210 power, no smoke');
  });

  it('the Healing Commons names its coverage and its refuge', () => {
    const { effects } = kindEffectLines(BuiltKind.HealingCommons);
    expect(effects).toContain('Fire & health cover within 6 tiles');
    expect(effects).toContain("Police won't patrol or arrest within 3 tiles");
  });

  it('costs are listed apart from effects', () => {
    expect(kindEffectLines(BuiltKind.CommunityGarden).costs).toEqual(['Tending: 0.1 effort/hour']);
    expect(kindEffectLines(BuiltKind.WindTurbine).costs).toEqual(['Upkeep: $0.6/hour']);
  });
});

describe('the tiny-home village', () => {
  it('says whom it shelters, that rent cannot touch it, and what it costs to keep', () => {
    const l = kindEffectLines(BuiltKind.TinyHomes);
    expect(l.effects[0]).toBe("Shelters 12 of the city's unhoused — and only them");
    expect(l.effects).toContain('Rent-protected: residents are never priced out by land value');
    expect(l.costs).toEqual(['Tending: 0.1 effort/hour']);
  });
});

describe('wind and sun text', () => {
  it('names the curves', () => {
    expect(kindEffectLines(BuiltKind.SolarPlant).effects).toContain('Follows the sun: full at noon, half at 09:00 and 15:00, nothing 18:00–06:00');
    expect(kindEffectLines(BuiltKind.WindTurbine).effects).toContain('Gusts hour to hour (0.4–1.6× its rating), blowing harder 20:00–06:00');
    expect(solarFactor(9)).toBe(0.5); // the text's numbers are the sim's
    expect(solarFactor(15)).toBe(0.5);
    expect(solarFactor(18)).toBe(0);
  });
});
