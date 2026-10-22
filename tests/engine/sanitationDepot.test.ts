// Street garbage (Maddy 2026-10-21: "trash cluttering the streets. makes me wonder about garbage trucks"): a
// sanitation depot — a city service you can build from the start, its trucks clearing the piles on the street.
import { describe, it, expect } from 'vitest';
import { BuiltKind } from '../../src/engine/fabric';
import { zoneTypeOf, ZoneType } from '../../src/engine/zone';
import { builtKindName } from '../../src/engine/builtNames';
import { availableTools, toolDef } from '../../src/tools/tools';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';
import { UPKEEP } from '../../src/economy/readings';
import { BUILDING_PAINTERS } from '../../src/ui/snesBuildings';
import { categoryOf } from '../../src/ui/toolMenuContent';

describe('the sanitation depot', () => {
  it('is a civic building, named, buildable from the start, with a price and an upkeep', () => {
    const k = BuiltKind.SanitationDepot;
    expect(zoneTypeOf(k)).toBe(ZoneType.Civic);
    expect(builtKindName(k)).toBe('Sanitation Depot');
    const def = toolDef(`build-${k}`);
    expect(def?.cost).toBeGreaterThan(0);
    expect(def?.footprint).toEqual({ w: 2, h: 2 });
    expect(availableTools(createTechState(TECH_TREE)).map((t) => t.id)).toContain(`build-${k}`);
    expect(UPKEEP.get(k) ?? 0).toBeGreaterThan(0);
    expect(categoryOf(def!)).toBe('civic');
  });
  it('has its art', () => {
    expect(BUILDING_PAINTERS.has(BuiltKind.SanitationDepot)).toBe(true);
  });
});
