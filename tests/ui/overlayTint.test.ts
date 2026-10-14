// C4 — the shared overlay tint primitives (one alpha + one Uint8 lerp for every direct-tint overlay).

import { describe, it, expect } from 'vitest';
import { OVERLAY_ALPHA, STRETCH_MIN_SPAN, lerpU8, rangeLabel, stretchRange, stretched } from '../../src/ui/overlayTint';
import { CIVIC_OVERLAY_ALPHA } from '../../src/ui/civicOverlayContent';
import { REDLINE_OVERLAY_ALPHA } from '../../src/ui/redlineOverlayContent';
import { COVERAGE_OVERLAY_ALPHA } from '../../src/ui/coverageOverlayContent';
import { POWER_OVERLAY_ALPHA } from '../../src/ui/powerOverlayContent';
import { OVERLAY_ALPHA as ECO_OVERLAY_ALPHA } from '../../src/ui/ecoOverlayContent';
import { POLICE_OVERLAY_ALPHA } from '../../src/ui/policeViolenceOverlayContent';

describe('overlay tint primitives', () => {
  it('one strong fill alpha for the direct-tint overlays; police keeps its own lighter stain', () => {
    expect(OVERLAY_ALPHA).toBe(0.92);
    for (const a of [CIVIC_OVERLAY_ALPHA, REDLINE_OVERLAY_ALPHA, COVERAGE_OVERLAY_ALPHA, POWER_OVERLAY_ALPHA, ECO_OVERLAY_ALPHA]) {
      expect(a).toBe(OVERLAY_ALPHA);
    }
    expect(POLICE_OVERLAY_ALPHA).toBe(0.6);
  });

  it('lerpU8 is an integer floor lerp over 0..255 with exact endpoints', () => {
    expect(lerpU8(70, 245, 0)).toBe(70);
    expect(lerpU8(70, 245, 255)).toBe(245);
    expect(lerpU8(70, 245, 128)).toBe(70 + Math.floor((175 * 128) / 255));
    expect(lerpU8(245, 70, 1)).toBe(245 + Math.floor((-175 * 1) / 255)); // floors toward −∞ going down
    expect(lerpU8(245, 70, 1)).toBe(244);
  });
});

// Stretched ramps (Maddy 2026-10-14: "stretching overlay ramps would be helpful"): a city whose neighbourhoods all
// sit at 14–23% health painted one flat tan on a fixed 0..255 ramp. A view spreads its ramp over the values on the
// map instead — with a floor on the span, so a near-flat field (0–3 smog) stays faint instead of blaring.
describe('stretched overlay ramps', () => {
  it('the range is the values\' min..max', () => {
    expect(stretchRange([40, 36, 59])).toEqual({ lo: 36, hi: 59 });
  });

  it('a span narrower than the floor widens upward from the minimum (down from 255 at the top)', () => {
    expect(STRETCH_MIN_SPAN).toBe(16);
    expect(stretchRange([0, 3])).toEqual({ lo: 0, hi: 16 });
    expect(stretchRange([250, 252])).toEqual({ lo: 239, hi: 255 });
    expect(stretchRange([7, 7])).toEqual({ lo: 7, hi: 23 });
  });

  it('no values: the full domain', () => {
    expect(stretchRange([])).toEqual({ lo: 0, hi: 255 });
  });

  it('stretched maps lo → 0 and hi → 255, clamped outside, integer between', () => {
    const r = { lo: 36, hi: 59 };
    expect(stretched(36, r)).toBe(0);
    expect(stretched(59, r)).toBe(255);
    expect(stretched(10, r)).toBe(0);
    expect(stretched(200, r)).toBe(255);
    expect(stretched(47, r)).toBe(Math.floor((11 * 255) / 23));
    expect(stretched(3, { lo: 0, hi: 16 })).toBe(Math.floor((3 * 255) / 16)); // faint, not full
  });

  it('the range reads as a share of the full scale', () => {
    expect(rangeLabel({ lo: 36, hi: 59 })).toBe('14–23%');
    expect(rangeLabel({ lo: 0, hi: 255 })).toBe('0–100%');
  });
});
