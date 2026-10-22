// Garbage trucks (Maddy 2026-10-21: "trash cluttering the streets. makes me wonder about garbage trucks"): a sanitation
// depot sends its trucks to the piles on the street within reach — out, a moment loading, back — and the pile is gone.
// A pile beyond any depot's reach stays.
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel, placeTransport } from '../../src/engine/fabric';
import { createAmbientState } from '../../src/live/types';
import { stepGarbage, DEPOT_REACH, TRUCKS_PER_DEPOT } from '../../src/live/garbage';

function town(piles: { x: number; y: number }[]) {
  const map = new GameMap(80, 12);
  const parcels = new ParcelStore();
  for (let x = 0; x < 80; x++) placeTransport(map, x, 5, BuiltKind.RoadStreet);
  placeParcel(map, parcels, { x: 3, y: 3, width: 2, height: 2, kind: BuiltKind.SanitationDepot });
  const state = createAmbientState();
  state.evictedPiles = piles.map((p, k) => ({ ...p, seed: k, hx: 0, hy: -1, age: 0 }));
  return { map, state };
}
const run = (t: ReturnType<typeof town>, steps: number) => {
  for (let k = 0; k < steps; k++) stepGarbage(t.state, t.map);
};

describe('garbage trucks', () => {
  it('a depot sends a truck to a pile in reach; it loads it up and the pile is gone; the truck goes home', () => {
    const t = town([{ x: 20, y: 5 }]);
    run(t, 40);
    expect(t.state.garbageTrucks?.length).toBe(1);
    let cleared = false;
    for (let k = 0; k < 20_000 && !cleared; k++) {
      stepGarbage(t.state, t.map);
      cleared = (t.state.evictedPiles?.length ?? 0) === 0;
    }
    expect(cleared).toBe(true);
    run(t, 20_000);
    expect(t.state.garbageTrucks ?? []).toHaveLength(0);
  });

  it('a pile beyond reach stays', () => {
    const far = 3 + DEPOT_REACH + 10;
    const t = town([{ x: far, y: 5 }]);
    run(t, 20_000);
    expect(t.state.evictedPiles).toHaveLength(1);
    expect(t.state.garbageTrucks ?? []).toHaveLength(0);
  });

  it('a depot runs a few trucks at once, each to its own pile', () => {
    const t = town([{ x: 12, y: 5 }, { x: 16, y: 5 }, { x: 20, y: 5 }, { x: 24, y: 5 }]);
    run(t, 40);
    const trucks = t.state.garbageTrucks ?? [];
    expect(trucks.length).toBe(TRUCKS_PER_DEPOT);
    expect(new Set(trucks.map((k) => `${k.pile.x},${k.pile.y}`)).size).toBe(trucks.length);
    run(t, 60_000);
    expect(t.state.evictedPiles ?? []).toHaveLength(0);
  });

  it('no depot, no trucks: the piles stay', () => {
    const t = town([{ x: 20, y: 5 }]);
    for (let x = 3; x < 5; x++) for (let y = 3; y < 5; y++) t.map.built[t.map.idx(x, y)] = BuiltKind.None;
    run(t, 5000);
    expect(t.state.garbageTrucks ?? []).toHaveLength(0);
    expect(t.state.evictedPiles).toHaveLength(1);
  });
});

// Uncollected piles cost the street (Maddy 2026-10-21): land value nearby falls while they stand.
import { landValueAt } from '../../src/live/fields/landValue';
describe('a pile on the street', () => {
  it('drags the land value of the plots near it, and less the further off', () => {
    const map = new GameMap(30, 12);
    for (let x = 0; x < 30; x++) placeTransport(map, x, 5, BuiltKind.RoadStreet);
    const parcels = new ParcelStore();
    placeParcel(map, parcels, { x: 10, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    const clean = landValueAt(map, 10, 4);
    const near = landValueAt(map, 10, 4, undefined, undefined, undefined, undefined, undefined, undefined, new Set([map.idx(10, 5)]));
    const far = landValueAt(map, 10, 4, undefined, undefined, undefined, undefined, undefined, undefined, new Set([map.idx(13, 5)]));
    expect(near).toBeLessThan(clean);
    expect(far).toBeLessThan(clean);
    expect(far).toBeGreaterThan(near);
  });
});

// Wired into the live step (a first build called it only while food vans were out — caught live).
import { stepAmbient } from '../../src/live/step';
import { createRng } from '../../src/engine/rng';
describe('garbage in the running live layer', () => {
  it('the live step sends the trucks out, with no food vans on the road', () => {
    const t = town([{ x: 20, y: 5 }]);
    stepAmbient(t.state, t.map, createRng('g'), 3000);
    expect(t.state.vans ?? []).toHaveLength(0);
    expect(t.state.garbageTrucks?.length).toBe(1);
  });
});

// The landfill (Maddy 2026-10-21: "the depots should feed a landfill"): a truck hauls its load there before going
// home, and the landfill fills. Compost hubs and maker spaces divert a share of every load — less reaches the dump.
import { landfillFill, divertShare } from '../../src/live/garbage';
describe('hauling to the landfill', () => {
  function withLandfill(extras: (map: GameMap, parcels: ParcelStore) => void = () => {}) {
    const map = new GameMap(80, 12);
    const parcels = new ParcelStore();
    for (let x = 0; x < 80; x++) placeTransport(map, x, 5, BuiltKind.RoadStreet);
    placeParcel(map, parcels, { x: 3, y: 3, width: 2, height: 2, kind: BuiltKind.SanitationDepot });
    placeParcel(map, parcels, { x: 60, y: 6, width: 3, height: 3, kind: BuiltKind.Landfill });
    extras(map, parcels);
    const state = createAmbientState();
    state.evictedPiles = [{ x: 20, y: 5, seed: 0, hx: 0, hy: -1, age: 0 }];
    return { map, state };
  }
  const haul = (t: ReturnType<typeof withLandfill>) => {
    let dumped = false;
    for (let k = 0; k < 60_000 && !(dumped && !(t.state.garbageTrucks?.length)); k++) {
      stepGarbage(t.state, t.map);
      if (t.state.garbageTrucks?.[0]?.job === 'dumping') dumped = true;
    }
    return dumped;
  };

  it('after loading, the truck drives to the landfill and dumps, then goes home; the landfill fills by a load', () => {
    const t = withLandfill();
    expect(haul(t)).toBe(true);
    expect(t.state.evictedPiles).toHaveLength(0);
    expect(t.state.garbageTrucks ?? []).toHaveLength(0);
    expect(landfillFill(t.state)).toBeCloseTo(1, 6);
  });

  it('compost hubs and maker spaces divert part of each load', () => {
    const t = withLandfill((map, parcels) => {
      placeParcel(map, parcels, { x: 30, y: 6, width: 2, height: 2, kind: BuiltKind.CompostHub });
      placeParcel(map, parcels, { x: 34, y: 6, width: 2, height: 2, kind: BuiltKind.MakerSpace });
    });
    expect(divertShare(t.map)).toBeGreaterThan(0);
    haul(t);
    expect(landfillFill(t.state)).toBeLessThan(1);
    expect(landfillFill(t.state)).toBeCloseTo(1 - divertShare(t.map), 6);
  });

  it('diversion has a ceiling — some always reaches the dump', () => {
    const map = new GameMap(60, 60);
    const parcels = new ParcelStore();
    for (let k = 0; k < 40; k++) placeParcel(map, parcels, { x: (k % 10) * 5, y: Math.floor(k / 10) * 5, width: 2, height: 2, kind: BuiltKind.CompostHub });
    expect(divertShare(map)).toBeLessThan(1);
  });
});

// The landfill's harm (Maddy 2026-10-21): it poisons the ground round it and the water beside it, the more the fuller
// it is, and drags the land value near it. A new city's landfill already holds decades of the city's garbage.
import { accumulateGroundPollution, accumulateWaterRunoff, seedDecay } from '../../src/live/fields/pollution';
import { LANDFILL_HISTORY } from '../../src/live/garbage';
describe("the landfill's harm", () => {
  function dump(fill: number) {
    const map = new GameMap(20, 12);
    const parcels = new ParcelStore();
    placeParcel(map, parcels, { x: 8, y: 4, width: 3, height: 3, kind: BuiltKind.Landfill });
    for (let x = 0; x < 20; x++) map.water[map.idx(x, 7)] = 1; // a creek along its fence
    const state = createAmbientState();
    state.landfill.set(map.idx(8, 4), fill);
    return { map, state };
  }
  it('poisons the ground round it, more the fuller it is', () => {
    const empty = dump(0);
    const full = dump(400);
    for (let k = 0; k < 20; k++) {
      accumulateGroundPollution(empty.state, empty.map);
      accumulateGroundPollution(full.state, full.map);
    }
    const near = (s: ReturnType<typeof dump>) => s.state.groundPollution.get(s.map.idx(7, 5)) ?? 0; // beside its fence
    expect(near(empty)).toBeGreaterThan(0);
    expect(near(full)).toBeGreaterThan(near(empty));
  });
  it('leaches into the water beside it', () => {
    const d = dump(100);
    const map2 = new GameMap(20, 12);
    for (let x = 0; x < 20; x++) map2.water[map2.idx(x, 7)] = 1;
    const clean = createAmbientState();
    accumulateWaterRunoff(d.state, d.map);
    accumulateWaterRunoff(clean, map2);
    expect(d.state.waterPollution.get(d.map.idx(9, 7)) ?? 0).toBeGreaterThan(clean.waterPollution.get(map2.idx(9, 7)) ?? 0);
  });
  it('drags the land value of the homes near it', () => {
    const map = new GameMap(30, 12);
    const parcels = new ParcelStore();
    placeParcel(map, parcels, { x: 10, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    const clean = landValueAt(map, 10, 4);
    placeParcel(map, parcels, { x: 12, y: 4, width: 3, height: 3, kind: BuiltKind.Landfill });
    expect(landValueAt(map, 10, 4)).toBeLessThan(clean);
  });
  it("a new city's landfill already holds the city's history", () => {
    const { map, state } = dump(0);
    state.landfill.clear();
    seedDecay(state, map);
    expect(state.landfill.get(map.idx(8, 4))).toBe(LANDFILL_HISTORY);
  });
});

// Capping (Maddy 2026-10-21, the full loop): Rezone: Park over a landfill caps it — a park where the dump was. Its
// fill stops harming; what it already put in the ground heals in time (faster with greens near).
import { convertParcel } from '../../src/engine/fabric';
describe('capping the landfill', () => {
  it('rezoned to a park, it stops poisoning the ground round it', () => {
    const map = new GameMap(20, 12);
    const parcels = new ParcelStore();
    placeParcel(map, parcels, { x: 8, y: 4, width: 3, height: 3, kind: BuiltKind.Landfill });
    const state = createAmbientState();
    state.landfill.set(map.idx(8, 4), 300);
    expect(convertParcel(map, parcels, 9, 5, BuiltKind.Park)).toBe(true);
    accumulateGroundPollution(state, map);
    expect(state.landfill.size).toBe(0); // its fill is under the cap now
    const after = state.groundPollution.get(map.idx(7, 5)) ?? 0;
    for (let k = 0; k < 50; k++) accumulateGroundPollution(state, map);
    expect(state.groundPollution.get(map.idx(7, 5)) ?? 0).toBeLessThanOrEqual(after); // only healing from here
  });
});
