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
    for (let y = 5; y < BASE_TILE; y++) for (let x = 0; x < BASE_TILE; x++) expect(t.data[(y * BASE_TILE + x) * 4 + 3], `(${x},${y})`).toBe(0); // stays on the sidewalk strip
  });

});

describe('snes roads — lines follow the road through turns, and every class shares one asphalt', () => {
  const colourAt = (p: Pixels, x: number, y: number): number[] => Array.from(p.data.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 3));
  const is = (p: Pixels, x: number, y: number, c: readonly number[]): boolean => colourAt(p, x, y).join() === c.join();
  const any = (p: Pixels, c: readonly number[], f: (x: number, y: number) => boolean): boolean => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (f(x, y) && is(p, x, y, c)) return true;
    return false;
  };
  const mode = (p: Pixels): string => {
    const n = new Map<string, number>();
    for (let i = 0; i < p.data.length; i += 4) {
      const k = `${p.data[i]},${p.data[i + 1]},${p.data[i + 2]}`;
      n.set(k, (n.get(k) ?? 0) + 1);
    }
    return [...n].sort((a, b) => b[1] - a[1])[0]![0];
  };

  it('an avenue turn (E+S) carries its double yellow round the bend to BOTH connected edges', () => {
    const t = tiles.get('road-2-6')!;
    expect(any(t, C.lineYellow, (x) => x === 15)).toBe(true); // reaches the east edge
    expect(any(t, C.lineYellow, (_x, y) => y === 15)).toBe(true); // reaches the south edge
    expect(any(t, C.lineYellow, (x, y) => x < 4 && y < 4)).toBe(false); // nothing out in the far corner
  });

  it('…and each of its two yellow lines is ONE continuous stroke round the bend (no gaps, no crossings)', () => {
    const t = tiles.get('road-2-6')!;
    const on = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < 16 && y < 16 && is(t, x, y, C.lineYellow);
    const seen = new Set<number>();
    let strokes = 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (!on(x, y) || seen.has(y * 16 + x)) continue;
        strokes++;
        const stack = [[x, y]];
        seen.add(y * 16 + x);
        while (stack.length) {
          const [cx, cy] = stack.pop()!;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = cx! + dx;
              const ny = cy! + dy;
              if (on(nx, ny) && !seen.has(ny * 16 + nx)) {
                seen.add(ny * 16 + nx);
                stack.push([nx, ny]);
              }
            }
          }
        }
      }
    }
    expect(strokes).toBe(2);
  });

  it('a single-lane highway turn curves its edge lines too (no crossing stubs)', () => {
    const t = tiles.get('road-3-6')!;
    expect(any(t, C.line, (x) => x === 15)).toBe(true);
    expect(any(t, C.line, (_x, y) => y === 15)).toBe(true);
    expect(is(t, 1, 1, C.line)).toBe(false); // the old straight edge-stub corner is gone
  });

  it('streets, avenues and highways share one asphalt — no patchwork at junctions', () => {
    expect(mode(tiles.get('road-3-5')!)).toBe(mode(tiles.get('road-1-5')!));
    expect(mode(tiles.get('road-2-15')!)).toBe(mode(tiles.get('road-1-15')!));
  });

  it('a two-row avenue paints its centre double yellow along the seam between its rows', () => {
    const top = tiles.get('road-2-14-w')!; // E|S|W: the north row, partner to the south
    const bottom = tiles.get('road-2-11-w')!; // N|E|W: the south row
    let topSeam = 0;
    let bottomSeam = 0;
    for (let x = 0; x < 16; x++) {
      if (is(top, x, 14, C.lineYellow)) topSeam++;
      if (is(bottom, x, 1, C.lineYellow)) bottomSeam++;
    }
    expect(topSeam).toBeGreaterThan(12);
    expect(bottomSeam).toBeGreaterThan(12);
    expect(any(top, C.lineYellow, (_x, y) => y < 10)).toBe(false);
  });

  it('wide interiors / junctions and freeway slabs stay clear (freeway lanes come from the overlays)', () => {
    expect(any(tiles.get('road-2-15-w')!, C.lineYellow, () => true)).toBe(false);
    expect(any(tiles.get('road-3-14-w')!, C.lineYellow, () => true)).toBe(false);
  });

  it('curbs round their outer corner and fill the inner block corner', () => {
    const outer = tiles.get('@road/curb/9')!; // N|W
    expect(outer.data[(3 * 16 + 3) * 4 + 3]).toBe(255); // the chamfer bulges into the corner
    expect(tiles.get('@road/curb/1')!.data[(3 * 16 + 3) * 4 + 3]).toBe(0);
    const inner = tiles.get('@road/curbCorner/16')!; // NE diagonal is the block corner
    expect(inner.data[(0 * 16 + 15) * 4 + 3]).toBe(255);
    expect(inner.data[(15 * 16 + 0) * 4 + 3]).toBe(0);
  });

  it('a junction pole is drawn tucked into the tile corner', () => {
    const t = tiles.get('@road/pole/nw')!;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (t.data[(y * 16 + x) * 4 + 3]) expect(x < 7 && y < 7, `(${x},${y})`).toBe(true);
  });
});

describe('snes roads — poles are props, no wires', () => {
  it('paints no wire tiles', () => {
    expect([...tiles.keys()].some((k) => k.startsWith('@road/wire/'))).toBe(false);
  });
});

describe('snes roads — every variant key the renderer asks for is ours', () => {
  it('road surface variant #0 is painted too (the renderer requests road-…#0, not the bare key)', () => {
    for (const k of ['road-1-6#0', 'road-2-10#0', 'road-3-5#0', 'road-2-14-w#0']) expect(tiles.has(k), k).toBe(true);
  });
});

describe('snes roads — local streets (Maddy 2026-09-30)', () => {
  const lineRows = (p: Pixels, x: number): number[] => {
    const out: number[] = [];
    for (let y = 0; y < 16; y++) {
      const i = (y * 16 + x) * 4;
      if (p.data[i] === C.line[0] && p.data[i + 1] === C.line[1] && p.data[i + 2] === C.line[2]) out.push(y);
    }
    return out;
  };

  it('street dashes run 4 on / 4 off, CENTRED in the tile — a 2-px gap at both ends, so no dash pokes into a junction', () => {
    expect(lineRows(tiles.get('road-1-5')!, 7)).toEqual([2, 3, 4, 5, 10, 11, 12, 13]);
  });

  it('street corners carry no centre paint (no dash crumbs round the bend)', () => {
    for (const k of ['road-1-6', 'road-1-3', 'road-10-6', 'road-7-9']) {
      let n = 0;
      const p = tiles.get(k)!;
      for (let i = 0; i < p.data.length; i += 4) if (p.data[i] === C.line[0] && p.data[i + 1] === C.line[1] && p.data[i + 2] === C.line[2]) n++;
      expect(n, k).toBe(0);
    }
  });

  it('a two-row street is the avenue form: a double yellow along its seam, like a two-row avenue', () => {
    const onRow = (p: Pixels, y: number): number => {
      let n = 0;
      for (let x = 0; x < 16; x++) {
        const i = (y * 16 + x) * 4;
        if (p.data[i] === C.lineYellow[0] && p.data[i + 1] === C.lineYellow[1]) n++;
      }
      return n;
    };
    expect(onRow(tiles.get('road-1-14-w')!, 14)).toBe(16);
    expect(onRow(tiles.get('road-1-11-w')!, 1)).toBe(16);
  });

  it('paints zebra crosswalk overlays for each approach side', () => {
    for (let m = 1; m < 16; m++) expect(tiles.has(`@road/zebra/${m}`), `zebra ${m}`).toBe(true);
    const z = tiles.get('@road/zebra/1')!; // approach from the south into a junction to the north
    const a = (x: number, y: number): number => z.data[(y * 16 + x) * 4 + 3]!;
    expect(a(4, 1)).toBe(255); // a stripe across the carriageway at the north edge
    expect(a(5, 1)).toBe(0); // …with gaps between stripes
    expect(a(4, 10)).toBe(0); // only at that edge
    // the band is cleared to asphalt between the bars, so no centre dash shows through the crossing
    const at = (x: number, y: number): string => Array.from(z.data.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)).join();
    expect(at(7, 2)).toBe([...C.asphalt, 255].join());
  });
});

describe('snes skin — buildings are materialized lazily (Maddy 2026-09-30: the view went blank)', () => {
  it('the eager set is small; buildings + their light maps come from the lazy source', async () => {
    const { paintSnesSkin } = await import('../../src/ui/snesTileset');
    const skin = paintSnesSkin();
    expect(skin.eager.size).toBeLessThan(3000);
    expect([...skin.eager.keys()].some((k) => k.startsWith('b-') || k.startsWith('@emit/'))).toBe(false);
    expect(skin.lazy!.keys.length).toBeGreaterThan(9000);
  });

  it('lazy tiles are pixel-identical to the full paint, and cover every building + light key', async () => {
    const { paintSnesSkin } = await import('../../src/ui/snesTileset');
    const skin = paintSnesSkin();
    const lazyKeys = new Set(skin.lazy!.keys);
    for (const k of tiles.keys()) {
      if (k.startsWith('b-') || k.startsWith('@emit/')) expect(lazyKeys.has(k), k).toBe(true);
    }
    for (const k of ['b-16-1x1-c0-r0-0#3', 'b-24-3x3-c2-r1-1', 'b-16-c-0', '@emit/b-16-2x1-0', '@emit/b-24-3x3-0/blink']) {
      const want = tiles.get(k);
      const got = skin.lazy!.paint(k);
      expect(got && Array.from(got.data).join(), k).toBe(want && Array.from(want.data).join());
    }
    expect(skin.lazy!.paint('@emit/b-61-2x2-0')).toBe(null); // a park has no lights
  });
});

describe('snes sprites — encampments at the art-pixel scale (Maddy 2026-09-30)', () => {
  it('paints tents and junk as small native-resolution sprites on a transparent ground', () => {
    for (const k of ['@sprite/tent/0', '@sprite/tent/1', '@sprite/tent/2', '@sprite/junk/0', '@sprite/junk/1', '@sprite/junk/2', '@sprite/junk/3']) {
      const t = tiles.get(k);
      expect(t, k).toBeDefined();
      expect(t!.w, k).toBeLessThanOrEqual(8);
      expect(t!.h, k).toBeLessThanOrEqual(7);
      if (k.includes('tent')) expect(t!.data[3], `${k} corner`).toBe(0); // an outlined sprite, not a tile
    }
  });

  it('tents are ink-outlined (they read as structures, like the buildings)', () => {
    for (const k of ['@sprite/tent/0', '@sprite/tent/1', '@sprite/tent/2']) expect(hasInk(tiles.get(k)!), k).toBe(true);
  });

  it('paints three worn-ground overlays (no translucent brown wash)', () => {
    for (const k of ['@wear/1', '@wear/2', '@wear/3']) {
      const t = tiles.get(k)!;
      expect([t.w, t.h]).toEqual([16, 16]);
      let on = 0;
      for (let i = 3; i < t.data.length; i += 4) if (t.data[i] === 255) on++;
      expect(on, k).toBeGreaterThan(0);
      expect(on, k).toBeLessThan(256);
    }
    const count = (k: string): number => {
      let n = 0;
      const t = tiles.get(k)!;
      for (let i = 3; i < t.data.length; i += 4) if (t.data[i] === 255) n++;
      return n;
    };
    expect(count('@wear/3')).toBeGreaterThan(count('@wear/1')); // more wear, more beaten earth
  });
});

describe('snes washes — dithered pixel overlays instead of translucent per-tile fills', () => {
  const cover = (k: string): number => {
    const p = tiles.get(k)!;
    let n = 0;
    for (let i = 3; i < p.data.length; i += 4) if (p.data[i] === 255) n++;
    return n / (p.w * p.h);
  };

  it('water pollution and redlined asphalt: 3 levels × 3 variants that thicken, never solid, hard pixels', () => {
    for (const fam of ['water', 'asphalt']) {
      for (let v = 0; v < 3; v++) {
        let prev = 0;
        for (let l = 1; l <= 3; l++) {
          const k = `@wash/${fam}/${l}/${v}`;
          const p = tiles.get(k);
          expect(p, k).toBeDefined();
          for (let i = 3; i < p!.data.length; i += 4) expect([0, 255]).toContain(p!.data[i]);
          expect(cover(k), k).toBeGreaterThan(prev);
          expect(cover(k), k).toBeLessThan(0.85);
          prev = cover(k);
        }
      }
    }
  });

  it('redlined asphalt keeps open ground mostly green (Maddy 2026-09-30): even the heaviest mat < 1/4 of a tile', () => {
    for (let v = 0; v < 3; v++) expect(cover(`@wash/asphalt/3/${v}`)).toBeLessThan(0.25);
  });

  it('washes are clumped patches, not a checkerboard dither (a district-wide dither reads as noise)', () => {
    for (const k of ['@wash/water/2/0', '@wash/asphalt/2/1']) {
      const p = tiles.get(k)!;
      const on = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < p.w && y < p.h && p.data[(y * p.w + x) * 4 + 3] === 255;
      let lit = 0;
      let clumped = 0;
      for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
        if (!on(x, y)) continue;
        lit++;
        if ([on(x + 1, y), on(x - 1, y), on(x, y + 1), on(x, y - 1)].filter(Boolean).length >= 2) clumped++;
      }
      expect(clumped / lit, k).toBeGreaterThan(0.6);
    }
    expect([...tiles.get('@wash/asphalt/2/0')!.data]).not.toEqual([...tiles.get('@wash/asphalt/2/1')!.data]);
  });

  it('the overpass shadow is a half-tone dither', () => {
    expect(cover('@wash/shadow')).toBeGreaterThan(0.4);
    expect(cover('@wash/shadow')).toBeLessThan(0.6);
  });

  it('a level crossing paves a road band across the rails, with the rails running through it', () => {
    const v = tiles.get('@road/xband/v')!; // road runs N-S across an E-W railway
    const a = (x: number, y: number): number => v.data[(y * v.w + x) * 4 + 3]!;
    expect(a(0, 0)).toBe(0); // outside the band stays the rail tile
    expect(a(8, 0)).toBe(255); // the band reaches both edges
    expect(a(8, 15)).toBe(255);
    const at = (x: number, y: number): number[] => [...v.data.subarray((y * v.w + x) * 4, (y * v.w + x) * 4 + 3)];
    expect(at(8, 5)).not.toEqual(at(8, 7)); // a rail row differs from the asphalt beside it
    expect(tiles.has('@road/xband/h')).toBe(true);
  });
});
