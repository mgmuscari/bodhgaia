// Industrial spills (docs/design/disasters.md): an old works leaks — poisoning the ground and the water near it —
// and a toxic cloud rides the wind, harming the people it passes over.
import { describe, it, expect } from 'vitest';
import { GameMap, Water } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { createAmbientState, NEUTRAL_PRACTICES } from '../../src/live/types';
import { spillChance, startSpill, stepClouds, drawSpills, stepToxic } from '../../src/live/spills';
import { CLOUD_DEATH_MAX, CLOUD_SUBSTEPS, SPILL_WATER_RADIUS } from '../../src/live/tuning';

function works(opts: { water?: boolean; treatment?: boolean } = {}) {
  const map = new GameMap(40, 20);
  const parcels = new ParcelStore();
  const w = placeParcel(map, parcels, { x: 10, y: 8, width: 2, height: 2, kind: BuiltKind.Industrial, condition: 40 });
  if (opts.water) for (let y = 0; y < 20; y++) map.water[map.idx(14, y)] = Water.River;
  if (opts.treatment) placeParcel(map, parcels, { x: 17, y: 8, width: 1, height: 1, kind: BuiltKind.WastewaterWorks });
  const state = createAmbientState();
  state.events = [];
  state.wind = { dx: 1, dy: 0 };
  return { map, parcels, state, w };
}

describe('spills: where they start', () => {
  it('old, redlined works leak more; worker-owned works far less; nothing else leaks', () => {
    const p = NEUTRAL_PRACTICES;
    expect(spillChance(BuiltKind.Industrial, 20, 0, p)).toBeGreaterThan(spillChance(BuiltKind.Industrial, 240, 0, p));
    expect(spillChance(BuiltKind.Industrial, 128, 255, p)).toBeGreaterThan(spillChance(BuiltKind.Industrial, 128, 0, p));
    expect(spillChance(BuiltKind.Industrial, 128, 128, { ...p, spillRate: 0.25 })).toBeCloseTo(spillChance(BuiltKind.Industrial, 128, 128, p) * 0.25);
    expect(spillChance(BuiltKind.HouseSingle, 0, 255, p)).toBe(0);
    expect(spillChance(BuiltKind.CommercialStrip, 0, 255, p)).toBe(0);
  });

  it('draws once per in-game hour, never without a clock', () => {
    const { map, parcels, state } = works();
    const rng = createRng('spill').fork('d');
    expect(drawSpills(state, { map, parcels }, rng, undefined)).toEqual([]);
    let started = 0;
    for (let h = 0; h < 24 * 4000; h++) {
      started += drawSpills(state, { map, parcels }, rng, h % 24).length;
      started += drawSpills(state, { map, parcels }, rng, h % 24).length; // same hour: no second draw
    }
    expect(started).toBeGreaterThan(0);
    expect(state.clouds!.length).toBe(started);
  });
});

describe('spills: what they do', () => {
  it('poisons the ground at the works, the water nearby, and sends a cloud and the camera', () => {
    const { map, parcels, state, w } = works({ water: true });
    startSpill(state, map, parcels.get(w));
    expect(state.groundPollution.get(map.idx(10, 8)) ?? 0).toBeGreaterThan(100);
    expect(state.waterPollution.get(map.idx(14, 9)) ?? 0).toBeGreaterThan(100);
    expect(state.waterPollution.get(map.idx(14, 9 + SPILL_WATER_RADIUS + 3)) ?? 0).toBe(0);
    expect(state.clouds).toHaveLength(1);
    expect(state.events).toEqual([{ kind: 'spill', x: 10, y: 8, w: 2, h: 2 }]);
  });

  it('a wastewater works nearby catches half of what reaches the water', () => {
    const a = works({ water: true });
    startSpill(a.state, a.map, a.parcels.get(a.w));
    const b = works({ water: true, treatment: true });
    startSpill(b.state, b.map, b.parcels.get(b.w));
    const at = (s: typeof a) => s.state.waterPollution.get(s.map.idx(14, 9)) ?? 0;
    expect(at(b)).toBeCloseTo(at(a) / 2);
  });

  it('the cloud rides the wind, smogs the air under it, and is gone after its life', () => {
    const { map, parcels, state, w } = works();
    startSpill(state, map, parcels.get(w));
    const x0 = state.clouds![0]!.x;
    const rng = createRng('c').fork('c');
    for (let i = 0; i < 100; i++) stepClouds(state, map, rng);
    expect(state.clouds![0]!.x).toBeGreaterThan(x0 + 1);
    expect(state.clouds![0]!.y).toBeCloseTo(9);
    expect(state.pollution.get(map.idx(Math.floor(state.clouds![0]!.x), 9)) ?? 0).toBeGreaterThan(0);
    for (let i = 0; i < CLOUD_SUBSTEPS; i++) stepClouds(state, map, rng);
    expect(state.clouds).toHaveLength(0);
  });

  it('the cloud is toxic smog: it lays its own field under it, which drifts downwind, spreads, and clears', () => {
    const { map, parcels, state, w } = works();
    startSpill(state, map, parcels.get(w));
    const rng = createRng('t').fork('t');
    for (let i = 0; i < 20; i++) stepClouds(state, map, rng);
    expect(state.toxic!.get(map.idx(11, 9)) ?? 0).toBeGreaterThan(100);
    state.clouds = [];
    const mass = (minX: number) => [...state.toxic!].filter(([t]) => t % map.width >= minX).reduce((s, [, v]) => s + v, 0);
    const downwindBefore = mass(15);
    for (let i = 0; i < 80; i++) stepToxic(state, map, i % 8 === 0);
    expect(mass(15)).toBeGreaterThan(downwindBefore);
    for (let i = 0; i < 4000; i++) stepToxic(state, map, i % 8 === 0);
    expect(state.toxic!.size).toBe(0);
  });

  it('kills a few of the people it passes over — never more than its cap, never anyone indoors or away from it', () => {
    const { map, parcels, state, w } = works();
    const home = map.idx(2, 2);
    state.occupancy.set(home, 50);
    for (let k = 0; k < 40; k++) state.peds.push({ x: 13 + (k % 8), y: 9, dir: 1, tx: 13, ty: 9, homeTile: home });
    state.peds.push({ x: 14, y: 9, dir: 1, tx: 14, ty: 9, phase: 'inside', homeTile: home });
    state.peds.push({ x: 14, y: 18, dir: 1, tx: 14, ty: 18, homeTile: home });
    startSpill(state, map, parcels.get(w));
    const rng = createRng('kill').fork('k');
    for (let i = 0; i < CLOUD_SUBSTEPS; i++) stepClouds(state, map, rng);
    const dead = state.events!.filter((e) => e.kind === 'death').length;
    expect(dead).toBeGreaterThan(0);
    expect(dead).toBeLessThanOrEqual(CLOUD_DEATH_MAX);
    expect(state.peds).toHaveLength(42 - dead);
    expect(state.peds.some((p) => p.phase === 'inside')).toBe(true);
    expect(state.peds.some((p) => p.y === 18)).toBe(true);
    expect(state.occupancy.get(home)).toBe(50 - dead);
  });
});
