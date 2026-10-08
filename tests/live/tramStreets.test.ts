// A streetcar line is a street (Maddy 2026-10-08): cars drive it alongside the trams, out in its outer lanes clear
// of the rails; walkers keep to its small kerbs; nobody parks on the tracks.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, placeTransport } from '../../src/engine/fabric';
import { canDrive, carPassable, isParkable } from '../../src/live/network';
import { carPose, pedPose, streetAt, TRAM_STREET_LANE, laneOnTile } from '../../src/live/poses';
import { PED_CURB } from '../../src/live/geometry';
import type { Ped } from '../../src/live/types';
import { LANE } from '../../src/live/geometry';
import type { Car } from '../../src/live/types';

function street() {
  const map = new GameMap(30, 9);
  for (let x = 1; x <= 9; x++) placeTransport(map, x, 4, BuiltKind.RoadStreet);
  for (let x = 10; x <= 20; x++) map.setBuilt(x, 4, BuiltKind.Streetcar); // the street carries on as a tram street
  for (let x = 21; x <= 28; x++) placeTransport(map, x, 4, BuiltKind.RoadStreet);
  return map;
}

describe('tram streets', () => {
  it('cars drive along them, but never park on the tracks', () => {
    const map = street();
    expect(carPassable(map, 15, 4)).toBe(true);
    expect(canDrive(map, 14, 4, 15, 4)).toBe(true);
    expect(canDrive(map, 9, 4, 10, 4)).toBe(true);
    expect(isParkable(map, 15, 4)).toBe(false);
  });

  it('cars run in the outer lanes there, clear of the rails, and ease across between street and tram street', () => {
    const map = street();
    const laneAt = laneOnTile(map);
    expect(laneAt(15, 4)).toBe(TRAM_STREET_LANE);
    expect(laneAt(5, 4)).toBe(LANE);
    const car: Car = { x: 2, y: 4, dir: 1, tx: 3, ty: 4 } as Car;
    let last: { x: number; y: number } | null = null;
    let worstSide = 0;
    let midTram = 0;
    for (let step = 0; step < 26 * 10; step++) {
      // drive east a tenth of a tile a step
      car.x += 0.1;
      if (car.x >= car.tx - 1e-9) {
        car.x = car.tx;
        car.prevDir = 1;
        car.tx += 1;
      }
      const pose = carPose(car, 1, laneAt);
      if (Math.abs(car.x - 14.5) < 0.05) midTram = pose.y - 4.5;
      if (last) worstSide = Math.max(worstSide, Math.abs(pose.y - last.y));
      last = { x: pose.x, y: pose.y };
    }
    expect(midTram).toBeCloseTo(TRAM_STREET_LANE, 5); // eastbound keeps right (south, y-down)
    expect(worstSide).toBeLessThan(0.05); // eased across, never a hop
  });

  it('walkers keep to its kerbs, never the middle (Maddy 2026-10-08)', () => {
    const map = street();
    const p = { x: 15, y: 4, dir: 1, tx: 15, ty: 4, homeTile: 7 } as Ped;
    const pose = pedPose(p, streetAt(map), 1);
    expect(Math.abs(pose.y - 4.5)).toBeCloseTo(PED_CURB, 5);
  });

  it('a tram MEDIAN between two avenues is still only crossed, never driven along', () => {
    const m = new GameMap(14, 10);
    for (let x = 0; x < 14; x++) {
      m.built[m.idx(x, 4)] = BuiltKind.RoadAvenue;
      m.built[m.idx(x, 5)] = BuiltKind.Streetcar;
      m.built[m.idx(x, 6)] = BuiltKind.RoadAvenue;
    }
    expect(canDrive(m, 4, 5, 5, 5)).toBe(false); // along the median
    expect(canDrive(m, 5, 4, 5, 5)).toBe(true); // across it, to the avenue beyond
  });
});
