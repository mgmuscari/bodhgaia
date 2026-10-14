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

// Stretched ramps (Maddy 2026-10-14): a view spreads its ramp over the values actually on the map, not the fixed
// 0..255 — a city whose neighbourhoods all sit at 14–23% health painted one flat tan. The span has a floor so a
// near-flat field (0–3 smog) stays faint instead of blaring; the key names the range (rangeLabel), so stretched
// colours never pass for the full scale.

/** The values a stretched ramp spans (Uint8 domain), lo < hi. */
export interface StretchRange {
  lo: number;
  hi: number;
}

/** The narrowest span a ramp stretches over (of 255). */
export const STRETCH_MIN_SPAN = 16;

/** The min..max of `values`, widened to STRETCH_MIN_SPAN (upward from the minimum, kept within 0..255). */
export function stretchRange(values: Iterable<number>): StretchRange {
  let lo = 255;
  let hi = 0;
  let any = false;
  for (const raw of values) {
    const v = raw < 0 ? 0 : raw > 255 ? 255 : raw;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    any = true;
  }
  if (!any) return { lo: 0, hi: 255 };
  if (hi - lo < STRETCH_MIN_SPAN) {
    hi = Math.min(255, lo + STRETCH_MIN_SPAN);
    lo = hi - STRETCH_MIN_SPAN;
  }
  return { lo, hi };
}

/** `value` re-scaled so `range` covers 0..255 (clamped outside it; integer floor). */
export function stretched(value: number, range: StretchRange): number {
  if (value <= range.lo) return 0;
  if (value >= range.hi) return 255;
  return Math.floor(((value - range.lo) * 255) / (range.hi - range.lo));
}

/** A range as a share of the full scale, for the colour key ("14–23%"). */
export function rangeLabel(range: StretchRange): string {
  const pct = (v: number): number => Math.round((v * 100) / 255);
  return `${pct(range.lo)}–${pct(range.hi)}%`;
}
