// The unhoused as people (docs/design/rehoming.md, Maddy 2026-10-07): a stock that homes lose people
// into and win people back from — not a vacancy count. Building homes and organising (voice) re-home
// people; harms, rent and demolition make them unhoused; nothing moves without a cause.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind } from '../../src/engine/fabric';
import { createAmbientState, setHouseholds, type AmbientState } from '../../src/live/types';
import { stepOccupancy, seedInheritedOccupancy, displaceFromHomes } from '../../src/live/fields/occupancy';
import { OCC_SETTLE_PASSES } from '../../src/live/tuning';
import { captureLive, restoreLive, LIVE_MAPS, type SaveV1 } from '../../src/save/snapshot';

const emptyMaps = () => Object.fromEntries(LIVE_MAPS.map((n) => [n, []]));

const occTotal = (s: AmbientState): number => [...s.occupancy.values()].reduce((a, b) => a + b, 0);

function street(homes: { x: number; count: number }[]) {
  const map = new GameMap(24, 4);
  for (const h of homes) map.built[map.idx(h.x, 1)] = BuiltKind.Apartments;
  const state = createAmbientState();
  setHouseholds(state, homes.map((h) => ({ x: h.x, y: 1, count: h.count })));
  return { map, state, t: (x: number) => map.idx(x, 1) };
}

/** Run the opening so every home takes its conditions as normal. */
const settle = (c: ReturnType<typeof street>) => {
  for (let i = 0; i < OCC_SETTLE_PASSES; i++) stepOccupancy(c.state, c.map);
};

describe('the unhoused are a stock of people', () => {
  it('the city opens with the inherited unhoused: what redlining emptied from its homes', () => {
    const c = street([{ x: 2, count: 10 }, { x: 5, count: 10 }]);
    c.map.redline.fill(255);
    seedInheritedOccupancy(c.state, c.map);
    expect(c.state.unhoused).toBeCloseTo(20 - occTotal(c.state), 9);
    expect(c.state.unhoused).toBeGreaterThan(0);
  });

  it('nothing moves without a cause: no change, no welcome, the pool holds', () => {
    const c = street([{ x: 2, count: 10 }]);
    c.state.occupancy.set(c.t(2), 6);
    c.state.unhoused = 4;
    settle(c);
    for (let i = 0; i < 500; i++) stepOccupancy(c.state, c.map);
    expect(c.state.unhoused).toBeCloseTo(4, 9);
    expect(c.state.occupancy.get(c.t(2))).toBeCloseTo(6, 9);
  });

  it('a harm pushes people out INTO the pool — nobody vanishes', () => {
    const c = street([{ x: 2, count: 10 }, { x: 5, count: 10 }]);
    settle(c);
    const before = occTotal(c.state) + c.state.unhoused;
    c.state.pollution.set(c.t(2), 255); // a new smokestack
    for (let i = 0; i < 60; i++) stepOccupancy(c.state, c.map);
    expect(c.state.occupancy.get(c.t(2))!).toBeLessThan(10);
    expect(occTotal(c.state) + c.state.unhoused).toBeCloseTo(before, 6);
  });

  it('a repair wins people back FROM the pool first', () => {
    const c = street([{ x: 2, count: 10 }]);
    c.state.occupancy.set(c.t(2), 6);
    c.state.unhoused = 4;
    settle(c);
    c.state.landValue.set(c.t(2), 200); // a park and a clinic in reach
    for (let i = 0; i < 20; i++) stepOccupancy(c.state, c.map);
    const gained = c.state.occupancy.get(c.t(2))! - 6;
    expect(gained).toBeGreaterThan(0);
    expect(c.state.unhoused).toBeCloseTo(Math.max(0, 4 - gained), 6);
  });

  it('tearing down an occupied home makes its residents unhoused', () => {
    const c = street([{ x: 2, count: 10 }, { x: 5, count: 8 }]);
    settle(c);
    const pool = c.state.unhoused;
    setHouseholds(c.state, [{ x: 2, y: 1, count: 10 }]); // (5,1) demolished
    stepOccupancy(c.state, c.map);
    expect(c.state.unhoused).toBeCloseTo(pool + 8, 6);
  });

  it('a newly built home opens empty and fills from the unhoused', () => {
    const c = street([{ x: 2, count: 10 }]);
    settle(c);
    c.state.unhoused = 30;
    setHouseholds(c.state, [{ x: 2, y: 1, count: 10 }, { x: 9, y: 1, count: 10 }]);
    c.map.built[c.t(9)] = BuiltKind.Apartments;
    for (let i = 0; i < 400; i++) stepOccupancy(c.state, c.map);
    expect(c.state.occupancy.get(c.t(9))!).toBeCloseTo(10, 6);
    expect(c.state.unhoused).toBeCloseTo(20, 6); // its ten came from the pool
  });

  it('a new home still fills when nobody is unhoused (people move to the city)', () => {
    const c = street([{ x: 2, count: 10 }]);
    settle(c);
    c.state.unhoused = 0;
    setHouseholds(c.state, [{ x: 2, y: 1, count: 10 }, { x: 9, y: 1, count: 10 }]);
    c.map.built[c.t(9)] = BuiltKind.Apartments;
    for (let i = 0; i < 400; i++) stepOccupancy(c.state, c.map);
    expect(c.state.occupancy.get(c.t(9))!).toBeCloseTo(10, 6);
    expect(c.state.unhoused).toBe(0);
  });

  it('voice welcomes people home: an organised neighbourhood re-homes, an unorganised one does not', () => {
    const run = (welcome: number) => {
      const c = street([{ x: 2, count: 10 }]);
      c.state.occupancy.set(c.t(2), 5);
      c.state.unhoused = 5;
      settle(c);
      c.state.welcome = new Map([[c.t(2), welcome]]);
      for (let i = 0; i < 300; i++) stepOccupancy(c.state, c.map);
      return c.state;
    };
    const quiet = run(0);
    expect(quiet.unhoused).toBeCloseTo(5, 9);
    const organised = run(1);
    expect(organised.unhoused).toBeLessThan(1);
    expect(organised.occupancy.values().next().value!).toBeGreaterThan(9);
  });
});

describe('the unhoused are saved', () => {
  it('a save keeps the pool and the homes still filling', () => {
    const c = street([{ x: 2, count: 10 }]);
    c.state.unhoused = 17.5;
    c.state.freshHomes = new Set([c.t(2)]);
    const saved = JSON.parse(JSON.stringify(captureLive(c.state))) as SaveV1['live'];
    const back = street([{ x: 2, count: 10 }]);
    restoreLive(back.state, saved, back.map.width);
    expect(back.state.unhoused).toBe(17.5);
    expect([...back.state.freshHomes!]).toEqual([c.t(2)]);
  });

  it('an older save (no pool) derives it from its emptied homes plus the old rent-displacement count', () => {
    const c = street([{ x: 2, count: 10 }, { x: 5, count: 10 }]);
    const saved = { maps: { ...emptyMaps(), occupancy: [[c.t(2), 6], [c.t(5), 10]] }, occPasses: 300 } as unknown as SaveV1['live'];
    restoreLive(c.state, saved, c.map.width, 3);
    expect(c.state.unhoused).toBe(4 + 3);
  });
});

describe('rent displaces people from real homes', () => {
  const town = () => {
    const c = street([{ x: 2, count: 10 }, { x: 5, count: 10 }, { x: 8, count: 10 }]);
    settle(c);
    c.state.landValue.set(c.t(2), 220); // prized
    c.state.landValue.set(c.t(5), 60);
    c.state.landValue.set(c.t(8), 220);
    return c;
  };

  it('takes people out of unprotected homes on the most valuable land, into the unhoused', () => {
    const c = town();
    const before = occTotal(c.state) + c.state.unhoused;
    const moved = displaceFromHomes(c.state, c.map, 3, (t) => (t === c.t(8) ? 1 : 0)); // (8,1) is a co-op
    expect(moved).toBeCloseTo(3, 9);
    expect(c.state.occupancy.get(c.t(8))).toBe(10); // protected
    expect(10 - c.state.occupancy.get(c.t(2))!).toBeGreaterThan(10 - c.state.occupancy.get(c.t(5))!); // dearer land loses more
    expect(occTotal(c.state) + c.state.unhoused).toBeCloseTo(before, 9);
  });

  it('never below a home’s floor; what cannot be displaced is not', () => {
    const c = town();
    const moved = displaceFromHomes(c.state, c.map, 1000, () => 0);
    for (const x of [2, 5, 8]) expect(c.state.occupancy.get(c.t(x))!).toBeCloseTo(10 * c.state.practices.occFloor, 9);
    expect(moved).toBeCloseTo(3 * 10 * (1 - c.state.practices.occFloor), 9);
  });
});
