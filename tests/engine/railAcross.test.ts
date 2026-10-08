// Laying track across other ways (Maddy 2026-10-08: "if i have 3 modes together - highway, bike path, quiet street -
// i can lay a track across them for 3 crossings").
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, placeTransport, demolishTransportAt, railCrossingMask, railCrossingKind } from '../../src/engine/fabric';

function corridor() {
  const map = new GameMap(20, 12);
  for (let x = 0; x < 20; x++) {
    placeTransport(map, x, 4, BuiltKind.RoadHighway);
    placeTransport(map, x, 5, BuiltKind.BikePath);
    placeTransport(map, x, 6, BuiltKind.QuietStreet);
  }
  return map;
}

describe('laying rail across other ways', () => {
  it('track laid across a highway, a bike path and a quiet street makes three crossings', () => {
    const map = corridor();
    for (let y = 1; y <= 10; y++) expect(placeTransport(map, 10, y, BuiltKind.Rail), `y=${y}`).toBe(true);
    for (const [y, kind] of [[4, BuiltKind.RoadHighway], [5, BuiltKind.BikePath], [6, BuiltKind.QuietStreet]] as const) {
      expect(map.getBuilt(10, y)).toBe(BuiltKind.Rail);
      expect(railCrossingMask(map, 10, y)).toBe(2 | 8); // the way runs E–W across it
      expect(railCrossingKind(map, 10, y)).toBe(kind);
    }
    expect(map.getBuilt(9, 5)).toBe(BuiltKind.BikePath); // the way either side is untouched
  });

  it('bulldozing a crossing gives the way back', () => {
    const map = corridor();
    for (let y = 1; y <= 10; y++) placeTransport(map, 10, y, BuiltKind.Rail);
    expect(demolishTransportAt(map, 10, 5)).toBe(true);
    expect(map.getBuilt(10, 5)).toBe(BuiltKind.BikePath);
    expect(demolishTransportAt(map, 10, 2)).toBe(true); // plain track: open land
    expect(map.getBuilt(10, 2)).toBe(BuiltKind.None);
  });

  it('track never goes onto a building, water, or streetcar track', () => {
    const map = new GameMap(10, 10);
    placeTransport(map, 5, 5, BuiltKind.Streetcar);
    expect(placeTransport(map, 5, 5, BuiltKind.Rail)).toBe(false);
  });
});
