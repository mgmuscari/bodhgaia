// Walkers keep to the sidewalks (Maddy 2026-10-06: "demand pathing is still way too strong"). People
// keep to the street network unless it fails them: a desire path forms where no street connects, never
// because a stroad is busy, a corner can be shaved, or a citizen stepped out of its home's back yard.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { createAmbientState } from '../../src/live/types';
import { stepAmbient } from '../../src/live/step';
import { pedCost, walkPath } from '../../src/live/pathing';
import { respawnAtHome } from '../../src/live/agents';
import { TRAFFIC_MAX } from '../../src/live/tuning';

const rngFor = (seed: string) => createRng(seed).fork('ambient');
const lay = (map: GameMap, kind: number, x0: number, y0: number, x1: number, y1: number): void => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) map.built[map.idx(x, y)] = kind;
};
const offRoadTiles = (map: GameMap, path: readonly number[]): number[] =>
  path.filter((i) => map.built[i] === BuiltKind.None);

describe('walkers keep to the sidewalk — the street network first', () => {
  it('bare ground, even a beaten path, costs more than a jammed stroad sidewalk', () => {
    const map = new GameMap(8, 8);
    map.built[map.idx(1, 1)] = BuiltKind.RoadAvenue;
    const stroad = pedCost(map, 1, 1, undefined, new Map([[map.idx(1, 1), TRAFFIC_MAX]]));
    expect(pedCost(map, 4, 4)).toBeGreaterThan(stroad);
    expect(pedCost(map, 4, 4, new Map([[map.idx(4, 4), 255]]))).toBeGreaterThan(stroad);
  });

  it('takes a short stroad detour rather than cutting across a vacant lot', () => {
    // an avenue with a 3-tile vacant gap at y=2, bridged one row down at y=3 (a 1.5x detour)
    const map = new GameMap(12, 8);
    lay(map, BuiltKind.RoadAvenue, 1, 2, 3, 2);
    lay(map, BuiltKind.RoadAvenue, 7, 2, 9, 2);
    lay(map, BuiltKind.RoadAvenue, 3, 3, 7, 3);
    map.built[map.idx(10, 2)] = BuiltKind.HouseSingle;
    const route = walkPath(map, 1, 2, 10, 2);
    expect(route).not.toBeNull();
    expect(offRoadTiles(map, route!)).toEqual([]);
  });

  it('still beats a desire path across open ground where NO street connects', () => {
    // two street stubs with no link between them: the gap can only be crossed on foot
    const map = new GameMap(16, 8);
    lay(map, BuiltKind.RoadStreet, 1, 4, 4, 4);
    lay(map, BuiltKind.RoadStreet, 10, 4, 13, 4);
    map.built[map.idx(14, 4)] = BuiltKind.CommercialStrip;
    const route = walkPath(map, 1, 4, 14, 4);
    expect(route).not.toBeNull();
    expect(offRoadTiles(map, route!).length).toBeGreaterThan(0);

    const state = createAmbientState();
    state.peds.push({ x: 1, y: 4, dir: 0, tx: 1, ty: 4, walkTo: { x: 14, y: 4 } });
    const rng = rngFor('desire');
    for (let i = 0; i < 200; i++) stepAmbient(state, map, rng, 50);
    let worn = 0;
    for (let x = 5; x <= 9; x++) if ((state.wear.get(map.idx(x, 4)) ?? 0) > 0) worn++;
    expect(worn).toBeGreaterThan(2); // a trodden line across the gap
  });
});

describe('a home is entered and left by its street door, not its back yard', () => {
  /** A 1x2 home (anchor (5,4), second tile (5,5)) on a street at y=6; yard ground on every other side. */
  const tallHome = (): GameMap => {
    const map = new GameMap(12, 10);
    lay(map, BuiltKind.RoadStreet, 0, 6, 11, 6);
    map.built[map.idx(5, 4)] = BuiltKind.HouseSingle;
    map.built[map.idx(5, 5)] = BuiltKind.HouseSingle;
    map.parcel[map.idx(5, 4)] = 1;
    map.parcel[map.idx(5, 5)] = 1;
    return map;
  };

  it('a single-tile home: the citizen steps out onto the street side', () => {
    const map = new GameMap(12, 10);
    lay(map, BuiltKind.RoadStreet, 0, 6, 11, 6);
    map.built[map.idx(5, 5)] = BuiltKind.HouseSingle; // yard ground N/E/W, street S
    const state = createAmbientState();
    const p = { x: 0, y: 6, dir: 0, tx: 0, ty: 6, homeTile: map.idx(5, 5) };
    expect(respawnAtHome(state, p, map)).toBe(true);
    expect([p.x, p.y]).toEqual([5, 6]);
  });

  it('a multi-tile home: the door is any street tile beside the footprint', () => {
    const map = tallHome();
    const state = createAmbientState();
    const p = { x: 0, y: 6, dir: 0, tx: 0, ty: 6, homeTile: map.idx(5, 4) };
    expect(respawnAtHome(state, p, map)).toBe(true);
    expect([p.x, p.y]).toEqual([5, 6]);
  });

  it('walking home along the street, the citizen arrives at the front, never round the back', () => {
    const map = tallHome();
    const state = createAmbientState();
    state.peds.push({ x: 1, y: 6, dir: 0, tx: 1, ty: 6, homeTile: map.idx(5, 4), phase: 'to-home', walkTo: { x: 5, y: 4 } });
    const rng = rngFor('front-door');
    const stood = new Set<number>();
    for (let i = 0; i < 200 && state.peds.length > 0; i++) {
      stepAmbient(state, map, rng, 50);
      for (const q of state.peds) stood.add(map.idx(Math.round(q.x), Math.round(q.y)));
    }
    expect(state.peds.length).toBe(0); // got home and went in
    expect([...stood].filter((i) => map.built[i] === BuiltKind.None)).toEqual([]);
  });
});
