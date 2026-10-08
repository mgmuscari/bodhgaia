// A tram street has small kerbs (Maddy 2026-10-08): on each edge it meets ground that isn't street, a narrow
// sidewalk and gutter; where it meets a road or carries on, none — and the road it meets draws none either.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, placeTransport, roadCurbMask, tramKerbMask } from '../../src/engine/fabric';
import { snesRoadTiles } from '../../src/ui/snesRoads';

describe('tram street kerbs', () => {
  const map = new GameMap(20, 7);
  for (let x = 1; x <= 9; x++) placeTransport(map, x, 3, BuiltKind.RoadStreet);
  for (let x = 10; x <= 18; x++) map.setBuilt(x, 3, BuiltKind.Streetcar);

  it('kerbs a tram street along its sides, not where it carries on or meets the road', () => {
    expect(tramKerbMask(map, 14, 3)).toBe(1 | 4); // N and S
    expect(tramKerbMask(map, 10, 3)).toBe(1 | 4); // the west edge meets the street: no kerb across it
    expect(tramKerbMask(map, 5, 3)).toBe(0); // not a tram street
  });

  it('the street meeting it draws no kerb across the join', () => {
    expect(roadCurbMask(map, 9, 3) & 2).toBe(0);
  });

  it('is drawn: a small kerb — narrower than a road sidewalk', () => {
    const out = new Map();
    snesRoadTiles(out, [BuiltKind.RoadStreet], []);
    const opaqueRows = (key: string) => {
      const p = out.get(key)!;
      let rows = 0;
      for (let y = 0; y < 16; y++) {
        let any = false;
        for (let x = 0; x < 16; x++) if (p.data[(y * 16 + x) * 4 + 3]! > 0) any = true;
        if (any) rows++;
      }
      return rows;
    };
    expect(opaqueRows('@road/kerb/1')).toBeGreaterThan(0);
    expect(opaqueRows('@road/kerb/1')).toBeLessThan(opaqueRows('@road/curb/1'));
  });
});
