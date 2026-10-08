// Disaster demos (?demo=fire|spill|disasters, DEV only): stage each disaster in a fresh city so it can be seen
// without waiting for it.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel } from '../../src/engine/fabric';
import { createAmbientState } from '../../src/live/types';
import { createDemo, pickFireSite, pickWorks } from '../../src/app/demo';

function city() {
  const map = new GameMap(60, 20);
  const parcels = new ParcelStore();
  placeParcel(map, parcels, { x: 2, y: 2, width: 2, height: 2, kind: BuiltKind.FireStation });
  const near = placeParcel(map, parcels, { x: 16, y: 3, width: 1, height: 1, kind: BuiltKind.HouseSingle });
  placeParcel(map, parcels, { x: 4, y: 3, width: 1, height: 1, kind: BuiltKind.HouseSingle }); // too close to show the drive
  placeParcel(map, parcels, { x: 50, y: 3, width: 1, height: 1, kind: BuiltKind.HouseSingle });
  const clean = placeParcel(map, parcels, { x: 20, y: 10, width: 2, height: 2, kind: BuiltKind.Industrial });
  const redlined = placeParcel(map, parcels, { x: 30, y: 10, width: 2, height: 2, kind: BuiltKind.Industrial });
  map.redline[map.idx(30, 10)] = 240;
  return { map, parcels, near, redlined, clean };
}

describe('disaster demos', () => {
  it('a demo fire is a home a short drive from a fire station', () => {
    const c = city();
    expect(pickFireSite({ map: c.map, parcels: c.parcels })).toBe(c.near);
  });

  it('a demo spill is at the most redlined works', () => {
    const c = city();
    expect(pickWorks({ map: c.map, parcels: c.parcels })).toBe(c.redlined);
  });

  it('stages a fire, then a spill, each with the camera on it', () => {
    const c = city();
    const live = createAmbientState();
    live.events = [];
    const lit: number[] = [];
    const views: string[] = [];
    const demo = createDemo('disasters', {
      world: { map: c.map, parcels: c.parcels },
      live,
      ignite: (i) => lit.push(i),
      view: (x, y) => views.push(`${x},${y}`),
    });
    demo.frame(0);
    demo.frame(1000);
    expect(lit).toEqual([]); // a moment to settle first
    demo.frame(4000);
    expect(lit).toEqual([c.near]);
    expect(views).toHaveLength(1);
    demo.frame(20000);
    expect(live.clouds ?? []).toHaveLength(0);
    demo.frame(60000);
    expect(live.clouds).toHaveLength(1);
    expect(views).toHaveLength(2);
    demo.frame(200000);
    expect(lit).toHaveLength(1); // each step runs once
    expect(live.clouds).toHaveLength(1);
  });

  it('a single-disaster demo runs only that one, at once', () => {
    const c = city();
    const live = createAmbientState();
    live.events = [];
    const demo = createDemo('spill', { world: { map: c.map, parcels: c.parcels }, live, ignite: () => {}, view: () => {} });
    demo.frame(0);
    demo.frame(4000);
    expect(live.clouds).toHaveLength(1);
  });
});
