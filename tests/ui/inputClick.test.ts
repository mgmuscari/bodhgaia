// A build click must land even when a no-button move arrives between press and release (seen driving the game
// from the Chrome extension: the drag safety net ended the drag and swallowed the pointerup).
import { describe, it, expect, beforeAll } from 'vitest';
import { attachInput } from '../../src/ui/input';

type Listener = (e: Record<string, unknown>) => void;

function fakeCanvas() {
  const on = new Map<string, Listener[]>();
  const captured = new Set<number>();
  const canvas = {
    addEventListener: (t: string, f: Listener) => on.set(t, [...(on.get(t) ?? []), f]),
    setPointerCapture: (id: number) => captured.add(id),
    releasePointerCapture: (id: number) => captured.delete(id),
    hasPointerCapture: (id: number) => captured.has(id),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    fire: (t: string, e: Record<string, unknown>) => (on.get(t) ?? []).forEach((f) => f({ preventDefault() {}, ...e })),
    captured,
  };
  return canvas;
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).window ??= { addEventListener() {} };
});

describe('map clicks', () => {
  it('a click applies the tool though a no-button move came between press and release, while captured', () => {
    const canvas = fakeCanvas();
    const applied: [number, number][] = [];
    const camera = { screenToWorld: (x: number, y: number) => ({ wx: x / 16, wy: y / 16 }), pan() {} };
    attachInput(canvas as unknown as HTMLCanvasElement, camera as never, {
      onChange() {}, hasTool: () => true, isLineTool: () => false, applyAt: (x, y) => applied.push([x, y]),
      hover() {}, clearHover() {}, onHotkey() {},
    });
    const at = { pointerId: 1, clientX: 100, clientY: 100, button: 0 };
    canvas.fire('pointerdown', { ...at, buttons: 1 });
    canvas.fire('pointermove', { ...at, buttons: 0 }); // the stray move
    canvas.fire('pointerup', { ...at, buttons: 0 });
    expect(applied).toEqual([[6, 6]]);
  });
});

// Mobile (Maddy 2026-10-08): the page must not zoom under the map, and two fingers pinch the map's own zoom.
describe('touch', () => {
  function setup(tool = true) {
    const canvas = Object.assign(fakeCanvas(), { style: {} as Record<string, string> });
    const applied: [number, number][] = [];
    const zooms: { x: number; y: number; dir: number }[] = [];
    const pans: [number, number][] = [];
    const camera = {
      screenToWorld: (x: number, y: number) => ({ wx: x / 16, wy: y / 16 }),
      pan: (dx: number, dy: number) => pans.push([dx, dy]),
      zoomAt: (x: number, y: number, dir: number) => zooms.push({ x, y, dir }),
    };
    attachInput(canvas as unknown as HTMLCanvasElement, camera as never, {
      onChange() {}, hasTool: () => tool, isLineTool: () => false, applyAt: (x, y) => applied.push([x, y]),
      hover() {}, clearHover() {}, onHotkey() {},
    });
    return { canvas, applied, zooms, pans };
  }

  it('the browser leaves touches on the map to the game (no page zoom, no page scroll)', () => {
    expect(setup().canvas.style.touchAction).toBe('none');
  });

  it('spreading two fingers zooms in around the point between them, and the pinch never applies a tool', () => {
    const { canvas, applied, zooms } = setup();
    canvas.fire('pointerdown', { pointerId: 1, clientX: 300, clientY: 200, button: 0, buttons: 1 });
    canvas.fire('pointerdown', { pointerId: 2, clientX: 340, clientY: 200, button: 0, buttons: 1 });
    canvas.fire('pointermove', { pointerId: 2, clientX: 420, clientY: 200, buttons: 1 }); // 40 → 120 apart: 3×
    expect(zooms.length).toBe(3);
    expect(zooms.every((z) => z.dir === 1)).toBe(true);
    expect(zooms[0]!.x).toBe(360); // between the fingers
    expect(zooms[0]!.y).toBe(200);
    canvas.fire('pointerup', { pointerId: 2, clientX: 420, clientY: 200, buttons: 0 });
    canvas.fire('pointerup', { pointerId: 1, clientX: 300, clientY: 200, buttons: 0 });
    expect(applied).toEqual([]);
  });

  it('closing them zooms out; moving them together pans', () => {
    const { canvas, zooms, pans } = setup(false);
    canvas.fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, button: 0, buttons: 1 });
    canvas.fire('pointerdown', { pointerId: 2, clientX: 300, clientY: 100, button: 0, buttons: 1 });
    canvas.fire('pointermove', { pointerId: 2, clientX: 200, clientY: 100, buttons: 1 }); // 200 → 100 apart
    expect(zooms.length).toBeGreaterThan(0);
    expect(zooms.every((z) => z.dir === -1)).toBe(true);
    const before = pans.length;
    canvas.fire('pointermove', { pointerId: 1, clientX: 100, clientY: 140, buttons: 1 });
    canvas.fire('pointermove', { pointerId: 2, clientX: 200, clientY: 140, buttons: 1 });
    const dy = pans.slice(before).reduce((s, p) => s + p[1], 0);
    expect(dy).toBeCloseTo(40); // the midpoint moved down 40
  });

  it('after a pinch, lifting one finger and dragging the other neither pans wildly nor applies', () => {
    const { canvas, applied, pans } = setup();
    canvas.fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, button: 0, buttons: 1 });
    canvas.fire('pointerdown', { pointerId: 2, clientX: 200, clientY: 100, button: 0, buttons: 1 });
    canvas.fire('pointerup', { pointerId: 2, clientX: 200, clientY: 100, buttons: 0 });
    const before = pans.length;
    canvas.fire('pointermove', { pointerId: 1, clientX: 150, clientY: 100, buttons: 1 });
    canvas.fire('pointerup', { pointerId: 1, clientX: 150, clientY: 100, buttons: 0 });
    expect(applied).toEqual([]);
    expect(pans.slice(before).every(([dx]) => Math.abs(dx) <= 50)).toBe(true);
  });
});
