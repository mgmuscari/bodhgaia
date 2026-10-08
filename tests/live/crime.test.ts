// Violent crime (docs/design/disasters.md — Maddy: conditions, not cops): despair — encampments, decay, police
// violence — makes a street dangerous; belonging and refuges make it safe; policing never does. Rare: at most one
// life an hour, likelier at night.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel, placeTransport } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { createAmbientState } from '../../src/live/types';
import { despairAt, drawCrime } from '../../src/live/crime';
import { ENCAMPMENT_WEAR, POLICE_VIOLENCE_MAX } from '../../src/live/tuning';

function street() {
  const map = new GameMap(30, 12);
  for (let x = 0; x < 30; x++) placeTransport(map, x, 6, BuiltKind.RoadStreet);
  const parcels = new ParcelStore();
  const state = createAmbientState();
  state.events = [];
  return { map, parcels, state, world: { map, parcels } };
}

describe('despair', () => {
  it('is nothing in a healed place', () => {
    const s = street();
    expect(despairAt(s.state, s.world, 10, 6, 0)).toBe(0);
  });

  it('rises with encampments, decay and police violence', () => {
    const camps = street();
    for (let x = 9; x <= 11; x++) camps.state.wear.set(camps.map.idx(x, 7), ENCAMPMENT_WEAR);
    const decay = street();
    for (let x = 8; x <= 12; x++) placeParcel(decay.map, decay.parcels, { x, y: 5, width: 1, height: 1, kind: BuiltKind.HouseSingle, condition: 10 });
    const police = street();
    police.state.policeViolence.set(police.map.idx(10, 6), POLICE_VIOLENCE_MAX);
    for (const s of [camps, decay, police]) expect(despairAt(s.state, s.world, 10, 6, 0)).toBeGreaterThan(0);
  });

  it('belonging and a refuge lower it; cruisers on the street do not', () => {
    const s = street();
    for (let x = 9; x <= 11; x++) s.state.wear.set(s.map.idx(x, 7), ENCAMPMENT_WEAR);
    const base = despairAt(s.state, s.world, 10, 6, 0);
    expect(despairAt(s.state, s.world, 10, 6, 1)).toBeLessThan(base);
    s.state.cruisers.push({ x: 10, y: 6, dir: 1, tx: 11, ty: 6 });
    expect(despairAt(s.state, s.world, 10, 6, 0)).toBe(base); // policing is no protection
    placeParcel(s.map, s.parcels, { x: 10, y: 4, width: 1, height: 1, kind: BuiltKind.HealingCommons });
    expect(despairAt(s.state, s.world, 10, 6, 0)).toBeLessThan(base);
  });
});

describe('a life lost to violence', () => {
  it('drawn once an hour, at most one, only someone out on the street, mourned like any death', () => {
    const s = street();
    for (let x = 0; x < 30; x++) {
      s.state.wear.set(s.map.idx(x, 7), ENCAMPMENT_WEAR);
      s.state.policeViolence.set(s.map.idx(x, 6), POLICE_VIOLENCE_MAX);
    }
    const home = s.map.idx(2, 2);
    s.state.occupancy.set(home, 40);
    for (let k = 0; k < 30; k++) s.state.peds.push({ x: k, y: 6, dir: 1, tx: k, ty: 6, homeTile: home });
    s.state.peds.push({ x: 5, y: 6, dir: 1, tx: 5, ty: 6, phase: 'inside', homeTile: home });
    const rng = createRng('c').fork('c');
    expect(drawCrime(s.state, s.world, rng, undefined, true, () => 0)).toBe(false);
    let lost = 0;
    for (let h = 0; h < 24 * 50; h++) {
      const a = drawCrime(s.state, s.world, rng, h % 24, true, () => 0);
      const b = drawCrime(s.state, s.world, rng, h % 24, true, () => 0); // the same hour: no second draw
      expect(b).toBe(false);
      if (a) lost++;
    }
    expect(lost).toBeGreaterThan(0);
    expect(s.state.events!.filter((e) => e.kind === 'death')).toHaveLength(lost);
    expect(s.state.peds.some((p) => p.phase === 'inside')).toBe(true);
    expect(s.state.occupancy.get(home)).toBe(40 - lost);
  });

  it('is likelier at night', () => {
    const count = (night: boolean): number => {
      let n = 0;
      for (let k = 0; k < 6; k++) {
        const s = street();
        for (let x = 0; x < 30; x++) s.state.wear.set(s.map.idx(x, 7), ENCAMPMENT_WEAR);
        for (let q = 0; q < 30; q++) s.state.peds.push({ x: q, y: 6, dir: 1, tx: q, ty: 6 });
        const rng = createRng(`n${k}`).fork('n');
        for (let h = 0; h < 24 * 30; h++) if (drawCrime(s.state, s.world, rng, h % 24, night, () => 0)) n++;
      }
      return n;
    };
    expect(count(true)).toBeGreaterThan(count(false));
  });
});
