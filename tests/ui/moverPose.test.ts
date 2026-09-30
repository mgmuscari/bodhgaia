import { describe, it, expect } from 'vitest';
import { moverPose, commitHeading, type Mover } from '../../src/ui/ambientContent';

// Headings: 0=N 1=E 2=S 3=W (screen y-down). A leg runs from the tile at (tx - dx, ty - dy) to (tx, ty);
// the pose is drawn half a tile behind the sim position, so across one leg it crosses the start tile
// from its entry edge to its exit edge — straight, or round a quarter-circle at a turn.
const mover = (x: number, y: number, dir: number, prevDir: number): Mover => {
  const dx = [0, 1, 0, -1][dir]!;
  const dy = [-1, 0, 1, 0][dir]!;
  // leg start tile = (x, y) at progress 0; target = start + dir
  return { x, y, dir, prevDir, tx: x + dx, ty: y + dy } as Mover;
};
// p = 1 itself never renders (the sim commits the next leg on arrival), so sample just short of it
const at = (m: Mover, p: number): Mover => {
  const dx = [0, 1, 0, -1][m.dir]!;
  const dy = [-1, 0, 1, 0][m.dir]!;
  const q = Math.min(p, 1 - 1e-9);
  return { ...m, x: m.tx - dx * (1 - q), y: m.ty - dy * (1 - q) };
};
const close = (a: number, b: number): void => expect(Math.abs(a - b)).toBeLessThan(1e-6);

describe('moverPose — smooth motion through tiles and turns', () => {
  it('straight: crosses the start tile from its entry edge to its exit edge, on the right-hand lane', () => {
    const m = mover(5, 5, 1, 1); // heading E, was heading E
    const p0 = moverPose(at(m, 0), 0.2);
    close(p0.x, 5); // west edge of tile (5,5)
    close(p0.y, 5.5 + 0.2); // right of an eastbound heading is south (y-down)
    const p1 = moverPose(at(m, 1), 0.2);
    close(p1.x, 6);
    close(p0.hx, 1);
    close(p0.hy, 0);
  });

  it('a right turn (N→E) rides a quarter-circle round the SE corner (it enters from the south), inside radius 0.5 − lane', () => {
    const m = mover(5, 5, 1, 0); // now heading E, was heading N → turned right at tile (5,5)
    const start = moverPose(at(m, 0), 0.2);
    const mid = moverPose(at(m, 0.5), 0.2);
    const end = moverPose(at(m, 1), 0.2);
    close(start.hx, 0);
    close(start.hy, -1); // still facing north as it enters
    close(end.hx, 1);
    close(end.hy, 0); // facing east as it leaves
    expect(mid.hx).toBeGreaterThan(0.5); // halfway round: heading NE
    expect(mid.hy).toBeLessThan(-0.5);
    for (const q of [start, mid, end]) close(Math.hypot(q.x - 6, q.y - 6), 0.3); // corner (6,6), r = 0.5 − 0.2
  });

  it('a left turn (N→W) swings wide: radius 0.5 + lane round the SW corner', () => {
    const m = mover(5, 5, 3, 0);
    for (const p of [0, 0.3, 0.7, 1]) {
      const q = moverPose(at(m, p), 0.2);
      close(Math.hypot(q.x - 5, q.y - 6), 0.7);
    }
  });

  it('is continuous across a leg boundary (turn tile → the straight tile after it)', () => {
    const turn = moverPose(at(mover(5, 5, 1, 0), 1), 0.2); // leaving the turn tile eastbound
    const next = moverPose(at(mover(6, 5, 1, 1), 0), 0.2); // entering the next tile eastbound
    close(turn.x, next.x);
    close(turn.y, next.y);
    close(turn.hx, next.hx);
    close(turn.hy, next.hy);
  });

  it('heading stays a unit vector all the way round', () => {
    const m = mover(5, 5, 2, 1); // E→S (right turn)
    for (let p = 0; p <= 1; p += 0.125) {
      const q = moverPose(at(m, p), 0.2);
      close(Math.hypot(q.hx, q.hy), 1);
    }
  });

  it('commitHeading records the heading it turned from', () => {
    const m = mover(5, 5, 0, 0);
    commitHeading(m, 1);
    expect(m.prevDir).toBe(0);
    expect(m.dir).toBe(1);
  });
});

import { carPose, snapshotMovers, ambientAlpha, SUBSTEP_MS, createAmbientState } from '../../src/ui/ambientContent';

describe('render interpolation between 50 ms sim substeps (no 20 Hz stutter at 120 fps)', () => {
  it('ambientAlpha is the fraction of a substep accumulated since the last one ran', () => {
    const s = createAmbientState();
    s.accMs = SUBSTEP_MS / 4;
    expect(ambientAlpha(s)).toBeCloseTo(0.25);
  });

  it('a car is drawn between its last two substep poses, by alpha', () => {
    const s = createAmbientState();
    const c = { ...at(mover(5, 5, 1, 1), 0.2), tint: 0 } as Mover;
    s.cars.push(c);
    snapshotMovers(s); // the pose at progress 0.2…
    Object.assign(c, at(c, 0.4)); // …then one substep moves it to 0.4
    const mid = carPose(c, 0.5);
    const want = moverPose(at(c, 0.3), 0.22);
    expect(mid.x).toBeCloseTo(want.x, 6);
    expect(mid.y).toBeCloseTo(want.y, 6);
  });

  it('a teleport (spawn / park / reroute) snaps instead of sliding across the map', () => {
    const s = createAmbientState();
    const c = { ...at(mover(5, 5, 1, 1), 0.2), tint: 0 } as Mover;
    s.cars.push(c);
    snapshotMovers(s);
    Object.assign(c, at(mover(40, 40, 1, 1), 0.2));
    const q = carPose(c, 0.5);
    expect(q.x).toBeCloseTo(moverPose(c, 0.22).x, 6);
  });
});

import { pedPose } from '../../src/ui/ambientContent';

describe('pedestrian edge cases — U-turns and stepping on/off the road stay smooth', () => {
  it('a U-turn sweeps the heading round instead of flipping 180° at the centre', () => {
    const m = mover(5, 5, 2, 0); // was heading N, now S: reversing inside tile (5,5)
    let prev = moverPose(at(m, 0), 0);
    for (let p = 0.05; p <= 1; p += 0.05) {
      const q = moverPose(at(m, p), 0);
      const dot = prev.hx * q.hx + prev.hy * q.hy;
      expect(dot, `p=${p.toFixed(2)}`).toBeGreaterThan(Math.cos((45 * Math.PI) / 180));
      prev = q;
    }
  });

  it('a walker stepping off the road onto open ground slides off the kerb, no jump at the tile edge', () => {
    // road at x ≤ 5 on row 5, open ground at x = 6: walking east
    const onRoad = (x: number, y: number): boolean => y === 5 && x <= 5;
    const leaving = pedPose(at(mover(5, 5, 1, 1) as Mover, 1), onRoad); // end of the leg across road tile (5,5)
    const arriving = pedPose(at(mover(6, 5, 1, 1) as Mover, 0), onRoad); // start of the leg across ground (6,5)
    expect(Math.hypot(leaving.x - arriving.x, leaving.y - arriving.y)).toBeLessThan(1e-6);
    // …and out on the open ground it walks down the middle (no kerb offset)
    const mid = pedPose(at(mover(6, 5, 1, 1) as Mover, 0.5), onRoad);
    expect(mid.y).toBeCloseTo(5.5, 6);
    // while on the road tile it keeps to the kerb
    const onKerb = pedPose(at(mover(5, 5, 1, 1) as Mover, 0.5), onRoad);
    expect(onKerb.y).toBeGreaterThan(5.8);
  });
});
