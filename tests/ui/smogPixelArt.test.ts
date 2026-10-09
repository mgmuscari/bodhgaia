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

// The performance pass (Maddy 2026-10-08: "this game heats up phones"). Measured: the smog pass cost ~1.2 ms of GPU per
// frame at 2800×1276 — the most of any pass — because every pixel ran the cloud noise three times before asking
// whether its air was dirty. Clean air now leaves at once, and a sky with no smog at all isn't drawn.
import { smogShows } from '../../src/ui/smogOverlay';
describe('smog costs nothing where there is none', () => {
  it('the fragment reads the air before any noise, and leaves at once where it is clean', () => {
    const main = src.slice(src.indexOf('void main()'));
    const air = main.indexOf('airAt(cell)');
    expect(air).toBeGreaterThan(-1);
    expect(air).toBeLessThan(main.indexOf('cloudAt('));
    expect(main.slice(air, main.indexOf('cloudAt('))).toMatch(/return;/);
  });
  it('no tile past the haze or toxic threshold: the pass is skipped', () => {
    expect(smogShows(new Map(), new Map())).toBe(false);
    expect(smogShows(new Map([[5, 30]]), new Map([[6, 8]]))).toBe(false); // faint road haze, faint spill: nothing drawn
    expect(smogShows(new Map([[5, 60]]), undefined)).toBe(true);
    expect(smogShows(new Map(), new Map([[6, 20]]))).toBe(true);
  });
});
