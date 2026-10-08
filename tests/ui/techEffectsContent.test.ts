import { describe, it, expect } from 'vitest';
import { TECH_TREE } from '../../src/tech/tree';
import { BuiltKind } from '../../src/engine/fabric';
import { kindEffectLines, nodeEffectLines, practiceEffectLines } from '../../src/ui/techEffectsContent';

/** Nodes whose mechanic (docs/design/tech-tree-balance.md) is not built yet. Batches 2–3 empty this; the
 *  test below fails the moment a listed node gains its effect, so the list can only shrink. */
const PENDING_PRACTICES = new Set([
  'soil-and-soul',
  'bike-shares',
  'sun-and-wire',
  'renewable-energy',
  'local-grids',
  'drone-deliveries',
  'mutual-aid',
  'collective-ownership',
]);

/** Building pairs that still read the same (the design splits them in batch 3). */
const PENDING_DUPLICATES: readonly [string, string][] = [
  ['urban-bazaars', 'maker-spaces'],
  ['coop-housing', 'communes'],
];

describe('every tech says exactly what it does', () => {
  for (const n of TECH_TREE) {
    if (PENDING_PRACTICES.has(n.id)) {
      it(`${n.id} is pending — and still has no effect (else drop it from the pending list)`, () => {
        expect(nodeEffectLines(n).effects).toEqual([]);
      });
    } else {
      it(`${n.id} names at least one effect`, () => {
        expect(nodeEffectLines(n).effects.length).toBeGreaterThan(0);
      });
    }
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
