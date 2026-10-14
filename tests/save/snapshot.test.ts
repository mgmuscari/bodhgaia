import { describe, it, expect } from 'vitest';
import { runPipeline } from '../../src/worldgen/pipeline';
import { terrainStage } from '../../src/worldgen/terrain';
import { mosesCenturyStage } from '../../src/worldgen/moses';
import { ecoSeedStage } from '../../src/worldgen/ecoseed';
import { hashWorld, demolishParcel, BuiltKind } from '../../src/engine/fabric';
import { GameMap } from '../../src/engine/map';
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
  it('this build carries no traffic layer', () => {
    const save = captureGame(parts());
    expect(Object.keys(save.world.layers)).not.toContain('traffic');
  });

  it('a v1 save (with its traffic layer) migrates to v2 and restores the same world', () => {
    const p = parts();
    const v2 = captureGame(p);
    const n = p.world.map.width * p.world.map.height;
    const v1 = { ...v2, version: 1, world: { ...v2.world, layers: { ...v2.world.layers, traffic: encodeBytes(new Uint8Array(n)) } } };
    const save = parseSave(JSON.stringify(v1));
    expect(save.version).toBe(SAVE_VERSION);
    expect(Object.keys(save.world.layers)).not.toContain('traffic');
    const fresh = gen(save.seed);
    restoreWorld(fresh, save.world);
    expect(hashWorld(fresh)).toBe(hashWorld(p.world));
  });

  // Maddy 2026-10-13: crossings are recorded where track is laid across a way (map.crossing, save v4). A v3 city's
  // crossings are read once from the track's neighbours — but not between two parallel highways.
  it('a v3 save gains its crossings on load: track across a street is one; track between highways is not', () => {
    const p = parts();
    const save = captureGame(p);
    const { width, height } = save;
    const m = new GameMap(width, height);
    for (let y = 0; y < 7; y++) m.setBuilt(3, y, BuiltKind.RoadStreet); // a street, cut by the line at (3, 3)
    for (let x = 0; x < 12; x++) m.setBuilt(x, 3, BuiltKind.Rail);
    for (let x = 0; x < 12; x++) {
      m.setBuilt(x, 10, BuiltKind.RoadHighway); // the line between two highways
      m.setBuilt(x, 11, BuiltKind.Rail);
      m.setBuilt(x, 12, BuiltKind.RoadHighway);
    }
    const { crossing: _none, ...older } = save.world.layers;
    const v3 = { ...save, version: 3, world: { ...save.world, layers: { ...older, built: encodeBytes(new Uint8Array(m.built.buffer)) } } };
    const lifted = parseSave(JSON.stringify(v3));
    const bytes = decodeBytes(lifted.world.layers.crossing);
    const crossing = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
    expect(crossing[m.idx(3, 3)]).toBe(BuiltKind.RoadStreet);
    for (let x = 0; x < 12; x++) expect(crossing[m.idx(x, 11)], `x ${x}`).toBe(0);
    expect(crossing[m.idx(8, 3)]).toBe(0); // open track
  });

  it('refuses a save from a newer build', () => {
    const newer = { ...captureGame(parts()), version: SAVE_VERSION + 1 };
    expect(() => parseSave(JSON.stringify(newer))).toThrow(/newer/);
  });
});

describe('save v3: parklets moved onto the kerb (Maddy 2026-10-08)', () => {
  it('this build writes v4 (crossings recorded, 2026-10-13)', () => {
    expect(SAVE_VERSION).toBe(4);
    expect(captureGame(parts()).version).toBe(4);
  });

  it("a v2 save's parklet lots become pocket parks, once, and nothing else changes", () => {
    const p = parts();
    const i = p.world.parcels.aliveIndices().find((j) => p.world.parcels.get(j).width === 1 && p.world.parcels.get(j).height === 1)!;
    const lot = p.world.parcels.get(i);
    const as = (kind: number) => {
      p.world.parcels.setKind(i, kind as BuiltKind);
      p.world.map.built[p.world.map.idx(lot.x, lot.y)] = kind;
    };
    as(BuiltKind.Parklet); // a v2-era parklet lot
    const v2 = { ...captureGame(p), version: 2 };
    const save = parseSave(JSON.stringify(v2));
    const fresh = gen(save.seed);
    restoreWorld(fresh, save.world);
    expect(fresh.parcels.get(i).kind).toBe(BuiltKind.Park);
    expect(fresh.map.built[fresh.map.idx(lot.x, lot.y)]).toBe(BuiltKind.Park);
    // the rest of the world is as it was
    as(BuiltKind.Park);
    expect(hashWorld(fresh)).toBe(hashWorld(p.world));
    // a v3 save keeps whatever it holds
    const again = parseSave(JSON.stringify(captureGame({ ...p, world: fresh })));
    expect(again.world.parcels.kind[i]).toBe(BuiltKind.Park);
  });
});

describe('the format refuses what it cannot read', () => {
  it('rejects a non-save and a save from a newer version', () => {
    expect(() => parseSave('{"hello":1}')).toThrow(/not a Bodhgaia save/);
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

describe('the rename (Bodhitropolis → Bodhgaia, 2026-10-07)', () => {
  it('writes Bodhgaia saves and still reads Bodhitropolis ones', () => {
    const save = captureGame(parts());
    expect(save.format).toBe('bodhgaia-save');
    const old = JSON.stringify({ ...save, format: 'bodhitropolis-save' });
    expect(parseSave(old).seed).toBe('lotus');
    expect(() => parseSave(JSON.stringify({ ...save, format: 'something-else' }))).toThrow(/not a Bodhgaia save/);
  });
});

describe('encampments are saved (Maddy 2026-10-08)', () => {
  it('the camps come back where they were; a save from before them has none until they settle', () => {
    const p = parts();
    p.live.camps = new Map([[100, 7], [205, 3.5]]);
    p.live.unhoused = 10.5;
    const save = parseSave(JSON.stringify(captureGame(p)));
    const live = createAmbientState();
    restoreLive(live, save.live, p.world.map.width);
    expect([...live.camps!]).toEqual([[100, 7], [205, 3.5]]);
    const old = { ...save.live, camps: undefined };
    const live2 = createAmbientState();
    restoreLive(live2, old, p.world.map.width);
    expect(live2.camps?.size ?? 0).toBe(0);
  });
});
