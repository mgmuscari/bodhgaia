import { describe, it, expect } from 'vitest';
import { materializeSkin } from '../../src/ui/tilesetLoader';
import { paintSnesSkin } from '../../src/ui/snesTileset';
import type { PaintedSkin } from '../../src/ui/tileset';

// A tagged stand-in image (no DOM in the node env).
const img = (tag: string): CanvasImageSource => ({ tag }) as unknown as CanvasImageSource;

describe('materializeSkin — a code-painted skin to drawable images', () => {
  const painted: PaintedSkin = {
    eager: new Map([
      ['grass-0', { w: 1, h: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) }],
      ['river-0', { w: 1, h: 1, data: new Uint8ClampedArray([4, 5, 6, 255]) }],
    ]),
    lazy: {
      keys: ['b-16-c-0', 'b-99-c-0'],
      paint: (k: string) => (k === 'b-16-c-0' ? { w: 1, h: 1, data: new Uint8ClampedArray([7, 8, 9, 255]) } : null),
    },
  };

  it('materializes every eager key', () => {
    const seen: number[] = [];
    const images = materializeSkin(painted, (p) => {
      seen.push(p.data[0]!);
      return img(`px${p.data[0]}`);
    });
    expect([...images.keys()].sort()).toEqual(['grass-0', 'river-0']);
    expect(seen.sort()).toEqual([1, 4]);
  });

  it('lazy tiles materialize on first get (memoized), not up front; an empty one is undefined', () => {
    let made = 0;
    const images = materializeSkin(painted, (p) => {
      made++;
      return img(`px${p.data[0]}`);
    });
    expect(made).toBe(2); // only the eager pair
    expect(images.lazy!.keys.has('b-16-c-0')).toBe(true);
    expect(images.lazy!.get('b-16-c-0')).toEqual(img('px7'));
    images.lazy!.get('b-16-c-0');
    expect(made).toBe(3); // painted once
    expect(images.lazy!.get('b-99-c-0')).toBe(undefined);
  });

  it('a buffer the materializer refuses (headless) is left out rather than stored empty', () => {
    const images = materializeSkin(painted, () => null);
    expect(images.size).toBe(0);
  });

  it('materializes the Super skin', () => {
    const images = materializeSkin(paintSnesSkin(), (p) => img(`${p.w}x${p.h}`));
    expect(images.has('grass-0')).toBe(true);
    expect(images.lazy?.keys.size ?? 0).toBeGreaterThan(0);
  });
});
