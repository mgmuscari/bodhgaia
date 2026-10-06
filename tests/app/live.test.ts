import { describe, it, expect, afterEach } from 'vitest';
import { createLive, plantEmitters, PLUME_RADIUS } from '../../src/app/live';
import { GameMap } from '../../src/engine/map';
import { ParcelStore, BuiltKind, placeParcel, placeTransport } from '../../src/engine/fabric';
import { plantPollution } from '../../src/growth/power';
import { createAmbientState } from '../../src/live/types';
import { liveCaps, applyLiveCaps } from '../../src/live/caps';
import { seedDecay } from '../../src/live/fields/pollution';
import { createRng } from '../../src/engine/rng';
import type { SaveV1 } from '../../src/save/snapshot';
import { CAP_PRESETS } from '../../src/ui/settings';

// The live layer's setup (app/live.ts): the ambient state + its own rng streams, the city-derived inputs it
// reads (parking lots, households, plant emitters), the seeded decay (and a save's stocks OVER it), the perf
// caps, the on/off switch and the ambient clock — the clock is the live path's own, never the sim's.

const defaults = { ...liveCaps };
afterEach(() => applyLiveCaps(defaults));

function city() {
  const map = new GameMap(20, 12);
  const parcels = new ParcelStore();
  for (let x = 2; x <= 14; x++) placeTransport(map, x, 5, BuiltKind.RoadStreet);
  for (let x = 2; x <= 14; x++) placeTransport(map, x, 7, BuiltKind.RoadStreet);
  placeParcel(map, parcels, { x: 4, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle });
  return { map, parcels };
}

describe('plantEmitters: each dirty plant smogs its footprint + a plume ring', () => {
  it('a plant emits over (w + 2r)×(h + 2r) tiles at its pollution amount, clipped to the map', () => {
    const map = new GameMap(16, 16);
    const parcels = new ParcelStore();
    placeParcel(map, parcels, { x: 6, y: 6, width: 2, height: 2, kind: BuiltKind.CoalPlant });
    const amt = plantPollution(BuiltKind.CoalPlant);
    expect(amt).toBeGreaterThan(0);
    const e = plantEmitters(map, parcels);
    const side = 2 + 2 * PLUME_RADIUS;
    expect(e).toHaveLength(side * side);
    expect(e.every((x) => x.amount === amt)).toBe(true);
    expect(e[0]).toEqual({ tile: map.idx(6 - PLUME_RADIUS, 6 - PLUME_RADIUS), amount: amt }); // row-major from the corner
    expect(new Set(e.map((x) => x.tile)).size).toBe(e.length);
  });

  it('clips at the map edge; clean parcels emit nothing', () => {
    const map = new GameMap(16, 16);
    const parcels = new ParcelStore();
    placeParcel(map, parcels, { x: 0, y: 0, width: 1, height: 1, kind: BuiltKind.CoalPlant });
    placeParcel(map, parcels, { x: 10, y: 10, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    const e = plantEmitters(map, parcels);
    expect(e).toHaveLength((1 + PLUME_RADIUS) * (1 + PLUME_RADIUS));
    expect(e.every((x) => map.inBounds(x.tile % 16, Math.floor(x.tile / 16)))).toBe(true);
  });
});

describe('createLive', () => {
  it('seeds the decay a century left, like seedDecay on a fresh state', () => {
    const { map, parcels } = city();
    const live = createLive({ seed: 's', map, parcels, caps: liveCaps, saved: null, walkable: () => false, now: () => 0 });
    const ref = createAmbientState(createRng('s').fork('ambient-wind'));
    seedDecay(ref, map);
    expect(live.state.wear.size).toBeGreaterThan(0);
    expect([...live.state.wear]).toEqual([...ref.wear]);
    expect(live.state.wind).toEqual(ref.wind); // the wind draws from its own fork
  });

  it('a resumed city puts its saved stocks OVER the seeded decay (restore after seed)', () => {
    const { map, parcels } = city();
    const empty = { occupancy: [], occExpect: [], wear: [[3, 7]], roadDecay: [], waterPollution: [], groundPollution: [], pollution: [], buildingHealth: [] };
    const saved = { maps: empty, occPasses: 9 } as unknown as SaveV1['live'];
    const live = createLive({ seed: 's', map, parcels, caps: liveCaps, saved, walkable: () => false, now: () => 0 });
    expect([...live.state.wear]).toEqual([[3, 7]]); // not the seeded trampling
    expect(live.state.occPasses).toBe(9);
  });

  it('applies the perf caps at creation and on change', () => {
    const { map, parcels } = city();
    const live = createLive({ seed: 's', map, parcels, caps: CAP_PRESETS.low, saved: null, walkable: () => false, now: () => 0 });
    expect(liveCaps.pedCap).toBe(CAP_PRESETS.low.pedCap);
    live.applyCaps(CAP_PRESETS.high);
    expect(liveCaps.pedCap).toBe(CAP_PRESETS.high.pedCap);
  });

  it('publishes the parking lots, households and plant emitters it derives from the city', () => {
    const { map, parcels } = city();
    placeParcel(map, parcels, { x: 16, y: 1, width: 1, height: 1, kind: BuiltKind.CoalPlant });
    const live = createLive({ seed: 's', map, parcels, caps: liveCaps, saved: null, walkable: () => false, now: () => 0 });
    expect(live.state.households!.length).toBeGreaterThan(0);
    expect(live.state.plantEmitters!.length).toBe(plantEmitters(map, parcels).length);
    placeParcel(map, parcels, { x: 1, y: 10, width: 1, height: 1, kind: BuiltKind.CoalPlant });
    live.recomputePlantEmitters();
    expect(live.state.plantEmitters!.length).toBe(plantEmitters(map, parcels).length);
  });

  it('steps on its OWN clock: dt since the last step (or reset), carrying the walkability flag', () => {
    const { map, parcels } = city();
    let walk = false;
    let t = 1000;
    const live = createLive({ seed: 's', map, parcels, caps: liveCaps, saved: null, walkable: () => walk, now: () => t });
    expect(live.on).toBe(true); // ambient life is on by default
    live.step(1010);
    expect(live.state.accMs).toBe(10);
    walk = true;
    live.step(1030);
    expect(live.state.accMs).toBe(30);
    expect(live.state.walkable).toBe(true);
    // off for a long while, then back on: the clock restarts — no giant first dt
    live.on = false;
    t = 90_000;
    live.on = true;
    live.step(90_005);
    expect(live.state.accMs).toBe(35);
    // a tab coming back resets the clock the same way
    t = 200_000;
    live.resetClock();
    live.step(200_001);
    expect(live.state.accMs).toBe(36);
  });
});
