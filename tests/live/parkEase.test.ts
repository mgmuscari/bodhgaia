// Parking eases (Maddy 2026-10-08: "cars parking and pedestrians pathing to/from parking snap to the sides of the
// road too quickly"): a car slides from its lane into the stall, and back out; the walker who gets out steps from
// the car to the kerb — over a moment, not in one frame.
import { describe, it, expect } from 'vitest';
import { applyParkSpot, spawnBoundPed } from '../../src/live/agents';
import { carPose, pedPose, snapshotMovers, EASE_SUBSTEPS } from '../../src/live/poses';
import { createAmbientState, type Car } from '../../src/live/types';

const gap = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('parking eases', () => {
  it('a car slides into its stall over EASE_SUBSTEPS, never jumping', () => {
    const state = createAmbientState();
    const car = { x: 4, y: 5, dir: 1, tx: 5, ty: 5 } as Car;
    state.cars.push(car);
    car.x = 4.6; // mid-tile in its lane
    const before = carPose(car);
    applyParkSpot(car, { x: 5.0, y: 5.85, dir: 2, slot: 0 }); // the kerb slot, below the lane
    const after = carPose(car);
    expect(gap(before, after)).toBeLessThan(0.05); // still where it was drawn
    let last = after;
    let worst = 0;
    for (let k = 0; k < EASE_SUBSTEPS + 2; k++) {
      snapshotMovers(state);
      const now = carPose(car);
      worst = Math.max(worst, gap(last, now));
      last = now;
    }
    expect(gap(last, { x: 5.0, y: 5.85 })).toBeLessThan(1e-6); // settled on the stall
    expect(worst).toBeLessThan(0.25); // a slide, not a jump
  });

  it('the walker who gets out of a parked car starts at the car, then steps to the kerb', () => {
    const state = createAmbientState();
    const car = { x: 4.5, y: 5.35, dir: 1, tx: 4.5, ty: 5.35, parked: true, curbDir: 2, curbSlot: 0, id: 7 } as Car;
    state.cars.push(car);
    spawnBoundPed(state, car, { x: 5, y: 7 });
    const p = state.peds[0]!;
    const onRoad = () => true;
    expect(gap(pedPose(p, onRoad), carPose(car))).toBeLessThan(0.05);
  });
});
