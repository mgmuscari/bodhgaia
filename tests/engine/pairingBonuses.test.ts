// Each pairing's bonus, carried by its own system (interdependence §9, step 5).
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel, placeTransport } from '../../src/engine/fabric';
import { stepRepairShops, MAKER_RADIUS } from '../../src/growth/revival';
import { foodHour, PRODUCE, PANTRY_REACH, COMPOST_PAIR_BONUS } from '../../src/live/food';
import { createAmbientState } from '../../src/live/types';
import { spawnVans } from '../../src/live/vans';

describe('pairing bonuses', () => {
  it('library + maker space: the maker reaches twice as far', () => {
    const map = new GameMap(40, 10);
    const parcels = new ParcelStore();
    placeParcel(map, parcels, { x: 10, y: 4, width: 2, height: 2, kind: BuiltKind.MakerSpace });
    const far = placeParcel(map, parcels, { x: 12 + MAKER_RADIUS + 2, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle, condition: 100 });
    stepRepairShops({ map, parcels });
    expect(parcels.get(far).condition).toBe(100); // beyond the plain reach
    placeParcel(map, parcels, { x: 8, y: 4, width: 1, height: 1, kind: BuiltKind.Library }); // 2 tiles off: paired
    stepRepairShops({ map, parcels });
    expect(parcels.get(far).condition).toBeGreaterThan(100);
  });

  it('compost hub + garden: the garden grows a quarter more', () => {
    const grown = (compost: boolean) => {
      const map = new GameMap(30, 10);
      const parcels = new ParcelStore();
      placeParcel(map, parcels, { x: 10, y: 4, width: 1, height: 1, kind: BuiltKind.Pantry });
      placeParcel(map, parcels, { x: 13, y: 4, width: 1, height: 1, kind: BuiltKind.CommunityGarden });
      if (compost) placeParcel(map, parcels, { x: 15, y: 4, width: 1, height: 1, kind: BuiltKind.CompostHub });
      const food = { stock: new Map<number, number>() };
      foodHour(food, map, parcels, () => 0);
      return food.stock.get(map.idx(10, 4)) ?? 0;
    };
    expect(grown(false)).toBe(PRODUCE.get(BuiltKind.CommunityGarden)!);
    expect(grown(true)).toBeCloseTo(PRODUCE.get(BuiltKind.CommunityGarden)! * COMPOST_PAIR_BONUS, 6);
  });

  it('co-op housing + pantry: the pantry serves two tiles further', () => {
    const fed = (coop: boolean) => {
      const map = new GameMap(40, 10);
      const parcels = new ParcelStore();
      placeParcel(map, parcels, { x: 10, y: 4, width: 1, height: 1, kind: BuiltKind.Pantry });
      placeParcel(map, parcels, { x: 10 + PANTRY_REACH + 2, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle });
      if (coop) placeParcel(map, parcels, { x: 8, y: 4, width: 1, height: 1, kind: BuiltKind.CoopHousing });
      const food = { stock: new Map<number, number>([[map.idx(10, 4), 10]]) };
      return foodHour(food, map, parcels, () => 4).access.has(map.idx(10 + PANTRY_REACH + 2, 4));
    };
    expect(fed(false)).toBe(false);
    expect(fed(true)).toBe(true);
  });

  it('AI node + food bank: the bank delivers by drone, not van', () => {
    const map = new GameMap(40, 12);
    const parcels = new ParcelStore();
    for (let x = 0; x < 40; x++) placeTransport(map, x, 5, BuiltKind.RoadStreet);
    placeParcel(map, parcels, { x: 3, y: 3, width: 2, height: 2, kind: BuiltKind.FoodBank });
    placeParcel(map, parcels, { x: 6, y: 3, width: 1, height: 1, kind: BuiltKind.AINode });
    placeParcel(map, parcels, { x: 30, y: 6, width: 1, height: 1, kind: BuiltKind.Pantry });
    const state = createAmbientState();
    state.foodRuns = [{ from: map.idx(3, 3), to: map.idx(30, 6), amount: 10 }];
    spawnVans(state, map);
    expect(state.vans ?? []).toHaveLength(0);
    expect(state.drones).toHaveLength(1);
  });
});

import { residentCollapses } from '../../src/live/death';
import { stepAmbulances } from '../../src/live/ambulances';
import { HEALING_PAIR_EXTRA } from '../../src/live/tuning';
import { pairedHoods } from '../../src/engine/pairings';
import { computeNeighborhoods } from '../../src/civic/neighborhoods';

describe('pairing bonuses (2)', () => {
  it('healing commons + clinic: its ambulance gives the patient HEALING_PAIR_EXTRA more', () => {
    const t0 = (healing: boolean) => {
      const map = new GameMap(30, 12);
      for (let x = 0; x < 30; x++) map.setBuilt(x, 5, BuiltKind.RoadStreet);
      const parcels = new ParcelStore();
      placeParcel(map, parcels, { x: 0, y: 6, width: 2, height: 2, kind: BuiltKind.Clinic });
      if (healing) placeParcel(map, parcels, { x: 3, y: 6, width: 2, height: 2, kind: BuiltKind.HealingCommons });
      const state = createAmbientState();
      residentCollapses(state, 20, 4, {});
      stepAmbulances(state, map);
      return state.dying![0]!.t;
    };
    expect(t0(true)).toBe(t0(false) - HEALING_PAIR_EXTRA);
  });

  it('bazaar + maker space: the neighbourhoods where they pair (craft fairs twice as often there)', () => {
    const map = new GameMap(20, 10);
    const parcels = new ParcelStore();
    for (let x = 0; x < 20; x++) placeTransport(map, x, 5, BuiltKind.RoadStreet);
    placeParcel(map, parcels, { x: 4, y: 3, width: 2, height: 2, kind: BuiltKind.MakerSpace });
    placeParcel(map, parcels, { x: 7, y: 3, width: 2, height: 2, kind: BuiltKind.Bazaar });
    const part = computeNeighborhoods(map);
    const hoods = pairedHoods(map, parcels, part.tileToNeighborhood, BuiltKind.MakerSpace, BuiltKind.Bazaar);
    expect(hoods.has(part.tileToNeighborhood[map.idx(4, 3)]!)).toBe(true);
  });
});
