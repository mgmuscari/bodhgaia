import { describe, it, expect } from 'vitest';
import { carPose, pedPose } from '../../src/live/poses';
import { createAmbientState, type Mover } from '../../src/live/types';
import { POSE_REACH, viewRect, inRect, computeFramePoses, shareFramePoses, sharedFramePoses } from '../../src/ui/framePoses';

// A tiny seeded LCG so the property sweep is deterministic.
const lcg = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

/** A mover partway along a leg, with a snapshot from the previous substep (also on a leg). */
function randomMover(r: () => number): Mover {
  const leg = (): { x: number; y: number; dir: number; prevDir: number; tx: number; ty: number } => {
    const dir = Math.floor(r() * 4);
    const prevDir = Math.floor(r() * 4);
    const sx = Math.floor(r() * 40) + 10;
    const sy = Math.floor(r() * 40) + 10;
    const p = r();
    return { x: sx + DX[dir]! * p, y: sy + DY[dir]! * p, dir, prevDir, tx: sx + DX[dir]!, ty: sy + DY[dir]! };
  };
  const now = leg();
  // the snapshot is usually one substep behind; sometimes far away (a teleport: spawn / park / re-route)
  const near = r() < 0.8;
  const before = near ? { ...now, x: now.x - DX[now.dir]! * 0.3, y: now.y - DY[now.dir]! * 0.3 } : leg();
  const m: Mover = { ...now, snap: before } as Mover;
  if (r() < 0.15) (m as Mover & { parked?: boolean }).parked = true;
  if (r() < 0.1) { m.tx = m.x + 7; m.ty = m.y - 3; } // off-grid target (an idle / off-leg mover)
  return m;
}

describe('framePoses — cull on raw x/y before posing', () => {
  it('POSE_REACH bounds how far a draw pose sits from its mover (the invariant the raw cull relies on)', () => {
    const r = lcg(7);
    const road = (x: number, y: number): boolean => ((x * 7 + y * 3) & 1) === 0;
    let worst = 0;
    for (let i = 0; i < 4000; i++) {
      const m = randomMover(r);
      const alpha = r();
      for (const p of [carPose(m, alpha), pedPose(m, road, alpha), carPose(m, 1), pedPose(m, road, 1)]) {
        worst = Math.max(worst, Math.abs(p.x - m.x), Math.abs(p.y - m.y));
      }
    }
    expect(worst).toBeLessThan(POSE_REACH);
  });

  it('viewRect is the screen in world tiles, grown by the margin; inRect is inclusive', () => {
    const v = viewRect(10, 20, 32, 320, 160, 1); // camera at (10,20), 32 px tiles, 10×5 tiles on screen
    expect(v).toEqual({ x0: 9, y0: 19, x1: 21, y1: 26 });
    expect(inRect(v, 9, 19)).toBe(true);
    expect(inRect(v, 21, 26)).toBe(true);
    expect(inRect(v, 8.99, 20)).toBe(false);
    expect(inRect(v, 15, 26.01)).toBe(false);
  });

  it('poses only movers near the view, once each, in list order; skips peds inside or driving', () => {
    const st = createAmbientState();
    const mk = (x: number, y: number, extra: Partial<Mover> & { phase?: string } = {}): Mover =>
      ({ x, y, dir: 1, tx: x + 1, ty: y, ...extra }) as Mover;
    st.cars = [mk(5, 5), mk(500, 5), mk(6, 6, { parked: true } as Partial<Mover>)];
    st.cruisers = [mk(-400, 0), mk(7, 7)];
    st.peds = [mk(5, 6), mk(5, 7, { phase: 'inside' } as Partial<Mover>), mk(5, 8, { phase: 'driving' } as Partial<Mover>), mk(900, 900)];
    const rect = viewRect(0, 0, 16, 320, 320, 1); // world 0..20
    const fp = computeFramePoses(st, rect, 1, () => false);
    expect(fp.cars.map((e) => e.m)).toEqual([st.cars[0], st.cars[2]]);
    expect(fp.cruisers.map((e) => e.m)).toEqual([st.cruisers[1]]);
    expect(fp.peds.map((e) => e.m)).toEqual([st.peds[0]]);
    expect(fp.cars[0]!.pose).toEqual(carPose(st.cars[0]!, 1));
    expect(fp.peds[0]!.pose).toEqual(pedPose(st.peds[0]!, () => false, 1));
  });

  it('the shared frame is handed to the second renderer only while it still describes the same state', () => {
    const st = createAmbientState();
    st.cars = [{ x: 1, y: 1, dir: 1, tx: 2, ty: 1 } as Mover];
    const rect = viewRect(0, 0, 16, 160, 160, 1);
    const fp = computeFramePoses(st, rect, 0.5, () => false);
    expect(sharedFramePoses(st, 0.5)).toBeNull(); // nothing shared yet
    shareFramePoses(st, fp);
    expect(sharedFramePoses(st, 0.5)).toBe(fp);
    expect(sharedFramePoses(st, 0.25)).toBeNull(); // a different interpolation point → stale
    st.cars.push({ x: 3, y: 3, dir: 1, tx: 4, ty: 3 } as Mover);
    expect(sharedFramePoses(st, 0.5)).toBeNull(); // the population changed → stale
    expect(sharedFramePoses(createAmbientState(), 0.5)).toBeNull(); // another state
  });
});
