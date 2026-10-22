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
