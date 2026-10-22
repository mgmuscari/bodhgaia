// Evictions you can see (Maddy 2026-10-21 "Unhoused as people"): when people are put out of a home — rent, a home
// torn down, a flood — you see them go: they walk out of the home with what they carry, to the camp they join. The
// count was already right; now it's people. Not at the city's opening (its inherited crisis is already in camps).
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel, placeTransport } from '../../src/engine/fabric';
import { createAmbientState, setHouseholds } from '../../src/live/types';
import { createRng } from '../../src/engine/rng';
import { leftHome, settleCamps } from '../../src/live/camps';
import { spawnEvictions } from '../../src/live/evictions';
import { stepPed } from '../../src/live/peds';
import { buildVehicleCtx } from '../../src/live/cars';

function block() {
  const map = new GameMap(30, 12);
  const parcels = new ParcelStore();
  for (let x = 0; x < 30; x++) placeTransport(map, x, 6, BuiltKind.RoadStreet);
  placeParcel(map, parcels, { x: 10, y: 5, width: 1, height: 1, kind: BuiltKind.HouseSingle });
  const state = createAmbientState();
  setHouseholds(state, [{ x: 10, y: 5, count: 6 }]);
  state.occupancy.set(map.idx(10, 5), 6);
  state.evictionsShown = true;
  return { map, parcels, state, home: map.idx(10, 5) };
}

describe('evictions you can see', () => {
  it('a household put out walks from the home, carrying what it can, toward the camp it joins', () => {
    const { map, state, home } = block();
    leftHome(state, home, 2);
    settleCamps(state, map);
    spawnEvictions(state, map);
    const out = state.peds.filter((p) => p.carrying);
    expect(out.length).toBe(2);
    const camp = [...state.camps!.keys()][0]!;
    expect(new Set(out.map((p) => p.dwellInside)).size).toBe(2); // one after another, not stacked
    for (const p of out) {
      expect(Math.max(Math.abs(p.x - 10), Math.abs(p.y - 5))).toBeLessThanOrEqual(1); // at the home's door (the walkable tile nearest it)
      expect(p.shelter).toBe(camp);
    }
    expect(state.events?.some((e) => e.kind === 'eviction') ?? true).toBe(true);
  });

  it('they reach the camp and are gone from the street (they live there now)', () => {
    const { map, state, home } = block();
    leftHome(state, home, 1);
    settleCamps(state, map);
    spawnEvictions(state, map);
    const rng = createRng('e');
    for (let k = 0; k < 2000 && state.peds.some((p) => p.carrying); k++) {
      const ctx = buildVehicleCtx(state, map);
      state.peds = state.peds.filter((p) => stepPed(state, map, rng, ctx, p));
    }
    expect(state.peds.filter((p) => p.carrying)).toHaveLength(0);
  });

  it('a trickle of rent displacement shows once it adds up to a person', () => {
    const { map, state, home } = block();
    for (let k = 0; k < 3; k++) {
      leftHome(state, home, 0.3);
      settleCamps(state, map);
      spawnEvictions(state, map);
    }
    expect(state.peds.filter((p) => p.carrying)).toHaveLength(0); // 0.9 of a person
    leftHome(state, home, 0.3);
    settleCamps(state, map);
    spawnEvictions(state, map);
    expect(state.peds.filter((p) => p.carrying)).toHaveLength(1);
  });

  it('not at the opening (before the city is shown), and not for someone rescued back to a camp', () => {
    const { map, state, home } = block();
    state.evictionsShown = false;
    leftHome(state, home, 3);
    settleCamps(state, map);
    spawnEvictions(state, map);
    expect(state.peds).toHaveLength(0);
    state.evictionsShown = true;
    const camp = [...state.camps!.keys()][0]!;
    leftHome(state, camp, 1); // a rescue returns someone to the unhoused, at their camp
    settleCamps(state, map);
    spawnEvictions(state, map);
    expect(state.peds).toHaveLength(0);
  });
});
