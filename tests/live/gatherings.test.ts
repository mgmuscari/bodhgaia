// Gatherings (docs/design/community-events.md): neighbours walk from their homes to a place, stay a while milling
// about in it, and walk home — real people, so everything that can happen to someone on the street can happen to
// them. The shared machinery under block parties, fairs, festivals, parades, protests and uprisings.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel, placeTransport } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { createAmbientState } from '../../src/live/types';
import { startGathering, stepGatherings, takeEndedGatherings } from '../../src/live/gatherings';
import { stepPed, } from '../../src/live/peds';
import { buildVehicleCtx } from '../../src/live/cars';

function street() {
  const map = new GameMap(30, 12);
  for (let x = 0; x < 30; x++) placeTransport(map, x, 5, BuiltKind.RoadStreet);
  const parcels = new ParcelStore();
  const homes: number[] = [];
  for (let x = 2; x < 26; x += 3) {
    placeParcel(map, parcels, { x, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    homes.push(map.idx(x, 4));
  }
  const state = createAmbientState();
  return { map, state, homes };
}

const run = (s: ReturnType<typeof street>, steps: number) => {
  const rng = createRng('g').fork('g');
  for (let i = 0; i < steps; i++) {
    const ctx = buildVehicleCtx(s.state, s.map);
    s.state.peds = s.state.peds.filter((p) => stepPed(s.state, s.map, rng, ctx, p));
    stepGatherings(s.state);
  }
};

describe('gatherings', () => {
  const site = { x: 12, y: 5, w: 3, h: 1 };

  it('neighbours set out from their homes for the place', () => {
    const s = street();
    const g = startGathering(s.state, s.map, createRng('s').fork('s'), { kind: 'block-party', site, hood: 1, life: 2000, homes: s.homes, crowd: 6 })!;
    expect(g).not.toBeNull();
    const crowd = s.state.peds.filter((p) => p.gather?.id === g.id);
    expect(crowd).toHaveLength(6);
    for (const p of crowd) expect(p.phase).toBe('gathering');
    for (const p of crowd) expect(s.homes).toContain(p.homeTile);
  });

  it('they arrive and stay in the place, milling about, while it lasts', () => {
    const s = street();
    const g = startGathering(s.state, s.map, createRng('s').fork('s'), { kind: 'block-party', site, hood: 1, life: 2000, homes: s.homes, crowd: 6 })!;
    run(s, 700);
    const crowd = s.state.peds.filter((p) => p.gather?.id === g.id);
    expect(crowd).toHaveLength(6);
    const inSite = crowd.filter((p) => Math.abs(p.x - 13) <= 2.5 && Math.abs(p.y - 5) <= 1.5);
    expect(inSite.length).toBeGreaterThanOrEqual(5);
  });

  it('when it is over they walk home and are gone; the gathering ends, once', () => {
    const s = street();
    const g = startGathering(s.state, s.map, createRng('s').fork('s'), { kind: 'block-party', site, hood: 1, life: 900, homes: s.homes, crowd: 6 })!;
    run(s, 2500);
    expect(s.state.peds.filter((p) => p.gather?.id === g.id)).toHaveLength(0);
    expect(takeEndedGatherings(s.state).map((e) => e.id)).toEqual([g.id]);
    expect(takeEndedGatherings(s.state)).toEqual([]);
    expect(s.state.gatherings ?? []).toHaveLength(0);
  });
});
