import { describe, it, expect } from 'vitest';
import { paintSnesTileset, SNES_PALETTE } from '../../src/ui/snesTileset';
import { BASE_TILE } from '../../src/ui/camera';
import type { Pixels } from '../../src/ui/pixelArt';

const TERRAIN = ['ocean', 'lake', 'river', 'bare', 'meadow', 'grass', 'forest'];
const tiles = paintSnesTileset();

const colourKey = (r: number, g: number, b: number): number => (r << 16) | (g << 8) | b;
const PALETTE = new Set(SNES_PALETTE.map(([r, g, b]) => colourKey(r, g, b)));

function offPalette(p: Pixels): string[] {
  const bad = new Set<string>();
  for (let i = 0; i < p.data.length; i += 4) {
    if (p.data[i + 3] === 0) continue;
    if (!PALETTE.has(colourKey(p.data[i]!, p.data[i + 1]!, p.data[i + 2]!))) {
      bad.add(`${p.data[i]},${p.data[i + 1]},${p.data[i + 2]}`);
    }
  }
  return [...bad];
}

describe('snes tileset — terrain', () => {
  it('paints every terrain kind × elevation band as an opaque BASE_TILE square', () => {
    for (const kind of TERRAIN) {
      for (let band = 0; band < 4; band++) {
        const t = tiles.get(`${kind}-${band}`);
        expect(t, `${kind}-${band}`).toBeDefined();
        expect(t!.w).toBe(BASE_TILE);
        expect(t!.h).toBe(BASE_TILE);
        for (let i = 3; i < t!.data.length; i += 4) expect(t!.data[i], `${kind}-${band} alpha`).toBe(255);
      }
    }
  });

  it('terrain kinds are visually distinct from each other', () => {
    const sig = (k: string): string => Array.from(tiles.get(k)!.data).join(',');
    const sigs = new Set(TERRAIN.map((k) => sig(`${k}-1`)));
    expect(sigs.size).toBe(TERRAIN.length);
  });
});

describe('snes tileset — discipline', () => {
  it('every painted pixel comes from the shared SNES palette (one coherent look)', () => {
    for (const [key, t] of tiles) expect(offPalette(t), key).toEqual([]);
  });

  it('the palette stays small (a limited-palette look, not a photo)', () => {
    expect(SNES_PALETTE.length).toBeLessThanOrEqual(64);
  });

  it('is deterministic — two paints are byte-identical', () => {
    const again = paintSnesTileset();
    expect([...again.keys()]).toEqual([...tiles.keys()]);
    for (const [k, t] of tiles) expect(Array.from(again.get(k)!.data), k).toEqual(Array.from(t.data));
  });
});

describe('snes tileset — anti-grid variants', () => {
  it('every terrain key ships 3 extra variants, each different from the base', () => {
    for (const kind of TERRAIN) {
      for (let band = 0; band < 4; band++) {
        const base = Array.from(tiles.get(`${kind}-${band}`)!.data).join();
        for (let v = 1; v < 4; v++) {
          const t = tiles.get(`${kind}-${band}#${v}`);
          expect(t, `${kind}-${band}#${v}`).toBeDefined();
          expect(Array.from(t!.data).join(), `${kind}-${band}#${v} differs`).not.toBe(base);
        }
      }
    }
  });
});
