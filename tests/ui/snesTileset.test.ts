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

describe('snes tileset — terrain edge overlays', () => {
  it('paints a shore and a canopy overlay for every non-empty blob mask', async () => {
    const { BLOB_MASKS } = await import('../../src/ui/renderKey');
    const { edgeKey } = await import('../../src/ui/tileset');
    for (const family of ['shore', 'canopy']) {
      for (const m of BLOB_MASKS.filter((m) => m !== 0)) {
        const t = tiles.get(edgeKey(family, m));
        expect(t, `${family}/${m}`).toBeDefined();
        let opaquePx = 0;
        for (let i = 3; i < t!.data.length; i += 4) if (t!.data[i] === 255) opaquePx++;
        expect(opaquePx, `${family}/${m} draws something`).toBeGreaterThan(0);
        expect(opaquePx, `${family}/${m} is an overlay, not a tile`).toBeLessThan(BASE_TILE * BASE_TILE);
      }
    }
  });

  it('a shore on the north edge sits along the top rows only', async () => {
    const { BLOB } = await import('../../src/ui/renderKey');
    const t = tiles.get(`@edge/shore/${BLOB.N}`)!;
    for (let y = 8; y < BASE_TILE; y++) for (let x = 0; x < BASE_TILE; x++) expect(t.data[(y * BASE_TILE + x) * 4 + 3]).toBe(0);
  });
});

describe('snes tileset — diagonal coasts', () => {
  it('a land cell with water on two adjacent sides gets a sandy point on that corner', async () => {
    const { BLOB } = await import('../../src/ui/renderKey');
    const t = tiles.get(`@edge/coast/${BLOB.N | BLOB.E}`)!;
    expect(t).toBeDefined();
    const at = (x: number, y: number): number[] => Array.from(t.data.slice((y * BASE_TILE + x) * 4, (y * BASE_TILE + x) * 4 + 4));
    expect([[...C.dirtHi, 255], [...C.dirt, 255]]).toContainEqual(at(BASE_TILE - 1, 0)); // sand at the NE point
    expect(at(0, BASE_TILE - 1)[3]).toBe(0); // the far corner is untouched land
  });

  it('no coast overlay where water touches only one side (the water-side shore handles that)', async () => {
    const { BLOB } = await import('../../src/ui/renderKey');
    expect(tiles.has(`@edge/coast/${BLOB.N}`)).toBe(false);
  });

  it('a water cell with land on two adjacent sides fills that inside corner with sand', async () => {
    const { BLOB } = await import('../../src/ui/renderKey');
    const t = tiles.get(`@edge/shore/${BLOB.N | BLOB.W}`)!;
    const a = (x: number, y: number): number => t.data[(y * BASE_TILE + x) * 4 + 3]!;
    expect(a(3, 3)).toBe(255); // well inside the wedge
    expect(a(12, 12)).toBe(0);
  });
});

describe('snes tileset — transport', () => {
  it('supplies SNES asphalt as the road SURFACE (the renderer paints lane markings over it)', () => {
    for (let v = 0; v < 3; v++) {
      const t = tiles.get(`@surface/road#${v}`);
      expect(t, `@surface/road#${v}`).toBeDefined();
      expect(opaque(t!)).toBe(true);
    }
  });

  it('paints every non-road transport mask tile (rail/streetcar/elev/bike/ped) in the palette', () => {
    const keys = renderKeyspace().filter((k) => /^(rail|streetcar|elev|bike|ped)-\d+$/.test(k));
    expect(keys.length).toBe(5 * 16);
    for (const k of keys) {
      expect(tiles.has(k), k).toBe(true);
      expect(opaque(tiles.get(k)!), k).toBe(true);
    }
  });

  it('rail reads as track: a connected N-S rail differs from an E-W one', () => {
    expect(sig(tiles.get('rail-5')!)).not.toBe(sig(tiles.get('rail-10')!));
  });
});

describe('snes tileset — night lights come from the pixel art', () => {
  const emitted = (p: Pixels): number => {
    let n = 0;
    for (let i = 3; i < p.data.length; i += 4) if (p.data[i] === 255) n++;
    return n;
  };

  it('a pristine house has a lit-window map, and every lit pixel sits on one of its window panes', () => {
    const img = (w: number, h: number) => {
      // reassemble the 2×1 footprint from its cells
      const out: number[][] = [];
      for (let y = 0; y < 16 * h; y++) {
        const row: number[] = [];
        for (let x = 0; x < 16 * w; x++) {
          const cell = tiles.get(footprintCellKey(16, w, h, x >> 4, y >> 4, 0))!;
          const i = ((y & 15) * 16 + (x & 15)) * 4;
          row.push((cell.data[i]! << 16) | (cell.data[i + 1]! << 8) | cell.data[i + 2]!);
        }
        out.push(row);
      }
      return out;
    };
    const art = img(2, 1);
    const lit = tiles.get('@emit/b-16-2x1-0')!;
    expect(lit).toBeDefined();
    expect([lit.w, lit.h]).toEqual([32, 16]);
    expect(emitted(lit)).toBeGreaterThan(0);
    const glass = new Set([C.glass, C.glassHi, C.glassLo].map(([r, g, b]) => (r << 16) | (g << 8) | b));
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 32; x++) if (lit.data[(y * 32 + x) * 4 + 3] === 255) expect(glass.has(art[y]![x]!), `(${x},${y})`).toBe(true);
    }
  });

  it('a derelict building is dimmer but still lived in — some panes survive the boarding', () => {
    const pristine = emitted(tiles.get('@emit/b-17-2x2-0')!);
    const derelict = emitted(tiles.get('@emit/b-17-2x2-1') ?? blankPx(32, 32));
    expect(derelict).toBeGreaterThan(0);
    expect(derelict).toBeLessThan(pristine * 0.6);
  });

  it('a coal plant carries a blinking beacon layer; a park emits nothing', () => {
    expect(tiles.has('@emit/b-24-3x3-0/blink')).toBe(true);
    expect(tiles.has('@emit/b-61-2x2-0')).toBe(false);
  });

  it('house variants light their own windows (#v maps exist alongside the art variants)', () => {
    expect(tiles.has('@emit/b-16-1x1-0#3')).toBe(true);
  });
});

function blankPx(w: number, h: number): Pixels {
  return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}

describe('snes tileset — road paint + street furniture on the art grid', () => {
  const count = (p: Pixels, c: readonly number[]): number => {
    let n = 0;
    for (let i = 0; i < p.data.length; i += 4) if (p.data[i + 3] === 255 && p.data[i] === c[0] && p.data[i + 1] === c[1] && p.data[i + 2] === c[2]) n++;
    return n;
  };

  it('paints every road tile the renderer can request (all kinds × masks, wide slabs, surface variants)', () => {
    for (const k of renderKeyspace().filter((k) => k.startsWith('road-'))) {
      for (const key of [k, `${k}#1`, `${k}#2`]) {
        expect(tiles.has(key), key).toBe(true);
        expect(opaque(tiles.get(key)!), key).toBe(true);
      }
    }
  });

  it('a straight street carries a white dashed centre line; a 4-way junction box is clear', () => {
    expect(count(tiles.get('road-1-5')!, C.line)).toBeGreaterThan(3);
    expect(count(tiles.get('road-1-15')!, C.line)).toBe(0);
    expect(count(tiles.get('road-1-15')!, C.lineYellow)).toBe(0);
  });

  it('an avenue carries a double yellow; a wide slab carries no centre paint', () => {
    expect(count(tiles.get('road-2-10')!, C.lineYellow)).toBeGreaterThan(8);
    expect(count(tiles.get('road-2-10-w')!, C.lineYellow)).toBe(0);
  });

  it('paints the per-tile street-furniture overlays as transparent art-grid tiles', () => {
    const keys = [
      ...Array.from({ length: 15 }, (_, i) => `@road/curb/${i + 1}`),
      ...Array.from({ length: 15 }, (_, i) => `@road/divider/${i + 1}`),
      ...Array.from({ length: 15 }, (_, i) => `@road/xing/${i + 1}`),
      '@road/pole/h', '@road/pole/v',
      ...[0, 1, 2, 3].flatMap((k) => [`@road/wire/h${k}`, `@road/wire/v${k}`]),
      '@road/flane/h', '@road/flane/v', '@road/flaneEdge/2', '@road/flaneEdge/4', '@road/flaneEdge/6',
      '@road/turn/h', '@road/turn/v', '@road/median/h', '@road/median/v',
    ];
    for (const k of keys) {
      const t = tiles.get(k);
      expect(t, k).toBeDefined();
      let on = 0;
      for (let i = 3; i < t!.data.length; i += 4) if (t!.data[i] === 255) on++;
      expect(on, `${k} draws`).toBeGreaterThan(0);
      expect(on, `${k} is an overlay`).toBeLessThan(BASE_TILE * BASE_TILE);
    }
  });

  it('a curb on the north edge sits in the top rows only', () => {
    const t = tiles.get('@road/curb/1')!;
    for (let y = 4; y < BASE_TILE; y++) for (let x = 0; x < BASE_TILE; x++) expect(t.data[(y * BASE_TILE + x) * 4 + 3]).toBe(0);
  });

  it('a pole is an ink-outlined sprite at the curb, not a block in the road middle', () => {
    const t = tiles.get('@road/pole/h')!;
    expect(hasInk(t)).toBe(true);
    expect(t.data[(8 * BASE_TILE + 8) * 4 + 3]).toBe(0); // the tile centre (road middle) is clear
  });

  it('the four wire spans along a run sag in the middle (a catenary, 1 art px thick)', () => {
    const row = (k: number): number => {
      const t = tiles.get(`@road/wire/h${k}`)!;
      for (let y = 0; y < BASE_TILE; y++) if (t.data[(y * BASE_TILE + 8) * 4 + 3] === 255) return y;
      return -1;
    };
    expect(row(1)).toBeGreaterThan(row(0));
    expect(row(2)).toBeGreaterThanOrEqual(row(1));
  });
});
