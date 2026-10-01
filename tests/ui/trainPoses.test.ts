import { describe, it, expect } from 'vitest';
import { trainPoses, type Train } from '../../src/ui/ambientContent';

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

import { syncTrainLegs, snapshotMovers, type AmbientState } from '../../src/ui/ambientContent';

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
