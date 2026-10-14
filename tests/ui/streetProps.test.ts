// Street trees and bike racks (backlog "road structure remainder", in 1.0.15): kerb props, practice-gated — trees
// with Walkable Streets on the kerb opposite the poles, between them, where the street fronts homes, shops or greens;
// a bike rack with Bike Shares at the kerb before each shop, bazaar, maker space, library and school.
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel, placeTransport } from '../../src/engine/fabric';
import { bikeRackAt, curbPoleAt, streetTreeAt } from '../../src/ui/decoration';

function street() {
  const map = new GameMap(24, 10);
  const parcels = new ParcelStore();
  for (let x = 0; x < 24; x++) placeTransport(map, x, 4, BuiltKind.RoadStreet);
  for (let x = 0; x < 10; x++) placeParcel(map, parcels, { x, y: 5, width: 1, height: 1, kind: BuiltKind.HouseSingle });
  placeParcel(map, parcels, { x: 12, y: 5, width: 2, height: 2, kind: BuiltKind.Library });
  placeParcel(map, parcels, { x: 16, y: 5, width: 1, height: 1, kind: BuiltKind.CommercialStrip });
  return map;
}

describe('street trees', () => {
  it('stand on the kerb fronting homes, every other tile, never where a pole stands', () => {
    const map = street();
    const trees = [...Array(10).keys()].filter((x) => streetTreeAt(map, x, 4) !== null);
    expect(trees.length).toBeGreaterThanOrEqual(4);
    expect(trees.length).toBeLessThanOrEqual(6);
    for (const x of trees) expect(curbPoleAt(map, x, 4) === null || streetTreeAt(map, x, 4) === 'h').toBe(true);
  });
  it('not on open country, nor off a road', () => {
    const map = street();
    for (let x = 18; x < 24; x++) expect(streetTreeAt(map, x, 4)).toBeNull(); // nothing fronting it
    expect(streetTreeAt(map, 3, 5)).toBeNull();
  });
});

describe('bike racks', () => {
  it('one at the kerb before each shop, library or school — not before homes', () => {
    const map = street();
    const racks = [...Array(24).keys()].filter((x) => bikeRackAt(map, x, 4) !== null);
    expect(racks).toEqual([12, 16]); // the library's first frontage tile, the shop's
  });
});
