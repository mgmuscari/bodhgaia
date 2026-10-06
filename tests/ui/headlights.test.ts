import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind } from '../../src/engine/fabric';
import { castHeadlights, BEAM_REACH, type Body } from '../../src/ui/headlights';
import { ART_PX } from '../../src/ui/artGrid';
import { CAR_LENGTH, CAR_WIDTH } from '../../src/live/geometry';

// Headlights stop at what they hit and light it (Maddy 2026-09-30: "headlights cast forward should stop
// and illuminate the next sprite they hit"), instead of beams laid over everything.
const car = (x: number, y: number, hx: number, hy: number, lights = true): Body => ({ x, y, hx, hy, len: CAR_LENGTH, wid: CAR_WIDTH, lights });

function road(): GameMap {
  const m = new GameMap(12, 12);
  for (let x = 0; x < 12; x++) m.setBuilt(x, 5, BuiltKind.RoadStreet);
  return m;
}

describe('castHeadlights', () => {
  it('an open road: both lamps reach their full length, nothing is lit', () => {
    const { beams, lit } = castHeadlights(road(), [car(3.5, 5.5, 1, 0)]);
    expect(beams).toHaveLength(2);
    for (const b of beams) {
      expect(b.cut).toBeCloseTo(BEAM_REACH, 5);
      expect(b.hit).toBe('none');
    }
    expect(lit.size).toBe(0);
  });

  it('a car ahead in the lane stops the beam at its tail and is lit', () => {
    const { beams, lit } = castHeadlights(road(), [car(3.5, 5.5, 1, 0), car(4.5, 5.5, 1, 0, false)]);
    for (const b of beams) {
      expect(b.hit).toBe('body');
      expect(b.target).toBe(1);
      // the lamp sits at the front bumper; the leader's tail is 1 tile − half a car ahead of centre
      const tail = 1 - CAR_LENGTH / 2 - (b.x - 3.5);
      expect(Math.abs(b.cut - tail)).toBeLessThanOrEqual(1 / ART_PX + 1e-9);
    }
    expect(lit.get(1)!.light).toBeGreaterThan(0);
    expect(lit.has(0)).toBe(false); // a car never lights itself (its lamps sit inside its own body)
  });

  it('a building stops the beam at the wall and splashes light there', () => {
    const m = road();
    m.setBuilt(5, 5, BuiltKind.Offices);
    const { beams } = castHeadlights(m, [car(3.5, 5.5, 1, 0)]);
    for (const b of beams) {
      expect(b.hit).toBe('wall');
      expect(Math.abs(b.x + b.fx * b.cut - 5)).toBeLessThanOrEqual(1 / ART_PX + 1e-9);
    }
  });

  it('open green parcels (parks, medians, lots) do not stop light', () => {
    const m = road();
    m.setBuilt(5, 5, BuiltKind.Park);
    for (const b of castHeadlights(m, [car(3.5, 5.5, 1, 0)]).beams) expect(b.hit).toBe('none');
  });

  it('a car in the next lane over is not in the beam', () => {
    const { beams } = castHeadlights(road(), [car(3.5, 5.5, 1, 0), car(4.3, 6.1, -1, 0, false)]);
    for (const b of beams) expect(b.hit).toBe('none');
  });

  it('cuts land on whole art pixels', () => {
    const { beams } = castHeadlights(road(), [car(3.5, 5.5, 1, 0), car(4.37, 5.5, 1, 0, false)]);
    for (const b of beams) expect(Math.abs(b.cut * ART_PX - Math.round(b.cut * ART_PX))).toBeLessThan(1e-9);
  });

  it('bodies without lights cast nothing', () => {
    expect(castHeadlights(road(), [car(3.5, 5.5, 1, 0, false)]).beams).toHaveLength(0);
  });
});
