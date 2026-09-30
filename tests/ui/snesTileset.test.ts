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

// ── Buildings ─────────────────────────────────────────────────────────────────────────────────────
import { renderKeyspace, footprintCellKey } from '../../src/ui/renderKey';
import { C } from '../../src/ui/snesPalette';

const buildingKinds = [...new Set(renderKeyspace().filter((k) => k.startsWith('b-')).map((k) => Number(k.split('-')[1])))];
const sig = (p: Pixels): string => Array.from(p.data).join();
const opaque = (p: Pixels): boolean => {
  for (let i = 3; i < p.data.length; i += 4) if (p.data[i] !== 255) return false;
  return true;
};
const hasInk = (p: Pixels): boolean => {
  for (let i = 0; i < p.data.length; i += 4) {
    if (p.data[i] === C.ink[0] && p.data[i + 1] === C.ink[1] && p.data[i + 2] === C.ink[2]) return true;
  }
  return false;
};

describe('snes tileset — buildings', () => {
  it('covers every procedural building key (b-{kind}-{pos}-{tier}) so nothing falls back', () => {
    for (const key of renderKeyspace().filter((k) => k.startsWith('b-'))) expect(tiles.has(key), key).toBe(true);
  });

  it('paints every kind as whole footprints 1..4 × 1..4, sliced into opaque cells, both tiers', () => {
    const bad: string[] = [];
    for (const kind of buildingKinds) {
      for (let w = 1; w <= 4; w++) {
        for (let h = 1; h <= 4; h++) {
          for (const tier of [0, 1]) {
            for (let r = 0; r < h; r++) {
              for (let c = 0; c < w; c++) {
                const key = footprintCellKey(kind, w, h, c, r, tier);
                const t = tiles.get(key);
                if (!t) bad.push(`${key} missing`);
                else if (t.w !== BASE_TILE || t.h !== BASE_TILE) bad.push(`${key} size`);
                else if (!opaque(t)) bad.push(`${key} has holes`);
              }
            }
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('a derelict building reads differently from its pristine twin', () => {
    for (const kind of buildingKinds) {
      const a = tiles.get(footprintCellKey(kind, 2, 2, 0, 0, 0))!;
      const b = tiles.get(footprintCellKey(kind, 2, 2, 0, 0, 1))!;
      expect(sig(a), `kind ${kind}`).not.toBe(sig(b));
    }
  });

  it('distinct kinds are drawn distinctly (type is carried by the art, not a label)', () => {
    const sigs = new Set(buildingKinds.map((k) => sig(tiles.get(footprintCellKey(k, 2, 2, 0, 1, 0))!)));
    expect(sigs.size).toBe(buildingKinds.length);
  });

  it('structures are ink-outlined (the SNES look) — every 1×1 non-green kind has ink', () => {
    const greens = new Set([11, 48, 49, 61, 62]);
    for (const kind of buildingKinds.filter((k) => !greens.has(k))) {
      expect(hasInk(tiles.get(footprintCellKey(kind, 1, 1, 0, 0, 0))!), `kind ${kind}`).toBe(true);
    }
  });

  it('houses come in several variants, and a variant covers the WHOLE footprint (no mixed cells)', () => {
    expect(tiles.has(`${footprintCellKey(16, 1, 1, 0, 0, 0)}#3`)).toBe(true);
    for (const [key] of tiles) {
      const m = /^(b-\d+-(\d)x(\d)-)c\d-r\d(-\d)#(\d+)$/.exec(key);
      if (!m) continue;
      const [, prefix, w, h, tier, v] = m;
      for (let r = 0; r < Number(h); r++) {
        for (let c = 0; c < Number(w); c++) expect(tiles.has(`${prefix}c${c}-r${r}${tier}#${v}`), key).toBe(true);
      }
    }
  });
});

describe('snes tileset — status icons', () => {
  for (const name of ['unpowered', 'thriving', 'suffering']) {
    it(`paints an ink-outlined 8×8 @icon/${name} on a transparent ground`, () => {
      const t = tiles.get(`@icon/${name}`);
      expect(t).toBeDefined();
      expect([t!.w, t!.h]).toEqual([8, 8]);
      expect(hasInk(t!)).toBe(true);
      expect(t!.data[3]).toBe(0); // corner stays clear — it's a badge, not a tile
    });
  }

  it('the three icons are distinct', () => {
    const s3 = new Set(['unpowered', 'thriving', 'suffering'].map((n) => sig(tiles.get(`@icon/${n}`)!)));
    expect(s3.size).toBe(3);
  });
});
