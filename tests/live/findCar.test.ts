// The scaling pass (Maddy 2026-10-08): findCar was state.cars.find — a scan of every car, for every driving walker,
// every substep (400 drivers × 800 cars = 320k compares a substep). It is an indexed lookup now, rebuilt only when the
// list changed, and it answers exactly as the scan did.
import { describe, expect, it } from 'vitest';
import { findCar } from '../../src/live/agents';
import type { AmbientState, Car } from '../../src/live/types';

const carOf = (id: number) => ({ id, x: 0, y: 0, dir: 0, tx: 0, ty: 0 }) as unknown as Car;

describe('findCar', () => {
  it('finds as the scan did: the car with that id, the first of duplicates, none when gone', () => {
    const a = carOf(1);
    const b = carOf(2);
    const dup = carOf(2);
    const state = { cars: [a, b, dup] } as unknown as AmbientState;
    expect(findCar(state, 1)).toBe(a);
    expect(findCar(state, 2)).toBe(b);
    expect(findCar(state, 9)).toBeUndefined();
  });

  it('follows the list as it changes: a removal, an addition, a fresh array', () => {
    const cars = [carOf(1), carOf(2), carOf(3)];
    const state = { cars } as unknown as AmbientState;
    expect(findCar(state, 3)).toBe(cars[2]);
    cars.splice(0, 1); // positions shift
    expect(findCar(state, 3)).toBe(cars[1]);
    expect(findCar(state, 1)).toBeUndefined();
    const fresh = carOf(4);
    cars.push(fresh);
    expect(findCar(state, 4)).toBe(fresh);
    state.cars = state.cars.filter((c) => c.id !== 2); // a new array, as the substep's filters make
    expect(findCar(state, 2)).toBeUndefined();
    expect(findCar(state, 3)?.id).toBe(3);
  });

  it('a car swapped in for another (same length) is still found', () => {
    const cars = [carOf(1), carOf(2)];
    const state = { cars } as unknown as AmbientState;
    expect(findCar(state, 2)).toBe(cars[1]);
    cars.splice(0, 1);
    const fresh = carOf(7);
    cars.push(fresh);
    expect(findCar(state, 7)).toBe(fresh);
  });

  it('a lookup per car of a big fleet reads each id a few times, not once per car (no n²)', () => {
    let reads = 0;
    const cars = Array.from({ length: 2000 }, (_, i) => {
      const c = carOf(0) as unknown as Record<string, unknown>;
      Object.defineProperty(c, 'id', { get: () => (reads++, i) });
      return c as unknown as Car;
    });
    const state = { cars } as unknown as AmbientState;
    for (let i = 0; i < 2000; i++) findCar(state, i);
    expect(reads).toBeLessThan(10 * 2000); // the scan: ~2M
  });
});
