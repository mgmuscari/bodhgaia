// Sideshows (Maddy 2026-10-21): cars spinning donuts in a crossing — where each car is and which way it faces, at a
// moment, and the tire marks the crossing keeps.
import { describe, it, expect } from 'vitest';
import { donutPoses, skidLevel } from '../../src/ui/sideshowContent';

const site = { x: 9, y: 9, w: 4, h: 4 }; // a 2×2 crossing and its approaches

describe('donuts', () => {
  it('one pose per car, each inside the crossing, facing one of the 8 headings', () => {
    for (const cars of [1, 2, 3, 4]) {
      const ps = donutPoses(site, cars, 7, 1234);
      expect(ps).toHaveLength(cars);
      for (const p of ps) {
        expect(p.x).toBeGreaterThan(site.x + 0.5);
        expect(p.x).toBeLessThan(site.x + site.w - 0.5);
        expect(p.y).toBeGreaterThan(site.y + 0.5);
        expect(p.y).toBeLessThan(site.y + site.h - 0.5);
        expect(Number.isInteger(p.dir8) && p.dir8 >= 0 && p.dir8 < 8).toBe(true);
      }
    }
  });

  it('a car goes all the way round, turning through every heading, within a couple of seconds', () => {
    const dirs = new Set<number>();
    for (let t = 0; t < 2000; t += 40) dirs.add(donutPoses(site, 1, 7, t)[0]!.dir8);
    expect(dirs.size).toBe(8);
  });

  it('is the same at the same moment', () => {
    expect(donutPoses(site, 3, 5, 999)).toEqual(donutPoses(site, 3, 5, 999));
  });
});

describe('tire marks', () => {
  it('show from a light scuff to a dark tangle as they build, and none when faded', () => {
    expect(skidLevel(0)).toBe(0);
    expect(skidLevel(10)).toBe(0);
    expect(skidLevel(40)).toBe(1);
    expect(skidLevel(120)).toBe(2);
    expect(skidLevel(255)).toBe(3);
  });
});

import { skidMarks } from '../../src/ui/snesTileset';
describe('tire-mark art', () => {
  const inked = (level: number, v: number) => {
    const p = skidMarks(level, v);
    let n = 0;
    for (let i = 3; i < p.data.length; i += 4) if (p.data[i]! > 0) n++;
    return n;
  };
  it('more rubber as the marks build, a different tangle per variant', () => {
    for (let v = 0; v < 3; v++) {
      expect(inked(1, v)).toBeGreaterThan(4);
      expect(inked(2, v)).toBeGreaterThan(inked(1, v));
      expect(inked(3, v)).toBeGreaterThan(inked(2, v));
    }
    expect(Buffer.from(skidMarks(3, 0).data).equals(Buffer.from(skidMarks(3, 1).data))).toBe(false);
  });
});
