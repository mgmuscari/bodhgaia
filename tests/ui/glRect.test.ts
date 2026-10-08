import { describe, it, expect } from 'vitest';
import { toGlRect } from '../../src/ui/glRect';

describe('toGlRect: a box on screen → the GL viewport/scissor rect of a canvas covering `pane`', () => {
  it('offsets by the pane, scales by the device pixel ratio and flips Y to GL’s bottom-left origin', () => {
    const pane = { left: 112, top: 44, width: 1288, height: 816 };
    const inset = { left: 1146, top: 642, width: 240, height: 160 };
    expect(toGlRect(inset, pane, 2)).toEqual({ x: 2068, y: 116, w: 480, h: 320 }) // its bottom sits 58 css px above the pane's;
  });

  it('rounds to whole device pixels', () => {
    const r = toGlRect({ left: 10.4, top: 10.6, width: 20.2, height: 20.2 }, { left: 0, top: 0, width: 100, height: 100 }, 1.5);
    expect(Number.isInteger(r.x) && Number.isInteger(r.y) && Number.isInteger(r.w) && Number.isInteger(r.h)).toBe(true);
  });
});
