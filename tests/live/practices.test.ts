// The tech practices' live effects (docs/design/tech-tree-balance.md): each is a plain coefficient on
// AmbientState.practices, neutral by default, set by the host from the tech tree.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { TravelMode } from '../../src/citizens/modes';
import { visitValue } from '../../src/citizens/plots';
import { createAmbientState, setHouseholds, NEUTRAL_PRACTICES } from '../../src/live/types';
import { chooseMode, tripDelivered } from '../../src/live/pathing';
import { stepArrests } from '../../src/live/police';
import { stepOccupancy } from '../../src/live/fields/occupancy';
import { depositVisit } from '../../src/live/agents';
import { OCC_FLOOR } from '../../src/live/tuning';

describe('neutral practices are the sim as it was', () => {
  it('the neutral coefficients are the tuning constants', () => {
    expect(NEUTRAL_PRACTICES.occFloor).toBe(OCC_FLOOR);
    expect(NEUTRAL_PRACTICES.industryVisit).toBe(visitValue(BuiltKind.Industrial));
    expect(NEUTRAL_PRACTICES.bikeStretch).toBe(1);
    expect(NEUTRAL_PRACTICES.arrestRelease).toBe(0);
    expect(NEUTRAL_PRACTICES.droneShopDrop).toBe(0);
  });
});

describe('Bike Shares: people cycle farther', () => {
  it('a leg just past cycling range is cycled, not driven', () => {
    const map = new GameMap(40, 10);
    for (let x = 0; x < 40; x++) map.built[map.idx(x, 5)] = BuiltKind.RoadStreet;
    expect(chooseMode(map, 3, 5, 28, 5, 0, 1, 1)).toBe(TravelMode.Drive); // d=25 > 18
    expect(chooseMode(map, 3, 5, 28, 5, 0, 1, 1.5)).toBe(TravelMode.Bike); // 25 ≤ 27
  });
});

describe('Drone Deliveries: a share of driven shopping trips never happen', () => {
  it('delivers none at 0, about half at 0.5, all at 1', () => {
    let half = 0;
    for (let h = 0; h < 2000; h++) {
      expect(tripDelivered(0, h)).toBe(false);
      expect(tripDelivered(1, h)).toBe(true);
      if (tripDelivered(0.5, h)) half++;
    }
    expect(half).toBeGreaterThan(900);
    expect(half).toBeLessThan(1100);
  });
});

describe('Circles: a police stop goes to a circle instead of an arrest', () => {
  const street = () => {
    const map = new GameMap(10, 10);
    map.redline.fill(255);
    for (let x = 0; x < 10; x++) map.built[map.idx(x, 5)] = BuiltKind.RoadStreet;
    const home = map.idx(5, 6);
    map.built[home] = BuiltKind.HouseSingle;
    const state = createAmbientState();
    state.occupancy.set(home, 5);
    state.cruisers.push({ x: 5, y: 5, dir: 1, tx: 5, ty: 5, recent: [] });
    state.peds.push({ x: 5, y: 5, dir: 1, tx: 5, ty: 5, homeTile: home, phase: 'to-building' });
    return { map, state, home };
  };

  it('with every stop released, nobody is taken and no violence is recorded', () => {
    const { map, state, home } = street();
    state.practices = { ...NEUTRAL_PRACTICES, arrestRelease: 1 };
    const rng = createRng('circles').fork('arrest');
    for (let n = 0; n < 60; n++) stepArrests(state, map, rng);
    expect(state.peds.length).toBe(1);
    expect(state.occupancy.get(home)).toBe(5);
    expect(state.policeViolence.size).toBe(0);
  });

  it('without circles the same street loses its citizen', () => {
    const { map, state } = street();
    const rng = createRng('circles').fork('arrest');
    for (let n = 0; n < 60 && state.peds.length > 0; n++) stepArrests(state, map, rng);
    expect(state.peds.length).toBe(0);
  });
});

describe('Mutual Aid: neighbours take people in', () => {
  it('a home never thins below the raised floor', () => {
    const map = new GameMap(8, 8);
    map.built[map.idx(3, 3)] = BuiltKind.HouseSingle;
    const t = map.idx(3, 3);
    const state = createAmbientState();
    setHouseholds(state, [{ x: 3, y: 3, count: 10 }]);
    state.occupancy.set(t, 10 * OCC_FLOOR);
    stepOccupancy(state, map);
    expect(state.occupancy.get(t)).toBeCloseTo(4, 9);
    state.practices = { ...NEUTRAL_PRACTICES, occFloor: 0.5 };
    stepOccupancy(state, map);
    expect(state.occupancy.get(t)).toBeCloseTo(5, 9);
  });
});

describe('Collective Ownership: a day at a worker-owned plant costs less', () => {
  it('an industrial visit deposits the practice value, not the neutral harm', () => {
    const map = new GameMap(8, 8);
    map.built[map.idx(2, 2)] = BuiltKind.Industrial;
    const home = map.idx(5, 5);
    const state = createAmbientState();
    depositVisit(state, home, { x: 2, y: 2 }, map);
    expect(state.buildingHealth.get(home)).toBe(visitValue(BuiltKind.Industrial));
    state.buildingHealth.clear();
    state.practices = { ...NEUTRAL_PRACTICES, industryVisit: -1 };
    depositVisit(state, home, { x: 2, y: 2 }, map);
    expect(state.buildingHealth.get(home)).toBe(-1);
  });
});
