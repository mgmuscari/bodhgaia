// Shelters (backlog, in 1.0.15; Maddy 2026-10-13: under Mutual Aid). A mutual-aid shelter has SHELTER_BEDS beds: on
// each settle it takes in people from the camps within SHELTER_DRAW, nearest first — those tents empty. The sheltered
// don't die of exposure, and their days out start from the shelter. Torn down, its people go back to the camps.
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel, bulldozeParcel } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { createAmbientState } from '../../src/live/types';
import { settleCamps, SHELTER_BEDS, SHELTER_DRAW } from '../../src/live/camps';
import { stepExposure } from '../../src/live/death';
import { spawnUnhoused } from '../../src/live/unhoused';
import { toolDef, availableTools } from '../../src/tools/tools';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';

function city(withShelter: boolean) {
  const map = new GameMap(40, 30);
  const parcels = new ParcelStore();
  const state = createAmbientState();
  state.camps = new Map([
    [map.idx(10, 10), 12],
    [map.idx(12, 10), 12],
    [map.idx(35, 25), 12], // far off
  ]);
  state.unhoused = 36;
  const shelter = withShelter ? placeParcel(map, parcels, { x: 10, y: 13, width: 2, height: 2, kind: BuiltKind.Shelter }) : -1;
  return { map, parcels, state, shelter };
}
const total = (m?: Map<number, number>) => [...(m ?? new Map<number, number>()).values()].reduce((a, b) => a + b, 0);

describe('mutual-aid shelters', () => {
  it('take in up to SHELTER_BEDS from the camps near them; the far camp stays; nobody is lost', () => {
    const c = city(true);
    settleCamps(c.state, c.map);
    expect(total(c.state.sheltered)).toBe(Math.min(SHELTER_BEDS, 24));
    expect(c.state.camps!.get(c.map.idx(35, 25))).toBe(12); // beyond SHELTER_DRAW
    expect(total(c.state.camps) + total(c.state.sheltered)).toBeCloseTo(36, 6);
    expect(SHELTER_DRAW).toBeGreaterThanOrEqual(8);
  });

  it('torn down, its people go back to the camps', () => {
    const c = city(true);
    settleCamps(c.state, c.map);
    bulldozeParcel(c.map, c.parcels, c.shelter);
    settleCamps(c.state, c.map);
    expect(total(c.state.sheltered)).toBe(0);
    expect(total(c.state.camps)).toBeCloseTo(36, 6);
  });

  it('the sheltered do not die of exposure — only the far camp is exposed', () => {
    const c = city(true);
    settleCamps(c.state, c.map);
    const rng = createRng('cold').fork('c');
    for (let n = 0; n < 24 * 60; n++) {
      c.state.hour = n % 24;
      stepExposure(c.state, c.map, rng);
    }
    for (const d of c.state.dying ?? []) expect([c.map.idx(35, 25)]).toContain(c.map.idx(d.x, d.y));
  });

  it('their days out start from the shelter', () => {
    const c = city(true);
    for (let x = 0; x < 40; x++) c.map.setBuilt(x, 16, BuiltKind.RoadStreet);
    placeParcel(c.map, c.parcels, { x: 14, y: 17, width: 1, height: 1, kind: BuiltKind.CommercialStrip });
    settleCamps(c.state, c.map);
    c.state.camps = new Map(); // everyone near is sheltered; nobody in a camp to start from
    c.state.unhoused = total(c.state.sheltered);
    spawnUnhoused(c.state, c.map, createRng('day').fork('d'));
    const shelterTiles = new Set([...c.state.sheltered!.keys()]);
    expect(c.state.peds.length).toBeGreaterThan(0);
    for (const p of c.state.peds) expect(shelterTiles.has(p.shelter!)).toBe(true);
  });

  it('are built under Mutual Aid', () => {
    const tech = createTechState(TECH_TREE);
    expect(availableTools(tech).some((t) => t.kind === BuiltKind.Shelter)).toBe(false);
    tech.restore(['mutual-aid'], 100);
    expect(availableTools(tech).some((t) => t.kind === BuiltKind.Shelter)).toBe(true);
    expect(toolDef(`build-${BuiltKind.Shelter}`)!.footprint).toEqual({ w: 2, h: 2 });
  });
});
