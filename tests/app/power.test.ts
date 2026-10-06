import { describe, it, expect } from 'vitest';
import { createPowerController } from '../../src/app/power';
import { GameMap } from '../../src/engine/map';
import { ParcelStore, BuiltKind, placeParcel, placeTransport } from '../../src/engine/fabric';
import { computePowerGrid } from '../../src/growth/power';
import { gameClock, DAYSPEED } from '../../src/ui/lighting';

// The power controller owns main's derived grid: it solves at creation, re-solves on demand (placement, the
// civic cadence) and once per new in-game hour, publishing each solve's powered anchors to the renderer.
const HOUR_SEC = (2 * Math.PI) / (DAYSPEED * 24); // one in-game hour of wall-clock seconds

function setup() {
  const map = new GameMap(24, 8);
  const parcels = new ParcelStore();
  placeParcel(map, parcels, { x: 2, y: 2, width: 1, height: 1, kind: BuiltKind.CoalPlant });
  for (let x = 3; x <= 8; x++) placeTransport(map, x, 2, BuiltKind.RoadStreet);
  placeParcel(map, parcels, { x: 9, y: 2, width: 1, height: 1, kind: BuiltKind.HouseSingle });
  let t = 0.5 * HOUR_SEC; // mid-hour, slot 0
  const published: Set<number>[] = [];
  const power = createPowerController({
    map,
    parcels,
    publish: (anchors) => published.push(anchors),
    nowSec: () => t,
  });
  return { map, parcels, power, published, setT: (s: number) => (t = s) };
}

describe('createPowerController', () => {
  it('solves the grid at creation for the current hour and publishes it', () => {
    const { map, parcels, power, published } = setup();
    const expected = computePowerGrid(map, parcels, gameClock(0.5 * HOUR_SEC));
    expect(power.grid()).toEqual(expected);
    expect(published).toHaveLength(1);
    expect(published[0]).toBe(power.grid().poweredAnchors);
  });

  it('recompute re-solves, publishes, and reports whether capacity/demand/powered count changed', () => {
    const { map, parcels, power, published } = setup();
    const first = power.grid();
    expect(power.recompute()).toBe(false); // nothing moved
    expect(power.grid()).not.toBe(first); // still a fresh solve
    expect(published).toHaveLength(2);
    placeParcel(map, parcels, { x: 10, y: 2, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    expect(power.recompute()).toBe(true); // demand rose
    expect(power.grid().demand).toBeGreaterThan(first.demand);
    expect(published).toHaveLength(3);
  });

  it('maybeResolveHour re-solves only when the in-game hour slot moved, and reports a change', () => {
    const { map, parcels, power, published } = setup();
    expect(power.maybeResolveHour(0.9 * HOUR_SEC * 1000)).toBe(false); // same slot → no solve
    expect(published).toHaveLength(1);
    placeParcel(map, parcels, { x: 10, y: 2, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    expect(power.maybeResolveHour(1.5 * HOUR_SEC * 1000)).toBe(true); // new slot + changed grid
    expect(published).toHaveLength(2);
  });

  it('a recompute adopts the current slot (so the next frame does not re-solve the same hour)', () => {
    const { power, published, setT } = setup();
    setT(1.5 * HOUR_SEC);
    power.recompute(); // e.g. a placement in hour 1
    expect(published).toHaveLength(2);
    expect(power.maybeResolveHour(1.6 * HOUR_SEC * 1000)).toBe(false);
    expect(published).toHaveLength(2);
  });
});
