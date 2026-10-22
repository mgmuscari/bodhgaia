// Police at sideshows (Maddy 2026-10-22: "we can send police to sideshows … also lead to arrests with hurt trust"):
// a sideshow calls the cruisers out of a precinct in reach; they drive there instead of patrolling, the crowd
// scatters, and on the scene they arrest at the full rate. Defund the precinct and nobody comes.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel, placeTransport } from '../../src/engine/fabric';
import { createAmbientState } from '../../src/live/types';
import { createRng } from '../../src/engine/rng';
import { startGathering, type Gathering } from '../../src/live/gatherings';
import { callToSideshows, stepCruisers, stepArrests, SIDESHOW_POLICE_REACH } from '../../src/live/police';

function scene(precinctAt: number | null, siteX = 29) {
  const map = new GameMap(60, 16);
  for (let x = 0; x < 60; x++) placeTransport(map, x, 7, BuiltKind.RoadStreet);
  for (let y = 0; y < 16; y++) placeTransport(map, siteX + 1, y, BuiltKind.RoadStreet);
  const parcels = new ParcelStore();
  if (precinctAt !== null) placeParcel(map, parcels, { x: precinctAt, y: 5, width: 2, height: 2, kind: BuiltKind.Precinct });
  const state = createAmbientState();
  const g: Gathering = startGathering(state, map, createRng('s'), { kind: 'sideshow', site: { x: siteX, y: 6, w: 3, h: 3 }, hood: 1, life: 1500, homes: [], crowd: 0 })
    ?? (() => { const gg: Gathering = { id: 1, kind: 'sideshow', site: { x: siteX, y: 6, w: 3, h: 3 }, hood: 1, age: 0, life: 1500, leaving: false }; (state.gatherings ??= []).push(gg); return gg; })();
  g.cars = 2;
  // a cruiser out on patrol, by the precinct
  if (precinctAt !== null) state.cruisers.push({ x: precinctAt, y: 7, dir: 1, tx: precinctAt, ty: 7, dwell: 600, recent: [], personality: 0 });
  return { map, state, g };
}

describe('police at a sideshow', () => {
  it('a precinct in reach sends its cruiser; it drives there, and the crowd scatters', () => {
    const { map, state, g } = scene(12);
    callToSideshows(state, map);
    expect(state.cruisers[0]!.respond).toBeDefined();
    const rng = createRng('p');
    for (let k = 0; k < 3000 && !g.policed; k++) stepCruisers(state, map, rng);
    expect(g.policed).toBe(true);
    expect(g.life).toBeLessThan(1500); // breaking up early
  });

  it('on the scene, they arrest at the full rate', () => {
    const { map, state, g } = scene(12);
    callToSideshows(state, map);
    const rng = createRng('p');
    for (let k = 0; k < 3000 && !g.policed; k++) stepCruisers(state, map, rng);
    const c = state.cruisers[0]!;
    for (let k = 0; k < 6; k++) state.peds.push({ x: Math.round(c.x), y: Math.round(c.y), dir: 0, tx: Math.round(c.x), ty: Math.round(c.y), gather: { id: g.id, go: 'here', mill: 99, home: { x: 0, y: 7 } }, phase: 'gathering' });
    let arrests = 0;
    for (let k = 0; k < 10; k++) {
      const before = state.peds.length;
      stepArrests(state, map, createRng(`a${k}`), undefined, true);
      arrests += before - state.peds.length;
    }
    expect(arrests).toBeGreaterThan(0);
  });

  it('no precinct within reach (or none at all — defunded): nobody comes', () => {
    const far = scene(0, 50); // its precinct 50 tiles off
    expect(48).toBeGreaterThan(SIDESHOW_POLICE_REACH);
    callToSideshows(far.state, far.map);
    expect(far.state.cruisers.every((c) => c.respond === undefined)).toBe(true);
    const none = scene(null);
    callToSideshows(none.state, none.map);
    expect(none.g.policed ?? false).toBe(false);
  });
});
