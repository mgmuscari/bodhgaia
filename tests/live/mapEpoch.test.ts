// The scaling pass (Maddy 2026-10-08): every A* compared the whole map against a private copy before searching
// (~49k word compares on 256²), and the police re-scanned it for precincts and refuges 20 times a second. The map is
// checked at most once a substep now; an epoch moves only when something was built; the police caches by it.
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind } from '../../src/engine/fabric';
import { networkMasks, mapEpoch, maskChecks } from '../../src/live/network';
import { liveSubstep } from '../../src/live/clock';
import { safeZonesFor, precinctsOf } from '../../src/live/police';

const town = () => {
  const map = new GameMap(30, 30);
  for (let x = 2; x < 28; x++) map.setBuilt(x, 10, BuiltKind.RoadStreet);
  map.setBuilt(5, 11, BuiltKind.Precinct);
  map.setBuilt(20, 12, BuiltKind.CommunityGarden);
  return map;
};

describe('the map is checked once a substep, and its epoch moves only on change', () => {
  it('outside a substep (an event right after the sim built something) every call checks, as before', () => {
    const map = town();
    networkMasks(map);
    map.setBuilt(15, 20, BuiltKind.RoadStreet);
    expect(networkMasks(map).walk[map.idx(15, 20)]).toBe(1);
  });

  it('many searches in one substep check the map once', () => {
    const map = town();
    liveSubstep(() => {
      networkMasks(map);
      const c0 = maskChecks();
      for (let i = 0; i < 50; i++) networkMasks(map);
      expect(maskChecks() - c0).toBe(0);
    });
  });

  it('the next substep sees a new road — and the epoch moves; an unchanged substep keeps it', () => {
    const map = town();
    const e0 = liveSubstep(() => mapEpoch(map));
    expect(liveSubstep(() => mapEpoch(map))).toBe(e0); // nothing built
    map.setBuilt(15, 20, BuiltKind.RoadStreet);
    expect(liveSubstep(() => mapEpoch(map))).toBeGreaterThan(e0);
    expect(networkMasks(map).walk[map.idx(15, 20)]).toBe(1);
  });
});

describe('the police cache their precincts and refuges by the epoch', () => {
  it('the same epoch: the same sets, not a fresh scan', () => {
    const map = town();
    const [a, p] = liveSubstep(() => [safeZonesFor(map), precinctsOf(map)] as const);
    liveSubstep(() => {
      expect(safeZonesFor(map)).toBe(a);
      expect(precinctsOf(map)).toBe(p);
    });
    expect(p).toEqual([map.idx(5, 11)]);
  });
  it('a new refuge or precinct is seen the next substep', () => {
    const map = town();
    const before = liveSubstep(() => safeZonesFor(map).size);
    map.setBuilt(8, 20, BuiltKind.CommunityGarden);
    map.setBuilt(25, 25, BuiltKind.Precinct);
    liveSubstep(() => {
      expect(safeZonesFor(map).size).toBeGreaterThan(before);
      expect(precinctsOf(map)).toContain(map.idx(25, 25));
    });
  });
});
