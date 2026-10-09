// Smog and toxic clouds in the pixel-art pipeline (Maddy 2026-10-08: "smog and toxic clouds need to be redrawn in
// the pixel art pipeline"): the GPU haze is no longer a smooth fBm gradient but clouds the way the game paints
// everything — hard-edged shapes on the art grid, shaded in three tones from the shared palette, at a few fixed
// opacities, drifting a whole art pixel at a time.
import { describe, expect, it } from 'vitest';
import { buildSmogFragment, SMOG_ALPHAS, TOXIC_ALPHAS } from '../../src/ui/smogOverlay';
import { C } from '../../src/ui/snesPalette';

const vec3 = (c: readonly number[]) => `vec3(${c.map((v) => (v / 255).toFixed(4)).join(', ')})`;
const src = buildSmogFragment();

describe('smog is pixel art', () => {
  it('its colours are the palette’s: slate for smog, meadow greens for a spill’s toxic cloud', () => {
    for (const c of [C.slateHi, C.slate, C.slateLo, C.meadowHi, C.meadow, C.grassMid]) expect(src).toContain(vec3(c));
  });

  it('no smooth blends of colour or opacity: tones are picked, never mixed', () => {
    expect(src).not.toMatch(/\bmix\(/);
    expect(src).not.toMatch(/smoothstep/);
  });

  it('opacity takes a few fixed steps, thin and thick', () => {
    expect(SMOG_ALPHAS.length).toBe(2);
    expect(TOXIC_ALPHAS.length).toBe(2);
    for (const a of [...SMOG_ALPHAS, ...TOXIC_ALPHAS]) expect(src).toContain(a.toFixed(3));
  });

  it('the clouds drift whole art pixels at a time', () => {
    expect(src).toMatch(/floor\(u_wind \* u_time \* [0-9.]+ \* ART_PX\) \/ ART_PX/);
  });

  it('shaded like the sprites: lit from above, shadowed below, by the cloud edge one art pixel away', () => {
    expect(src).toMatch(/vec2\(0\.0, 1\.0 \/ ART_PX\)/);
  });
});
