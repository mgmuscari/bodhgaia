// Tech-tree batch 3: the buildings' area effects in the live layer (docs/design/tech-tree-balance.md).
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind } from '../../src/engine/fabric';
import { createAmbientState, setHouseholds } from '../../src/live/types';
import { homeDrives, nearKind } from '../../src/live/pathing';
import { stepOccupancy, homeCapacity } from '../../src/live/fields/occupancy';
import { landValueAt } from '../../src/live/fields/landValue';
import { STATION_RADIUS, LV_STATION, OCC_SETTLE_PASSES, PARKLET_RADIUS, PARKLET_SHIFT, FRESH_FOOD_RADIUS, ADU_HOUSE_HEADROOM, OCC_HEADROOM } from '../../src/live/tuning';

describe('nearKind', () => {
  it('finds a kind within a Chebyshev radius', () => {
    const map = new GameMap(20, 20);
    map.built[map.idx(10, 10)] = BuiltKind.Parklet;
    expect(nearKind(map, 13, 7, BuiltKind.Parklet, 3)).toBe(true);
    expect(nearKind(map, 14, 10, BuiltKind.Parklet, 3)).toBe(false);
  });
});

describe('Parklets and Communes: who drives', () => {
  it('a commune household never drives', () => {
    const map = new GameMap(10, 10);
    map.built[map.idx(2, 2)] = BuiltKind.Commune;
    for (let h = 0; h < 200; h++) expect(homeDrives(map, map.idx(2, 2), h)).toBe(false);
  });

  it(`homes within ${PARKLET_RADIUS} tiles of a parklet drive ${PARKLET_SHIFT * 100}% fewer trips`, () => {
    const map = new GameMap(20, 10);
    map.built[map.idx(2, 2)] = BuiltKind.HouseSingle;
    map.built[map.idx(15, 2)] = BuiltKind.HouseSingle;
    map.built[map.idx(4, 3)] = BuiltKind.Parklet;
    let near = 0;
    let far = 0;
    for (let h = 0; h < 2000; h++) {
      if (homeDrives(map, map.idx(2, 2), h)) near++;
      if (homeDrives(map, map.idx(15, 2), h)) far++;
    }
    expect(far).toBe(2000);
    expect(near / 2000).toBeGreaterThan(1 - PARKLET_SHIFT - 0.05);
    expect(near / 2000).toBeLessThan(1 - PARKLET_SHIFT + 0.05);
  });
});

describe('Vertical Farming: fresh food holds residents', () => {
  it(`a farm opening within ${FRESH_FOOD_RADIUS} tiles draws people to a home; one farther does not`, () => {
    const run = (farmX: number) => {
      const map = new GameMap(30, 4);
      map.built[map.idx(2, 1)] = BuiltKind.Apartments;
      const state = createAmbientState();
      setHouseholds(state, [{ x: 2, y: 1, count: 10 }]);
      state.unhoused = 10;
      for (let i = 0; i < OCC_SETTLE_PASSES; i++) stepOccupancy(state, map);
      map.built[map.idx(farmX, 1)] = BuiltKind.VerticalFarm;
      for (let i = 0; i < 60; i++) stepOccupancy(state, map);
      return state.occupancy.get(map.idx(2, 1))!;
    };
    expect(run(2 + FRESH_FOOD_RADIUS)).toBeGreaterThan(10);
    expect(run(2 + FRESH_FOOD_RADIUS + 5)).toBe(10);
  });
});

describe('Accessory Dwellings: densify without demolition', () => {
  it('a house beside an ADU can hold more; the ADU itself holds as much', () => {
    const map = new GameMap(10, 10);
    map.built[map.idx(3, 3)] = BuiltKind.HouseSingle;
    map.built[map.idx(7, 7)] = BuiltKind.HouseSingle;
    map.built[map.idx(4, 3)] = BuiltKind.ADU;
    expect(homeCapacity(map, map.idx(3, 3), 3)).toBe(3 * ADU_HOUSE_HEADROOM);
    expect(homeCapacity(map, map.idx(7, 7), 3)).toBe(3 * OCC_HEADROOM.get(BuiltKind.HouseSingle)!);
    expect(homeCapacity(map, map.idx(4, 3), 3)).toBe(3 * OCC_HEADROOM.get(BuiltKind.ADU)!);
    expect(OCC_HEADROOM.get(BuiltKind.ADU)).toBe(ADU_HOUSE_HEADROOM);
  });
});

describe('Elevated Rail: the stations lift the land around the line', () => {
  it(`a plot within ${STATION_RADIUS} tiles of the line gains ${LV_STATION}; once, however much line is near`, () => {
    const make = (railY: number | null, deck = false) => {
      const map = new GameMap(20, 20);
      map.built[map.idx(10, 10)] = BuiltKind.HouseSingle;
      if (railY !== null) for (let x = 0; x < 20; x++) (deck ? map.deck : map.built)[map.idx(x, railY)] = BuiltKind.ElevatedRail;
      return landValueAt(map, 10, 10);
    };
    const bare = make(null);
    expect(make(12) - bare).toBeCloseTo(LV_STATION, 9);
    expect(make(12, true) - bare).toBeCloseTo(LV_STATION, 9); // an overpass line counts too
    expect(make(15)).toBeCloseTo(bare, 9);
  });
});
