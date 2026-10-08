// Traffic accidents (docs/design/disasters.md): a jammed road crashes — a car (and the one it ran into) is wrecked
// and blocks the lane until it's towed, and someone may die. Fewer cars, fewer jams, fewer crashes.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, placeTransport } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { createAmbientState } from '../../src/live/types';
import type { Car } from '../../src/live/types';
import { crashChance, drawCrashes, crash } from '../../src/live/accidents';
import { CRASH_JAM, CRASH_SUBSTEPS, CRASH_DEATH, TRAFFIC_MAX } from '../../src/live/tuning';
import { stepCar } from '../../src/live/cars';
import { buildVehicleCtx } from '../../src/live/cars';

function road() {
  const map = new GameMap(30, 10);
  for (let x = 0; x < 30; x++) placeTransport(map, x, 5, BuiltKind.RoadStreet);
  const state = createAmbientState();
  state.events = [];
  return { map, state };
}
const car = (x: number, extra: Partial<Car> = {}): Car => ({ x, y: 5, dir: 1, tx: x + 1, ty: 5, ...extra });

describe('crashes: where', () => {
  it('only on a jammed road, likelier the worse the jam', () => {
    expect(crashChance(0)).toBe(0);
    expect(crashChance(CRASH_JAM * TRAFFIC_MAX - 1)).toBe(0);
    expect(crashChance(TRAFFIC_MAX)).toBeGreaterThan(crashChance(((CRASH_JAM + 1) / 2) * TRAFFIC_MAX));
    expect(crashChance(((CRASH_JAM + 1) / 2) * TRAFFIC_MAX)).toBeGreaterThan(0);
  });

  it('drawn once an in-game hour, never without a clock; only cars on the move crash', () => {
    const { map, state } = road();
    for (let x = 0; x < 30; x++) state.traffic.set(map.idx(x, 5), TRAFFIC_MAX);
    state.cars.push(car(3, { owned: true, id: 1, path: [0, 1], leg: 1 }), car(8, { parked: true, owned: true, id: 2 }), car(20, { abandoned: true, parked: true }));
    const rng = createRng('crash').fork('c');
    expect(drawCrashes(state, map, rng, undefined)).toBe(0);
    let n = 0;
    for (let h = 0; h < 24 * 400 && n === 0; h++) {
      n += drawCrashes(state, map, rng, h % 24);
      n += drawCrashes(state, map, rng, h % 24); // the same hour: no second draw
    }
    expect(n).toBeGreaterThan(0);
    const wrecked = state.cars.filter((c) => c.wreck !== undefined);
    expect(wrecked.map((c) => c.x)).toEqual([3]);
  });
});

describe('crashes: what', () => {
  it("a driven car's driver gets out and walks on, or dies at the wheel", () => {
    let walked = 0;
    let died = 0;
    const rng = createRng('driver').fork('d');
    for (let k = 0; k < 200; k++) {
      const { map, state } = road();
      const home = map.idx(2, 2);
      state.occupancy.set(home, 5);
      const c = car(5, { owned: true, id: 9, path: [0, 1], leg: 1 });
      state.cars.push(c);
      const driver = { x: 5, y: 5, dir: 1, tx: 6, ty: 5, phase: 'driving' as const, carId: 9, homeTile: home };
      state.peds.push(driver);
      crash(state, map, rng, c);
      expect(c.owned).toBeFalsy(); // the wreck is nobody's to drive now
      if (state.peds.includes(driver)) {
        expect(driver.carId).toBeUndefined(); // on foot from here
        walked++;
      } else {
        expect(state.occupancy.get(home)).toBe(4);
        died++;
      }
    }
    expect(walked).toBeGreaterThan(died);
    expect(died).toBeGreaterThan(0);
  });

  it('wrecks the car and the one just ahead, calls the camera, blocks until towed', () => {
    const { map, state } = road();
    const a = car(5);
    const b = car(5.8);
    const far = car(15);
    state.cars.push(a, b, far);
    crash(state, map, createRng('x').fork('x'), a);
    expect(a.wreck).toBe(CRASH_SUBSTEPS);
    expect(b.wreck).toBe(CRASH_SUBSTEPS);
    expect(far.wreck).toBeUndefined();
    expect(state.events!.filter((e) => e.kind === 'crash')).toEqual([{ kind: 'crash', x: 5, y: 5, w: 1, h: 1 }]);
    const ctx = buildVehicleCtx(state, map);
    const x0 = a.x;
    for (let i = 0; i < CRASH_SUBSTEPS - 1; i++) expect(stepCar(state, map, createRng('s').fork('s'), ctx, a)).toBe(true);
    expect(a.x).toBe(x0); // it doesn't move
    expect(stepCar(state, map, createRng('s').fork('s'), ctx, a)).toBe(false); // towed
  });

  it('sometimes someone dies — about CRASH_DEATH of crashes, never more than one each', () => {
    let deaths = 0;
    const N = 400;
    const rng = createRng('toll').fork('t');
    for (let k = 0; k < N; k++) {
      const { map, state } = road();
      const home = map.idx(2, 2);
      state.occupancy.set(home, 5);
      const c = car(5, { homeTile: home });
      state.cars.push(c);
      crash(state, map, rng, c);
      const d = state.events!.filter((e) => e.kind === 'death').length;
      expect(d).toBeLessThanOrEqual(1);
      if (d) expect(state.occupancy.get(home)).toBe(4);
      deaths += d;
    }
    expect(deaths / N).toBeGreaterThan(CRASH_DEATH - 0.08);
    expect(deaths / N).toBeLessThan(CRASH_DEATH + 0.08);
  });
});
