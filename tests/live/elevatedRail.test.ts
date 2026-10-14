// Maddy 2026-10-13: "Elevated rail currently bugged: cars path on top of the rail and there are no trains". Laid over
// a road, elevated rail is a DECK above it (the road keeps its cars, beneath) — and the transit lines read only the
// ground layer, so a viaduct over the streets was no line at all: no trains. A deck is track.
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, placeOverpass, placeTransport } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { stepTrain, trackTraversable } from '../../src/live/trains';
import { transitLines } from '../../src/live/transit';
import { DIR_DX, DIR_DY } from '../../src/live/geometry';
import type { Train } from '../../src/live/types';

function viaduct() {
  const map = new GameMap(30, 11);
  for (let x = 0; x < 30; x++) placeTransport(map, x, 5, BuiltKind.RoadStreet); // a street
  for (let y = 0; y < 11; y++) placeTransport(map, 15, y, BuiltKind.RoadStreet); // a cross street
  for (let x = 2; x <= 27; x++) placeOverpass(map, x, 5, BuiltKind.ElevatedRail); // the viaduct, over the street
  return map;
}

describe('elevated rail decked over a street', () => {
  it('is a rail line, the street still below it', () => {
    const map = viaduct();
    const rail = transitLines(map).filter((l) => l.family === 'rail');
    expect(rail).toHaveLength(1);
    expect(rail[0]!.tiles).toHaveLength(26);
    expect(map.getBuilt(10, 5)).toBe(BuiltKind.RoadStreet); // cars keep the street beneath
  });

  it('stops where a street passes under it across the line', () => {
    const map = viaduct();
    const stops = transitLines(map).flatMap((l) => l.stops).map((s) => s.track % map.width);
    expect(stops).toContain(15);
  });

  it('a train rides it end to end', () => {
    const map = viaduct();
    expect(trackTraversable(map, 10, 5, 'rail')).toBe(true);
    const east = [0, 1, 2, 3].find((d) => DIR_DX[d] === 1 && DIR_DY[d] === 0)!;
    const t: Train = { cells: [map.idx(2, 5)], hx: 2, hy: 5, tx: 3, ty: 5, dir: east, family: 'rail' };
    const rng = createRng('via').fork('t');
    let far = 0;
    for (let s = 0; s < 400; s++) {
      expect(stepTrain(map, t, rng)).toBe(true);
      far = Math.max(far, t.hx);
    }
    expect(far).toBeGreaterThanOrEqual(26);
  });
});
