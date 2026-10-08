import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { createFireState, stepFire, igniteChance, BURN_STEPS, QUENCH_DAMAGE, DISTRESS_FACTOR, ABANDON_FACTOR } from '../../src/growth/fire';

function block(condition: number, kind: BuiltKind = BuiltKind.HouseSingle, n = 40) {
  const map = new GameMap(60, 10);
  const parcels = new ParcelStore();
  for (let x = 0; x < n; x++) placeParcel(map, parcels, { x: x + 2, y: 2, width: 1, height: 1, kind, condition });
  return { world: { map, parcels } };
}

describe('fire: ignition', () => {
  it('distressed (redlined) and abandoned (emptied) buildings burn more readily (Maddy 2026-10-08)', () => {
    const base = igniteChance(BuiltKind.HouseSingle, 128);
    expect(igniteChance(BuiltKind.HouseSingle, 128, 255)).toBeCloseTo(base * (1 + DISTRESS_FACTOR));
    expect(igniteChance(BuiltKind.HouseSingle, 128, 0, 1)).toBeCloseTo(base * (1 + ABANDON_FACTOR));
    expect(igniteChance(BuiltKind.HouseSingle, 128, 255, 1)).toBeGreaterThan(igniteChance(BuiltKind.HouseSingle, 128, 255, 0.3));
    expect(igniteChance(BuiltKind.Park, 0, 255, 1)).toBe(0); // greens still don't burn
  });

  it('stepFire reads distress from the redline layer and abandonment from the host', () => {
    const count = (grade: number, vacant: number): number => {
      const { world } = block(128, BuiltKind.HouseSingle, 40);
      world.map.redline.fill(grade);
      const vacancy = new Map(world.parcels.aliveIndices().map((i) => [i, vacant] as [number, number]));
      const fires = createFireState();
      const rng = createRng('fire').fork('distress');
      for (let h = 0; h < 24 * 200; h++) {
        stepFire(world, fires, rng, { hour: h % 24, vacancy });
        fires.burning.clear();
      }
      return fires.started;
    };
    expect(count(255, 0)).toBeGreaterThan(count(0, 0));
    expect(count(0, 1)).toBeGreaterThan(count(0, 0));
  });

  it('decay, ruins and industry burn more readily than a well-kept house', () => {
    expect(igniteChance(BuiltKind.HouseSingle, 30)).toBeGreaterThan(igniteChance(BuiltKind.HouseSingle, 250));
    expect(igniteChance(BuiltKind.Ruin, 0)).toBeGreaterThan(igniteChance(BuiltKind.HouseSingle, 0));
    expect(igniteChance(BuiltKind.Industrial, 200)).toBeGreaterThan(igniteChance(BuiltKind.HouseSingle, 200));
    expect(igniteChance(BuiltKind.Park, 0)).toBe(0); // greens don't burn
    expect(igniteChance(BuiltKind.Yard, 0)).toBe(0);
  });

  it('draws once per in-game hour, never without a clock — and a decayed street burns more often', () => {
    const count = (cond: number): number => {
      const { world } = block(cond, BuiltKind.HouseSingle, 40);
      const fires = createFireState();
      const rng = createRng('fire').fork('ignite');
      let started = 0;
      for (let h = 0; h < 24 * 200; h++) {
        stepFire(world, fires, rng, { hour: h % 24 }); // ignition
        stepFire(world, fires, rng, { hour: h % 24 }); // same hour: no second draw
        started += fires.started;
        fires.started = 0;
        fires.burning.clear(); // isolate ignition from spread
      }
      return started;
    };
    expect(count(20)).toBeGreaterThan(count(250));
    const { world } = block(20);
    const fires = createFireState();
    stepFire(world, fires, createRng('x').fork('y'), {});
    expect(fires.burning.size).toBe(0);
  });
});

describe('fire: spread, burnout, quenching', () => {
  it('spreads to a building beside it, not to one across open ground', () => {
    const map = new GameMap(30, 10);
    const parcels = new ParcelStore();
    const a = placeParcel(map, parcels, { x: 2, y: 2, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    const b = placeParcel(map, parcels, { x: 3, y: 2, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    const far = placeParcel(map, parcels, { x: 20, y: 2, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    const fires = createFireState();
    fires.burning.set(a, { age: 0 });
    const rng = createRng('spread').fork('s');
    for (let i = 0; i < BURN_STEPS - 1; i++) stepFire({ map, parcels }, fires, rng, {});
    expect(fires.burning.has(b) || parcels.kindAt(b) === BuiltKind.Ruin).toBe(true);
    expect(fires.burning.has(far)).toBe(false);
  });

  it('a fire left to burn leaves a ruin', () => {
    const map = new GameMap(10, 10);
    const parcels = new ParcelStore();
    const a = placeParcel(map, parcels, { x: 4, y: 4, width: 2, height: 2, kind: BuiltKind.Apartments });
    const fires = createFireState();
    fires.burning.set(a, { age: 0 });
    const rng = createRng('burn').fork('b');
    let burnt: number[] = [];
    for (let i = 0; i < BURN_STEPS; i++) burnt = burnt.concat(stepFire({ map, parcels }, fires, rng, {}).burntOut.map((e) => e.parcel));
    expect(burnt).toEqual([a]);
    expect(parcels.kindAt(a)).toBe(BuiltKind.Ruin);
    expect(parcels.conditionAt(a)).toBe(0);
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) expect(map.built[map.idx(4 + dx, 4 + dy)]).toBe(BuiltKind.Ruin);
    expect(fires.burning.size).toBe(0);
  });

  it('a fire a truck reaches is put out; the building stands, scorched', () => {
    const map = new GameMap(10, 10);
    const parcels = new ParcelStore();
    const a = placeParcel(map, parcels, { x: 4, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle, condition: 200 });
    const fires = createFireState();
    fires.burning.set(a, { age: 3 });
    const r = stepFire({ map, parcels }, fires, createRng('q').fork('q'), { quenched: new Set([a]) });
    expect(r.quenched).toEqual([a]);
    expect(fires.burning.size).toBe(0);
    expect(parcels.kindAt(a)).toBe(BuiltKind.HouseSingle);
    expect(parcels.conditionAt(a)).toBe(200 - QUENCH_DAMAGE);
  });
});
