// Skin materializer (IO — touches the DOM, so NOT on the pure-ui allowlist; the skin contract lives in
// the pure tileset.ts). Turns a code-painted skin's pixel buffers into the drawable images the renderer
// reads: Map<atlasKey, image>, plus an on-demand source for the tiles it paints lazily.

import type { PaintedSkin } from './tileset';
import type { Pixels } from './pixelArt';

/** A skin's on-demand images: every key it can supply, and a getter that materializes one on first use
 *  (memoized). The renderer's atlas consults it on a miss. */
export interface LazyImages {
  keys: ReadonlySet<string>;
  get(key: string): CanvasImageSource | undefined;
}

/** A skin's drawable images: the eager ones (a Map), plus its lazy source if it has one. */
export type SkinImages = Map<string, CanvasImageSource> & { lazy?: LazyImages };

/** Turns a code-painted pixel buffer into a drawable image, or `null` if it can't (headless). */
export type Materializer = (p: Pixels) => CanvasImageSource | null;

/** Default materializer: one canvas per buffer via putImageData (crisp — no scaling involved). */
const domMaterializer: Materializer = (p) => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = p.w;
  canvas.height = p.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const id = ctx.createImageData(p.w, p.h);
  id.data.set(p.data);
  ctx.putImageData(id, 0, 0);
  return canvas;
};

/** Materialize a painted skin: every eager tile now, each lazy tile once on first request (memoized —
 *  a key that paints empty stays a miss). Synchronous: the skin is code, not a download. */
export function materializeSkin(skin: PaintedSkin, materialize: Materializer = domMaterializer): SkinImages {
  const images: SkinImages = new Map<string, CanvasImageSource>();
  for (const [key, pixels] of skin.eager) {
    const out = materialize(pixels);
    if (out) images.set(key, out);
  }
  if (skin.lazy) {
    const lazy = skin.lazy;
    const cache = new Map<string, CanvasImageSource | null>();
    images.lazy = {
      keys: new Set(lazy.keys),
      get(key) {
        if (!cache.has(key)) {
          const px = lazy.paint(key);
          cache.set(key, px ? materialize(px) : null);
        }
        return cache.get(key) ?? undefined;
      },
    };
  }
  return images;
}
