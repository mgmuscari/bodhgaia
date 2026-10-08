import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind } from '../../src/engine/fabric';
import { createAmbientState, setHouseholds } from '../../src/live/types';
import { seedDecay } from '../../src/live/fields/pollution';
import { INHERITED_VACANCY } from '../../src/live/tuning';
import { OCC_FLOOR } from '../../src/live/tuning';

// Maddy 2026-10-06: "we do expect high homeless population in distressed cities". The crisis is INHERITED — the
// city opens with homes emptied by disinvestment, in proportion to how redlined their ground is — rather than
// ratcheting up from zero after the player arrives.
function city() {
  const map = new GameMap(8, 4);
  const homes = [
    { x: 1, y: 1, count: 10, grade: 0 }, // greenlined: full
    { x: 3, y: 1, count: 10, grade: 128 }, // middling
    { x: 5, y: 1, count: 10, grade: 255 }, // fully redlined
  ];
  for (const h of homes) {
    map.built[map.idx(h.x, h.y)] = BuiltKind.HouseSingle;
    map.redline[map.idx(h.x, h.y)] = h.grade;
  }
  const state = createAmbientState();
  setHouseholds(state, homes.map(({ x, y, count }) => ({ x, y, count })));
  seedDecay(state, map);
  return { map, state };
}

describe('the inherited housing crisis', () => {
  it('opens each home emptied in proportion to its redline grade; greenlined homes are full', () => {
    const { map, state } = city();
    const occ = (x: number) => state.occupancy.get(map.idx(x, 1))!;
    expect(occ(1)).toBe(10);
    expect(occ(3)).toBeCloseTo(10 * (1 - INHERITED_VACANCY * (128 / 255)), 9);
    expect(occ(5)).toBeCloseTo(Math.max(10 * OCC_FLOOR, 10 * (1 - INHERITED_VACANCY)), 9);
    expect(occ(5)).toBeLessThan(occ(3));
  });

  it('the city opens with unhoused residents — the crisis is visible from the first frame', () => {
    const { state } = city();
    expect(state.unhoused).toBeGreaterThan(0);
  });
});
