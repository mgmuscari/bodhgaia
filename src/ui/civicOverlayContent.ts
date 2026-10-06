// Civic overlay content: pure presentation for the C-cycled neighborhood heatmap
// — the three views, their value→colour ramps and legends (keyMap.ts is the key
// table). No DOM, no transcendental Math (the architecture guard's pure-ui
// allowlist scans this file). The single-active-overlay composite and the per-kind dispatch live in
// overlayRegistry.ts.

import type { OverlayLegend } from './overlayLegend';
import { OVERLAY_ALPHA, lerpU8 } from './overlayTint';

/** The three civic heatmap views, in cycle order. */
export type CivicOverlayView = 'belonging' | 'voice' | 'trust';
export const CIVIC_VIEWS: readonly CivicOverlayView[] = ['belonging', 'voice', 'trust'];

/** Fixed translucency for every civic overlay tint (matches the ecology overlay). */
export const CIVIC_OVERLAY_ALPHA = OVERLAY_ALPHA;

type RGB = readonly [number, number, number];

// Pinned value→colour ramps (Uint8 input domain). Value 0 → lo, 255 → hi; the
// renderer reads each tile's neighborhood value per frame, so the tint tracks
// the civic cadence.
const RAMPS: Record<CivicOverlayView, { lo: RGB; hi: RGB }> = {
  belonging: { lo: [70, 54, 64], hi: [245, 185, 70] }, // muted → warm amber (held)
  voice: { lo: [120, 60, 180], hi: [56, 200, 210] }, // violet (quiet) → cyan (heard)
  trust: { lo: [78, 92, 112], hi: [226, 190, 78] }, // slate (wary) → gold (trusting)
};

/**
 * The translucent RGBA tint for `view` at a Uint8 `value` (0..255). Endpoints are
 * exact (0 → lo, 255 → hi); alpha is fixed. Integer-only, deterministic.
 */
export function civicOverlayTint(
  view: CivicOverlayView,
  value: number,
): [number, number, number, number] {
  const v = value < 0 ? 0 : value > 255 ? 255 : value;
  const { lo, hi } = RAMPS[view];
  return [lerpU8(lo[0], hi[0], v), lerpU8(lo[1], hi[1], v), lerpU8(lo[2], hi[2], v), CIVIC_OVERLAY_ALPHA];
}

const LEGENDS: Record<CivicOverlayView, string> = {
  belonging: 'Belonging — adrift to held',
  voice: 'Voice — unheard to heard',
  trust: 'Trust — wary to trusting',
};

/** The dock legend line for an active civic overlay view. */
export function civicLegendLine(view: CivicOverlayView): string {
  return LEGENDS[view];
}

const CIVIC_LEGEND_ENDS: Record<CivicOverlayView, { title: string; lo: string; hi: string }> = {
  belonging: { title: 'Belonging', lo: 'adrift', hi: 'held' },
  voice: { title: 'Voice', lo: 'unheard', hi: 'heard' },
  trust: { title: 'Trust', lo: 'wary', hi: 'trusting' },
};

/** The structured colour KEY for a civic overlay view: the ramp endpoints as labelled swatches. */
export function civicLegend(view: CivicOverlayView): OverlayLegend {
  const { lo, hi } = RAMPS[view];
  return {
    title: CIVIC_LEGEND_ENDS[view].title,
    stops: [
      { color: lo, label: CIVIC_LEGEND_ENDS[view].lo },
      { color: hi, label: CIVIC_LEGEND_ENDS[view].hi },
    ],
  };
}
