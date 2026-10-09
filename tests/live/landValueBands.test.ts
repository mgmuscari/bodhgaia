// The scaling pass (Maddy 2026-10-08): land value recomputed every plot's 41-tile neighbourhood in one substep each
// second (6.5M map reads on 256²) — a once-a-second stutter. Each substep now recomputes one band of rows; a second of
// substeps covers the map exactly as the whole pass did.
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind } from '../../src/engine/fabric';
import { createAmbientState } from '../../src/live/types';
import { recomputeLandValue, recomputeLandValueBand } from '../../src/live/fields/landValue';
import { LV_CADENCE } from '../../src/live/tuning';

const city = () => {
  const map = new GameMap(40, 37);
  for (let y = 0; y < 37; y += 3) for (let x = 0; x < 40; x += 2) map.setBuilt(x, y, (x + y) % 5 === 0 ? BuiltKind.Park : BuiltKind.HouseSingle);
  const state = createAmbientState();
  state.pollution.set(map.idx(10, 10), 200);
  return { map, state };
};

describe('land value in bands', () => {
  it('a full round of bands gives exactly the values of the whole pass', () => {
    const a = city();
    recomputeLandValue(a.state, a.map);
    const b = city();
    for (let k = 0; k < LV_CADENCE; k++) recomputeLandValueBand(b.state, b.map, k, LV_CADENCE);
    expect([...b.state.landValue.entries()].sort((x, y) => x[0] - y[0])).toEqual([...a.state.landValue.entries()].sort((x, y) => x[0] - y[0]));
  });

  it('each band covers only its share of the rows', () => {
    const { map, state } = city();
    recomputeLandValueBand(state, map, 3, LV_CADENCE);
    const rows = new Set([...state.landValue.keys()].map((i) => Math.floor(i / map.width)));
    expect(rows.size).toBeGreaterThan(0);
    expect(rows.size).toBeLessThanOrEqual(Math.ceil(map.height / LV_CADENCE));
  });

  it('a demolished plot drops out when its band comes round', () => {
    const { map, state } = city();
    for (let k = 0; k < LV_CADENCE; k++) recomputeLandValueBand(state, map, k, LV_CADENCE);
    const t = map.idx(2, 0);
    expect(state.landValue.has(t)).toBe(true);
    map.setBuilt(2, 0, BuiltKind.None);
    for (let k = 0; k < LV_CADENCE; k++) recomputeLandValueBand(state, map, k, LV_CADENCE);
    expect(state.landValue.has(t)).toBe(false);
  });
});
