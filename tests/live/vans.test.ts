// Delivery vans (interdependence §2, step 3c): each hour's food-bank run to a pantry is a van on the roads — out to the
// pantry, a moment unloading, back to the bank, gone. At most VAN_CAP at once.
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel, placeTransport } from '../../src/engine/fabric';
import { createAmbientState } from '../../src/live/types';
import { spawnVans, stepVans, VAN_CAP } from '../../src/live/vans';

function town() {
  const map = new GameMap(40, 12);
  const parcels = new ParcelStore();
  for (let x = 0; x < 40; x++) placeTransport(map, x, 5, BuiltKind.RoadStreet);
  placeParcel(map, parcels, { x: 3, y: 3, width: 2, height: 2, kind: BuiltKind.FoodBank });
  placeParcel(map, parcels, { x: 30, y: 6, width: 1, height: 1, kind: BuiltKind.Pantry });
  const state = createAmbientState();
  state.foodRuns = [{ from: map.idx(3, 3), to: map.idx(30, 6), amount: 10 }];
  return { map, state };
}

describe('delivery vans', () => {
  it('a run becomes a van at the bank; the runs are taken', () => {
    const t = town();
    spawnVans(t.state, t.map);
    expect(t.state.vans).toHaveLength(1);
    expect(t.state.foodRuns).toEqual([]);
    expect(Math.abs(t.state.vans![0]!.x - 4)).toBeLessThanOrEqual(2);
  });
  it('it drives to the pantry, unloads, drives back and is gone', () => {
    const t = town();
    spawnVans(t.state, t.map);
    let reached = false;
    let n = 0;
    while ((t.state.vans?.length ?? 0) > 0 && n < 20_000) {
      stepVans(t.state, t.map);
      const v = t.state.vans?.[0];
      if (v && Math.abs(v.x - 30) <= 1 && v.run === 'unload') reached = true;
      n++;
    }
    expect(reached).toBe(true);
    expect(t.state.vans ?? []).toHaveLength(0);
  });
  it('never more than VAN_CAP on the road', () => {
    const t = town();
    t.state.foodRuns = Array.from({ length: VAN_CAP + 5 }, () => ({ from: t.map.idx(3, 3), to: t.map.idx(30, 6), amount: 1 }));
    spawnVans(t.state, t.map);
    expect(t.state.vans!.length).toBe(VAN_CAP);
  });
});
