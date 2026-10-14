// Building boosts (Maddy 2026-10-14: "buffed buildings could have a status icon"): ONE answer to "is this building
// boosted, and why" — read by the simulation that carries the bonus, the map's boosted badge and the inspect readout,
// so the badge can't drift from the effect. A boost is a lane pairing (both partners) or the maker/industry work
// together (the maker is supplied; the works' scrap is reused).
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, MAKER_SUPPLY, ParcelStore, placeParcel } from '../../src/engine/fabric';
import { boostIndex, boostsOf, makerSupplied } from '../../src/engine/boosts';

function world() {
  const map = new GameMap(40, 20);
  const parcels = new ParcelStore();
  const put = (x: number, y: number, kind: BuiltKind, w = 2, h = 2) => placeParcel(map, parcels, { x, y, width: w, height: h, kind });
  return { map, parcels, put };
}

describe('building boosts', () => {
  it('a paired building names each pairing it is in, both partners', () => {
    const { map, parcels, put } = world();
    const school = put(4, 4, BuiltKind.School);
    const lib = put(7, 4, BuiltKind.Library);
    expect(boostsOf(map, parcels, school)).toEqual(['Pairs with the Library: the school teaches twice as fast']);
    expect(boostsOf(map, parcels, lib)).toEqual(['Pairs with the School: the school teaches twice as fast']);
  });

  it('an unpaired building, and a home, carry none', () => {
    const { map, parcels, put } = world();
    const school = put(4, 4, BuiltKind.School);
    const home = put(20, 4, BuiltKind.HouseSingle, 1, 1);
    expect(boostsOf(map, parcels, school)).toEqual([]);
    expect(boostsOf(map, parcels, home)).toEqual([]);
  });

  it('a maker space within MAKER_SUPPLY of industry is supplied; the works has its scrap reused', () => {
    const { map, parcels, put } = world();
    const maker = put(4, 4, BuiltKind.MakerSpace);
    const works = put(5 + MAKER_SUPPLY, 4, BuiltKind.Industrial); // gap exactly MAKER_SUPPLY (adjacent = 1)
    expect(boostsOf(map, parcels, maker)).toEqual(['Supplied by the works nearby: reaches further, mends twice as fast']);
    expect(boostsOf(map, parcels, works)).toEqual(['A maker space takes its scrap: half the ground poison']);
  });

  it('one tile further, neither', () => {
    const { map, parcels, put } = world();
    const maker = put(4, 4, BuiltKind.MakerSpace);
    const works = put(6 + MAKER_SUPPLY, 4, BuiltKind.Industrial);
    expect(boostsOf(map, parcels, maker)).toEqual([]);
    expect(boostsOf(map, parcels, works)).toEqual([]);
  });

  it('makerSupplied is footprint to footprint, as the repairs read it', () => {
    const { parcels, put } = world();
    put(20, 10, BuiltKind.Industrial, 3, 3);
    const { works } = boostIndex(parcels);
    expect(makerSupplied({ x: 20 - MAKER_SUPPLY - 1, y: 10, w: 2, h: 2 }, works)).toBe(true);
    expect(makerSupplied({ x: 20 - MAKER_SUPPLY - 2, y: 10, w: 2, h: 2 }, works)).toBe(false);
    expect(makerSupplied({ x: 22 + MAKER_SUPPLY, y: 12 + MAKER_SUPPLY, w: 1, h: 1 }, works)).toBe(true); // diagonal
  });

  it('a building can carry several boosts', () => {
    const { map, parcels, put } = world();
    const maker = put(4, 4, BuiltKind.MakerSpace);
    put(7, 4, BuiltKind.Library);
    put(4, 7, BuiltKind.Industrial);
    expect(boostsOf(map, parcels, maker)).toEqual([
      'Pairs with the Library: the maker space reaches twice as far',
      'Supplied by the works nearby: reaches further, mends twice as fast',
    ]);
  });
});
