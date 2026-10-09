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
