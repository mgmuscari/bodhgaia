// Maker spaces × industry (interdependence §3, step 4a). A maker space within MAKER_SUPPLY of industry gets
// materials: its reach grows to MAKER_RADIUS_SUPPLIED and its repairs double. Industry with a maker space in reach
// turns scrap into repairs: half its ground pollution.
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel } from '../../src/engine/fabric';
import { stepRepairShops, MAKER_RADIUS, MAKER_RADIUS_SUPPLIED, MAKER_REPAIR, MAKER_SUPPLY } from '../../src/growth/revival';
import { createAmbientState } from '../../src/live/types';
import { accumulateGroundPollution } from '../../src/live/fields/pollution';

function block(withWorks: boolean) {
  const map = new GameMap(40, 12);
  const parcels = new ParcelStore();
  placeParcel(map, parcels, { x: 10, y: 4, width: 2, height: 2, kind: BuiltKind.MakerSpace });
  const near = placeParcel(map, parcels, { x: 15, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle, condition: 100 }); // 4 tiles off
  const far = placeParcel(map, parcels, { x: 17, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle, condition: 100 }); // 6 tiles off
  if (withWorks) placeParcel(map, parcels, { x: 5, y: 4, width: 2, height: 2, kind: BuiltKind.Industrial });
  return { map, parcels, near, far };
}

describe('maker spaces and industry', () => {
  it('without industry nearby, as before: reach MAKER_RADIUS, MAKER_REPAIR a pass', () => {
    const b = block(false);
    stepRepairShops(b);
    expect(b.parcels.get(b.near).condition).toBe(100 + MAKER_REPAIR);
    expect(b.parcels.get(b.far).condition).toBe(100); // beyond the reach
    expect(MAKER_RADIUS_SUPPLIED).toBeGreaterThan(MAKER_RADIUS);
  });
  it('supplied by industry within MAKER_SUPPLY, it reaches further and mends twice as fast', () => {
    const b = block(true);
    expect(5 + 2 - 1).toBeGreaterThanOrEqual(10 - MAKER_SUPPLY);
    stepRepairShops(b);
    expect(b.parcels.get(b.near).condition).toBe(100 + 2 * MAKER_REPAIR);
    expect(b.parcels.get(b.far).condition).toBe(100 + 2 * MAKER_REPAIR);
  });
  it('the industry it takes from poisons its ground half as much', () => {
    const dirty = (() => {
      const map = new GameMap(40, 12);
      const parcels = new ParcelStore();
      placeParcel(map, parcels, { x: 5, y: 4, width: 2, height: 2, kind: BuiltKind.Industrial });
      const s = createAmbientState();
      accumulateGroundPollution(s, map);
      return s.groundPollution.get(map.idx(5, 4)) ?? 0;
    })();
    const b = block(true);
    const s = createAmbientState();
    accumulateGroundPollution(s, b.map);
    const reused = s.groundPollution.get(b.map.idx(5, 4)) ?? 0;
    expect(reused).toBeGreaterThan(0);
    expect(reused).toBeLessThan(dirty * 0.75);
  });
});
