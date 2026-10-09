// Bridges (Maddy 2026-10-08: "need ability to build transport bridges over water"): a transport tool laid across
// water decks a bridge — dearer than on land — and people cross a street, path or promenade bridge on foot.
import { describe, it, expect } from 'vitest';
import { GameMap, Water } from '../../src/engine/map';
import { BuiltKind, ParcelStore } from '../../src/engine/fabric';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';
import { applyTool, previewTool, toolDef, toolPrice, chargeFor, BRIDGE_COST_MUL } from '../../src/tools/tools';
import { isWalkable } from '../../src/live/network';

function river() {
  const map = new GameMap(12, 12);
  for (let y = 0; y < 12; y++) for (const x of [5, 6, 7]) map.water[map.idx(x, y)] = Water.River;
  return { map, parcels: new ParcelStore() };
}

describe('bridges', () => {
  it('a street laid across a river decks a bridge over the water', () => {
    const world = river();
    const tech = createTechState(TECH_TREE);
    const tool = toolDef(`build-${BuiltKind.RoadStreet}`)!;
    for (let x = 2; x <= 10; x++) expect(applyTool(world, tech, tool, x, 4, { funds: 1e9 }).ok, `x=${x}`).toBe(true);
    for (const x of [5, 6, 7]) expect(world.map.getBuilt(x, 4)).toBe(BuiltKind.RoadStreet);
  });

  it('a span over water costs BRIDGE_COST_MUL× the same road on land', () => {
    const world = river();
    const tool = toolDef(`build-${BuiltKind.RoadStreet}`)!;
    const land = chargeFor(world, tool, 2, 4, { funds: 1e9 }).funds;
    expect(land).toBe(toolPrice(tool).funds);
    expect(chargeFor(world, tool, 6, 4, { funds: 1e9 }).funds).toBe(land * BRIDGE_COST_MUL);
  });

  it('rail and bike paths bridge too; a building never goes on the water', () => {
    const world = river();
    const tech = createTechState(TECH_TREE);
    expect(previewTool(world, tech, toolDef(`build-${BuiltKind.Rail}`)!, 6, 2, { funds: 1e9 }).valid).toBe(true);
    expect(previewTool(world, tech, toolDef(`build-${BuiltKind.HouseSingle}`)!, 6, 2, { funds: 1e9 }).valid).toBe(false);
  });

  it('people walk over a street bridge, not over a freeway bridge or open water', () => {
    const { map } = river();
    map.setBuilt(6, 4, BuiltKind.RoadStreet);
    map.setBuilt(6, 8, BuiltKind.RoadHighway);
    expect(isWalkable(map, 6, 4)).toBe(true);
    expect(isWalkable(map, 6, 8)).toBe(false);
    expect(isWalkable(map, 6, 6)).toBe(false);
  });
});
