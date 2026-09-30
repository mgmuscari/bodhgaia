import { describe, it, expect } from 'vitest';
import { loadTileset, loadTilesetAssets, type ImageLoader } from '../../src/ui/tilesetLoader';
import { PROCEDURAL, PROCEDURAL_PROFILE, type TilesetDef } from '../../src/ui/tileset';

// Sentinel "images" — the loader is source-agnostic (Map<key, CanvasImageSource>), so the test
// returns tagged objects and asserts by identity. No DOM / no real decoding needed.
const img = (tag: string): CanvasImageSource => ({ tag } as unknown as CanvasImageSource);

/** A loader that returns a per-url sentinel image, or null for urls in `missing`. */
function stubLoader(missing: readonly string[] = []): { load: ImageLoader; urls: string[] } {
  const urls: string[] = [];
  const load: ImageLoader = async (url) => {
    urls.push(url);
    return missing.includes(url) ? null : img(url);
  };
  return { load, urls };
}

describe('loadTileset (registry-resolved)', () => {
  it('procedural loads nothing (empty override map → pure painters)', async () => {
    const { load, urls } = stubLoader();
    const overrides = await loadTileset(PROCEDURAL, load);
    expect(overrides.size).toBe(0);
    expect(urls).toEqual([]); // no fetches at all
  });

  it('an unknown id falls back to procedural → empty map, no fetches', async () => {
    const { load, urls } = stubLoader();
    const overrides = await loadTileset('does-not-exist', load);
    expect(overrides.size).toBe(0);
    expect(urls).toEqual([]);
  });
});

describe('loadTilesetAssets (the core)', () => {
  const def: TilesetDef = {
    id: 'fixture',
    label: 'Fixture',
    description: 'test',
    assets: [
      { file: 'terrain/grass.png', keys: ['grass-0', 'grass-1'] },
      { file: 'buildings/house.png', keys: ['b-16-c-0', 'b-16-e-0'] },
      { file: 'buildings/missing.png', keys: ['b-16-k-0'] },
    ],
    profile: PROCEDURAL_PROFILE,
  };

  it('assigns each loaded image to ALL its atlas keys', async () => {
    const { load } = stubLoader();
    const overrides = await loadTilesetAssets(def, load, '/');
    // Both grass band keys point at the SAME loaded image (one fetch, fanned out).
    expect(overrides.get('grass-0')).toBe(overrides.get('grass-1'));
    expect(overrides.get('b-16-c-0')).toBe(overrides.get('b-16-e-0'));
    // The two distinct files produced two distinct images.
    expect(overrides.get('grass-0')).not.toBe(overrides.get('b-16-c-0'));
  });

  it('SKIPS a failed asset — its keys fall back to procedural (partial tileset still runs)', async () => {
    const { load } = stubLoader(['/tilesets/fixture/buildings/missing.png']);
    const overrides = await loadTilesetAssets(def, load, '/');
    expect(overrides.has('b-16-k-0')).toBe(false); // dropped, not crashed
    expect(overrides.has('grass-0')).toBe(true); // siblings unaffected
    expect(overrides.has('b-16-c-0')).toBe(true);
  });

  it('builds asset urls under public/tilesets/<id>/ from the base', async () => {
    const { load, urls } = stubLoader();
    await loadTilesetAssets(def, load, '/');
    expect(urls).toContain('/tilesets/fixture/terrain/grass.png');
    expect(urls).toContain('/tilesets/fixture/buildings/house.png');
  });

  it('an empty asset list yields an empty override map', async () => {
    const { load } = stubLoader();
    const overrides = await loadTilesetAssets({ ...def, assets: [] }, load);
    expect(overrides.size).toBe(0);
  });
});

import { applyTerrainGrade } from '../../src/ui/tilesetLoader';

// Render-time terrain GRADE: darken + desaturate the satellite terrain tiles so they read like a
// satellite photo, not a cartoon (Maddy 2026-06-20). Pure RGBA transform — alpha untouched.
describe('applyTerrainGrade: darken + desaturate', () => {
  const px = (r: number, g: number, b: number, a = 255) => new Uint8ClampedArray([r, g, b, a]);

  it('is identity at sat=1, bright=1', () => {
    const d = px(200, 100, 50);
    applyTerrainGrade(d, 1, 1);
    expect([...d]).toEqual([200, 100, 50, 255]);
  });

  it('full desaturate (sat=0) collapses to luminance', () => {
    const d = px(200, 100, 50);
    applyTerrainGrade(d, 0, 1);
    const lum = Math.round(0.299 * 200 + 0.587 * 100 + 0.114 * 50); // 124
    expect([...d]).toEqual([lum, lum, lum, 255]);
  });

  it('brightness scales channels', () => {
    const d = px(200, 100, 50);
    applyTerrainGrade(d, 1, 0.5);
    expect([...d]).toEqual([100, 50, 25, 255]);
  });

  it('preserves alpha and processes every pixel', () => {
    const d = new Uint8ClampedArray([200, 100, 50, 120, 10, 20, 30, 255]);
    applyTerrainGrade(d, 1, 0.5);
    expect(d[3]).toBe(120); // alpha 1 untouched
    expect(d[7]).toBe(255); // alpha 2 untouched
    expect([d[4], d[5], d[6]]).toEqual([5, 10, 15]);
  });
});

describe('applyTerrainGrade: green pull (de-cyan water)', () => {
  it('gMul scales only the green channel', () => {
    const d = new Uint8ClampedArray([100, 200, 150, 255]);
    applyTerrainGrade(d, 1, 1, 0.5); // sat/bright identity, half green
    expect([d[0], d[1], d[2], d[3]]).toEqual([100, 100, 150, 255]);
  });
});

import { normalizeLuma } from '../../src/ui/tilesetLoader';

describe('normalizeLuma: asphalt variant brightness match', () => {
  it('scales a flat tile so its mean luma equals the target', () => {
    const d = new Uint8ClampedArray([50, 50, 50, 255, 50, 50, 50, 255]);
    normalizeLuma(d, 100);
    expect(d[0]).toBe(100);
    expect(d[3]).toBe(255); // alpha untouched
  });

  it('two tiles of different brightness converge to the same mean', () => {
    const dark = new Uint8ClampedArray([40, 40, 40, 255]);
    const light = new Uint8ClampedArray([120, 120, 120, 255]);
    normalizeLuma(dark, 96);
    normalizeLuma(light, 96);
    expect(Math.abs(dark[0]! - light[0]!)).toBeLessThanOrEqual(1);
  });
});

describe('loadTilesetAssets — code-painted skins', () => {
  const painted: TilesetDef = {
    id: 'painted',
    label: 'Painted',
    description: 'test',
    assets: [],
    paint: () => ({
      eager: new Map([
        ['grass-0', { w: 1, h: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) }],
        ['river-0', { w: 1, h: 1, data: new Uint8ClampedArray([4, 5, 6, 255]) }],
      ]),
      lazy: {
        keys: ['b-16-c-0', 'b-99-c-0'],
        paint: (k: string) => (k === 'b-16-c-0' ? { w: 1, h: 1, data: new Uint8ClampedArray([7, 8, 9, 255]) } : null),
      },
    }),
    profile: PROCEDURAL_PROFILE,
  };

  it('materializes every painted key, with no fetches', async () => {
    const { load, urls } = stubLoader();
    const seen: number[] = [];
    const overrides = await loadTilesetAssets(painted, load, '/', (p) => {
      seen.push(p.data[0]!);
      return img(`px${p.data[0]}`);
    });
    expect(urls).toEqual([]);
    expect([...overrides.keys()].sort()).toEqual(['grass-0', 'river-0']);
    expect(seen.sort()).toEqual([1, 4]);
  });

  it('keeps a painted river as painted (the satellite river→ocean alias is for baked PNGs only)', async () => {
    const { load } = stubLoader();
    const overrides = await loadTilesetAssets(painted, load, '/', (p) => img(`px${p.data[0]}`));
    expect(overrides.get('river-0')).toEqual(img('px4'));
  });

  it('lazy tiles materialize on first get (memoized), not at load; an empty one is undefined', async () => {
    const { load } = stubLoader();
    let made = 0;
    const overrides = await loadTilesetAssets(painted, load, '/', (p) => {
      made++;
      return img(`px${p.data[0]}`);
    });
    expect(made).toBe(2); // only the eager pair
    expect(overrides.lazy!.keys.has('b-16-c-0')).toBe(true);
    expect(overrides.lazy!.get('b-16-c-0')).toEqual(img('px7'));
    overrides.lazy!.get('b-16-c-0');
    expect(made).toBe(3); // painted once
    expect(overrides.lazy!.get('b-99-c-0')).toBe(undefined);
  });

  it('the registered snes skin paints its tiles through loadTileset', async () => {
    const { load, urls } = stubLoader();
    const overrides = await loadTileset('snes', load, '/', (p) => img(`${p.w}x${p.h}`));
    expect(urls).toEqual([]);
    expect(overrides.has('grass-0')).toBe(true);
  });
});
