// Parklets (Maddy 2026-10-08): plopped on a road, in place of its kerb — they take the kerb's parking, and are
// not a tile of their own. Stored as the road tile's deck (the per-tile second layer).
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeTransport, canPlaceParklet, placeParklet, parkletAt, overpassAt } from '../../src/engine/fabric';
import { isParkable } from '../../src/live/network';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';
import { applyTool, previewTool, toolDef } from '../../src/tools/tools';
import { snesRoadTiles } from '../../src/ui/snesRoads';

function street() {
  const map = new GameMap(20, 10);
  for (let x = 0; x < 20; x++) placeTransport(map, x, 4, BuiltKind.RoadStreet);
  for (let x = 0; x < 20; x++) placeTransport(map, x, 8, BuiltKind.RoadHighway);
  return { map, parcels: new ParcelStore() };
}

describe('parklets on the kerb', () => {
  it('go on a street or avenue with a kerb — not open land, a freeway, or twice', () => {
    const { map } = street();
    expect(canPlaceParklet(map, 5, 4)).toBe(true);
    expect(canPlaceParklet(map, 5, 2)).toBe(false); // open land
    expect(canPlaceParklet(map, 5, 8)).toBe(false); // freeway
    expect(placeParklet(map, 5, 4)).toBe(true);
    expect(parkletAt(map, 5, 4)).toBe(true);
    expect(map.built[map.idx(5, 4)]).toBe(BuiltKind.RoadStreet); // still the street
    expect(map.parcel[map.idx(5, 4)]).toBe(0); // not a lot of its own
    expect(canPlaceParklet(map, 5, 4)).toBe(false);
  });

  it('take that kerb\'s parking', () => {
    const { map } = street();
    expect(isParkable(map, 5, 4)).toBe(true);
    placeParklet(map, 5, 4);
    expect(isParkable(map, 5, 4)).toBe(false);
    expect(isParkable(map, 6, 4)).toBe(true);
  });

  it('the Parklet tool plops one on a road, refuses open land, and bulldozing lifts it off the street', () => {
    const world = street();
    const tech = createTechState(TECH_TREE);
    tech.effort = 1000;
    for (const id of ['walkable-streets', 'road-diets', 'parklets']) tech.grant(id);
    const tool = toolDef(`build-${BuiltKind.Parklet}`)!;
    expect(previewTool(world, tech, tool, 5, 2).valid).toBe(false);
    expect(applyTool(world, tech, tool, 5, 4).ok).toBe(true);
    expect(parkletAt(world.map, 5, 4)).toBe(true);
    expect(applyTool(world, tech, toolDef('bulldoze')!, 5, 4).ok).toBe(true);
    expect(overpassAt(world.map, 5, 4)).toBe(0);
    expect(world.map.built[world.map.idx(5, 4)]).toBe(BuiltKind.RoadStreet);
  });

  it('is drawn in the kerb strip, in place of the kerb', () => {
    const out = new Map();
    snesRoadTiles(out, [BuiltKind.RoadStreet], []);
    expect(out.get('@road/parklet/1')).toBeDefined();
    expect(out.get('@road/parklet/5')).toBeDefined();
  });
});
