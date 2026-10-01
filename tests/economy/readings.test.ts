import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel } from '../../src/engine/fabric';
import { readCity, UPKEEP, TENDING } from '../../src/economy/readings';

// The economy reads the live city as a handful of aggregates (src/economy stays headless: the city hands
// it plain accessors, like growth's occupancy accessor).
function city() {
  const map = new GameMap(16, 16);
  const parcels = new ParcelStore();
  const occ = new Map<number, number>();
  const lv = new Map<number, number>();
  const put = (x: number, y: number, kind: BuiltKind, households: number, landValue: number) => {
    placeParcel(map, parcels, { x, y, width: 1, height: 1, kind });
    occ.set(map.idx(x, y), households);
    lv.set(map.idx(x, y), landValue);
  };
  put(1, 1, BuiltKind.HouseSingle, 4, 128);
  put(2, 1, BuiltKind.CoopHousing, 6, 128);
  put(3, 1, BuiltKind.CommercialStrip, 3, 255);
  put(4, 1, BuiltKind.Industrial, 5, 64);
  put(5, 1, BuiltKind.CommunityGarden, 0, 128);
  for (let x = 0; x < 8; x++) map.setBuilt(x, 3, BuiltKind.RoadStreet);
  for (let x = 0; x < 8; x++) map.setBuilt(x, 6, BuiltKind.RoadHighway);
  return { map, parcels, occ, lv };
}

const read = (c: ReturnType<typeof city>) =>
  readCity({
    map: c.map,
    parcels: c.parcels,
    occupancyAt: (t) => c.occ.get(t),
    landValueAt: (t) => c.lv.get(t),
    wellbeing: 0.5,
    extraInfra: 0,
    harms: { blackouts: 0, policeViolence: 0, takings: 0 },
    repairs: 0,
  });

describe('readCity', () => {
  it('households are the homes’ live occupancy; co-ops and communes count as protected', () => {
    const r = read(city());
    expect(r.households).toBe(10);
    expect(r.protectedShare).toBeCloseTo(0.6, 9);
  });

  it('each class’s tax base grows with its occupancy and land value', () => {
    const c = city();
    const before = read(c);
    c.lv.set(c.map.idx(3, 1), 128); // the shop's land loses half its value
    expect(read(c).base.c).toBeLessThan(before.base.c);
    expect(before.base.r).toBeGreaterThan(0);
    expect(before.base.i).toBeGreaterThan(0);
  });

  it('upkeep counts the fabric: a highway tile costs more than a street tile', () => {
    expect(UPKEEP.get(BuiltKind.RoadHighway)!).toBeGreaterThan(UPKEEP.get(BuiltKind.RoadStreet)!);
    const c = city();
    const r = read(c);
    const roads = 8 * UPKEEP.get(BuiltKind.RoadStreet)! + 8 * UPKEEP.get(BuiltKind.RoadHighway)!;
    expect(r.upkeep).toBeGreaterThanOrEqual(roads);
  });

  it('the commons need tending; gathering places are social infrastructure', () => {
    const r = read(city());
    expect(r.tending).toBeCloseTo(TENDING.get(BuiltKind.CommunityGarden)!, 9);
    expect(r.socialInfra).toBeGreaterThanOrEqual(1); // the garden is a gathering place
  });
});
