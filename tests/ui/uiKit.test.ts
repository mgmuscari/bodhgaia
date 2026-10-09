import { describe, it, expect } from 'vitest';
import { framePixels, FRAME_SIZE, FRAME_SLICE, themeVars, FRAME_KINDS } from '../../src/ui/uiKit';
import { SNES_PALETTE } from '../../src/ui/snesPalette';
import type { Pixels } from '../../src/ui/pixelArt';

// The window kit (Maddy 2026-09-30: menus should match the pixel art and feel like a classic 16-bit city-builder):
// bevelled 9-slice frames painted from the one shared palette, served as CSS border-images.
const rgbAt = (p: Pixels, x: number, y: number): number[] => [...p.data.subarray((y * p.w + x) * 4, (y * p.w + x) * 4 + 4)];
const onPalette = (r: number, g: number, b: number): boolean => SNES_PALETTE.some((c) => c[0] === r && c[1] === g && c[2] === b);

describe('uiKit frames', () => {
  for (const kind of FRAME_KINDS) {
    it(`${kind}: a ${FRAME_SIZE}px 9-slice on the shared palette with rounded (clear) corners`, () => {
      const p = framePixels(kind);
      expect([p.w, p.h]).toEqual([FRAME_SIZE, FRAME_SIZE]);
      for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
        const [r, g, b, a] = rgbAt(p, x, y);
        if (a! > 0) expect(onPalette(r!, g!, b!), `${kind} (${x},${y})`).toBe(true);
      }
      expect(rgbAt(p, 0, 0)[3]).toBe(0);
      expect(rgbAt(p, FRAME_SIZE - 1, FRAME_SIZE - 1)[3]).toBe(0);
    });

    it(`${kind}: the edge and centre bands are uniform, so the slice stretches without seams`, () => {
      const p = framePixels(kind);
      const mid = FRAME_SLICE; // first pixel past the corner
      for (let i = FRAME_SLICE; i < FRAME_SIZE - FRAME_SLICE; i++) {
        for (let d = 0; d < FRAME_SIZE; d++) {
          expect(rgbAt(p, i, d), `${kind} column ${i} row ${d}`).toEqual(rgbAt(p, mid, d)); // top/bottom bands
          expect(rgbAt(p, d, i), `${kind} row ${i} col ${d}`).toEqual(rgbAt(p, d, mid)); // left/right bands
        }
      }
    });
  }

  it('a pressed button is the raised one with its bevel inverted (lit edge goes dark)', () => {
    const up = framePixels('button');
    const down = framePixels('buttonDown');
    expect(rgbAt(down, FRAME_SLICE, 1)).toEqual(rgbAt(up, FRAME_SLICE, FRAME_SIZE - 2)); // top edge ← bottom edge
    expect(rgbAt(down, FRAME_SLICE, FRAME_SIZE - 2)).toEqual(rgbAt(up, FRAME_SLICE, 1));
  });
});

describe('uiKit theme variables', () => {
  it('names every UI colour role, each a shared-palette colour', () => {
    const vars = themeVars();
    for (const role of ['--ui-ink', '--ui-panel', '--ui-panel-hi', '--ui-text', '--ui-muted', '--ui-accent', '--ui-face', '--ui-good', '--ui-bad']) {
      expect(vars[role], role).toBeDefined();
      const m = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(vars[role]!);
      expect(m, `${role} = ${vars[role]}`).not.toBeNull();
      expect(onPalette(Number(m![1]), Number(m![2]), Number(m![3])), role).toBe(true);
    }
  });
});
