// "Falling Down" jams (Maddy 2026-09-30, in 1.0.15): a driver who has already given up on a stop and is jammed past
// the give-up rung AGAIN leaves the car in its lane and walks off — the household takes a wellbeing hit, the car
// stands in the lane (hazards on) blocking traffic until it's towed, and the news reports it.
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { createAmbientState, type Mover } from '../../src/live/types';
import { skipJammedStop } from '../../src/live/agents';
import { stepCar } from '../../src/live/cars';
import { JAM_SKIP_PENALTY, JAM_WALKOFF_PENALTY, STUCK_GIVE_UP, WALKOFF_TOW } from '../../src/live/tuning';

function jam() {
  const map = new GameMap(16, 9);
  for (let x = 1; x <= 14; x++) map.setBuilt(x, 4, BuiltKind.RoadStreet);
  const state = createAmbientState();
  state.events = [];
  const home = map.idx(2, 3);
  state.buildingHealth.set(home, 20);
  const car = { x: 6, y: 4, dir: 1, tx: 7, ty: 4, owned: true, id: 42, path: [map.idx(6, 4), map.idx(7, 4)], leg: 2, stuck: STUCK_GIVE_UP } as Mover;
  state.cars.push(car);
  const p = { x: 6, y: 4, dir: 1, tx: 7, ty: 4, homeTile: home, carId: 42, itinerary: ['work', 'shop'], itinStep: 0, phase: 'driving' } as unknown as Mover;
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

  it('jammed past the rung again, they leave it in the lane and walk; the car blocks it until towed', () => {
    const j = jam();
    skipJammedStop(j.state, j.p, j.map);
    j.car.stuck = STUCK_GIVE_UP; // jammed again
    j.car.parked = false;
    skipJammedStop(j.state, j.p, j.map);
    expect(j.car.leftInJam).toBe(true);
    expect(j.car.owned).toBe(false);
    expect(j.car.parked).not.toBe(true); // standing in the lane, not at a kerb
    expect(j.car.wreck).toBe(WALKOFF_TOW);
    expect(j.p.carId).toBeUndefined();
    expect(j.p.phase).not.toBe('driving');
    expect(j.state.buildingHealth.get(j.home)).toBe(20 - 2 * JAM_SKIP_PENALTY - JAM_WALKOFF_PENALTY); // the stop skipped again, and the car
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
