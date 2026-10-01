import { describe, it, expect } from 'vitest';
import { paintSnesAgents, heading8, AGENT_TINTS, SMOG_SIZES } from '../../src/ui/snesAgents';
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

describe('snes smog — pixel puffs replace the diffusion plume sprites', () => {
  it('3 billow sizes × 2 variants, growing, all on the shared palette, ragged (not a solid disc)', () => {
    expect(SMOG_SIZES).toBe(3);
    let prev = 0;
    for (let s = 0; s < SMOG_SIZES; s++) {
      for (let v = 0; v < 2; v++) {
        const p = tiles.get(`@sprite/smog/${s}/${v}`);
        expect(p, `smog ${s}/${v}`).toBeDefined();
        expect(p!.w).toBeGreaterThan(prev);
        const area = p!.w * p!.h;
        expect(opaque(p!)).toBeGreaterThan(area * 0.25);
        expect(opaque(p!)).toBeLessThan(area * 0.8);
        for (let i = 0; i < p!.data.length; i += 4) {
          if (p!.data[i + 3] === 0) continue;
          const rgb = [p!.data[i], p!.data[i + 1], p!.data[i + 2]];
          expect(SNES_PALETTE.some((c) => c[0] === rgb[0] && c[1] === rgb[1] && c[2] === rgb[2])).toBe(true);
        }
      }
      prev = tiles.get(`@sprite/smog/${s}/0`)!.w;
    }
  });
});

describe('snes trains + birds — the last flat-shape agents, as pixel art', () => {
  it('locomotive and carriage in 8 headings, ~0.8 tile long, on the shared palette', () => {
    for (const part of ['loco', 'car']) {
      for (let d = 0; d < 8; d++) {
        const p = tiles.get(`@sprite/train/${part}/${d}`);
        expect(p, `${part}/${d}`).toBeDefined();
        if (d % 2 === 0) {
          expect(Math.max(p!.w, p!.h), `${part}/${d} length`).toBeGreaterThanOrEqual(12);
          expect(Math.max(p!.w, p!.h), `${part}/${d} length`).toBeLessThanOrEqual(14);
        }
        for (let i = 0; i < p!.data.length; i += 4) {
          if (p!.data[i + 3] === 0) continue;
          const rgb = [p!.data[i], p!.data[i + 1], p!.data[i + 2]];
          expect(SNES_PALETTE.some((c) => c[0] === rgb[0] && c[1] === rgb[1] && c[2] === rgb[2])).toBe(true);
        }
      }
    }
    // the locomotive reads differently from its carriages
    expect([...tiles.get('@sprite/train/loco/2')!.data]).not.toEqual([...tiles.get('@sprite/train/car/2')!.data]);
  });

  it('a diagonal frame is a turned body, not the straight one (no rotated-sprite smear)', () => {
    const e = tiles.get('@sprite/train/car/2')!;
    const ne = tiles.get('@sprite/train/car/1')!;
    expect(ne.w).toBe(ne.h);
    expect(ne.w).toBeLessThan(e.w);
    expect(opaque(ne)).toBeGreaterThan(opaque(e) * 0.6);
  });

  it('birds flap through two frames', () => {
    const a = tiles.get('@sprite/bird/0')!;
    const b = tiles.get('@sprite/bird/1')!;
    expect(opaque(a)).toBeGreaterThan(0);
    expect([...a.data]).not.toEqual([...b.data]);
  });
});
