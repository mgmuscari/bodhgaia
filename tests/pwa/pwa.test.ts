// Installable (Maddy 2026-10-08): "if we could make it installable as a PWA that would be really cool" — and, once
// installed, "it should be able to check the original site for any updated code". The build emits a manifest, icons
// painted from the favicon's own pixels, and a service worker that caches this build for offline play but always asks
// the site for the page first, so a new release reaches an installed copy on its next launch.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { svgPixels, iconPixels, encodePng, manifest, serviceWorkerSource } from '../../scripts/pwa';

const favicon = readFileSync('public/favicon.svg', 'utf8');
const rgbAt = (px: Uint8Array, w: number, x: number, y: number) => [...px.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];

describe('the icon is the favicon’s pixel house', () => {
  const house = svgPixels(favicon);
  it('reads the 16 × 16 squares of the favicon', () => {
    expect(house.w).toBe(16);
    expect(rgbAt(house.data, 16, 0, 0)).toEqual([0x18, 0x18, 0x28, 255]); // the ink ground
    expect(rgbAt(house.data, 16, 7, 2)).toEqual([0xc0, 0x40, 0x30, 255]); // the roof's peak
  });

  it('scales by whole pixels, centred on the ink ground — and a maskable icon keeps the house in the safe zone', () => {
    const icon = iconPixels(house, 192, 0);
    expect(rgbAt(icon, 192, 7 * 12 + 5, 2 * 12 + 5)).toEqual([0xc0, 0x40, 0x30, 255]); // 12× exactly
    const mask = iconPixels(house, 512, 0.2);
    expect(rgbAt(mask, 512, 40, 40)).toEqual([0x18, 0x18, 0x28, 255]); // padding is ground
    expect(rgbAt(mask, 512, 256, 256).slice(3)).toEqual([255]);
  });

  it('encodes a real PNG of the right size', () => {
    const png = encodePng(4, 2, new Uint8Array(4 * 2 * 4).fill(200));
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(4); // IHDR width
    expect(view.getUint32(20)).toBe(2); // IHDR height
    const idatLen = view.getUint32(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLen));
    expect(raw.length).toBe(2 * (1 + 4 * 4)); // a filter byte + a row of RGBA, per row
  });
});

describe('the manifest', () => {
  const m = manifest('1.0.6');
  it('installs as Bodhgaia, full screen, from wherever it is published', () => {
    expect(m.name).toBe('Bodhgaia');
    expect(m.start_url).toBe('./');
    expect(m.scope).toBe('./');
    expect(m.display).toBe('fullscreen');
    expect(m.icons.map((i) => i.sizes)).toEqual(['192x192', '512x512', '512x512']);
    expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });
});

describe('the service worker', () => {
  const sw = serviceWorkerSource('1.0.6', ['index.html', 'assets/index-abc.js', 'music/a.mid']);
  it('caches exactly this build, under a cache named for its version, and drops older ones', () => {
    expect(sw).toContain("'bodhgaia-1.0.6'");
    expect(sw).toContain('"assets/index-abc.js"');
    expect(sw).toMatch(/caches\.delete/);
  });

  it('asks the site for the page first (updates), and falls back to the cache offline', () => {
    const nav = sw.slice(sw.indexOf("mode === 'navigate'"));
    expect(nav.indexOf('fetch(')).toBeGreaterThan(-1);
    expect(nav.indexOf('fetch(')).toBeLessThan(nav.indexOf('caches.match'));
    expect(sw).toMatch(/ignoreSearch: true/); // ?seed=… and ?nointro=1 still find the cached page
  });

  it('is valid JavaScript', () => {
    expect(() => new Function(sw)).not.toThrow();
  });
});
