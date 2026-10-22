import { describe, it, expect } from 'vitest';
import { createCity } from '../../src/app/city';
import { captureGame } from '../../src/save/snapshot';
import { createEconomy } from '../../src/economy/model';
import { DEFAULT_LEVERS } from '../../src/economy/run';
import { createAmbientState } from '../../src/live/types';
import { createRng } from '../../src/engine/rng';
import { TECH_TREE } from '../../src/tech/tree';

// The city: the world generated from its seed (or a save's seed + size), the tech tree, and the civic state over
// the neighborhood partition — with a save's layers / grants / civic cells laid over them BEFORE anything derives
// from them — plus the sim deps simTick reads.

const SIZE = { width: 48, height: 40 };

describe('createCity', () => {
  it('generates a fresh city from the seed at the requested size, sharing one partition with the sim', () => {
    const c = createCity({ seed: 'city-test', size: SIZE, save: null });
    expect([c.world.map.width, c.world.map.height]).toEqual([48, 40]);
    expect(c.sim.world).toBe(c.world);
    expect(c.sim.tech).toBe(c.tech);
    expect(c.sim.civic).toBe(c.civic);
    expect(c.seed).toBe('city-test');
    // the sim carries no seed (it draws no randomness) and no effort mode (the economy owns effort)
    expect('seed' in c.sim).toBe(false);
    expect('effortAccrual' in c.sim).toBe(false);
    expect(c.tech.unlocked.size).toBe(0);
  });

  it('is deterministic in the seed', () => {
    const a = createCity({ seed: 'city-test', size: SIZE, save: null });
    const b = createCity({ seed: 'city-test', size: SIZE, save: null });
    expect(Buffer.from(a.world.map.built).equals(Buffer.from(b.world.map.built))).toBe(true);
  });

  it('a save brings its own size and lays its world, tech and civic state over the regenerated city', () => {
    const a = createCity({ seed: 'city-test', size: SIZE, save: null });
    a.world.map.soilHealth.fill(7);
    a.tech.grant(TECH_TREE[0]!.id);
    a.tech.effort = 321;
    const save = captureGame({
      seed: 'city-test',
      world: a.world,
      tech: a.tech,
      civic: a.civic,
      econ: { state: createEconomy(), levers: DEFAULT_LEVERS, projects: [] } as never,
      live: createAmbientState(createRng('x')),
      tick: 9,
      camera: { x: 0, y: 0, zoom: 2 },
    });
    const b = createCity({ seed: 'ignored', size: { width: 16, height: 16 }, save });
    expect([b.world.map.width, b.world.map.height]).toEqual([48, 40]);
    expect(b.seed).toBe('city-test'); // the save's seed, not the one asked for
    expect(b.world.map.soilHealth.every((v) => v === 7)).toBe(true);
    expect([...b.tech.unlocked]).toEqual([TECH_TREE[0]!.id]);
    expect(b.tech.effort).toBe(321);
    expect(b.civic.exportCells()).toEqual(a.civic.exportCells());
  });
});

// A city's mode (Maddy 2026-10-21 "Sandbox + difficulty"): the difficulty scales how much damage the history stage
// leaves; a sandbox opens the whole tech tree; standard is today's city exactly; the mode is saved with the city.
import { STANDARD_MODE, type CityMode } from '../../src/engine/mode';
describe('createCity: the city mode', () => {
  const S = { width: 64, height: 64 };
  const meanCondition = (mode?: CityMode) => {
    const c = createCity({ seed: 'mode-test', size: S, save: null, mode });
    const ids = c.world.parcels.aliveIndices();
    return ids.reduce((a, i) => a + c.world.parcels.conditionAt(i), 0) / ids.length;
  };

  it('standard is the city it always was', () => {
    const a = createCity({ seed: 'mode-test', size: S, save: null });
    const b = createCity({ seed: 'mode-test', size: S, save: null, mode: STANDARD_MODE });
    expect(Buffer.from(a.world.map.built).equals(Buffer.from(b.world.map.built))).toBe(true);
    expect(meanCondition()).toBe(meanCondition(STANDARD_MODE));
    expect(b.mode).toEqual(STANDARD_MODE);
  });

  it('a gentle history leaves the buildings in better repair, a hard one in worse', () => {
    const gentle = meanCondition({ difficulty: 'gentle', sandbox: false });
    const standard = meanCondition(STANDARD_MODE);
    const hard = meanCondition({ difficulty: 'hard', sandbox: false });
    expect(gentle).toBeGreaterThan(standard);
    expect(hard).toBeLessThan(standard);
  });

  it('a sandbox opens the whole tech tree', () => {
    const c = createCity({ seed: 'mode-test', size: S, save: null, mode: { difficulty: 'standard', sandbox: true } });
    expect(c.tech.unlocked.size).toBe(TECH_TREE.length);
  });

  it('the mode is saved with the city, and a resumed city keeps its own', () => {
    const hard: CityMode = { difficulty: 'hard', sandbox: true };
    const a = createCity({ seed: 'mode-test', size: S, save: null, mode: hard });
    const save = captureGame({ seed: a.seed, world: a.world, tech: a.tech, civic: a.civic, econ: { state: createEconomy(), levers: DEFAULT_LEVERS, projects: [] } as never, live: createAmbientState(createRng('x')), tick: 0, camera: { x: 0, y: 0, zoom: 2 }, mode: a.mode });
    expect(save.mode).toEqual(hard);
    const b = createCity({ seed: 'other', size: S, save, mode: STANDARD_MODE });
    expect(b.mode).toEqual(hard);
    expect(Buffer.from(b.world.map.built).equals(Buffer.from(a.world.map.built))).toBe(true);
  });
});
