// Death and memorial (docs/design/bodhgaia-opening.md §2): a resident who dies lies down, and a memorial
// stays on that tile for a while. Unhoused residents can die of exposure at night — rarely, likelier the
// more are unhoused, and not within reach of shelter.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { createAmbientState } from '../../src/live/types';
import { residentDies, stepDeaths, stepExposure, exposureDeathsPerHour } from '../../src/live/death';
import { FALL_SUBSTEPS, MEMORIAL_SUBSTEPS, SHELTER_RADIUS, ENCAMPMENT_WEAR } from '../../src/live/tuning';

describe('a death', () => {
  it('lies down, then leaves a memorial that stays a while, then is gone', () => {
    const state = createAmbientState();
    residentDies(state, 4, 7);
    expect(state.fallen).toEqual([{ x: 4, y: 7, t: 0 }]);
    for (let i = 0; i < FALL_SUBSTEPS; i++) stepDeaths(state);
    expect(state.fallen).toEqual([]);
    expect(state.memorials).toEqual([{ x: 4, y: 7, age: 0 }]);
    for (let i = 0; i < MEMORIAL_SUBSTEPS; i++) stepDeaths(state);
    expect(state.memorials).toEqual([]);
    expect(state.deaths).toBe(1);
  });
});

describe('exposure', () => {
  const camp = (shelter = false) => {
    const map = new GameMap(30, 30);
    const state = createAmbientState();
    for (let x = 5; x < 10; x++) state.wear.set(map.idx(x, 5), ENCAMPMENT_WEAR + 10);
    if (shelter) map.built[map.idx(7, 5 + SHELTER_RADIUS)] = BuiltKind.TinyHomes;
    state.unhoused = 600;
    return { map, state };
  };

  it('kills nobody by day, nor when nobody is unhoused, nor before the host sets the clock', () => {
    const { map, state } = camp();
    const rng = createRng('exp').fork('x');
    for (let h = 0; h < 200; h++) {
      state.hour = 12;
      stepExposure(state, map, rng);
    }
    expect(state.deaths ?? 0).toBe(0);
    state.hour = undefined;
    stepExposure(state, map, rng);
    expect(state.deaths ?? 0).toBe(0);
  });

  it('at night, deaths scale with the unhoused, happen at the encampments and leave the unhoused stock', () => {
    expect(exposureDeathsPerHour(600)).toBeGreaterThan(exposureDeathsPerHour(100));
    expect(exposureDeathsPerHour(0)).toBe(0);
    const { map, state } = camp();
    const rng = createRng('exp').fork('x');
    let hour = 22;
    for (let n = 0; n < 24 * 20; n++) {
      state.hour = hour;
      stepExposure(state, map, rng);
      hour = (hour + 1) % 24;
    }
    const died = state.deaths!;
    expect(died).toBeGreaterThan(0);
    expect(state.unhoused).toBe(600 - died);
    for (const f of state.fallen!) expect(state.wear.get(map.idx(f.x, f.y))!).toBeGreaterThanOrEqual(ENCAMPMENT_WEAR);
  });

  it('a step within the same hour draws nothing more (deaths are per in-game hour, not per frame)', () => {
    const { map, state } = camp();
    const rng = createRng('exp').fork('x');
    state.hour = 23;
    for (let i = 0; i < 500; i++) stepExposure(state, map, rng);
    expect(state.deaths ?? 0).toBeLessThanOrEqual(Math.ceil(exposureDeathsPerHour(600)));
  });

  it(`nobody dies within ${SHELTER_RADIUS} tiles of shelter`, () => {
    const { map, state } = camp(true);
    const rng = createRng('exp').fork('x');
    let hour = 22;
    for (let n = 0; n < 24 * 20; n++) {
      state.hour = hour;
      stepExposure(state, map, rng);
      hour = (hour + 1) % 24;
    }
    expect(state.deaths ?? 0).toBe(0);
  });
});
