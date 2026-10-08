import { describe, it, expect } from 'vitest';
import { GameMap, Water } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel } from '../../src/engine/fabric';
import { tourStops, glide } from '../../src/ui/tourContent';

function city() {
  const map = new GameMap(80, 60);
  const parcels = new ParcelStore();
  for (let y = 10; y < 18; y++) for (let x = 10; x < 18; x++) placeParcel(map, parcels, { x, y, width: 1, height: 1, kind: BuiltKind.HouseSingle });
  for (let y = 40; y < 50; y++) for (let x = 50; x < 60; x++) map.floraVitality[map.idx(x, y)] = 250;
  for (let y = 0; y < 60; y++) map.water[map.idx(75, y)] = Water.River;
  for (let y = 20; y < 28; y++) placeParcel(map, parcels, { x: 74, y, width: 1, height: 1, kind: BuiltKind.HouseSingle });
  return { map, parcels };
}

describe('tourStops: the heart, the green, the water, then the whole city', () => {
  it('finds each from the map, and ends wide on the whole city', () => {
    const { map, parcels } = city();
    const [heart, green, water, whole] = tourStops(map, parcels);
    expect(Math.abs(heart!.x - 14) + Math.abs(heart!.y - 14)).toBeLessThanOrEqual(4);
    expect(Math.abs(green!.x - 55) + Math.abs(green!.y - 45)).toBeLessThanOrEqual(5);
    expect(Math.abs(water!.x - 74) + Math.abs(water!.y - 24)).toBeLessThanOrEqual(5);
    // the whole CITY, not the map's middle (lotus's middle is open ocean): the centre of everything built
    expect(whole).toEqual({ x: 42, y: 18, zoom: 1 });
  });

  it('is deterministic', () => {
    const a = city();
    const b = city();
    expect(tourStops(a.map, a.parcels)).toEqual(tourStops(b.map, b.parcels));
  });
});

describe('glide: an eased move between two points', () => {
  it('starts at the first, ends at the second, eases in and out', () => {
    expect(glide({ x: 0, y: 0 }, { x: 10, y: 20 }, 0)).toEqual({ x: 0, y: 0 });
    expect(glide({ x: 0, y: 0 }, { x: 10, y: 20 }, 1)).toEqual({ x: 10, y: 20 });
    expect(glide({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5).x).toBeCloseTo(5, 9);
    expect(glide({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.1).x).toBeLessThan(1); // slow start
    expect(glide({ x: 0, y: 0 }, { x: 10, y: 0 }, 2)).toEqual({ x: 10, y: 0 }); // clamps
  });
});
