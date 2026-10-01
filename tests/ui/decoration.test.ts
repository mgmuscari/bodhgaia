import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind } from '../../src/engine/fabric';
import { wideRoadAt } from '../../src/ui/decoration';

// --- Fixture helpers: write tiles directly into a bare GameMap. ---
function hline(map: GameMap, kind: number, y: number, x0: number, x1: number): void {
  for (let x = x0; x <= x1; x++) map.built[map.idx(x, y)] = kind;
}
function vline(map: GameMap, kind: number, x: number, y0: number, y1: number): void {
  for (let y = y0; y <= y1; y++) map.built[map.idx(x, y)] = kind;
}
function band(map: GameMap, kind: number, x0: number, x1: number, y0: number, y1: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) map.built[map.idx(x, y)] = kind;
}

describe('wideRoadAt: 2x2-block road predicate', () => {
  it('is true for every tile of a 2-row avenue band', () => {
    const map = new GameMap(16, 16);
    band(map, BuiltKind.RoadAvenue, 2, 10, 5, 6); // rows 5,6
    for (let y = 5; y <= 6; y++) {
      for (let x = 2; x <= 10; x++) {
        expect(wideRoadAt(map, x, y), `(${x},${y}) should be wide`).toBe(true);
      }
    }
  });

  it('is false for every tile of a single 1-wide row', () => {
    const map = new GameMap(16, 16);
    hline(map, BuiltKind.RoadAvenue, 5, 2, 12);
    for (let x = 2; x <= 12; x++) expect(wideRoadAt(map, x, 5)).toBe(false);
  });

  it('is false at the center of a + of two 1-wide roads (diagonal not road)', () => {
    const map = new GameMap(16, 16);
    hline(map, BuiltKind.RoadAvenue, 8, 2, 14);
    vline(map, BuiltKind.RoadAvenue, 8, 2, 14);
    expect(wideRoadAt(map, 8, 8)).toBe(false); // intersection center
    expect(wideRoadAt(map, 7, 8)).toBe(false); // arm tile
  });

  it('is true for middle and edge rows of a 3-row band', () => {
    const map = new GameMap(16, 16);
    band(map, BuiltKind.RoadHighway, 2, 12, 5, 7); // rows 5,6,7
    expect(wideRoadAt(map, 7, 6)).toBe(true); // middle row interior
    expect(wideRoadAt(map, 7, 5)).toBe(true); // edge row
    expect(wideRoadAt(map, 7, 7)).toBe(true); // far edge row
    expect(wideRoadAt(map, 2, 5)).toBe(true); // band corner
  });

  it('is false for a non-road tile and out of bounds', () => {
    const map = new GameMap(16, 16);
    band(map, BuiltKind.RoadAvenue, 2, 10, 5, 6);
    map.built[map.idx(4, 9)] = BuiltKind.HouseSingle; // a building tile
    expect(wideRoadAt(map, 4, 9)).toBe(false);
    expect(wideRoadAt(map, 0, 0)).toBe(false); // empty tile
    expect(wideRoadAt(map, -1, 5)).toBe(false); // out of bounds
  });
});

// --- Exact-set integration over a worldgen-shaped fixture (YP4). ---
// A straight 1-wide street grid (one + intersection), an isolated 2-row avenue
// band, and an isolated 3-row highway band — separated by gaps so the asserted
// sets stay clean (the PRP-sanctioned "isolate the bands" option; the mixed-kind
// boundary is covered separately below). Asserts the COMPLETE wideRoadAt set ==
// exactly the band tiles (every grid + intersection excluded).
describe('decoration predicates compose over a worldgen-shaped fixture (exact sets)', () => {
  function makeFixture(): GameMap {
    const map = new GameMap(24, 24);
    hline(map, BuiltKind.RoadStreet, 2, 2, 14); // H1
    vline(map, BuiltKind.RoadStreet, 8, 2, 6); // V1 (crosses H1 at (8,2))
    band(map, BuiltKind.RoadAvenue, 2, 14, 10, 11); // 2-row avenue band
    band(map, BuiltKind.RoadHighway, 2, 14, 15, 17); // 3-row highway band
    return map;
  }
  const key = (x: number, y: number): string => `${x},${y}`;

  it('wideRoadAt set is exactly the avenue + highway band tiles', () => {
    const map = makeFixture();
    const expected = new Set<string>();
    for (let y = 10; y <= 11; y++) for (let x = 2; x <= 14; x++) expected.add(key(x, y));
    for (let y = 15; y <= 17; y++) for (let x = 2; x <= 14; x++) expected.add(key(x, y));

    const actual = new Set<string>();
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) if (wideRoadAt(map, x, y)) actual.add(key(x, y));
    }
    expect(actual).toEqual(expected);
    // Explicit: the grid + intersection at (8,2) is NOT wide.
    expect(wideRoadAt(map, 8, 2)).toBe(false);
  });
});

// --- Deliberate mixed-kind boundary case (YP4 residual). ---
// A 1-wide street running parallel-adjacent to a 2-row avenue band completes a
// 2x2 of road tiles and so legitimately reads `wide` — correct isRoadKind-based
// behaviour (a 2x2 of road tiles regardless of kind mix), NOT a bug. Pinned here
// so a future reader does not mistake the isolated-band fixture above for full
// mixed-kind-boundary coverage. The cosmetic visual is left to the live pass.
describe('wideRoadAt mixed-kind boundary (street abutting an avenue band reads wide)', () => {
  it('a street tile adjacent to a 2-row avenue band is wide (correct, not a bug)', () => {
    const map = new GameMap(16, 16);
    band(map, BuiltKind.RoadAvenue, 2, 8, 5, 6); // avenue band rows 5,6
    hline(map, BuiltKind.RoadStreet, 4, 2, 8); // street row 4, directly above row 5
    // (3,4) completes 2x2 {(3,4),(4,4),(3,5),(4,5)} = street,street,avenue,avenue.
    expect(wideRoadAt(map, 3, 4)).toBe(true);
  });
});

import { curbPoleAt, innerCornerMask, roadPaintKind, crosswalkMask } from '../../src/ui/decoration';

// A period-4 street grid (the common worldgen shape): streets on x ≡ 0 and y ≡ 0 (mod 4), blocks between.
function streetGrid(size = 17): GameMap {
  const map = new GameMap(size, size);
  for (let i = 0; i < size; i += 4) {
    hline(map, BuiltKind.RoadStreet, i, 0, size - 1);
    vline(map, BuiltKind.RoadStreet, i, 0, size - 1);
  }
  return map;
}

describe('curb-side power lines (Maddy 2026-09-30: at the sides, not only at intersections)', () => {
  it('poles stand mid-block on straight street runs — never in a junction box', () => {
    const map = streetGrid();
    expect(curbPoleAt(map, 2, 4)).toBe('h'); // mid-block on the y=4 street
    expect(curbPoleAt(map, 4, 6)).toBe('v'); // mid-block on the x=4 street
    for (let y = 0; y < 17; y += 4) for (let x = 0; x < 17; x += 4) expect(curbPoleAt(map, x, y), `junction ${x},${y}`).toBe(null);
  });

  it('every block of a street grid gets poles (they are not all eaten by the intersections)', () => {
    const map = streetGrid();
    let poles = 0;
    for (let y = 0; y < 17; y++) for (let x = 0; x < 17; x++) if (curbPoleAt(map, x, y)) poles++;
    expect(poles).toBeGreaterThanOrEqual(20);
  });

  it('on a two-row avenue only the outer (north) row gets poles — never mid-road', () => {
    const map = new GameMap(16, 8);
    hline(map, BuiltKind.RoadAvenue, 3, 0, 15);
    hline(map, BuiltKind.RoadAvenue, 4, 0, 15);
    expect(curbPoleAt(map, 6, 4)).toBe(null);
    expect(curbPoleAt(map, 6, 3)).toBe('h');
  });

  it('highways carry no poles', () => {
    const map = new GameMap(12, 6);
    hline(map, BuiltKind.RoadHighway, 2, 0, 11);
    for (let x = 0; x < 12; x++) expect(curbPoleAt(map, x, 2)).toBe(null);
  });
});

describe('junction poles + inner curb corners (Maddy 2026-09-30: poles on the corner at T junctions)', () => {
  it('a pole landing on a T junction moves to the tile corner', () => {
    // E-W street along y=4, a side street running SOUTH from x=6 (a T open to the north)
    const map = new GameMap(16, 12);
    hline(map, BuiltKind.RoadStreet, 4, 0, 15);
    vline(map, BuiltKind.RoadStreet, 6, 5, 11);
    expect(curbPoleAt(map, 6, 4)).toBe('nw');
    expect(curbPoleAt(map, 2, 4)).toBe('h'); // a plain mid-block pole is unchanged
  });

  it('innerCornerMask marks each diagonal block corner of a road tile whose two sides are road', () => {
    const map = streetGrid();
    // the junction (4,4): all four diagonals are block corners
    expect(innerCornerMask(map, 4, 4)).toBe(16 | 32 | 64 | 128);
    expect(innerCornerMask(map, 2, 4)).toBe(0); // a straight run has none
  });
});

describe('roadPaintKind — a street tile that only links highways wears highway paint', () => {
  it('the street tile at a bend of a country highway paints as highway', () => {
    const map = new GameMap(12, 12);
    hline(map, BuiltKind.RoadHighway, 2, 0, 5);
    map.built[map.idx(6, 2)] = BuiltKind.RoadStreet; // the worldgen connector at the bend
    vline(map, BuiltKind.RoadHighway, 6, 3, 10);
    expect(roadPaintKind(map, 6, 2)).toBe(BuiltKind.RoadHighway);
  });

  it('a street among streets, or a street crossing a highway, keeps street paint', () => {
    const map = new GameMap(12, 12);
    hline(map, BuiltKind.RoadStreet, 4, 0, 11);
    vline(map, BuiltKind.RoadHighway, 6, 0, 3);
    vline(map, BuiltKind.RoadHighway, 6, 5, 11);
    expect(roadPaintKind(map, 2, 4)).toBe(BuiltKind.RoadStreet);
    expect(roadPaintKind(map, 6, 4)).toBe(BuiltKind.RoadStreet); // street neighbours too → a crossing
  });

  it('a staircase of RAMP tiles at a bend (the country highway, seen live) paints as highway', () => {
    // live seed "lotus" around (74..84, 19..25): highway, ramp bend, highway, ramp, ramp, highway
    const map = new GameMap(12, 8);
    vline(map, BuiltKind.RoadHighway, 2, 0, 3);
    map.built[map.idx(2, 4)] = BuiltKind.RoadRamp;
    hline(map, BuiltKind.RoadHighway, 4, 3, 6);
    map.built[map.idx(7, 4)] = BuiltKind.RoadRamp;
    map.built[map.idx(7, 5)] = BuiltKind.RoadRamp;
    hline(map, BuiltKind.RoadHighway, 5, 8, 11);
    expect(roadPaintKind(map, 2, 4)).toBe(BuiltKind.RoadHighway);
    expect(roadPaintKind(map, 7, 4)).toBe(BuiltKind.RoadHighway);
    expect(roadPaintKind(map, 7, 5)).toBe(BuiltKind.RoadHighway);
  });

  it('a chain that ends in a dead end or a street keeps its own paint', () => {
    const map = new GameMap(12, 4);
    hline(map, BuiltKind.RoadHighway, 1, 0, 3);
    hline(map, BuiltKind.RoadStreet, 1, 4, 6); // highway → street stub, ends nowhere
    expect(roadPaintKind(map, 5, 1)).toBe(BuiltKind.RoadStreet);
  });

  it('non-street kinds are returned unchanged', () => {
    const map = new GameMap(6, 6);
    hline(map, BuiltKind.RoadAvenue, 2, 0, 5);
    expect(roadPaintKind(map, 2, 2)).toBe(BuiltKind.RoadAvenue);
  });
});

describe('crosswalkMask — zebra crossings on local-street approaches to a junction', () => {
  it('a street tile next to a street junction gets a crossing on the junction side', () => {
    const map = streetGrid();
    expect(crosswalkMask(map, 3, 4)).toBe(2); // E side: the junction at (4,4)
    expect(crosswalkMask(map, 5, 4)).toBe(8); // W side
    expect(crosswalkMask(map, 4, 3)).toBe(4); // S side (a vertical approach)
    expect(crosswalkMask(map, 2, 4)).toBe(0); // mid-block
    expect(crosswalkMask(map, 4, 4)).toBe(0); // the junction box itself
  });

  it('highways and wide slabs get no zebras', () => {
    const map = new GameMap(12, 12);
    hline(map, BuiltKind.RoadHighway, 4, 0, 11);
    vline(map, BuiltKind.RoadHighway, 6, 0, 11);
    expect(crosswalkMask(map, 5, 4)).toBe(0);
  });
});

describe('innerCornerMask treats ramp decks as road (Maddy 2026-09-30: stray kerb hooks at (97,37))', () => {
  it('no block corner where the diagonal is a ramp deck across a freeway', () => {
    const map = new GameMap(8, 8);
    hline(map, BuiltKind.RoadAvenue, 3, 0, 2); // avenue approaching from the west
    map.built[map.idx(3, 3)] = BuiltKind.RoadHighway; // east: the freeway
    map.built[map.idx(3, 2)] = BuiltKind.RoadRamp; // NE diagonal: the ramp deck
    map.built[map.idx(2, 2)] = BuiltKind.RoadAvenue; // north: the avenue's other row
    expect(innerCornerMask(map, 2, 3) & 16).toBe(0);
  });
});
