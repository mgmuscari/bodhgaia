// The art grid (PURE — pure-ui allowlist): the one spatial quantum of the picture. Tiles are painted at
// ART_PX × ART_PX art pixels, sprites are placed on whole art pixels (renderer.drawArt), and every
// illumination effect — contact shadows, headlight/window glow, smog haze — is evaluated once per art
// pixel too (Maddy 2026-09-30), so light and shade step in the same blocks the pixel art is made of
// instead of smoothing across them at screen resolution.

import { BASE_TILE } from './camera';

/** Art pixels per tile edge. */
export const ART_PX = BASE_TILE;

/** The centre of the art pixel containing world coordinate `v` (in tiles). */
export function snapArt(v: number): number {
  return (Math.floor(v * ART_PX) + 0.5) / ART_PX;
}

/** GLSL twin of {@link snapArt} for world-cell coordinates, plus the grid constant. Prepend to any shader
 *  that computes light in world space, and evaluate the light at `artPixel(g)`. */
export const ART_GRID_GLSL = `const float ART_PX = ${ART_PX.toFixed(1)};
vec2 artPixel(vec2 g) { return (floor(g * ART_PX) + 0.5) / ART_PX; }`;
