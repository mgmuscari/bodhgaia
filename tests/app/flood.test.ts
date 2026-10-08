// The flood controller: heavy rain floods the plain; a home under water is evacuated (its people unhoused for the
// duration) and its people come home when the water goes; the camera and the news are told.
import { describe, it, expect } from 'vitest';
import { GameMap, Water } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel } from '../../src/engine/fabric';
import { createAmbientState, setHouseholds } from '../../src/live/types';
import { createFloodController, FLOOD_STEP_MS } from '../../src/app/flood';

function town() {
  const map = new GameMap(30, 10);
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 30; x++) {
      const i = map.idx(x, y);
      if (x < 3) {
        map.water[i] = Water.Ocean;
        map.elevation[i] = 0.34;
      } else map.elevation[i] = 0.37 + (x - 3) * 0.01;
    }
  }
  const parcels = new ParcelStore();
  placeParcel(map, parcels, { x: 3, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle, condition: 200 });
  const live = createAmbientState();
  live.events = [];
  setHouseholds(live, [{ x: 3, y: 4, count: 10 }]);
  live.occupancy.set(map.idx(3, 4), 10);
  live.unhoused = 5;
  let hour = 0;
  const news: string[] = [];
  const flood = createFloodController({
    world: { map, parcels },
    live,
    hour: () => hour,
    disastersOn: () => true,
    markDirty: () => {},
    news: (t) => news.push(t),
  });
  let now = 0;
  const hourPasses = (heavy: boolean) => {
    live.rain = heavy ? { heavy: true } : undefined;
    hour++;
    now += FLOOD_STEP_MS;
    flood.frame(now);
  };
  return { map, live, news, hourPasses };
}

describe('the flood controller', () => {
  it('evacuates a home under water, and brings its people home when the water goes', () => {
    const t = town();
    t.hourPasses(true);
    t.hourPasses(true);
    expect(t.live.flooded!.has(t.map.idx(3, 4))).toBe(true);
    expect(t.live.occupancy.get(t.map.idx(3, 4))).toBe(0);
    expect(t.live.unhoused).toBe(15);
    expect(t.live.events!.filter((e) => e.kind === 'flood')).toHaveLength(1); // the camera, once
    expect(t.news.some((n) => n.startsWith('Flooding'))).toBe(true);
    for (let h = 0; h < 30; h++) t.hourPasses(false);
    expect(t.live.flooded!.size).toBe(0);
    expect(t.live.occupancy.get(t.map.idx(3, 4))).toBe(10);
    expect(t.live.unhoused).toBe(5);
  });

  it('light rain floods nothing', () => {
    const t = town();
    for (let h = 0; h < 5; h++) {
      t.live.rain = { heavy: false };
      t.hourPasses(false);
    }
    expect(t.live.flooded?.size ?? 0).toBe(0);
  });
});

describe('an evacuated home stays empty while it is under water', () => {
  it('the occupancy pass leaves a flooded home be', async () => {
    const { stepOccupancy } = await import('../../src/live/fields/occupancy');
    const t = town();
    t.hourPasses(true);
    t.hourPasses(true);
    const before = t.live.unhoused;
    for (let k = 0; k < 20; k++) stepOccupancy(t.live, t.map);
    expect(t.live.occupancy.get(t.map.idx(3, 4))).toBe(0);
    expect(t.live.unhoused).toBe(before);
  });
});
