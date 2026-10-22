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
