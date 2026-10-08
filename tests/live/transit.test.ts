// Transit (docs/design/transit.md): lines are connected runs of track of one family; stops sit along each line at
// a track tile with a walkable neighbour — the platform people wait on.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, placeTransport } from '../../src/engine/fabric';
import { transitLines, STOP_SPACING } from '../../src/live/transit';
import { isWalkable } from '../../src/live/network';

function lineWithStreet(len: number, kind: number = BuiltKind.Streetcar) {
  const map = new GameMap(len + 4, 8);
  for (let x = 1; x <= len; x++) {
    map.setBuilt(x, 3, kind);
    placeTransport(map, x, 4, BuiltKind.RoadStreet); // a street alongside: the platforms
  }
  return map;
}

describe('transit lines and stops', () => {
  it('a streetcar run is one tram line, stopping along it on its platforms', () => {
    const map = lineWithStreet(30);
    const lines = transitLines(map);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.family).toBe('tram');
    const stops = lines[0]!.stops;
    expect(stops.length).toBeGreaterThanOrEqual(3);
    for (const s of stops) {
      expect(map.built[s.track]).toBe(BuiltKind.Streetcar);
      const tx = s.track % map.width, ty = (s.track - tx) / map.width;
      const px = s.platform % map.width, py = (s.platform - px) / map.width;
      expect(Math.abs(tx - px) + Math.abs(ty - py)).toBe(1); // beside the track
      expect(isWalkable(map, px, py)).toBe(true);
      expect(map.built[s.platform]).not.toBe(BuiltKind.Streetcar); // a platform is not track
    }
    for (let i = 0; i < stops.length; i++) for (let j = i + 1; j < stops.length; j++) {
      const a = stops[i]!.track, b = stops[j]!.track;
      const d = Math.abs((a % map.width) - (b % map.width)) + Math.abs(Math.floor(a / map.width) - Math.floor(b / map.width));
      expect(d).toBeGreaterThanOrEqual(STOP_SPACING);
    }
  });

  it('rail and elevated rail joined are one rail line; a separate streetcar is its own line', () => {
    const map = new GameMap(40, 10);
    for (let x = 1; x <= 10; x++) map.setBuilt(x, 2, BuiltKind.Rail);
    for (let x = 11; x <= 20; x++) map.setBuilt(x, 2, BuiltKind.ElevatedRail);
    for (let x = 1; x <= 12; x++) map.setBuilt(x, 7, BuiltKind.Streetcar);
    const lines = transitLines(map);
    expect(lines.map((l) => l.family).sort()).toEqual(['rail', 'tram']);
    expect(lines.find((l) => l.family === 'rail')!.tiles).toHaveLength(20);
  });

  it('a line no one can reach on foot has no stops', () => {
    const map = new GameMap(20, 5);
    for (let x = 0; x < 20; x++) for (const y of [1, 2, 3]) map.water[map.idx(x, y)] = 3; // the sea all round…
    for (let x = 2; x < 18; x++) {
      map.water[map.idx(x, 2)] = 0;
      map.setBuilt(x, 2, BuiltKind.Rail); // …a causeway of track
    }
    expect(transitLines(map)[0]!.stops).toHaveLength(0);
  });

  it('trains stop only where a road crosses the line or lines join (Maddy 2026-10-08: too many stops)', () => {
    const map = new GameMap(60, 12);
    for (let x = 1; x <= 50; x++) map.setBuilt(x, 5, BuiltKind.Rail);
    for (let x = 1; x <= 50; x++) if (x !== 20) placeTransport(map, x, 6, BuiltKind.RoadStreet); // a street alongside
    for (let y = 0; y <= 4; y++) placeTransport(map, 20, y, BuiltKind.RoadStreet); // a street crossing at x=20
    placeTransport(map, 20, 6, BuiltKind.RoadStreet);
    for (let y = 6; y <= 11; y++) map.setBuilt(35, y, BuiltKind.Rail); // a branch joining at x=35
    const rail = transitLines(map).find((l) => l.family === 'rail')!;
    const at = rail.stops.map((s) => [s.track % map.width, Math.floor(s.track / map.width)]);
    expect(at).toEqual(expect.arrayContaining([[20, 5]]));
    for (const [x, y] of at) expect([20, 35]).toContain(x), expect(y).toBe(5);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(transitLines(lineWithStreet(30)))).toBe(JSON.stringify(transitLines(lineWithStreet(30))));
  });
});

describe('tracks are closed to walkers (docs/design/transit.md step 4; Maddy 2026-10-08: people walk on the tracks)', () => {
  it('a rail line is walked across only where a road crosses it; a viaduct only where a street passes under', () => {
    const map = new GameMap(30, 10);
    for (let x = 1; x <= 25; x++) map.setBuilt(x, 5, BuiltKind.Rail);
    for (let x = 1; x <= 25; x++) map.setBuilt(x, 2, BuiltKind.ElevatedRail);
    for (const y of [1, 3, 4, 6]) placeTransport(map, 10, y, BuiltKind.RoadStreet); // a street across both
    expect(isWalkable(map, 5, 5)).toBe(false);
    expect(isWalkable(map, 10, 5)).toBe(true); // the level crossing
    expect(isWalkable(map, 5, 2)).toBe(false);
    expect(isWalkable(map, 10, 2)).toBe(true); // under the viaduct
  });

  it('a streetcar line is a street: walked along its kerbs', () => {
    const map = new GameMap(30, 10);
    for (let x = 1; x <= 25; x++) map.setBuilt(x, 5, BuiltKind.Streetcar);
    expect(isWalkable(map, 5, 5)).toBe(true);
  });
});
