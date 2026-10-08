// The opening's night walker (bodhgaia-opening.md §3): one unhoused resident walks the streets, the camera
// following, until they die.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, placeTransport } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { createAmbientState } from '../../src/live/types';
import { startWanderer, stepWanderer } from '../../src/live/wanderer';
import { isWalkable } from '../../src/live/network';
import { ENCAMPMENT_WEAR } from '../../src/live/tuning';

function town() {
  const map = new GameMap(40, 40);
  for (let i = 0; i < 40; i++) {
    placeTransport(map, i, 10, BuiltKind.RoadStreet);
    placeTransport(map, i, 25, BuiltKind.RoadStreet);
    placeTransport(map, 12, i, BuiltKind.RoadStreet);
    placeTransport(map, 30, i, BuiltKind.RoadStreet);
  }
  const state = createAmbientState();
  state.wear.set(map.idx(20, 18), ENCAMPMENT_WEAR + 5);
  state.unhoused = 50;
  return { map, state };
}

describe('the night walker', () => {
  it('starts at the encampment and walks real paths, on walkable ground', () => {
    const { map, state } = town();
    const rng = createRng('walker').fork('w');
    expect(startWanderer(state, map, rng, 400)).toBe(true);
    const start = { x: state.wanderer!.x, y: state.wanderer!.y };
    expect(Math.abs(start.x - 20) + Math.abs(start.y - 18)).toBeLessThanOrEqual(1);
    let moved = 0;
    for (let i = 0; i < 300; i++) {
      stepWanderer(state, map, rng);
      const w = state.wanderer!;
      expect(isWalkable(map, Math.round(w.x), Math.round(w.y)), `at ${w.x},${w.y}`).toBe(true);
      moved = Math.max(moved, Math.abs(w.x - start.x) + Math.abs(w.y - start.y));
    }
    expect(moved).toBeGreaterThan(3);
  });

  it('dies when their time is up: lies down where they are, leaving the unhoused', () => {
    const { map, state } = town();
    const rng = createRng('walker').fork('w');
    startWanderer(state, map, rng, 100);
    for (let i = 0; i < 99; i++) stepWanderer(state, map, rng);
    expect(state.wanderer).toBeDefined();
    const at = { x: Math.round(state.wanderer!.x), y: Math.round(state.wanderer!.y) };
    stepWanderer(state, map, rng);
    expect(state.wanderer).toBeUndefined();
    expect(state.fallen).toEqual([{ x: at.x, y: at.y, t: 0 }]);
    expect(state.unhoused).toBe(49);
  });
});
