import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel, placeTransport } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { createAmbientState, setHouseholds } from '../../src/live/types';
import { createFireController, homeVacancy, FIRE_STEP_MS, FIRE_DEATH_MAX } from '../../src/app/fire';
import { BURN_STEPS } from '../../src/growth/fire';

function town(withStation = true) {
  const map = new GameMap(40, 12);
  const parcels = new ParcelStore();
  for (let x = 0; x < 40; x++) placeTransport(map, x, 5, BuiltKind.RoadStreet);
  if (withStation) placeParcel(map, parcels, { x: 2, y: 3, width: 2, height: 2, kind: BuiltKind.FireStation });
  const home = placeParcel(map, parcels, { x: 30, y: 6, width: 1, height: 1, kind: BuiltKind.Apartments });
  const live = createAmbientState();
  live.events = [];
  setHouseholds(live, [{ x: 30, y: 6, count: 20 }]);
  live.occupancy.set(map.idx(30, 6), 20);
  const log: string[] = [];
  let dirty = 0;
  const fire = createFireController({
    world: { map, parcels },
    live,
    rng: createRng('fire-host').fork('f'),
    hour: () => undefined, // no ignition: the test lights it
    disastersOn: () => true,
    markDirty: () => dirty++,
    refreshHouseholds: () => log.push('households'),
    news: (t) => log.push(`news ${t}`),
  });
  return { map, parcels, live, home, fire, log, dirty: () => dirty };
}

describe('the fire controller', () => {
  it('a home\'s vacancy is the share of its baseline people gone (an abandoned home burns more readily)', () => {
    const h = town();
    expect(homeVacancy(h.live, h.map).get(h.home)).toBe(0);
    h.live.occupancy.set(h.map.idx(30, 6), 5);
    expect(homeVacancy(h.live, h.map).get(h.home)).toBeCloseTo(0.75);
    h.live.occupancy.delete(h.map.idx(30, 6));
    expect(homeVacancy(h.live, h.map).get(h.home)).toBe(1);
  });

  it('a new fire gets a truck from the nearest station, the camera, and the news', () => {
    const h = town();
    h.fire.ignite(h.home);
    h.fire.frame(FIRE_STEP_MS);
    expect(h.live.trucks).toHaveLength(1);
    expect(h.live.events).toEqual([{ kind: 'fire', x: 30, y: 6, w: 1, h: 1 }]);
    expect(h.log).toContain('news Fire!');
    expect(h.live.burning).toEqual([{ x: 30, y: 6, w: 1, h: 1 }]);
  });

  it('with no fire station, it burns out: a ruin, a few dead, the rest unhoused', () => {
    const h = town(false);
    h.fire.ignite(h.home);
    for (let s = 1; s <= BURN_STEPS + 1; s++) h.fire.frame(s * FIRE_STEP_MS);
    expect(h.live.trucks ?? []).toEqual([]);
    expect(h.parcels.kindAt(h.home)).toBe(BuiltKind.Ruin);
    const dead = h.live.events!.filter((e) => e.kind === 'death').length;
    expect(dead).toBeGreaterThan(0);
    expect(dead).toBeLessThanOrEqual(FIRE_DEATH_MAX);
    expect(h.live.occupancy.get(h.map.idx(30, 6))).toBe(20 - dead); // the rest leave as the census drops the home
    expect(h.log).toContain('households');
    expect(h.dirty()).toBeGreaterThan(0);
    expect(h.live.burning).toEqual([]);
  });

  it('a truck that reaches the fire puts it out', () => {
    const h = town();
    h.fire.ignite(h.home);
    h.fire.frame(FIRE_STEP_MS);
    h.live.quenched = new Set([h.home]); // the truck's spray (live layer) has done its work
    h.fire.frame(2 * FIRE_STEP_MS);
    expect(h.parcels.kindAt(h.home)).toBe(BuiltKind.Apartments);
    expect(h.live.burning).toEqual([]);
    expect(h.live.quenched!.size).toBe(0);
  });

  it('reports whether anything is burning', () => {
    const h = town();
    expect(h.fire.active()).toBe(false);
    h.fire.ignite(h.home);
    h.fire.frame(FIRE_STEP_MS);
    expect(h.fire.active()).toBe(true);
  });
});
