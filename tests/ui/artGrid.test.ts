import { describe, it, expect } from 'vitest';
import { ART_PX, ART_GRID_GLSL, snapArt } from '../../src/ui/artGrid';
import { BASE_TILE } from '../../src/ui/camera';
import { buildFragmentSource } from '../../src/ui/satelliteShader';
import { buildGlowVertex, buildGlowFragment } from '../../src/ui/glowBatch';
import { buildSmogFragment } from '../../src/ui/smogOverlay';

// Every illumination effect lands on the pixel-art grid (Maddy 2026-09-30: "quantize all illumination
// effects into the underlying pixel art grid"): one art pixel = 1/ART_PX tile, the same grid the tiles
// and sprites are painted on, so a light/shadow/haze step never splits an art pixel.
describe('art grid — the one quantum for tiles, sprites and light', () => {
  it('is the tile pixel grid', () => {
    expect(ART_PX).toBe(BASE_TILE);
  });

  it('snapArt maps a world coordinate to the centre of its art pixel', () => {
    expect(snapArt(0)).toBe(0.5 / ART_PX);
    expect(snapArt(0.06)).toBe(0.5 / ART_PX); // 0.06 tile < 1 art px
    expect(snapArt(1.07)).toBe((ART_PX + 1.5) / ART_PX);
    expect(snapArt(-0.01)).toBe(-0.5 / ART_PX);
  });

  it('the GLSL twin floors to the same grid', () => {
    expect(ART_GRID_GLSL).toContain(`vec2 artPixel(vec2 g)`);
    expect(ART_GRID_GLSL).toContain(`${ART_PX.toFixed(1)}`);
  });
});

describe('every light/shadow/haze shader samples on the art grid', () => {
  it('the base lighting pass marches contact shadows from the art pixel, not the screen pixel', () => {
    const f = buildFragmentSource();
    expect(f).toContain(ART_GRID_GLSL);
    expect(f).toMatch(/vec2 ga = artPixel\(g\)/);
    expect(f).toMatch(/floor\(ga \+ stepv \* d\)/);
  });

  it('the glow pass evaluates its falloff per art pixel, from a source snapped to the sprite grid', () => {
    expect(buildGlowFragment()).toContain(ART_GRID_GLSL);
    expect(buildGlowFragment()).toMatch(/artPixel\(v_world\)/);
    expect(buildGlowVertex()).toMatch(/round\(a_pos \* ART_PX\) \/ ART_PX/);
    // a headlight cone stops where its (art-pixel) ray hit something
    expect(buildGlowFragment()).toMatch(/fd > v_cut\) discard/);
  });

  it('the smog haze is sampled per art pixel', () => {
    expect(buildSmogFragment()).toContain(ART_GRID_GLSL);
    expect(buildSmogFragment()).toMatch(/vec2 cell = artPixel\(/);
    // a spill's toxic smog rides the same texture (green channel) and the same art-pixel billow
    expect(buildSmogFragment()).toMatch(/float tox = texture\(u_poll, .*\)\.g;/);
  });
});
