// Release: the static page carries its own description, Open Graph card, theme colour and favicon — what a
// link preview / browser tab shows before (or without) the game booting.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { themeVars } from '../src/ui/uiKit';

const html = readFileSync('index.html', 'utf8');
const head = html.slice(0, html.indexOf('</head>'));

function meta(attr: 'name' | 'property', key: string): string | undefined {
  const re = new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`);
  return re.exec(head)?.[1];
}

function hex(rgb: string): string {
  const parts = (rgb.match(/\d+/g) ?? []).map(Number);
  return '#' + parts.map((v) => v.toString(16).padStart(2, '0')).join('');
}

describe('page metadata (index.html)', () => {
  it('has a short description, mirrored by the Open Graph card', () => {
    const desc = meta('name', 'description');
    expect(desc).toBeTruthy();
    expect(desc!.length).toBeLessThanOrEqual(200);
    expect(meta('property', 'og:title')).toBe('Bodhgaia');
    expect(meta('property', 'og:description')).toBeTruthy();
    expect(meta('property', 'og:type')).toBe('website');
  });

  it('keeps the language rule: no planning euphemisms used as neutral words', () => {
    const copy = [meta('name', 'description'), meta('property', 'og:description')].join(' ');
    expect(copy).not.toMatch(/blight|urban renewal|redevelop|revitali|sim\s*city/i);
  });

  it("theme-color is the UI's ink ground", () => {
    expect(meta('name', 'theme-color')).toBe(hex(themeVars()['--ui-ink'] ?? ''));
  });

  it('has a static favicon that ships with the page (relative, not the empty data: placeholder)', () => {
    const href = /<link\s+rel="icon"\s+href="([^"]*)"/.exec(head)?.[1];
    expect(href).toBeTruthy();
    expect(href).not.toBe('data:,');
    expect(href).not.toMatch(/^\//); // relative: the page is hosted under a subpath
    expect(existsSync(`public/${href!.replace(/^\.\//, '')}`)).toBe(true);
  });
});

describe('no desktop-only note (index.html)', () => {
  // Maddy 2026-10-08: the game plays on phones now (pinch, touch hints, installable) — the "best on a desktop
  // browser" nag is gone, and stays gone.
  it('carries no "best on a desktop" note', () => {
    expect(html).not.toMatch(/desktop-note|best on a desktop/i);
  });
});

// Maddy 2026-10-08: "bodhgaia title is too wide for mobile". The opening's title cards scale with the screen's width
// (never past their desktop size), so BODHGAIA, its byline and the awakening fit a phone.
describe('the opening titles fit a phone', () => {
  /** The font-size of the rule for exactly `sel` that sets one (a grouped selector ending in it sets none). */
  const size = (sel: string): string => {
    for (const m of head.matchAll(new RegExp(`(?:^|\\n)\\s*\\${sel}\\s*\\{([^}]*)\\}`, 'g'))) {
      const f = /font-size:\s*([^;]+);/.exec(m[1]!);
      if (f) return f[1]!;
    }
    return '';
  };
  it('each title card’s size is the smaller of its desktop size and a share of the screen width', () => {
    expect(size('.night-credit-name')).toMatch(/^min\(4rem, [\d.]+vw\)$/);
    expect(size('.night-credit')).toMatch(/^min\(1\.5rem, [\d.]+vw\)$/);
    expect(size('.night-title')).toMatch(/^min\(3rem, [\d.]+vw\)$/);
  });
  it('BODHGAIA — 8 letters, tracked 0.32em — fits 390 px less its 24 px margins', () => {
    const vw = Number(/min\(4rem, ([\d.]+)vw\)/.exec(size('.night-credit-name'))![1]);
    const px = (vw / 100) * 390;
    const width = 8 * px * (0.6 + 0.32) + px * 0.32; // a generous glyph advance, the tracking, the balancing pad
    expect(width).toBeLessThanOrEqual(390 - 48);
  });
});

// Maddy 2026-10-08: "the budget and other panels are also too wide for mobile, they overflow the right edge".
describe('the windows fit a phone', () => {
  const blocks = [...html.matchAll(/@media \(max-width: 760px\) \{([\s\S]*?)\n {6}\}/g)].map((m) => m[1]!);
  const rulesFor = (sel: string): string =>
    blocks.flatMap((b) => [...b.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((r) => r[1]!.split(',').map((s) => s.trim()).includes(sel)).map((r) => r[2]!)).join(';');
  it('the Budget (and Saves) and Tech windows span the screen less a margin, over the palette', () => {
    for (const sel of ['.budget-panel', '.tech-panel']) {
      const r = rulesFor(sel);
      expect(r, sel).toMatch(/left:\s*0\.5rem/);
      expect(r, sel).toMatch(/right:\s*0\.5rem/);
      expect(r, sel).toMatch(/width:\s*auto/);
    }
  });
  it('the centred and docked windows are capped to the screen', () => {
    for (const sel of ['.settings-panel', '.help-panel', '.restoration-panel']) {
      const r = rulesFor(sel);
      expect(r, sel).toMatch(/max-width:\s*calc\(100vw - 1rem\)/);
      expect(r, sel).toMatch(/min-width:\s*0/);
      expect(r, sel).toMatch(/box-sizing:\s*border-box/);
    }
  });
  it('and come after the windows’ own rules, so they win', () => {
    expect(html.lastIndexOf('.budget-panel {')).toBeLessThan(html.indexOf('/* windows on a phone'));
  });
});
