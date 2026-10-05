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
    expect(meta('property', 'og:title')).toBe('Bodhitropolis');
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
