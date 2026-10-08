// Fire trucks (docs/design/disasters.md): dispatched from a fire station, they drive the road network to the fire,
// spray it, report it out, and drive home.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, placeTransport } from '../../src/engine/fabric';
import { createAmbientState } from '../../src/live/types';
import { dispatchTruck, stepTrucks, roadNear } from '../../src/live/trucks';
import { SPRAY_SUBSTEPS, TURNOUT_SUBSTEPS } from '../../src/live/tuning';

function town() {
  const map = new GameMap(40, 10);
  for (let x = 0; x < 40; x++) placeTransport(map, x, 5, BuiltKind.RoadStreet);
  map.built[map.idx(3, 4)] = BuiltKind.FireStation;
  map.built[map.idx(30, 6)] = BuiltKind.HouseSingle;
  return { map, state: createAmbientState() };
}

describe('fire trucks', () => {
  it('finds the road beside a building', () => {
    const { map } = town();
    expect(roadNear(map, 3, 4, 1, 1)).toEqual({ x: 3, y: 5 });
    expect(roadNear(map, 30, 6, 1, 1)).toEqual({ x: 30, y: 5 });
  });

  it('drives the roads to the fire, sprays it, reports it out, and goes home', () => {
    const { map, state } = town();
    expect(dispatchTruck(state, map, { x: 3, y: 5 }, { x: 30, y: 5 }, 7)).toBe(true);
    const t = state.trucks![0]!;
    let onRoad = true;
    let n = 0;
    while (state.trucks![0]?.phase === 'to-fire' && n++ < 2000) {
      stepTrucks(state, map);
      const k = map.built[map.idx(Math.round(t.x), Math.round(t.y))]!;
      if (k < 1 || k > 3) onRoad = false;
    }
    expect(onRoad).toBe(true);
    expect(state.trucks![0]!.phase).toBe('spraying');
    expect(Math.round(t.x)).toBe(30);
    for (let i = 0; i < SPRAY_SUBSTEPS; i++) stepTrucks(state, map);
    expect([...state.quenched!]).toEqual([7]);
    expect(state.trucks![0]!.phase).toBe('home');
    for (let i = 0; i < 2000 && state.trucks!.length > 0; i++) stepTrucks(state, map);
    expect(state.trucks).toEqual([]); // back at the station
  });

  it('the crew turns out before the truck leaves the station', () => {
    const { map, state } = town();
    expect(TURNOUT_SUBSTEPS).toBeGreaterThanOrEqual(60); // seconds, not a blink
    dispatchTruck(state, map, { x: 3, y: 5 }, { x: 30, y: 5 }, 7);
    for (let i = 0; i < TURNOUT_SUBSTEPS - 1; i++) stepTrucks(state, map);
    expect(state.trucks![0]!.x).toBe(3);
    for (let i = 0; i < 5; i++) stepTrucks(state, map);
    expect(state.trucks![0]!.x).toBeGreaterThan(3);
  });

  it('a fire with no road to it gets no truck', () => {
    const { map, state } = town();
    expect(dispatchTruck(state, map, { x: 3, y: 5 }, { x: 30, y: 8 }, 7)).toBe(false);
    expect(state.trucks ?? []).toEqual([]);
  });
});
