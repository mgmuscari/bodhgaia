import { describe, it, expect } from 'vitest';
import { SatType } from '../../src/ui/satelliteFormat';
import { buildVertexSource, buildFragmentSource, glslDefines } from '../../src/ui/satelliteShader';
import { SHADOW_REACH } from '../../src/ui/satelliteShader';
import { SHADOW_STRENGTH } from '../../src/ui/gpuRenderer';

// The GL program itself needs a WebGL2 context (browser-only, smoke-tested via the
// ?shaderdemo route). What IS pure and worth pinning here is the GLSL *source*: the
// fragment shader switches on the SatType enum, so the CPU enum and the GPU #defines
// must never drift. These tests are that contract.

describe('satelliteShader: source headers', () => {
  it('emits GLSL ES 3.00 for both stages', () => {
    expect(buildVertexSource().startsWith('#version 300 es')).toBe(true);
    expect(buildFragmentSource().startsWith('#version 300 es')).toBe(true);
  });

  it('vertex stage is a fullscreen triangle passing v_uv', () => {
    const v = buildVertexSource();
    expect(v).toContain('gl_VertexID');
    expect(v).toContain('v_uv');
  });
});

describe('satelliteShader: fragment contract', () => {
  const f = buildFragmentSource();

  it('binds the data-map and frame uniforms', () => {
    expect(f).toContain('u_data');
    expect(f).toContain('u_grid');
    expect(f).toContain('u_time'); // the day/night sun arc
    expect(f).toContain('u_sun'); //  raymarched shadows
    expect(f).toContain('fragColor');
  });

  it('water laps like the flood: per tile in a checker, the art alternates with itself shifted, water onto water only', () => {
    expect(f).toMatch(/if \(type == SAT_WATER\)/);
    expect(f).toMatch(/mod\(floor\(u_time \/ WATER_LAP_S\) \+ wc\.x \+ wc\.y, 2\.0\)/);
    expect(f).toMatch(/== SAT_WATER\) col = texture\(u_base, v_uv \+ lap \/ u_view\)\.rgb;/);
  });

  it('maps screen UV through a camera region (origin + view), not the full grid', () => {
    // u_grid stays the texture size; u_origin/u_view are the visible window so the
    // shader can render a panned/zoomed slice of the live world (phase 5).
    expect(f).toContain('u_origin');
    expect(f).toContain('u_view');
    expect(f).toMatch(/u_origin\s*\+\s*v_uv\s*\*\s*u_view/);
  });

  it('samples the pixel-art base unwarped — the shader adds light, never motion', () => {
    expect(f).toContain('texture(u_base, v_uv)');
    expect(f).not.toContain('u_motion');
    expect(f).not.toMatch(/fbm\(/); // no animated noise (water swell, clouds) smearing the pixels
  });

  it('declares every per-cell value it reads (an undeclared `type` fails the GPU compile → silent CPU fallback)', () => {
    const main = f.slice(f.indexOf('void main()'));
    for (const name of ['type', 'ci']) {
      if (new RegExp(`\\b${name}\\b`).test(main)) expect(main, name).toMatch(new RegExp(`\\b(int|vec2|float|vec4) ${name}\\b`));
    }
  });

  it('shadows are short contact shadows: reach at most ~1 tile, soft, and faint (Maddy 2026-09-30)', () => {
    expect(SHADOW_REACH).toBeLessThanOrEqual(1);
    expect(SHADOW_STRENGTH).toBeLessThanOrEqual(0.25);
    expect(f).toContain('SHADOW_REACH');
    expect(f).not.toMatch(/mix\(1\.0, 2\.4/); // the old dawn/dusk stretch to 2.4 tiles is gone
  });

  it('carries the single-pass raymarched shadow loop', () => {
    expect(f).toMatch(/for\s*\(\s*int\s+i\s*=\s*1/); // step loop along the sun ray
    expect(f).toContain('shadow');
  });
});

describe('satelliteShader: enum sync (CPU ↔ GPU)', () => {
  it('defines every SatType with its exact numeric value', () => {
    const defs = glslDefines();
    for (const [name, value] of Object.entries(SatType)) {
      expect(defs).toContain(`#define SAT_${name.toUpperCase()} ${value}`);
    }
  });

  it('injects the defines into the fragment source', () => {
    expect(buildFragmentSource()).toContain(`#define SAT_WATER ${SatType.Water}`);
    expect(buildFragmentSource()).toContain(`#define SAT_POWER ${SatType.Power}`);
  });
});
