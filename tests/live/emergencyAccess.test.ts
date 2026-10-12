// A player's request, via Maddy (2026-10-12): emergency vehicles may use quiet streets, bike paths and promenades —
// fire trucks only (the police stay on the roads). As real car-free streets keep emergency access: a car-free
// district can still be reached by a fire engine, which takes those ways slowly and only when the roads are a
// real detour.
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind } from '../../src/engine/fabric';
import { roadPath, emergencyPath } from '../../src/live/pathing';
import { roadNear, dispatchTruck, stepTrucks } from '../../src/live/trucks';
import { createAmbientState } from '../../src/live/types';

/** A road along y=2; a promenade (or other car-free way) down x=10 to a lot at the bottom, reached no other way. */
const town = (way: number) => {
  const map = new GameMap(20, 20);
  for (let x = 0; x < 20; x++) map.setBuilt(x, 2, BuiltKind.RoadStreet);
  for (let y = 3; y <= 15; y++) map.setBuilt(10, y, way);
  map.setBuilt(11, 15, BuiltKind.HouseSingle); // the burning house, only on the car-free way
  return map;
};

describe('fire trucks may use the car-free ways', () => {
  for (const [name, way] of [['promenade', BuiltKind.Promenade], ['bike path', BuiltKind.BikePath], ['quiet street', BuiltKind.QuietStreet]] as const) {
    it(`a ${name}: the truck finds a way the cars cannot`, () => {
      const map = town(way);
      expect(roadPath(map, 2, 2, 10, 15)).toBeNull(); // cars (and cruisers): no
      const path = emergencyPath(map, 2, 2, 10, 15);
      expect(path).not.toBeNull();
      expect(path!.at(-1)).toBe(map.idx(10, 15));
    });
  }

  it('it reaches a fire from a car-free way beside it, when no road is near', () => {
    const map = town(BuiltKind.Promenade);
    expect(roadNear(map, 11, 15, 1, 1)).toEqual({ x: 10, y: 15 });
  });

  it('a road is preferred when it is only a little longer than the shortcut', () => {
    const map = new GameMap(20, 20);
    for (let x = 0; x < 20; x++) map.setBuilt(x, 2, BuiltKind.RoadStreet);
    for (let x = 0; x < 20; x++) map.setBuilt(x, 4, BuiltKind.RoadStreet);
    map.setBuilt(0, 3, BuiltKind.RoadStreet);
    map.setBuilt(19, 3, BuiltKind.RoadStreet);
    map.setBuilt(5, 3, BuiltKind.Promenade); // a one-tile shortcut between the two roads
    const path = emergencyPath(map, 4, 2, 6, 4)!;
    // through the promenade is 4 tiles; round by road (via x=0) is 10 — the shortcut wins here
    expect(path).toContain(map.idx(5, 3));
    map.setBuilt(6, 3, BuiltKind.RoadStreet); // now a road joins them one tile further on
    expect(emergencyPath(map, 4, 2, 6, 4)!).not.toContain(map.idx(5, 3));
  });

  it('a dispatched truck drives the promenade to the fire and sprays', () => {
    const map = town(BuiltKind.Promenade);
    const state = createAmbientState();
    expect(dispatchTruck(state, map, { x: 2, y: 2 }, { x: 10, y: 15 }, 0)).toBe(true);
    let sprayed = false;
    for (let i = 0; i < 3000 && !sprayed; i++) {
      stepTrucks(state, map);
      sprayed = state.trucks?.[0]?.call === 'spraying';
    }
    expect(sprayed).toBe(true);
  });
});
