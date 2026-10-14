// "Falling Down" jams (Maddy 2026-09-30, in 1.0.15). Amended 2026-10-14 (Maddy: "cars in jams get abandoned way too
// often… they are ending up in strange positions and stick around too long waiting to get towed, causing worse jams"):
// only some drivers (one in WALKOFF_ONE_IN) walk off, and only on their third give-up of a trip; the car is pulled to
// the kerb of its tile (or set square on it) — parked, so it blocks nobody — hazards on, and towed in ~15 s.
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { createAmbientState, type Mover } from '../../src/live/types';
import { skipJammedStop } from '../../src/live/agents';
import { stepCar } from '../../src/live/cars';
import { JAM_SKIP_PENALTY, JAM_WALKOFF_PENALTY, STUCK_GIVE_UP, WALKOFF_GIVE_UPS, WALKOFF_ONE_IN, WALKOFF_TOW } from '../../src/live/tuning';
import { seconds } from '../../src/live/tuning';

function jam(id = 42) {
  const map = new GameMap(16, 9);
  for (let x = 1; x <= 14; x++) map.setBuilt(x, 4, BuiltKind.RoadStreet);
  const state = createAmbientState();
  state.events = [];
  const home = map.idx(2, 3);
  state.buildingHealth.set(home, 20);
  const car = { x: 6, y: 4, dir: 1, tx: 7, ty: 4, owned: true, id, path: [map.idx(6, 4), map.idx(7, 4)], leg: 2, stuck: STUCK_GIVE_UP } as Mover;
  state.cars.push(car);
  const p = { x: 6, y: 4, dir: 1, tx: 7, ty: 4, homeTile: home, carId: id, itinerary: ['work', 'shop'], itinStep: 0, phase: 'driving' } as unknown as Mover;
  state.peds.push(p);
  return { map, state, car, p, home };
}

describe('a driver jammed twice walks away from the car', () => {
  it('the first give-up only skips the stop, as before', () => {
    const j = jam();
    skipJammedStop(j.state, j.p, j.map);
    expect(j.car.wreck).toBeUndefined();
    expect(j.state.buildingHealth.get(j.home)).toBe(20 - JAM_SKIP_PENALTY);
  });

  const giveUp = (j: ReturnType<typeof jam>, times: number) => {
    for (let k = 0; k < times; k++) {
      j.car.stuck = STUCK_GIVE_UP; // jammed again
      j.car.parked = false;
      skipJammedStop(j.state, j.p, j.map);
    }
  };

  it('it is rare: only one driver in WALKOFF_ONE_IN, and only at the third give-up of a trip', () => {
    expect(WALKOFF_GIVE_UPS).toBe(3);
    expect(WALKOFF_ONE_IN).toBeGreaterThanOrEqual(3);
    const twice = jam(WALKOFF_ONE_IN * 14); // a driver of the walking-off kind
    giveUp(twice, 2);
    expect(twice.car.leftInJam).toBeUndefined();
    const other = jam(WALKOFF_ONE_IN * 14 + 1); // not that kind: never walks off
    giveUp(other, 6);
    expect(other.car.leftInJam).toBeUndefined();
  });

  it('a driver who walks off pulls the car to the kerb (parked: it blocks nobody), hazards on, towed in ~15 s', () => {
    const j = jam(WALKOFF_ONE_IN * 14);
    giveUp(j, 3);
    expect(j.car.leftInJam).toBe(true);
    expect(j.car.owned).toBe(false);
    expect(j.car.parked).toBe(true); // at the kerb, out of the lane
    expect(WALKOFF_TOW).toBeLessThanOrEqual(seconds(15));
    expect(j.car.wreck).toBe(WALKOFF_TOW);
    expect(j.p.carId).toBeUndefined();
    expect(j.p.phase).not.toBe('driving');
    expect(j.state.buildingHealth.get(j.home)).toBe(20 - 3 * JAM_SKIP_PENALTY - JAM_WALKOFF_PENALTY);
    expect(j.state.events!.some((e) => e.kind === 'walkoff')).toBe(true);
    // it stands there until towed, then is gone
    const rng = createRng('tow').fork('t');
    let alive = true;
    let n = 0;
    while (alive && n < WALKOFF_TOW + 5) {
      alive = stepCar(j.state, j.map, rng, {} as never, j.car);
      n++;
    }
    expect(n).toBe(WALKOFF_TOW);
  });
});
