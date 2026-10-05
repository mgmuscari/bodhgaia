// C4 — the shared overlay tint primitives (one alpha + one Uint8 lerp for every direct-tint overlay).

import { describe, it, expect } from 'vitest';
import { OVERLAY_ALPHA, lerpU8 } from '../../src/ui/overlayTint';
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
