// The skin contract (PURE — no DOM, no transcendental Math → pure-ui allowlist): what a code-painted skin
// hands the loader, and the reserved `@` key namespaces the renderer reads beside the tile atlas.
// Bodhitropolis has one skin — Super (16-bit), painted by snesTileset.ts (Maddy 2026-09-30: one
// consistent aesthetic) — and this module keeps its contract apart from its painting.

import type { Pixels } from './pixelArt';

/** Tiles a code-painted skin offers on demand: every key it can paint, and a painter for one key
 *  (null when that key turns out empty — e.g. a building with no lit windows). */
export interface LazyTiles {
  keys: readonly string[];
  paint(key: string): Pixels | null;
}

/** A code-painted skin: tiles materialized up front, and (optionally) tiles materialized when first drawn
 *  (a skin can offer thousands of building tiles it mostly never draws). */
export interface PaintedSkin {
  eager: ReadonlyMap<string, Pixels>;
  lazy?: LazyTiles;
}

/**
 * Reserved key namespace for status ICONS (`unpowered`, `thriving`, `suffering`) — badges the renderer
 * draws over buildings. The `@` prefix can never collide with a tile key (those start with a letter),
 * so `@`-namespaced entries are never blitted as tiles.
 */
export function iconKey(name: string): string {
  return `@icon/${name}`;
}

export { edgeKey } from './renderKey';
