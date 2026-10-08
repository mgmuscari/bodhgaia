// Where walkers go and where they stand (Maddy 2026-10-08): residents shouldn't cut through back yards, and
// shouldn't walk down the middle of an avenue.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, placeTransport } from '../../src/engine/fabric';
import { pedCost } from '../../src/live/pathing';
import { pedPose } from '../../src/live/poses';
import { isRoadKind } from '../../src/engine/fabric';

describe('back yards', () => {
  it("are someone's home: a last resort on foot, dearer than even a busy avenue", () => {
    const map = new GameMap(10, 10);
    map.built[map.idx(3, 3)] = BuiltKind.Yard;
    placeTransport(map, 5, 5, BuiltKind.RoadAvenue);
    placeTransport(map, 7, 7, BuiltKind.RoadStreet);
    const busy = new Map([[map.idx(5, 5), 255]]);
    expect(pedCost(map, 3, 3)).toBeGreaterThan(pedCost(map, 5, 5, undefined, busy));
    expect(pedCost(map, 3, 3)).toBeGreaterThan(pedCost(map, 7, 7));
  });
});

describe('avenues', () => {
  // a two-lane avenue along rows 5 and 6
  const map = new GameMap(20, 12);
  for (let x = 0; x < 20; x++) for (const y of [5, 6]) placeTransport(map, x, y, BuiltKind.RoadAvenue);
  const onRoad = (x: number, y: number) => map.inBounds(x, y) && isRoadKind(map.built[map.idx(x, y)]!);
  const walker = (y: number, dir: number) => ({ x: 8, y, dir, tx: 8 + (dir === 1 ? 1 : -1), ty: y });

  it('walkers keep to the kerb of the lane they are on — never the middle of the road', () => {
    // walking east (right = south): on the north lane they keep north, on the south lane south
    expect(pedPose(walker(5, 1) as never, onRoad).y).toBeLessThan(5.5);
    expect(pedPose(walker(6, 1) as never, onRoad).y).toBeGreaterThan(6.5);
    // and walking west the same — the kerb, whichever way they face
    expect(pedPose(walker(5, 3) as never, onRoad).y).toBeLessThan(5.5);
    expect(pedPose(walker(6, 3) as never, onRoad).y).toBeGreaterThan(6.5);
  });

  it('on a one-lane street they still walk on their right', () => {
    const street = new GameMap(20, 12);
    for (let x = 0; x < 20; x++) placeTransport(street, x, 5, BuiltKind.RoadStreet);
    const on = (x: number, y: number) => street.inBounds(x, y) && isRoadKind(street.built[street.idx(x, y)]!);
    expect(pedPose(walker(5, 1) as never, on).y).toBeGreaterThan(5.5); // east: right is south
    expect(pedPose(walker(5, 3) as never, on).y).toBeLessThan(5.5); // west: right is north
  });
});
