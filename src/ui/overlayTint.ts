// Shared primitives for the direct-tint heatmap overlays (eco, civic, redline, coverage, power,
// police): the one strong fill alpha and the integer Uint8 colour lerp. Pure — no DOM, no
// transcendental Math (on the architecture guard's pure-ui allowlist).

/** Fixed fill alpha for the direct-tint overlays — strong (over a dimmed base) so the data reads as
 *  a clean layer view. The police stain keeps its own lighter alpha. */
export const OVERLAY_ALPHA = 0.92;

/** Integer lerp from a to b over the Uint8 domain (floor — value 0→a, 255→b). */
export function lerpU8(a: number, b: number, value: number): number {
  return a + Math.floor(((b - a) * value) / 255);
}
