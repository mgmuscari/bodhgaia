// Schools teach (Maddy 2026-10-14: "better work over time"): each school's learning grows a little each civic tick it
// stands, to LEARN_MAX; a neighbourhood within SCHOOL_REACH gets more of the jobs round it (work, employment).
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, bulldozeParcel, placeParcel } from '../../src/engine/fabric';
import { createAmbientState } from '../../src/live/types';
import { learningNear, stepLearning, LEARN_MAX, LEARN_RATE, SCHOOL_REACH } from '../../src/live/school';

describe('school learning', () => {
  it('grows each tick a school stands, to LEARN_MAX; a school torn down takes its learning with it', () => {
    const map = new GameMap(30, 10);
    const parcels = new ParcelStore();
    const s = placeParcel(map, parcels, { x: 4, y: 4, width: 2, height: 2, kind: BuiltKind.School });
    const state = createAmbientState();
    stepLearning(state, map);
    expect(state.learning.get(map.idx(4, 4))).toBe(LEARN_RATE);
    for (let k = 0; k < 1000; k++) stepLearning(state, map);
    expect(state.learning.get(map.idx(4, 4))).toBe(LEARN_MAX);
    bulldozeParcel(map, parcels, s);
    stepLearning(state, map);
    expect(state.learning.size).toBe(0);
  });
  it('a place within SCHOOL_REACH has the best learning in reach; beyond, none', () => {
    const map = new GameMap(40, 10);
    const parcels = new ParcelStore();
    placeParcel(map, parcels, { x: 4, y: 4, width: 2, height: 2, kind: BuiltKind.School });
    const state = createAmbientState();
    for (let k = 0; k < 10; k++) stepLearning(state, map);
    expect(learningNear(state, map, 4 + SCHOOL_REACH, 4)).toBe(10 * LEARN_RATE);
    expect(learningNear(state, map, 4 + SCHOOL_REACH + 2, 4)).toBe(0);
  });
});

// Lane pairing (interdependence §9): a library beside a school — the school learns twice as fast.
describe('library + school', () => {
  it('a school with a library within reach learns at twice the rate', () => {
    const map = new GameMap(30, 10);
    const parcels = new ParcelStore();
    placeParcel(map, parcels, { x: 4, y: 4, width: 2, height: 2, kind: BuiltKind.School });
    placeParcel(map, parcels, { x: 7, y: 4, width: 1, height: 1, kind: BuiltKind.Library });
    const state = createAmbientState();
    stepLearning(state, map);
    expect(state.learning.get(map.idx(4, 4))).toBe(2 * LEARN_RATE);
  });
});
