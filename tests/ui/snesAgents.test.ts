import { describe, it, expect } from 'vitest';
import { paintSnesAgents, heading8, AGENT_TINTS } from '../../src/ui/snesAgents';
import { SNES_PALETTE } from '../../src/ui/snesPalette';
import { CAR_LENGTH, CAR_WIDTH } from '../../src/ui/ambientContent';
import type { Pixels } from '../../src/ui/pixelArt';

const tiles = new Map<string, Pixels>();
paintSnesAgents(tiles);
const opaque = (p: Pixels): number => {
  let n = 0;
  for (let i = 3; i < p.data.length; i += 4) if (p.data[i] === 255) n++;
  return n;
};

describe('snes agents — vehicles + pedestrians at the art-pixel scale (Maddy 2026-09-30)', () => {
  it('cars come in every tint × 8 headings, sized to the car footprint (16 art px per tile)', () => {
    for (let t = 0; t < AGENT_TINTS; t++) {
      for (let d = 0; d < 8; d++) {
        const p = tiles.get(`@sprite/car/${t}/${d}`);
        expect(p, `car ${t}/${d}`).toBeDefined();
        const long = Math.max(p!.w, p!.h);
        expect(long).toBeLessThanOrEqual(Math.ceil(CAR_LENGTH * 16) + 1); // ≈ 7–8 art px
        expect(Math.min(p!.w, p!.h)).toBeGreaterThanOrEqual(Math.floor(CAR_WIDTH * 16)); // ≈ 4 art px
      }
    }
  });

  it('east- and north-facing cars are the same drawing turned (7×4 vs 4×7)', () => {
    const e = tiles.get('@sprite/car/0/2')!;
    const n = tiles.get('@sprite/car/0/0')!;
    expect([e.w, e.h]).toEqual([n.h, n.w]);
  });

  it('each heading has a lights frame (headlights + taillights) and cruisers flash two phases', () => {
    for (let d = 0; d < 8; d++) {
      expect(opaque(tiles.get(`@sprite/car-light/${d}`)!), `light ${d}`).toBeGreaterThan(0);
      expect(tiles.has(`@sprite/cop/${d}/0`) && tiles.has(`@sprite/cop/${d}/1`), `cop ${d}`).toBe(true);
    }
  });

  it('pedestrians and cyclists are tiny two-frame figures', () => {
    for (const kind of ['ped', 'bike']) {
      for (let f = 0; f < 2; f++) {
        const p = tiles.get(`@sprite/${kind}/0/0/${f}`)!;
        expect(p, `${kind} ${f}`).toBeDefined();
        expect(Math.max(p.w, p.h)).toBeLessThanOrEqual(4);
      }
    }
  });

  it('every agent pixel is from the one palette', () => {
    const pal = new Set(SNES_PALETTE.map(([r, g, b]) => (r << 16) | (g << 8) | b));
    for (const [k, p] of tiles) {
      for (let i = 0; i < p.data.length; i += 4) {
        if (p.data[i + 3] === 0) continue;
        expect(pal.has((p.data[i]! << 16) | (p.data[i + 1]! << 8) | p.data[i + 2]!), k).toBe(true);
      }
    }
  });
});

describe('heading8 — the sprite frame for a continuous heading', () => {
  it('maps unit headings to 8 compass frames (0 = N, clockwise, screen y-down)', () => {
    expect(heading8(0, -1)).toBe(0);
    expect(heading8(1, 0)).toBe(2);
    expect(heading8(0, 1)).toBe(4);
    expect(heading8(-1, 0)).toBe(6);
    expect(heading8(0.7071, -0.7071)).toBe(1);
    expect(heading8(0.92, -0.38)).toBe(2); // 22° off east still reads east
  });
});
