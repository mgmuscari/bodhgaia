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

describe('going there (Maddy 2026-10-08: clicking the feed takes you to it)', () => {
  it('the main view centres on the event, at a close zoom', async () => {
    const { cctvGoTo, GO_TO_ZOOM } = await import('../../src/ui/cctvContent');
    expect(cctvGoTo({ kind: 'fire', x: 10, y: 20, w: 2, h: 2 }, 800, 600)).toEqual({ x: 11, y: 21, zoom: GO_TO_ZOOM });
    expect(GO_TO_ZOOM).toBeGreaterThanOrEqual(3);
  });

  // Maddy 2026-10-21: "zoom to event doesn't seem to clearly zoom to the correct coordinates" — the centring was exact
  // (measured live), but a wide event overflowed the view, nothing marked the spot, and the feed stayed up over it.
  it('a wide event is framed whole in the main view, not cropped at the close zoom', async () => {
    const { cctvGoTo } = await import('../../src/ui/cctvContent');
    const flood = { kind: 'flood' as const, x: 10, y: 20, w: 30, h: 12 };
    const g = cctvGoTo(flood, 800, 600);
    expect(g.zoom).toBeLessThan(3);
    expect(800 / (16 * g.zoom)).toBeGreaterThanOrEqual(30);
    expect(cctvGoTo({ kind: 'crash', x: 5, y: 5, w: 1, h: 1 }, 800, 600).zoom).toBe(3); // a small one: close up
  });

  it('marks the spot: four corner brackets just outside the event, blinking, then gone', async () => {
    const { reticle, MARK_MS } = await import('../../src/ui/cctvContent');
    const ev = { kind: 'fire' as const, x: 10, y: 20, w: 2, h: 1 };
    const r = reticle(ev, 0, 0)!;
    expect(r).not.toBeNull();
    expect(r.length).toBe(8); // 4 corners × (one horizontal + one vertical arm), in art pixels
    const minX = Math.min(...r.map((b) => b.x));
    const maxX = Math.max(...r.map((b) => b.x + b.w));
    const minY = Math.min(...r.map((b) => b.y));
    const maxY = Math.max(...r.map((b) => b.y + b.h));
    expect(minX).toBeLessThan(10 * 16); // outside the event's tiles on every side
    expect(maxX).toBeGreaterThan(12 * 16);
    expect(minY).toBeLessThan(20 * 16);
    expect(maxY).toBeGreaterThan(21 * 16);
    const shownAt = Array.from({ length: 16 }, (_, k) => reticle(ev, 0, (k * MARK_MS) / 16) !== null);
    expect(shownAt.some((on) => !on)).toBe(true); // it blinks
    expect(reticle(ev, 0, MARK_MS)).toBeNull(); // and goes
  });

  it('the feed can be dismissed once you have gone there', () => {
    const q = new CctvQueue();
    q.push([{ kind: 'fire', x: 1, y: 1, w: 1, h: 1 }], 0);
    expect(q.current(0)).not.toBeNull();
    q.dismiss();
    expect(q.current(1)).toBeNull();
  });
});

describe('community events on camera (Maddy 2026-10-08)', () => {
  it('labels them', () => {
    expect(cctvLabel({ kind: 'party', x: 0, y: 0, w: 1, h: 1 })).toBe('Block party');
    expect(cctvLabel({ kind: 'fair', x: 0, y: 0, w: 1, h: 1 })).toBe('Craft fair');
    expect(cctvLabel({ kind: 'festival', x: 0, y: 0, w: 1, h: 1 })).toBe('Festival');
  });

  it('a celebration never goes before a death or a disaster', () => {
    const q = new CctvQueue();
    q.push([{ kind: 'festival', x: 0, y: 0, w: 1, h: 1 }, { kind: 'fire', x: 1, y: 1, w: 1, h: 1 }], 0);
    expect(q.current(0)!.kind).toBe('fire');
  });
});
