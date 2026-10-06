// Ecology overlay content: pure presentation for the E-cycled heatmap overlay —
// the view order, the value→colour ramps, and the legend copy.
// No DOM, no transcendental Math (the architecture guard's pure-ui allowlist
// scans this file). The renderer/main shell consumes these; keeping them here
// lets the ramps be unit-tested rather than left to manual QA.

import type { OverlayLegend } from './overlayLegend';
import { OVERLAY_ALPHA, lerpU8 } from './overlayTint';

/** The ecology heatmap views, in cycle order: the living-land layers, then the three POLLUTION
 *  layers (air smog, ground contamination, water runoff) the player drives down by healing. */
export type OverlayView =
  | 'soil'
  | 'flora'
  | 'fauna'
  | 'biodiversity'
  | 'airPollution'
  | 'groundPollution'
  | 'waterPollution';
export const OVERLAY_VIEWS: readonly OverlayView[] = [
  'soil',
  'flora',
  'fauna',
  'biodiversity',
  'airPollution',
  'groundPollution',
  'waterPollution',
];

/** Fixed translucency for every overlay tint (the tint sits under the preview). */
export { OVERLAY_ALPHA };

type RGB = readonly [number, number, number];

// Pinned value→colour ramps (Uint8 input domain). Value 0 → lo, 255 → hi; the
// renderer reads the LIVE layer (or biodiversity field) per tile, so the tint
// tracks each ecology tick.
const RAMPS: Record<OverlayView, { lo: RGB; hi: RGB }> = {
  soil: { lo: [120, 82, 48], hi: [80, 170, 80] }, // broken brown → living green
  flora: { lo: [210, 216, 180], hi: [28, 120, 44] }, // bare → deep canopy
  fauna: { lo: [228, 214, 176], hi: [210, 120, 40] }, // quiet → teeming amber
  biodiversity: { lo: [120, 72, 176], hi: [226, 200, 64] }, // violet → gold
  airPollution: { lo: [150, 170, 150], hi: [54, 44, 38] }, // clear air → dark smog
  groundPollution: { lo: [160, 165, 135], hi: [92, 56, 26] }, // clean land → toxic sludge brown
  waterPollution: { lo: [60, 130, 185], hi: [120, 120, 52] }, // clear blue → dingy creek
};

/**
 * The translucent RGBA tint for `view` at a Uint8 `value` (0..255). Endpoints are
 * exact (0 → lo, 255 → hi); alpha is fixed. Integer-only, deterministic.
 */
export function overlayTint(view: OverlayView, value: number): [number, number, number, number] {
  const v = value < 0 ? 0 : value > 255 ? 255 : value;
  const { lo, hi } = RAMPS[view];
  return [lerpU8(lo[0], hi[0], v), lerpU8(lo[1], hi[1], v), lerpU8(lo[2], hi[2], v), OVERLAY_ALPHA];
}

const LEGENDS: Record<OverlayView, string> = {
  soil: 'Soil health — broken brown to living green',
  flora: 'Flora vitality — bare ground to deep canopy',
  fauna: 'Fauna presence — quiet to teeming',
  biodiversity: 'Biodiversity — richness, violet to gold',
  airPollution: 'Air pollution — clear air to dark smog',
  groundPollution: 'Ground pollution — clean land to toxic ground',
  waterPollution: 'Water pollution — clear to dingy creek',
};

/** The dock legend line for an active overlay view. */
export function legendLine(view: OverlayView): string {
  return LEGENDS[view];
}

const LEGEND_ENDS: Record<OverlayView, { title: string; lo: string; hi: string }> = {
  soil: { title: 'Soil health', lo: 'broken', hi: 'living' },
  flora: { title: 'Flora vitality', lo: 'bare', hi: 'canopy' },
  fauna: { title: 'Fauna presence', lo: 'quiet', hi: 'teeming' },
  biodiversity: { title: 'Biodiversity', lo: 'low', hi: 'high' },
  airPollution: { title: 'Air pollution', lo: 'clear', hi: 'smog' },
  groundPollution: { title: 'Ground pollution', lo: 'clean', hi: 'toxic' },
  waterPollution: { title: 'Water pollution', lo: 'clear', hi: 'dingy' },
};

/** The structured colour KEY for an eco overlay view: the ramp endpoints as labelled swatches. */
export function ecoLegend(view: OverlayView): OverlayLegend {
  const { lo, hi } = RAMPS[view];
  return {
    title: LEGEND_ENDS[view].title,
    stops: [
      { color: lo, label: LEGEND_ENDS[view].lo },
      { color: hi, label: LEGEND_ENDS[view].hi },
    ],
  };
}
