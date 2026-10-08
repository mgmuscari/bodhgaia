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
import { LICENCES, MUSIC_TRACKS } from '../src/audio/music/tracks';
import { CHANT_TEXTS } from '../src/audio/music/chant';

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
    expect(SOURCE_URL).toBe('https://github.com/mgmuscari/bodhgaia');
    const hrefs = creditsBlocks().flatMap((b) => (b.links ?? []).map((l) => l.href));
    expect(hrefs).toContain(SOURCE_URL);
    expect(hrefs).toContain(COPYING_HREF);
    // relative (subpath hosting), and .txt so browsers DISPLAY it (an extensionless file may download)
    expect(COPYING_HREF).toBe('COPYING.txt');
  });

  it('ships the licence text it links, byte-identical to the repo COPYING', () => {
    const copying = readFileSync('COPYING', 'utf8');
    expect(readFileSync(`public/${COPYING_HREF}`, 'utf8')).toBe(copying);
    expect(readFileSync('public/COPYING', 'utf8')).toBe(copying); // the conventional name ships too
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

  it('credits every piece of music: title, composer, typesetter, licence, and links to source + licence', () => {
    const music = creditsBlocks().filter((b) => /music/i.test(b.heading));
    expect(music.length).toBeGreaterThan(0);
    const body = music.flatMap((b) => b.paragraphs).join('\n');
    const hrefs = music.flatMap((b) => (b.links ?? []).map((l) => l.href));
    for (const t of MUSIC_TRACKS) {
      expect(body, t.id).toContain(t.title);
      expect(body, t.id).toContain(t.composer);
      expect(body, t.id).toContain(t.credit.typesetter);
      expect(body, t.id).toContain(LICENCES[t.credit.licence].name);
      expect(hrefs, t.id).toContain(t.credit.source);
    }
    for (const id of new Set(MUSIC_TRACKS.map((t) => t.credit.licence)))
      if (id !== 'public-domain') expect(hrefs).toContain(LICENCES[id].url);
    expect(body).toContain('Mutopia Project');
    expect(body).toContain('Nocturne in B major, Op. 9 No. 3');
    expect(body).toContain('Glen Larsen');
    expect(body).not.toMatch(/ShareAlike [0-3]\.\d/); // only 4.0 licences ship
    // the arrangements made for the game say so, and say by whom
    expect(body).toContain("St. Louis Blues — W. C. Handy. Arranged for Bodhgaia by Madeleine Muscari");
    expect(body).toContain('MIDI typeset by Glen Larsen for the Mutopia Project (Creative Commons Attribution-ShareAlike 4.0); arranged for Bodhgaia by Madeleine Muscari; Creative Commons Attribution-ShareAlike 4.0.');
  });

  it('credits the Pali chant as a transcription of traditional recitation, with the text and its meaning', () => {
    const block = creditsBlocks().find((b) => /pali/i.test(b.heading));
    expect(block).toBeDefined();
    const body = block!.paragraphs.join('\n');
    expect(body).toMatch(/transcription/i);
    expect(body).toMatch(/not a recording/i);
    for (const text of CHANT_TEXTS) {
      expect(body).toContain(text.title);
      for (const v of text.verses) {
        for (const line of v.pali) expect(body).toContain(line);
        expect(body).toContain(v.meaning);
      }
    }
  });
});

describe('the opening’s words are credited (Maddy 2026-10-08)', () => {
  it('names the Berkeley Zen Center chant book for the epigraphs and vows', () => {
    const block = creditsBlocks().find((b) => /opening/i.test(b.heading))!;
    expect(block).toBeDefined();
    expect(block.paragraphs.join(' ')).toMatch(/Berkeley Zen Center/);
    expect(block.paragraphs.join(' ')).toMatch(/Heart Sutra/);
    expect(block.paragraphs.join(' ')).toMatch(/Dōgen/);
    expect((block.links ?? []).some((l) => /berkeleyzencenter\.org/.test(l.href))).toBe(true);
  });
});
