import { describe, it, expect } from 'vitest';
import { cctvFrame, cctvLabel, CctvQueue, CCTV_W, CCTV_H, CCTV_MS, ARREST_GAP_MS } from '../../src/ui/cctvContent';

describe('cctvFrame: the most zoomed-in view that fits the whole event', () => {
  it('a death (one tile) gets the closest zoom, centred on it', () => {
    expect(cctvFrame({ kind: 'death', x: 10, y: 20, w: 1, h: 1 }, CCTV_W, CCTV_H)).toEqual({ zoom: 4, cx: 10.5, cy: 20.5 });
  });

  it('a wider event backs off until it fits, with half a tile of margin each side', () => {
    const f = cctvFrame({ kind: 'arrest', x: 4, y: 5, w: 6, h: 1 }, CCTV_W, CCTV_H);
    expect(CCTV_W / (16 * f.zoom)).toBeGreaterThanOrEqual(6 + 1);
    expect(CCTV_W / (16 * (f.zoom + 1))).toBeLessThan(6 + 1);
    expect(f.cx).toBe(7);
  });

  it('never zooms out past the camera minimum', () => {
    expect(cctvFrame({ kind: 'arrest', x: 0, y: 0, w: 200, h: 200 }, CCTV_W, CCTV_H).zoom).toBe(1);
  });
});

describe('cctvLabel', () => {
  it('names the event the way a camera feed would', () => {
    expect(cctvLabel({ kind: 'death', x: 0, y: 0, w: 1, h: 1 })).toBe('A resident has died');
    expect(cctvLabel({ kind: 'arrest', x: 0, y: 0, w: 1, h: 1 })).toBe('Arrest');
    expect(cctvLabel({ kind: 'fire', x: 0, y: 0, w: 1, h: 1 })).toBe('Fire');
    expect(cctvLabel({ kind: 'spill', x: 0, y: 0, w: 1, h: 1 })).toBe('Toxic spill');
    expect(cctvLabel({ kind: 'flood', x: 0, y: 0, w: 1, h: 1 })).toBe('Flood');
    expect(cctvLabel({ kind: 'crash', x: 0, y: 0, w: 1, h: 1 })).toBe('Crash');
    expect(cctvLabel({ kind: 'protest', x: 0, y: 0, w: 1, h: 1 })).toBe('Protest');
    expect(cctvLabel({ kind: 'uprising', x: 0, y: 0, w: 1, h: 1 })).toBe('Uprising');
  });
});

describe('CctvQueue: one event at a time, deaths before arrests', () => {
  const death = { kind: 'death' as const, x: 1, y: 1, w: 1, h: 1 };
  const arrest = { kind: 'arrest' as const, x: 2, y: 2, w: 1, h: 1 };

  it(`shows each for ${CCTV_MS} ms, then the next — a death jumps the queue`, () => {
    const q = new CctvQueue();
    q.push([arrest, death], 0);
    expect(q.current(0)).toEqual(death);
    expect(q.current(CCTV_MS - 1)).toEqual(death);
    expect(q.current(CCTV_MS)).toEqual(arrest);
    expect(q.current(2 * CCTV_MS)).toBeNull();
  });

  it(`arrests are common — at most one every ${ARREST_GAP_MS / 1000} s reaches the feed; deaths always do`, () => {
    const q = new CctvQueue();
    let shown = 0;
    for (let t = 0; t < 60_000; t += 1000) {
      q.push([arrest], t);
      if (q.current(t) !== null && t % CCTV_MS === 0) shown++;
    }
    expect(shown).toBeLessThanOrEqual(Math.ceil(60_000 / ARREST_GAP_MS));
    q.push([death, death], 60_000);
    expect(q.current(60_000 + CCTV_MS)).toEqual(death);
  });

  it('keeps only a few waiting (a burst does not stack up for minutes)', () => {
    const q = new CctvQueue();
    q.push(Array.from({ length: 20 }, () => death), 0);
    let shown = 0;
    for (let t = 0; q.current(t) !== null; t += CCTV_MS) shown++;
    expect(shown).toBeLessThanOrEqual(3);
  });
});
