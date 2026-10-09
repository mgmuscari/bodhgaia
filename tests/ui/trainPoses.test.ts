import { describe, it, expect } from 'vitest';
import { trainPoses } from '../../src/live/poses';
import type { Train } from '../../src/live/types';

// Trains move like the other sprite movers (Maddy 2026-09-30): every car interpolates (not just the
// locomotive), and the consist rounds a bend in the same quarter arcs cars do, one car after another.
const W = 20;
const idx = (x: number, y: number): number => y * W + x;

/** A train whose head has just left (hx,hy)=cells[0] heading `dir`, at progress p into the next tile. */
function train(cells: Array<[number, number]>, dir: number, p: number): Train {
  const [hx, hy] = cells[0]!;
  const DX = [0, 1, 0, -1];
  const DY = [-1, 0, 1, 0];
  return { cells: cells.map(([x, y]) => idx(x, y)), hx: hx + DX[dir]! * p, hy: hy + DY[dir]! * p, tx: hx + DX[dir]!, ty: hy + DY[dir]!, dir };
}

// An L of track: the train came south down x=5 and turns east at (5,8): cells head-first.
const L: Array<[number, number]> = [[5, 8], [5, 7], [5, 6], [5, 5]];

describe('trainPoses', () => {
  it('one pose per car, the locomotive first', () => {
    expect(trainPoses(train(L, 1, 0.3), W)).toHaveLength(L.length);
  });

  it('every car moves continuously as the train advances — no car snaps tile to tile', () => {
    let prev = trainPoses(train(L, 1, 0), W);
    for (let i = 1; i < 40; i++) {
      // p = 1 is never drawn: arrival becomes the next leg's p = 0 (the hand-off test below)
      const now = trainPoses(train(L, 1, i / 40), W);
      now.forEach((q, k) => {
        expect(Math.hypot(q.x - prev[k]!.x, q.y - prev[k]!.y), `car ${k} step ${i}`).toBeLessThan(0.06);
      });
      prev = now;
    }
  });

  it('the hand-off to the next tile is seamless (end of one leg = start of the next)', () => {
    const before = trainPoses(train(L, 1, 1 - 1e-9), W);
    // the head arrives at (6,8): it is pushed onto cells and the tail drops; it carries on east
    const after = trainPoses(train([[6, 8], [5, 8], [5, 7], [5, 6]], 1, 0), W);
    after.forEach((q, k) => expect(Math.hypot(q.x - before[k]!.x, q.y - before[k]!.y), `car ${k}`).toBeLessThan(1e-6));
  });

  it('a car rounds the bend: mid-corner its heading is diagonal, not a 90° flip', () => {
    // the car crossing the corner tile (5,8) while the head crosses (6,8): car 1, at mid-progress
    const q = trainPoses(train([[6, 8], [5, 8], [5, 7], [5, 6]], 1, 0.5), W)[1]!;
    expect(Math.abs(q.hx)).toBeGreaterThan(0.5);
    expect(Math.abs(q.hy)).toBeGreaterThan(0.5);
  });

  it('cars trail one tile apart along straight track', () => {
    const qs = trainPoses(train([[5, 9], [5, 8], [5, 7], [5, 6]], 2, 0.4), W);
    for (let k = 1; k < qs.length; k++) expect(qs[k - 1]!.y - qs[k]!.y).toBeCloseTo(1, 6);
  });
});

import { syncTrainLegs, snapshotMovers } from '../../src/live/poses';
import type { AmbientState } from '../../src/live/types';

describe('trains run on the shared mover path (Maddy 2026-09-30: "move train sprites into the same mover code")', () => {
  it('each car is a Mover the substep snapshot covers, so a frame between substeps blends like a car', () => {
    const t = train(L, 1, 0.2);
    syncTrainLegs(t, W);
    expect(t.cars).toHaveLength(L.length);
    const before = trainPoses(t, W);
    snapshotMovers({ cars: [], cruisers: [], peds: [], trains: [t] } as unknown as AmbientState);
    // one substep: the locomotive moves on, the legs re-sync (keeping their snapshots)
    t.hx += 0.16;
    syncTrainLegs(t, W);
    const after = trainPoses(t, W);
    const at0 = trainPoses(t, W, 0);
    const half = trainPoses(t, W, 0.5);
    at0.forEach((q, k) => expect(Math.hypot(q.x - before[k]!.x, q.y - before[k]!.y), `alpha 0, car ${k}`).toBeLessThan(1e-9));
    half.forEach((q, k) => {
      expect(q.x).toBeCloseTo((before[k]!.x + after[k]!.x) / 2, 9);
      expect(q.y).toBeCloseTo((before[k]!.y + after[k]!.y) / 2, 9);
    });
  });
});

// Maddy 2026-10-08: "streetcars that stop at corners have one car that leaves the track because the whole consist is
// in a straight line at a stop". The last car had no tile behind it to bend from, so on a corner tile it was drawn
// straight across — off the rails. The trail remembers the tile it last dropped, and the tail rounds the bend too.
describe('the last car keeps to the track on a corner', () => {
  it('halted with its tail on the corner tile, the tail car is posed on the corner’s arc, not straight across it', () => {
    // the tram came south down x=5, turned east at the corner (5,8), and stopped with its head on (6,8)
    const t = train([[6, 8], [5, 8]], 1, 0);
    t.behind = idx(5, 7);
    const tail = trainPoses(t, W)[1]!;
    // its tile's entry is the north edge (it came from (5,7)): at p = 0 it stands there, heading south
    expect(tail.x).toBeCloseTo(5.5, 6);
    expect(tail.y).toBeCloseTo(8, 6);
    expect(tail.hy).toBeCloseTo(1, 6);
  });

  it('a train remembers the tile its tail just left', async () => {
    const { GameMap } = await import('../../src/engine/map');
    const { BuiltKind } = await import('../../src/engine/fabric');
    const { stepTrain } = await import('../../src/live/trains');
    const { createRng } = await import('../../src/engine/rng');
    const map = new GameMap(W, W);
    for (let y = 2; y <= 8; y++) map.setBuilt(5, y, BuiltKind.Streetcar);
    for (let x = 6; x <= 12; x++) map.setBuilt(x, 8, BuiltKind.Streetcar);
    const t: Train = { cells: [idx(5, 5), idx(5, 4)], hx: 5, hy: 5, tx: 5, ty: 6, dir: 2, family: 'tram' };
    const rng = createRng(1);
    for (let i = 0; i < 400 && t.cells[0] !== idx(7, 8); i++) stepTrain(map, t, rng);
    expect(t.cells).toEqual([idx(7, 8), idx(6, 8)]);
    expect(t.behind).toBe(idx(5, 8));
  });
});

// Maddy 2026-10-08: "we've got the trailing tram car is in the wrong place bug back" — after a reload. Vehicles respawn
// on one tile and stretch out as they ride, so until a fresh tram had dropped its first tile it had no tile behind its
// tail, and a halt with the tail on a corner drew it straight across again. A tram is spawned knowing where it came from.
describe('a freshly spawned vehicle knows the tile behind it', () => {
  it('every spawn on a tile with track behind it records that tile — never the tile it is heading to', async () => {
    const { GameMap } = await import('../../src/engine/map');
    const { BuiltKind } = await import('../../src/engine/fabric');
    const { spawnTransit } = await import('../../src/live/trains');
    const { createRng } = await import('../../src/engine/rng');
    const { createAmbientState } = await import('../../src/live/types');
    const map = new GameMap(W, W);
    for (let y = 2; y <= 8; y++) map.setBuilt(5, y, BuiltKind.Streetcar);
    for (let x = 6; x <= 12; x++) map.setBuilt(x, 8, BuiltKind.Streetcar);
    const isTrack = (i: number) => map.built[i] === BuiltKind.Streetcar;
    let checked = 0;
    for (let seed = 0; seed < 40; seed++) {
      const state = createAmbientState();
      spawnTransit(state, map, createRng(seed));
      const t = state.trains[0];
      if (!t) continue;
      const s = t.cells[0]!;
      const sx = s % W;
      const sy = Math.floor(s / W);
      const neighbours = [idx(sx, sy - 1), idx(sx + 1, sy), idx(sx, sy + 1), idx(sx - 1, sy)].filter(isTrack);
      const next = idx(t.tx, t.ty);
      if (neighbours.length < 2) continue; // a line's end: nothing behind
      expect(t.behind, `seed ${seed}`).toBeDefined();
      expect(neighbours).toContain(t.behind);
      expect(t.behind).not.toBe(next);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });
});
