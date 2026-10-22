// The neighbours clear their own block (Maddy 2026-10-21, garbage: "trucks + neighbours"): where Mutual Aid is
// practised and a neighbourhood belongs, the piles on its streets are cleared by the people who live there, a few an
// hour. And a pile left standing a day costs its neighbourhood belonging.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel, placeTransport } from '../../src/engine/fabric';
import { createAmbientState } from '../../src/live/types';
import { computeNeighborhoods } from '../../src/civic/neighborhoods';
import { createCivicState, SEED_BELONGING } from '../../src/civic/state';
import { createRng } from '../../src/engine/rng';
import { garbageHour, PILE_STALE } from '../../src/app/garbage';

function block(belonging: number) {
  const map = new GameMap(30, 12);
  for (let x = 0; x < 30; x++) placeTransport(map, x, 5, BuiltKind.RoadStreet);
  const parcels = new ParcelStore();
  for (let x = 2; x < 28; x += 2) placeParcel(map, parcels, { x, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle });
  const partition = computeNeighborhoods(map);
  const civic = createCivicState(partition);
  const hood = partition.tileToNeighborhood[map.idx(10, 4)]!;
  civic.setValues(hood, { ...civic.getValues(hood), belonging });
  const live = createAmbientState();
  live.evictedPiles = [6, 10, 14, 18].map((x, k) => ({ x, y: 4, seed: k, hx: 0, hy: 1, age: 0 }));
  return { map, partition, civic, live, hood };
}
const hours = (b: ReturnType<typeof block>, n: number, mutualAid: boolean) => {
  const rng = createRng('g');
  for (let h = 0; h < n; h++) garbageHour({ live: b.live, map: b.map, partition: b.partition, civic: b.civic, practised: (id) => mutualAid && id === 'mutual-aid', rng, news: () => {} });
};

describe('the neighbours clear their block', () => {
  it('with Mutual Aid and belonging, the piles go, a few an hour', () => {
    const b = block(230);
    hours(b, 1, true);
    expect(b.live.evictedPiles!.length).toBeGreaterThan(0); // not all at once
    hours(b, 48, true);
    expect(b.live.evictedPiles).toHaveLength(0);
  });
  it('without Mutual Aid, or where the neighbourhood barely belongs, they stay', () => {
    const none = block(230);
    hours(none, 48, false);
    expect(none.live.evictedPiles).toHaveLength(4);
    const frayed = block(SEED_BELONGING);
    hours(frayed, 48, true);
    expect(frayed.live.evictedPiles).toHaveLength(4);
  });
  it('a pile left a day costs its neighbourhood belonging', () => {
    const b = block(150);
    for (const p of b.live.evictedPiles!) p.age = PILE_STALE;
    const before = b.civic.getValues(b.hood).belonging;
    hours(b, 3, false);
    expect(b.civic.getValues(b.hood).belonging).toBeLessThan(before);
  });
});
