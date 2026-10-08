// Transit vehicles (docs/design/transit.md): every line runs vehicles — trams on streetcar track, trains on rail
// and elevated rail — that halt at each stop.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, placeTransport } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { createAmbientState } from '../../src/live/types';
import { spawnTransit, stepTrain, vehicleSpeed } from '../../src/live/trains';
import { transitFor, DWELL } from '../../src/live/transit';
import { syncTrainLegs } from '../../src/live/poses';
import { buildVehicleCtx } from '../../src/live/cars';


function city() {
  const map = new GameMap(40, 12);
  for (let x = 2; x <= 13; x++) {
    map.setBuilt(x, 2, BuiltKind.Streetcar); // a short tram line — too short for the old one-per-26 rule
    placeTransport(map, x, 3, BuiltKind.RoadStreet);
  }
  for (let x = 2; x <= 30; x++) {
    map.setBuilt(x, 8, BuiltKind.ElevatedRail); // an elevated line, which used to get no trains at all
    placeTransport(map, x, 9, BuiltKind.RoadStreet);
  }
  return { map, state: createAmbientState() };
}

const run = (c: ReturnType<typeof city>, n: number, each?: () => void) => {
  const rng = createRng('v').fork('v');
  for (let i = 0; i < n; i++) {
    spawnTransit(c.state, c.map, rng);
    c.state.trains = c.state.trains.filter((t) => stepTrain(c.map, t, rng));
    each?.();
  }
};

describe('transit vehicles', () => {
  it('never jump — halting at a stop included (Maddy 2026-10-08: trams snapped to their stops)', () => {
    const c = city();
    const last = new Map<object, { x: number; y: number }[]>();
    let worst = 0;
    run(c, 800, () => {
      for (const t of c.state.trains) {
        const cars = syncTrainLegs(t, c.map.width).map((m) => ({ x: m.x, y: m.y }));
        const before = last.get(t);
        if (before && before.length === cars.length) cars.forEach((q, k) => (worst = Math.max(worst, Math.abs(q.x - before[k]!.x) + Math.abs(q.y - before[k]!.y))));
        last.set(t, cars);
      }
    });
    expect(worst).toBeLessThanOrEqual(Math.max(vehicleSpeed('tram'), vehicleSpeed('rail')) + 1e-6);
  });

  it('every line runs a vehicle: a tram on the streetcar line, a train on the elevated', () => {
    const c = city();
    run(c, 5);
    expect(c.state.trains.map((t) => t.family).sort()).toEqual(['rail', 'tram']);
  });

  it('trains run long distances fast — well over twice a tram\'s pace (Maddy 2026-10-08: too slow)', () => {
    const c = city();
    const moved = { tram: 0, rail: 0 };
    const last = new Map<object, [number, number]>();
    run(c, 400, () => {
      for (const t of c.state.trains) {
        const b = last.get(t);
        if (b) moved[t.family!] += Math.abs(t.hx - b[0]) + Math.abs(t.hy - b[1]);
        last.set(t, [t.hx, t.hy]);
      }
    });
    expect(moved.rail).toBeGreaterThan(2 * moved.tram);
  });

  it('trams keep to streetcar track, trains to rail', () => {
    const c = city();
    run(c, 600, () => {
      for (const t of c.state.trains) {
        const k = c.map.built[c.map.idx(Math.round(t.hx), Math.round(t.hy))];
        if (t.family === 'tram') expect(k).toBe(BuiltKind.Streetcar);
        else expect(k).toBe(BuiltKind.ElevatedRail);
      }
    });
  });

  it('halts at each stop for a while, then goes on', () => {
    const c = city();
    const stopTracks = new Set(transitFor(c.map).lines.flatMap((l) => l.stops.map((s) => s.track)));
    const held = new Map<number, number>(); // stop track → longest halt seen
    const streak = new Map<object, { at: number; n: number }>();
    run(c, 1200, () => {
      for (const t of c.state.trains) {
        const at = c.map.idx(Math.round(t.hx), Math.round(t.hy));
        const s = streak.get(t);
        const still = s && s.at === at && t.hx === Math.round(t.hx) && t.hy === Math.round(t.hy);
        const n = still ? s.n + 1 : 1;
        streak.set(t, { at, n });
        if (stopTracks.has(at)) held.set(at, Math.max(held.get(at) ?? 0, n));
      }
    });
    expect(held.size).toBeGreaterThan(0);
    for (const [, n] of held) expect(n).toBeGreaterThanOrEqual(DWELL);
  });
});

describe('level crossings: cars wait for the train (Maddy 2026-09-30: right-of-way at at-grade crossings)', () => {
  function crossing() {
    const map = new GameMap(30, 12);
    for (let x = 0; x < 30; x++) map.setBuilt(x, 5, BuiltKind.Rail);
    for (let y = 0; y < 12; y++) if (y !== 5) placeTransport(map, 12, y, BuiltKind.RoadStreet); // a street across
    return { map, state: createAmbientState() };
  }
  const car = { x: 12, y: 3, dir: 2, tx: 12, ty: 4, serial: 1 } as unknown as import('../../src/live/types').Car;
  const nearing = { x: 12, y: 4, dir: 2, tx: 12, ty: 5, serial: 1 } as unknown as import('../../src/live/types').Car;

  it('holds a car at the crossing while a train is on it or coming up to it', () => {
    const c = crossing();
    c.state.trains.push({ cells: [c.map.idx(10, 5), c.map.idx(9, 5)], hx: 10, hy: 5, tx: 11, ty: 5, dir: 1, family: 'rail' });
    expect(buildVehicleCtx(c.state, c.map).blocked(nearing)).toBe(true);
  });

  it('lets it cross once the train has gone by, or when none is near', () => {
    const c = crossing();
    expect(buildVehicleCtx(c.state, c.map).blocked(nearing)).toBe(false);
    c.state.trains.push({ cells: [c.map.idx(20, 5), c.map.idx(19, 5)], hx: 20, hy: 5, tx: 21, ty: 5, dir: 1, family: 'rail' });
    expect(buildVehicleCtx(c.state, c.map).blocked(nearing)).toBe(false);
    expect(buildVehicleCtx(c.state, c.map).blocked(car)).toBe(false);
  });
});
