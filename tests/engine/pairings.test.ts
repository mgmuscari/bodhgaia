// Lane pairings (docs/design/interdependence.md §9, step 5): civic and commons buildings pair with neighbours — two
// that pair, within PAIR_REACH tiles (footprint to footprint), each get the pairing's bonus. One table, one rule.
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel } from '../../src/engine/fabric';
import { PAIRINGS, PAIR_REACH, pairedWith, pairsFor } from '../../src/engine/pairings';

describe('pairings', () => {
  it('the table: each pairing names both kinds and its bonus', () => {
    const lib = PAIRINGS.find((p) => p.a === BuiltKind.Library && p.b === BuiltKind.MakerSpace)!;
    expect(lib.bonus).toMatch(/reach/i);
    for (const p of PAIRINGS) expect(p.bonus.length).toBeGreaterThan(0);
  });
  it('two that pair within PAIR_REACH are paired, both ways; further off, not', () => {
    const map = new GameMap(30, 10);
    const parcels = new ParcelStore();
    placeParcel(map, parcels, { x: 4, y: 4, width: 2, height: 2, kind: BuiltKind.MakerSpace });
    placeParcel(map, parcels, { x: 5 + PAIR_REACH, y: 4, width: 2, height: 2, kind: BuiltKind.Library });
    expect(pairedWith(map, { x: 4, y: 4, w: 2, h: 2 }, BuiltKind.Library)).toBe(true);
    expect(pairedWith(map, { x: 5 + PAIR_REACH, y: 4, w: 2, h: 2 }, BuiltKind.MakerSpace)).toBe(true);
    expect(pairedWith(map, { x: 4, y: 4, w: 2, h: 2 }, BuiltKind.School)).toBe(false);
    const far = new GameMap(30, 10);
    const fp = new ParcelStore();
    placeParcel(far, fp, { x: 4, y: 4, width: 2, height: 2, kind: BuiltKind.MakerSpace });
    placeParcel(far, fp, { x: 6 + PAIR_REACH, y: 4, width: 2, height: 2, kind: BuiltKind.Library });
    expect(pairedWith(far, { x: 4, y: 4, w: 2, h: 2 }, BuiltKind.Library)).toBe(false);
  });
  it('pairsFor lists what a kind pairs with, for the preview', () => {
    expect(pairsFor(BuiltKind.MakerSpace).map((p) => (p.a === BuiltKind.MakerSpace ? p.b : p.a))).toEqual(
      expect.arrayContaining([BuiltKind.Library, BuiltKind.Bazaar]),
    );
    expect(pairsFor(BuiltKind.HouseSingle)).toEqual([]);
  });
});

// The placement preview (interdependence §9: "placing becomes the puzzle"): the partner tiles a building would pair
// with, lit, and the pairing named with its bonus.
import { pairPreview } from '../../src/engine/pairings';
import { builtKindName } from '../../src/engine/builtNames';
describe('pairPreview', () => {
  it('the partner tiles in reach, and each pairing named with its bonus', () => {
    const map = new GameMap(30, 10);
    const parcels = new ParcelStore();
    placeParcel(map, parcels, { x: 8, y: 4, width: 1, height: 1, kind: BuiltKind.Library });
    const pv = pairPreview(map, BuiltKind.MakerSpace, { x: 10, y: 4, w: 2, h: 2 });
    expect(pv.tiles).toEqual([map.idx(8, 4)]);
    expect(pv.lines).toEqual([`Pairs with the ${builtKindName(BuiltKind.Library)}: the maker space reaches twice as far`]);
  });
  it('nothing in reach, nothing to show', () => {
    const map = new GameMap(30, 10);
    expect(pairPreview(map, BuiltKind.MakerSpace, { x: 10, y: 4, w: 2, h: 2 })).toEqual({ tiles: [], lines: [] });
  });
});
