// The food chain's buildings (docs/design/interdependence.md §2, step 3; Maddy 2026-10-13: "as outlined"): an urban
// farm (Green Development, after Community Gardens), a food bank (Mutual Aid) and a food pantry (Shared Table).
import { describe, expect, it } from 'vitest';
import { BuiltKind } from '../../src/engine/fabric';
import { availableTools, toolDef } from '../../src/tools/tools';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';
import { builtKindName as builtName } from '../../src/engine/builtNames';
import { BUILDING_PAINTERS } from '../../src/ui/snesBuildings';

const has = (unlocked: string[], kind: number) => {
  const tech = createTechState(TECH_TREE);
  tech.restore(unlocked, 100);
  return availableTools(tech).some((t) => t.kind === kind);
};

describe('the food buildings', () => {
  it('a farm comes with Urban Farms, after Community Gardens', () => {
    const node = TECH_TREE.find((n) => n.grants.kinds?.includes(BuiltKind.UrbanFarm))!;
    expect(node.branch).toBe('GreenDevelopment');
    expect(node.prereqs).toContain('community-gardens');
    expect(has([], BuiltKind.UrbanFarm)).toBe(false);
    expect(has([node.id], BuiltKind.UrbanFarm)).toBe(true);
  });
  it('a food bank with Mutual Aid; a pantry with Shared Table', () => {
    expect(has(['mutual-aid'], BuiltKind.FoodBank)).toBe(true);
    expect(has(['shared-table'], BuiltKind.Pantry)).toBe(true);
    expect(has([], BuiltKind.Pantry)).toBe(false);
  });
  it('their sizes, names and drawings', () => {
    expect(toolDef(`build-${BuiltKind.UrbanFarm}`)!.footprint).toEqual({ w: 2, h: 2 });
    expect(toolDef(`build-${BuiltKind.FoodBank}`)!.footprint).toEqual({ w: 2, h: 2 });
    expect(toolDef(`build-${BuiltKind.Pantry}`)!.footprint).toEqual({ w: 1, h: 1 });
    for (const k of [BuiltKind.UrbanFarm, BuiltKind.FoodBank, BuiltKind.Pantry]) {
      expect(builtName(k)).toBeTruthy();
      expect(BUILDING_PAINTERS.has(k)).toBe(true);
    }
  });
});
