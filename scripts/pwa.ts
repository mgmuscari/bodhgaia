// The installable app (build-time, Node): Maddy 2026-10-08 — "make it installable as a PWA", and once installed "check
// the original site for any updated code". A Vite plugin that, on build, emits:
//   manifest.webmanifest — name, full screen, icons; relative URLs, so it installs from whatever subpath it's published at;
//   icon-192.png, icon-512.png, icon-maskable-512.png — the favicon's own 16 × 16 pixel house, scaled by whole pixels;
//   sw.js — a service worker that precaches exactly this build (cache named for its version, older ones dropped) and
//           fetches the page from the site first, so an installed copy picks up a new release on its next launch and
//           falls back to the cache offline.
// The page registers sw.js itself (src/app/pwa.ts), in production builds only.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { Plugin } from 'vite';

export interface Pixels {
  w: number;
  h: number;
  data: Uint8Array;
}

const INK = [0x18, 0x18, 0x28];

/** The favicon's pixel squares (its <rect>s, on a viewBox grid) as RGBA, unpainted pixels transparent. */
export function svgPixels(svg: string): Pixels {
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  const w = vb ? Number(vb[1]) : 16;
  const h = vb ? Number(vb[2]) : 16;
  const data = new Uint8Array(w * h * 4);
  for (const m of svg.matchAll(/<rect\b([^>]*)\/?>/g)) {
    const attr = (name: string, dflt: number): number => {
      const a = new RegExp(`\\b${name}="([\\d.]+)"`).exec(m[1]!);
      return a ? Number(a[1]) : dflt;
    };
    const fill = /\bfill="#([0-9a-fA-F]{6})"/.exec(m[1]!);
    if (!fill) continue;
    const rgb = [0, 2, 4].map((i) => parseInt(fill[1]!.slice(i, i + 2), 16));
    const x0 = attr('x', 0);
    const y0 = attr('y', 0);
    const rw = attr('width', w);
    const rh = attr('height', h);
    for (let y = y0; y < Math.min(h, y0 + rh); y++)
      for (let x = x0; x < Math.min(w, x0 + rw); x++) data.set([...rgb, 255], (y * w + x) * 4);
  }
  return { w, h, data };
}

/** A square icon of `size` px: the art scaled by the largest whole factor that fits inside `pad` (a fraction of the
 *  size kept clear on each side — a maskable icon's safe zone), centred on the ink ground. */
export function iconPixels(art: Pixels, size: number, pad: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) out.set([...INK, 255], i * 4);
  const room = size * (1 - 2 * pad);
  const k = Math.max(1, Math.floor(Math.min(room / art.w, room / art.h)));
  const ox = Math.floor((size - art.w * k) / 2);
  const oy = Math.floor((size - art.h * k) / 2);
  for (let y = 0; y < art.h * k; y++)
    for (let x = 0; x < art.w * k; x++) {
      const s = (Math.floor(y / k) * art.w + Math.floor(x / k)) * 4;
      if (art.data[s + 3] === 0) continue;
      out.set(art.data.subarray(s, s + 4), ((oy + y) * size + ox + x) * 4);
    }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A PNG (8-bit RGBA, no interlace) of w × h pixels. */
export function encodePng(w: number, h: number, rgba: Uint8Array): Uint8Array {
  const chunk = (type: string, body: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + body.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, body.length);
    out.set([...type].map((c) => c.charCodeAt(0)), 4);
    out.set(body, 8);
    v.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, w);
  hv.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit, RGBA, deflate, adaptive filtering, no interlace
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (1 + w * 4) + 1); // filter 0
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}

export interface Manifest {
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
}

export function manifest(version: string): Manifest {
  return {
    name: 'Bodhgaia',
    short_name: 'Bodhgaia',
    description: `A pixel city cut apart on purpose. You do not build it. You repair it. (${version})`,
    start_url: './',
    scope: './',
    display: 'fullscreen',
    background_color: '#181828',
    theme_color: '#181828',
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

/** The service worker for this build: `files` (relative to the page) precached under a cache named for `version`. */
export function serviceWorkerSource(version: string, files: readonly string[]): string {
  return `// Bodhgaia ${version} — generated at build (scripts/pwa.ts).
const CACHE = 'bodhgaia-${version}';
const FILES = ${JSON.stringify(['./', ...files])};

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

// a new release's worker takes over at once and drops the old release's cache
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bodhgaia-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // the page: from the site first — that is how an installed copy finds a new release — the cache when offline
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./', copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./'))),
    );
    return;
  }
  // everything else is this build's own files (hashed, unchanging): the cache first, the network to fill it
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
`;
}

/** Every file under `dir`, as paths relative to it with forward slashes. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split('\\').join('/'));
    }
  };
  walk(dir);
  return out;
}

/** The Vite plugin: emits the manifest, the icons and the service worker into the build. */
export function pwa(version: string): Plugin {
  return {
    name: 'bodhgaia-pwa',
    apply: 'build',
    generateBundle(_options, bundle) {
      const house = svgPixels(readFileSync('public/favicon.svg', 'utf8'));
      const icons: [string, number, number][] = [
        ['icon-192.png', 192, 0],
        ['icon-512.png', 512, 0],
        ['icon-maskable-512.png', 512, 0.2],
      ];
      for (const [fileName, size, pad] of icons) {
        this.emitFile({ type: 'asset', fileName, source: encodePng(size, size, iconPixels(house, size, pad)) });
      }
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(manifest(version), null, 2) });
      const files = [
        ...Object.keys(bundle),
        ...filesUnder('public').filter((f) => !f.split('/').some((part) => part.startsWith('.'))),
        ...icons.map(([f]) => f),
        'manifest.webmanifest',
      ].filter((f, i, all) => all.indexOf(f) === i && !f.endsWith('.map'));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorkerSource(version, files) });
    },
  };
}
