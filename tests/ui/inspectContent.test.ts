import { describe, it, expect } from 'vitest';
import { inspectReadout, type InspectFields } from '../../src/ui/inspectContent';
import { GameMap, Water } from '../../src/engine/map';
import { ParcelStore, BuiltKind, placeParcel, placeTransport } from '../../src/engine/fabric';
import { plantOutput } from '../../src/growth/power';
import { gradeLetter } from '../../src/worldgen/redline';

function setup() {
  const map = new GameMap(16, 16);
  const parcels = new ParcelStore();
  const live = {
    occupancy: new Map<number, number>(),
    landValue: new Map<number, number>(),
    buildingHealth: new Map<number, number>(),
    traffic: new Map<number, number>(),
    pollution: new Map<number, number>(),
    waterPollution: new Map<number, number>(),
    roadDecay: new Map<number, number>(),
    policeViolence: new Map<number, number>(),
    coverage: new Set<number>(),
  } satisfies InspectFields;
  return { map, parcels, live, world: { map, parcels } };
}

describe('inspectReadout: the inspect tool status line', () => {
  it('bare land: the tool info + the HOLC redline grade, nothing live', () => {
    const { map, live, world } = setup();
    map.redline[map.idx(3, 3)] = 200;
    expect(inspectReadout('open ground', 3, 3, world, live, new Set())).toBe(`open ground · redline ${gradeLetter(200)}`);
  });

  it('a home: anchor-keyed samples (pop/land value/health/served) even when a non-anchor tile is clicked', () => {
    const { map, parcels, live, world } = setup();
    placeParcel(map, parcels, { x: 4, y: 4, width: 2, height: 2, kind: BuiltKind.HouseSingle });
    const anchor = map.idx(4, 4);
    const clicked = map.idx(5, 5);
    live.occupancy.set(anchor, 3.4);
    live.landValue.set(anchor, 41.6);
    live.buildingHealth.set(anchor, 80);
    live.occupancy.set(clicked, 999); // not the anchor → never read
    live.coverage.add(anchor);
    const line = inspectReadout('house', 5, 5, world, live, new Set([anchor]));
    expect(line).toBe(`house · pop 3 · land value 42 · health 80 · served · powered · redline ${gradeLetter(0)}`);
  });

  it('a home off the grid and out of service reach reads UNPOWERED and under-served', () => {
    const { map, parcels, live, world } = setup();
    placeParcel(map, parcels, { x: 4, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    const line = inspectReadout('house', 4, 4, world, live, new Set());
    expect(line).toBe(`house · under-served · UNPOWERED · redline ${gradeLetter(0)}`);
  });

  it('tile-keyed samples (traffic, smog, police violence) come from the clicked tile', () => {
    const { map, live, world } = setup();
    const i = map.idx(7, 2);
    live.traffic.set(i, 12.2);
    live.pollution.set(i, 5.5);
    live.policeViolence.set(i, 2);
    expect(inspectReadout('x', 7, 2, world, live, new Set())).toBe(
      `x · traffic 12 · smog 6 · police violence 2 · redline ${gradeLetter(0)}`,
    );
  });

  it('a plant shows its output (and no powered/unpowered)', () => {
    const { map, parcels, live, world } = setup();
    placeParcel(map, parcels, { x: 1, y: 1, width: 1, height: 1, kind: BuiltKind.CoalPlant });
    const line = inspectReadout('coal', 1, 1, world, live, new Set());
    expect(line).toBe(`coal · under-served · output ${plantOutput(BuiltKind.CoalPlant)} · redline ${gradeLetter(0)}`);
  });

  it('water shows its contamination and no redline grade', () => {
    const { map, live, world } = setup();
    const i = map.idx(9, 9);
    map.water[i] = Water.River;
    map.redline[i] = 255;
    live.waterPollution.set(i, 30);
    expect(inspectReadout('river', 9, 9, world, live, new Set())).toBe('river · water 30 contaminated');
  });

  it('dry land never shows water contamination; only road tiles show road decay', () => {
    const { map, live, world } = setup();
    const land = map.idx(2, 9);
    live.waterPollution.set(land, 30);
    live.roadDecay.set(land, 50);
    expect(inspectReadout('land', 2, 9, world, live, new Set())).toBe(`land · redline ${gradeLetter(0)}`);
    placeTransport(map, 3, 9, BuiltKind.RoadStreet);
    const road = map.idx(3, 9);
    live.roadDecay.set(road, 50);
    expect(inspectReadout('street', 3, 9, world, live, new Set())).toBe(`street · road 50 crumbling · redline ${gradeLetter(0)}`);
  });
});
