// Encampments (Maddy 2026-10-08): the unhoused are people, and they live somewhere — in tents, at encampments.
// Someone put out of a home goes to the camp nearest it (or starts one on open land nearby); someone re-housed
// leaves the camp nearest their new home. Tents are the people in them, not the wear of a desire path.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel, placeTransport } from '../../src/engine/fabric';
import { createAmbientState } from '../../src/live/types';
import { leftHome, wentHome, settleCamps, tentsAt, CAMP_CAP, PEOPLE_PER_TENT } from '../../src/live/camps';

const total = (m: ReadonlyMap<number, number> | undefined) => [...(m ?? new Map()).values()].reduce((a, b) => a + b, 0);
const dist = (map: GameMap, a: number, x: number, y: number) => Math.abs((a % map.width) - x) + Math.abs(Math.floor(a / map.width) - y);

function town() {
  const map = new GameMap(40, 30);
  const parcels = new ParcelStore();
  for (let x = 0; x < 40; x++) placeTransport(map, x, 10, BuiltKind.RoadStreet);
  placeParcel(map, parcels, { x: 5, y: 9, width: 1, height: 1, kind: BuiltKind.HouseSingle });
  placeParcel(map, parcels, { x: 35, y: 9, width: 1, height: 1, kind: BuiltKind.HouseSingle });
  const state = createAmbientState();
  state.households = [{ x: 5, y: 9, count: 10 }, { x: 35, y: 9, count: 10 }] as never;
  return { map, parcels, state };
}

describe('encampments', () => {
  it('someone put out of a home goes to a camp on open land near it; the camps hold exactly the unhoused', () => {
    const { map, state } = town();
    leftHome(state, map.idx(5, 9), 3);
    settleCamps(state, map);
    expect(state.unhoused).toBe(3);
    expect(total(state.camps)).toBeCloseTo(3, 9);
    const [camp] = [...state.camps!.keys()];
    expect(dist(map, camp!, 5, 9)).toBeLessThanOrEqual(3);
    expect(map.built[camp!]).toBe(BuiltKind.None); // open land, not the road or a home
  });

  it('a camp fills, then the next starts beside it', () => {
    const { map, state } = town();
    leftHome(state, map.idx(5, 9), CAMP_CAP + 5);
    settleCamps(state, map);
    const camps = [...state.camps!.entries()];
    expect(camps).toHaveLength(2);
    expect(Math.max(...camps.map(([, n]) => n))).toBeCloseTo(CAMP_CAP, 9);
    for (const [t] of camps) expect(dist(map, t, 5, 9)).toBeLessThanOrEqual(4);
  });

  it('someone re-housed leaves the camp nearest their new home; an empty camp is gone', () => {
    const { map, state } = town();
    leftHome(state, map.idx(5, 9), 4);
    leftHome(state, map.idx(35, 9), 4);
    settleCamps(state, map);
    wentHome(state, map.idx(35, 9), 4);
    settleCamps(state, map);
    expect(state.unhoused).toBe(4);
    const camps = [...state.camps!.keys()];
    expect(camps).toHaveLength(1);
    expect(dist(map, camps[0]!, 5, 9)).toBeLessThanOrEqual(3); // the far camp emptied, not the near one
  });

  it('building over a camp moves its people to open land nearby', () => {
    const { map, parcels, state } = town();
    leftHome(state, map.idx(5, 9), 4);
    settleCamps(state, map);
    const [camp] = [...state.camps!.keys()];
    const x = camp! % map.width;
    placeParcel(map, parcels, { x, y: Math.floor(camp! / map.width), width: 1, height: 1, kind: BuiltKind.CommercialStrip });
    settleCamps(state, map);
    expect(state.camps!.has(camp!)).toBe(false);
    expect(total(state.camps)).toBeCloseTo(4, 9);
  });

  it('people the pool gained with no home named (an older save) camp by the emptiest homes', () => {
    const { map, state } = town();
    state.occupancy.set(map.idx(5, 9), 10);
    state.occupancy.set(map.idx(35, 9), 2); // eight gone from here
    state.unhoused = 8;
    settleCamps(state, map);
    expect(total(state.camps)).toBeCloseTo(8, 9);
    for (const t of state.camps!.keys()) expect(dist(map, t, 35, 9)).toBeLessThanOrEqual(4);
  });

  it('the unhoused who die or are taken leave the camps too', () => {
    const { map, state } = town();
    leftHome(state, map.idx(5, 9), 6);
    settleCamps(state, map);
    state.unhoused -= 2; // a death, unattributed
    settleCamps(state, map);
    expect(total(state.camps)).toBeCloseTo(4, 9);
  });

  it('tents are the people in them: one a few people, up to three a camp; none for nobody', () => {
    expect(tentsAt(0)).toBe(0);
    expect(tentsAt(0.3)).toBe(0);
    expect(tentsAt(1)).toBe(1);
    expect(tentsAt(PEOPLE_PER_TENT + 1)).toBe(2);
    expect(tentsAt(CAMP_CAP)).toBe(3);
    expect(tentsAt(CAMP_CAP * 4)).toBe(3);
  });
});

describe('camps gather, they do not scatter (Maddy\'s city: 363 people in 327 camps)', () => {
  it('a trickle of fractions from homes across a district gathers into a few camps, each with tents', () => {
    const map = new GameMap(60, 40);
    const state = createAmbientState();
    for (let pass = 0; pass < 60; pass++) {
      for (let x = 5; x < 55; x += 3) leftHome(state, map.idx(x, 20), 0.15); // every home sheds a little, every pass
      settleCamps(state, map);
    }
    const camps = [...state.camps!.values()];
    expect(total(state.camps)).toBeCloseTo(state.unhoused, 6);
    expect(camps.length).toBeLessThanOrEqual(Math.ceil(state.unhoused / CAMP_CAP) + 4);
    for (const n of camps) expect(tentsAt(n), String(n)).toBeGreaterThan(0);
  });
});

describe('no dust camps', () => {
  it('a fraction of a person far from any camp joins the nearest real camp instead of founding its own', () => {
    const { map, state } = town();
    leftHome(state, map.idx(5, 9), 8); // a real camp by the first home
    settleCamps(state, map);
    leftHome(state, map.idx(14, 9), 0.1); // a fraction, beyond CAMP_REACH of it
    settleCamps(state, map);
    expect([...state.camps!.values()].filter((n) => n < 0.5)).toHaveLength(0);
    expect(total(state.camps)).toBeCloseTo(8.1, 9);
  });
});
