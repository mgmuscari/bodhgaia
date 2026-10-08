// Back yards (Maddy 2026-10-07): a house's yard is the tile behind it, away from the street it faces. A corner
// house (streets on two sides) gets none; neither does one whose back tile is already taken.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel, placeTransport, yardTileFor, layYardFor, buildOnYard } from '../../src/engine/fabric';
import { isUnsealed } from '../../src/ecology/influence';

function street() {
  const map = new GameMap(10, 10);
  const parcels = new ParcelStore();
  for (let x = 0; x < 10; x++) placeTransport(map, x, 5, BuiltKind.RoadStreet);
  return { map, parcels };
}

describe('yardTileFor', () => {
  it('is the tile behind a house, away from the street it faces', () => {
    const { map, parcels } = street();
    placeParcel(map, parcels, { x: 3, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle }); // faces south
    expect(yardTileFor(map, 3, 4)).toEqual({ x: 3, y: 3 });
    placeParcel(map, parcels, { x: 6, y: 6, width: 1, height: 1, kind: BuiltKind.HouseSingle }); // faces north
    expect(yardTileFor(map, 6, 6)).toEqual({ x: 6, y: 7 });
  });

  it('a house facing a streetcar line, promenade, bike path or rail gets one too (Maddy 2026-10-08)', () => {
    for (const kind of [BuiltKind.Streetcar, BuiltKind.Promenade, BuiltKind.BikePath, BuiltKind.Rail, BuiltKind.ElevatedRail]) {
      const map = new GameMap(10, 10);
      const parcels = new ParcelStore();
      for (let x = 0; x < 10; x++) placeTransport(map, x, 5, kind);
      placeParcel(map, parcels, { x: 3, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle });
      expect(yardTileFor(map, 3, 4), String(kind)).toEqual({ x: 3, y: 3 });
    }
  });

  it('a street out front wins over a line out back: the yard stays behind, against the line', () => {
    const { map, parcels } = street();
    for (let x = 0; x < 10; x++) placeTransport(map, x, 2, BuiltKind.Rail); // a line two rows back
    placeParcel(map, parcels, { x: 3, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    expect(yardTileFor(map, 3, 4)).toEqual({ x: 3, y: 3 });
  });

  it('a corner house gets none', () => {
    const { map, parcels } = street();
    for (let y = 0; y < 5; y++) placeTransport(map, 4, y, BuiltKind.RoadStreet); // a cross street
    placeParcel(map, parcels, { x: 3, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    expect(yardTileFor(map, 3, 4)).toBeNull();
  });

  it('nor one whose back tile is taken, nor one off any street', () => {
    const { map, parcels } = street();
    placeParcel(map, parcels, { x: 3, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    placeParcel(map, parcels, { x: 3, y: 3, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    expect(yardTileFor(map, 3, 4)).toBeNull();
    placeParcel(map, parcels, { x: 8, y: 1, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    expect(yardTileFor(map, 8, 1)).toBeNull();
  });
});

describe('layYardFor and buildOnYard', () => {
  it('lays the yard as its own lot; an accessory dwelling then takes the yard, not new land', () => {
    const { map, parcels } = street();
    placeParcel(map, parcels, { x: 3, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    expect(layYardFor(map, parcels, 3, 4)).toBe(true);
    expect(map.built[map.idx(3, 3)]).toBe(BuiltKind.Yard);
    expect(layYardFor(map, parcels, 3, 4)).toBe(false); // already has one
    expect(buildOnYard(map, parcels, 3, 3, BuiltKind.ADU)).toBe(true);
    expect(map.built[map.idx(3, 3)]).toBe(BuiltKind.ADU);
    expect(buildOnYard(map, parcels, 5, 5, BuiltKind.ADU)).toBe(false); // a road is not a yard
  });

  it('a yard is open ground: its soil heals', () => {
    expect(isUnsealed(BuiltKind.Yard)).toBe(true);
  });
});
