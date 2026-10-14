// Maddy 2026-10-13: "Trains not stopping at crossing stations". A train remembered the last stop it halted at so it
// wouldn't halt there twice in a row — and never forgot it: on a line with a single station, it stopped once in its
// life. It halts at a station every time it comes to one.
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, placeTransport } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { stepTrain } from '../../src/live/trains';
import { DWELL, transitFor } from '../../src/live/transit';
import { DIR_DX, DIR_DY } from '../../src/live/geometry';
import type { Train } from '../../src/live/types';

describe('a train halts at its station every time it comes to it', () => {
  it('on a line with one station (a street crossing it), shuttling end to end', () => {
    const map = new GameMap(30, 7);
    for (let y = 0; y < 7; y++) placeTransport(map, 15, y, BuiltKind.RoadStreet);
    for (let x = 2; x <= 27; x++) placeTransport(map, x, 3, BuiltKind.Rail); // track laid across the street
    const stops = transitFor(map).lines.flatMap((l) => l.stops);
    expect(stops).toHaveLength(1);
    const east = [0, 1, 2, 3].find((d) => DIR_DX[d] === 1 && DIR_DY[d] === 0)!;
    const t: Train = { cells: [map.idx(2, 3)], hx: 2, hy: 3, tx: 3, ty: 3, dir: east, family: 'rail' };
    const rng = createRng('stops').fork('t');
    let halts = 0;
    for (let s = 0; s < 3000; s++) {
      expect(stepTrain(map, t, rng)).toBe(true);
      if (t.dwell === DWELL) halts++;
    }
    // ~26 tiles each way at 2.5 tiles… a pass every few hundred substeps: several passes, a halt on each
    expect(halts).toBeGreaterThanOrEqual(4);
  });
});
