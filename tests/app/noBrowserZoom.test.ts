// Maddy 2026-10-08 (mobile): "double tap still slightly zooms in the browser, and pinching over the menu bars themselves
// also zooms… need to find a way to disable browser zoom on mobile". Three layers, since Safari ignores the first.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { installNoBrowserZoom } from '../../src/app/noBrowserZoom';

const html = readFileSync('index.html', 'utf8');

describe('the browser never zooms the page', () => {
  it('the viewport forbids scaling (Android Chrome honours it)', () => {
    const vp = /<meta name="viewport" content="([^"]+)"/.exec(html)![1]!;
    expect(vp).toMatch(/maximum-scale=1/);
    expect(vp).toMatch(/user-scalable=no/);
  });

  it('every element allows panning only — no pinch, no double-tap zoom; panels still scroll', () => {
    expect(html).toMatch(/\*\s*\{\s*touch-action:\s*pan-x pan-y;\s*\}/);
  });

  it('Safari’s own gestures and a two-finger touch off the map are cancelled; one finger, and the map, are left alone', () => {
    const on = new Map<string, { fn: (e: unknown) => void; opts: unknown }>();
    const doc = { addEventListener: (t: string, fn: (e: unknown) => void, opts: unknown) => on.set(t, { fn, opts }) };
    installNoBrowserZoom(doc as unknown as Document, () => 1);
    const ev = (extra: Record<string, unknown>) => {
      const e = { prevented: false, preventDefault() { this.prevented = true; }, target: { closest: () => null }, ...extra };
      return e;
    };
    for (const t of ['gesturestart', 'gesturechange']) {
      const e = ev({});
      on.get(t)!.fn(e);
      expect(e.prevented, t).toBe(true);
      expect(on.get(t)!.opts).toMatchObject({ passive: false });
    }
    const two = ev({ touches: { length: 2 } });
    on.get('touchmove')!.fn(two);
    expect(two.prevented).toBe(true);
    const one = ev({ touches: { length: 1 } });
    on.get('touchmove')!.fn(one);
    expect(one.prevented).toBe(false);
    const onMap = ev({ touches: { length: 2 }, target: { closest: (s: string) => (s === 'canvas' ? {} : null) } });
    on.get('touchmove')!.fn(onMap);
    expect(onMap.prevented).toBe(false); // the map's pinch is the game's (pointer events), not cancelled here
  });
});

// Maddy 2026-10-08 (iOS Safari): "double tapping … is still caught and slightly zooms in the interface, and now you
// can't zoom out the interface". Safari ignores touch-action for a double tap: the second tap's touchend is swallowed.
// And a page that did get zoomed must be able to pinch back out: the pinch guard stands down while it is zoomed.
describe('Safari: double tap, and a way back out', () => {
  const setup = (scale = 1) => {
    const on = new Map<string, (e: unknown) => void>();
    const doc = { addEventListener: (t: string, fn: (e: unknown) => void) => on.set(t, fn) };
    installNoBrowserZoom(doc as unknown as Document, () => scale);
    const ev = (extra: Record<string, unknown>) => ({ prevented: false, preventDefault() { this.prevented = true; }, target: { closest: () => null }, ...extra });
    return { on, ev };
  };
  it('the second tap of a double tap is swallowed; a lone tap is not', () => {
    const { on, ev } = setup();
    const first = ev({ timeStamp: 1000, touches: { length: 0 } });
    on.get('touchend')!(first);
    const second = ev({ timeStamp: 1200, touches: { length: 0 } });
    on.get('touchend')!(second);
    const later = ev({ timeStamp: 2000, touches: { length: 0 } });
    on.get('touchend')!(later);
    expect([first.prevented, second.prevented, later.prevented]).toEqual([false, true, false]);
  });
  it('a page already zoomed can pinch back out: the guard stands down', () => {
    const { on, ev } = setup(1.4);
    const g = ev({});
    on.get('gesturestart')!(g);
    expect(g.prevented).toBe(false);
    const two = ev({ touches: { length: 2 } });
    on.get('touchmove')!(two);
    expect(two.prevented).toBe(false);
  });
  it('form fields are 16 px on a touch screen (Safari zooms in on focusing a smaller one)', () => {
    expect(html).toMatch(/@media \(hover: none\) and \(pointer: coarse\) \{\s*input, select, textarea \{\s*font-size: 16px;/);
  });
});
