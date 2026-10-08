import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel } from '../../src/engine/fabric';
import { RAIL_COMMERCE_LIFT, RAIL_COMMERCE_RADIUS, readCity, homeProtection, UPKEEP, TENDING, NEUTRAL_ECONOMY_PRACTICES, type EconomyPractices } from '../../src/economy/readings';

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

  it('industry is assessed on its jobs, not land value — it poisons its own land (Maddy 2026-10-01: new industry paid nothing)', () => {
    const c = city();
    c.lv.set(c.map.idx(4, 1), 0); // the works' own smoke has zeroed its land value
    const r = read(c);
    expect(r.base.i).toBeGreaterThan(0);
    c.lv.set(c.map.idx(4, 1), 255);
    expect(read(c).base.i).toBeCloseTo(r.base.i, 9);
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

// The practices' economy effects (docs/design/tech-tree-balance.md), handed in as plain numbers.
describe('readCity — the practices', () => {
  const withPractices = (c: ReturnType<typeof city>, practices: Partial<EconomyPractices>) =>
    readCity({
      map: c.map,
      parcels: c.parcels,
      occupancyAt: (t) => c.occ.get(t),
      landValueAt: (t) => c.lv.get(t),
      wellbeing: 0.5,
      extraInfra: 0,
      harms: { blackouts: 0, policeViolence: 0, takings: 0 },
      repairs: 0,
      practices: { ...NEUTRAL_ECONOMY_PRACTICES, ...practices },
    });

  it('neutral practices read exactly as before', () => {
    const c = city();
    expect(withPractices(c, {})).toEqual(read(c));
  });

  it('Community Land Trust protects every home within 4 tiles of a co-op, commune or healing commons', () => {
    const c = city();
    placeParcel(c.map, c.parcels, { x: 14, y: 14, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    c.occ.set(c.map.idx(14, 14), 10);
    // the co-op's 6 of 20 households are protected; the house beside it isn't — until the trust holds the land
    expect(withPractices(c, {}).protectedShare).toBeCloseTo(6 / 20, 9);
    expect(withPractices(c, { landTrust: true }).protectedShare).toBeCloseTo(10 / 20, 9); // + the house at (1,1); not (14,14)
  });

  it('Gift Circles: the commons need a quarter less tending', () => {
    const c = city();
    expect(withPractices(c, { tendingMul: 0.75 }).tending).toBeCloseTo(read(c).tending * 0.75, 9);
  });

  it('Craft Fairs: each maker space and bazaar adds social infrastructure', () => {
    const c = city();
    placeParcel(c.map, c.parcels, { x: 8, y: 8, width: 2, height: 2, kind: BuiltKind.Bazaar });
    placeParcel(c.map, c.parcels, { x: 11, y: 8, width: 2, height: 2, kind: BuiltKind.MakerSpace });
    expect(withPractices(c, { craftInfra: 2 }).socialInfra).toBe(withPractices(c, {}).socialInfra + 4);
  });

  it('carries the approval and burnout coefficients through to the model', () => {
    const r = withPractices(city(), { taxPainMul: 0.5, burnoutHealMul: 2 });
    expect(r.taxPainMul).toBe(0.5);
    expect(r.burnoutHealMul).toBe(2);
  });
});

describe('readCity — voice protects (tenant organising, Maddy 2026-10-07)', () => {
  it("a home's protection is its neighbourhood's voice when that beats its kind", () => {
    const c = city();
    const at = (voice: number) =>
      readCity({
        map: c.map,
        parcels: c.parcels,
        occupancyAt: (t) => c.occ.get(t),
        landValueAt: (t) => c.lv.get(t),
        wellbeing: 0.5,
        extraInfra: 0,
        harms: { blackouts: 0, policeViolence: 0, takings: 0 },
        repairs: 0,
        voiceAt: () => voice,
      }).protectedShare;
    // the house (4) and the co-op (6): the co-op is always protected; the house by half its households at voice ½
    expect(at(0)).toBeCloseTo(6 / 10, 9);
    expect(at(0.5)).toBeCloseTo((6 + 2) / 10, 9);
    expect(at(1)).toBeCloseTo(1, 9);
  });

  it('homeProtection: the best of kind, land trust and voice', () => {
    expect(homeProtection(BuiltKind.CoopHousing, false, 0)).toBe(1);
    expect(homeProtection(BuiltKind.HouseSingle, true, 0)).toBe(1);
    expect(homeProtection(BuiltKind.HouseSingle, false, 0.3)).toBe(0.3);
    expect(homeProtection(BuiltKind.HouseSingle, false, 0)).toBe(0);
  });
});

describe('readCity — building area effects (tech-tree batch 3)', () => {
  const base = (c: ReturnType<typeof city>) =>
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

  it('a compost hub halves the tending of gardens and vertical farms within 4 tiles', () => {
    const c = city(); // the garden at (5,1)
    const before = base(c).tending;
    placeParcel(c.map, c.parcels, { x: 7, y: 1, width: 1, height: 1, kind: BuiltKind.CompostHub }); // 2 tiles away
    const garden = TENDING.get(BuiltKind.CommunityGarden)!;
    expect(base(c).tending).toBeCloseTo(before + TENDING.get(BuiltKind.CompostHub)! - garden / 2, 9);
  });

  it('a bazaar draws a crowd: shops within 4 tiles are assessed a quarter more', () => {
    const c = city(); // the strip at (3,1)
    const before = base(c).base.c;
    placeParcel(c.map, c.parcels, { x: 9, y: 9, width: 2, height: 2, kind: BuiltKind.Bazaar }); // far: no lift
    expect(base(c).base.c).toBeCloseTo(before, 9);
    const c2 = city();
    placeParcel(c2.map, c2.parcels, { x: 4, y: 4, width: 2, height: 2, kind: BuiltKind.Bazaar }); // 3 tiles from the strip
    expect(base(c2).base.c).toBeCloseTo(before * 1.25, 9); // the bazaar itself holds no jobs at occupancy 0
  });

  it("a commune's households regenerate effort twice over", () => {
    const c = city();
    placeParcel(c.map, c.parcels, { x: 10, y: 10, width: 3, height: 3, kind: BuiltKind.Commune });
    c.occ.set(c.map.idx(10, 10), 5);
    const r = base(c);
    expect(r.households).toBe(15);
    expect(r.regenHouseholds).toBe(20);
  });
});

describe('readCity — elevated rail draws shoppers (Maddy 2026-10-07)', () => {
  it(`shops within ${RAIL_COMMERCE_RADIUS} tiles of the line are assessed ${RAIL_COMMERCE_LIFT}×`, () => {
    const read1 = (c: ReturnType<typeof city>) =>
      readCity({ map: c.map, parcels: c.parcels, occupancyAt: (t) => c.occ.get(t), landValueAt: (t) => c.lv.get(t), wellbeing: 0.5, extraInfra: 0, harms: { blackouts: 0, policeViolence: 0, takings: 0 }, repairs: 0 });
    const before = read1(city()).base.c;
    const c = city(); // the strip at (3,1)
    for (let x = 0; x < 8; x++) c.map.deck[c.map.idx(x, 3)] = BuiltKind.ElevatedRail; // over the street, 2 rows away
    expect(read1(c).base.c).toBeCloseTo(before * RAIL_COMMERCE_LIFT, 9);
  });
});
