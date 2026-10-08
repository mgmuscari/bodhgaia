import { describe, it, expect } from 'vitest';
import { runPipeline } from '../../src/worldgen/pipeline';
import { terrainStage } from '../../src/worldgen/terrain';
import { mosesCenturyStage } from '../../src/worldgen/moses';
import { ecoSeedStage } from '../../src/worldgen/ecoseed';
import { hashWorld, demolishParcel } from '../../src/engine/fabric';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';
import { CivicState } from '../../src/civic/state';
import { createEconomy } from '../../src/economy/model';
import { DEFAULT_LEVERS, practiceProject } from '../../src/economy/run';
import { createAmbientState } from '../../src/live/types';
import { encodeBytes, decodeBytes, captureGame, restoreWorld, restoreTech, restoreCivic, restoreLive, parseSave, SAVE_VERSION, type GameParts } from '../../src/save/snapshot';

// Save/load (Maddy 2026-10-02): the game's STOCKS serialize; everything derived (land value, coverage,
// traffic, the partition, households, the agents) is recomputed from them on load.
const gen = (seed = 'lotus') => runPipeline({ seed, width: 48, height: 48 }, [terrainStage(), mosesCenturyStage(), ecoSeedStage()]);

function parts(): GameParts {
  const world = gen();
  // the player changed the city: a new street, a demolition's tombstone
  demolishParcel(world.map, world.parcels, world.parcels.aliveIndices()[0]!); // a tombstone
  for (let x = 2; x < 10; x++) world.map.floraVitality[world.map.idx(x, 2)] = 250; // land healed
  const tech = createTechState(TECH_TREE);
  tech.effort = 321;
  tech.grant('walkable-streets');
  const civic = new CivicState(3);
  civic.setValues(2, { belonging: 10, voice: 20, trust: 30 });
  civic.recordRepair(2, 77);
  const econ = { state: { ...createEconomy(1234), approval: 41 }, projects: [practiceProject({ id: 'road-diets', name: 'Road Diets', cost: 15 })], levers: { ...DEFAULT_LEVERS, police: 5 } };
  const live = createAmbientState();
  live.occupancy.set(5, 7.5);
  live.occExpect.set(5, -0.1);
  live.occPasses = 400;
  live.wear.set(9, 120);
  live.roadDecay.set(11, 30);
  live.buildingHealth.set(5, -12);
  return { seed: 'lotus', world, tech, civic, econ, live, tick: 4242, camera: { x: 12.5, y: 30, zoom: 3 } };
}

describe('bytes', () => {
  it('base64 round-trips any bytes', () => {
    const b = new Uint8Array(1000);
    for (let i = 0; i < b.length; i++) b[i] = (i * 37 + 11) & 255;
    for (const n of [0, 1, 2, 3, 999, 1000]) expect([...decodeBytes(encodeBytes(b.subarray(0, n)))]).toEqual([...b.subarray(0, n)]);
  });
});

describe('a saved game restores to the same stocks', () => {
  it('survives JSON, and the world hashes identically after restore onto a fresh worldgen', () => {
    const p = parts();
    const save = parseSave(JSON.stringify(captureGame(p)));
    expect(save.version).toBe(SAVE_VERSION);
    const fresh = gen(save.seed);
    expect(hashWorld(fresh)).not.toBe(hashWorld(p.world));
    restoreWorld(fresh, save.world);
    expect(hashWorld(fresh)).toBe(hashWorld(p.world));
    expect(fresh.parcels.aliveIndices().length).toBe(p.world.parcels.aliveIndices().length);
  });

  it('tech, civic, economy, the live stocks, tick and camera come back', () => {
    const p = parts();
    const save = parseSave(JSON.stringify(captureGame(p)));
    const tech = createTechState(TECH_TREE);
    restoreTech(tech, save.tech);
    expect(tech.effort).toBe(321);
    expect(tech.hasCapability('walkability')).toBe(true);
    const civic = new CivicState(3);
    restoreCivic(civic, save.civic);
    expect(civic.getValues(2)).toEqual({ belonging: 10, voice: 20, trust: 30 });
    expect(civic.getRing(2)).toEqual([77]);
    expect(save.econ).toEqual(JSON.parse(JSON.stringify(p.econ)));
    const live = createAmbientState();
    restoreLive(live, save.live, 4);
    expect(live.occupancy.get(5)).toBe(7.5);
    expect(live.occExpect.get(5)).toBe(-0.1);
    expect(live.occPasses).toBe(400);
    expect(live.wear.get(9)).toBe(120);
    expect(live.roadDecay.get(11)).toBe(30);
    expect(live.buildingHealth.get(5)).toBe(-12);
    expect(save.tick).toBe(4242);
    expect(save.camera).toEqual({ x: 12.5, y: 30, zoom: 3 });
  });

  it('civic restore tolerates a partition of a different size (keeps what overlaps)', () => {
    const save = parseSave(JSON.stringify(captureGame(parts())));
    const civic = new CivicState(2);
    restoreCivic(civic, save.civic);
    expect(civic.getValues(2).trust).toBe(30);
  });
});

describe('save v2: the always-zero traffic layer is retired', () => {
  it('this build writes v2 and carries no traffic layer', () => {
    const save = captureGame(parts());
    expect(SAVE_VERSION).toBe(2);
    expect(save.version).toBe(2);
    expect(Object.keys(save.world.layers)).not.toContain('traffic');
  });

  it('a v1 save (with its traffic layer) migrates to v2 and restores the same world', () => {
    const p = parts();
    const v2 = captureGame(p);
    const n = p.world.map.width * p.world.map.height;
    const v1 = { ...v2, version: 1, world: { ...v2.world, layers: { ...v2.world.layers, traffic: encodeBytes(new Uint8Array(n)) } } };
    const save = parseSave(JSON.stringify(v1));
    expect(save.version).toBe(2);
    expect(Object.keys(save.world.layers)).not.toContain('traffic');
    const fresh = gen(save.seed);
    restoreWorld(fresh, save.world);
    expect(hashWorld(fresh)).toBe(hashWorld(p.world));
  });

  it('refuses a v3 save', () => {
    const v3 = { ...captureGame(parts()), version: 3 };
    expect(() => parseSave(JSON.stringify(v3))).toThrow(/newer/);
  });
});

describe('the format refuses what it cannot read', () => {
  it('rejects a non-save and a save from a newer version', () => {
    expect(() => parseSave('{"hello":1}')).toThrow(/not a Bodhitropolis save/);
    const future = { ...captureGame(parts()), version: SAVE_VERSION + 1 };
    expect(() => parseSave(JSON.stringify(future))).toThrow(/newer/);
  });
});

describe('the batteries are saved', () => {
  it('captures each energy node’s charge, and an older save has none', () => {
    const p = { ...parts(), power: { storage: new Map([[17, 300]]) } };
    const save = parseSave(JSON.stringify(captureGame(p)));
    expect(save.power?.storage).toEqual([[17, 300]]);
    expect(captureGame(parts()).power).toEqual({ storage: [] });
  });
});
