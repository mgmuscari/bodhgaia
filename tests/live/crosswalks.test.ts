// Walkers keep to the corners of a junction and cross on its edges, along the crosswalks — never through the middle
// of the intersection (Maddy 2026-10-08).
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, placeTransport } from '../../src/engine/fabric';
import { pedPose, streetAt } from '../../src/live/poses';
import { PED_CURB } from '../../src/live/geometry';
import type { Ped } from '../../src/live/types';

function crossroads() {
  const map = new GameMap(11, 11);
  for (let i = 0; i < 11; i++) {
    placeTransport(map, i, 5, BuiltKind.RoadStreet);
    placeTransport(map, 5, i, BuiltKind.RoadStreet);
  }
  return map;
}

describe('crosswalks', () => {
  it('on a junction a walker stands at a corner, not in the middle', () => {
    const map = crossroads();
    for (const homeTile of [1, 2, 3, 4]) {
      const p = { x: 5, y: 5, dir: 1, tx: 5, ty: 5, homeTile } as Ped;
      const pose = pedPose(p, streetAt(map), 1);
      expect(Math.abs(pose.x - 5.5)).toBeGreaterThan(PED_CURB * 0.6);
      expect(Math.abs(pose.y - 5.5)).toBeGreaterThan(PED_CURB * 0.6);
    }
  });

  it('walking straight through, they keep their side of the street — crossing on the junction\'s edge', () => {
    const map = crossroads();
    const p = { x: 3, y: 5, dir: 1, tx: 4, ty: 5, homeTile: 1 } as Ped;
    const ys: number[] = [];
    for (let k = 0; k <= 40; k++) {
      p.x = 3 + k * 0.1;
      p.tx = Math.floor(p.x) + 1;
      ys.push(pedPose(p, streetAt(map), 1).y);
    }
    const side = Math.sign(ys[0]! - 5.5);
    for (const y of ys) expect(Math.sign(y - 5.5)).toBe(side); // never through the middle row
    expect(Math.min(...ys.map((y) => Math.abs(y - 5.5)))).toBeGreaterThan(PED_CURB * 0.6);
  });
});
