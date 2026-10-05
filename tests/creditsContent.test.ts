// Credits are a licence-compliance release blocker: the Micropolis GPL carries §7 ADDITIONAL TERMS that every
// conveyance must include verbatim, alongside the Electronic Arts copyright notice — and the SimCity trademark
// may appear nowhere except inside those quoted terms.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COPYING_HREF,
  EA_NOTICE,
  GPL7_TERMS,
  SOURCE_URL,
  creditsBlocks,
  creditsText,
  openingCreditLine,
} from '../src/ui/creditsContent';

/** The upstream §7 block, unwrapped from its C comment, one string per paragraph. */
function upstreamSection7(): string[] {
  const src = readFileSync('micropolis-activity/src/sim/sim.c', 'utf8');
  const header = src.slice(0, src.indexOf('*/'));
  const body = header.slice(header.indexOf('ADDITIONAL TERMS per GNU GPL Section 7'));
  const lines = body.split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trim());
  const paras: string[] = [];
  let cur: string[] = [];
  for (const l of lines.slice(1)) {
    if (l === '') {
      if (cur.length) paras.push(cur.join(' '));
      cur = [];
    } else cur.push(l);
  }
  if (cur.length) paras.push(cur.join(' '));
  return paras.map((p) => p.replace(/\s+/g, ' '));
}

describe('credits content', () => {
  const text = creditsText();

  it('names the licence and links the source and the shipped licence text', () => {
    expect(text).toContain('GPL-3.0-or-later');
    expect(text).toContain(SOURCE_URL);
    expect(SOURCE_URL).toBe('https://github.com/mgmuscari/bodhitropolis');
    const hrefs = creditsBlocks().flatMap((b) => (b.links ?? []).map((l) => l.href));
    expect(hrefs).toContain(SOURCE_URL);
    expect(hrefs).toContain(COPYING_HREF);
    expect(COPYING_HREF).toBe('COPYING'); // relative: ships next to the page (public/COPYING)
  });

  it('says what it is derived from, and that it is a modified version', () => {
    expect(text).toContain('derived from Micropolis, the GPL release of the original 1989 city simulator');
    expect(text).toMatch(/modified version/);
  });

  it('carries the Electronic Arts copyright notice', () => {
    expect(EA_NOTICE).toContain('Copyright (C) 1989 - 2007 Electronic Arts Inc.');
    expect(EA_NOTICE).toMatch(/^Micropolis/);
    expect(text).toContain(EA_NOTICE);
  });

  it('carries the GPL §7 additional terms VERBATIM from upstream', () => {
    const upstream = upstreamSection7();
    expect(upstream.length).toBeGreaterThanOrEqual(5);
    expect(GPL7_TERMS).toEqual(upstream);
    for (const p of GPL7_TERMS) expect(text).toContain(p);
  });

  it('never says SimCity outside the verbatim §7 terms', () => {
    let rest = text;
    for (const p of GPL7_TERMS) rest = rest.split(p).join('');
    expect(rest).not.toMatch(/sim\s*city/i);
    expect(openingCreditLine()).not.toMatch(/sim\s*city/i);
  });

  it('keeps the language rule (no planning euphemisms as neutral words)', () => {
    expect(text).not.toMatch(/blight|urban renewal|redevelop|revitali/i);
  });

  it('gives the opening a one-line credit naming the licence and the EA notice', () => {
    const line = openingCreditLine();
    expect(line).toContain('GPL-3.0-or-later');
    expect(line).toContain('Micropolis');
    expect(line).toContain('Electronic Arts');
  });
});
