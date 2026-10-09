// Credits are a licence-compliance release blocker: the game is GPL-3.0-or-later, and every conveyance names the
// licence, ships its text and links the source; the music, the opening's words and the type are credited under
// their own terms. (2026-10-08: the game carries no third-party simulator code or art, and names none.)
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COPYING_HREF,
  SOURCE_URL,
  creditsBlocks,
  creditsText,
  openingCreditLine,
} from '../src/ui/creditsContent';
import { LICENCES, MUSIC_TRACKS } from '../src/audio/music/tracks';

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

  it('is its own work: the game, the opening\'s words, the music and the type — nothing else (Maddy 2026-10-08)', () => {
    expect(creditsBlocks().map((b) => b.heading.replace(/ \d+\.\d+\.\d+$/, ''))).toEqual(['Bodhgaia', creditsBlocks()[1]!.heading, 'Music', 'Type']);
  });

  it('keeps the language rule (no planning euphemisms as neutral words)', () => {
    expect(text).not.toMatch(/blight|urban renewal|redevelop|revitali/i);
  });

  it('gives the opening a one-line credit naming the licence and pointing to Help', () => {
    const line = openingCreditLine();
    expect(line).toContain('GPL-3.0-or-later');
    expect(line).toMatch(/Help/);
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

  it('credits no Pali recitation — they were removed (Maddy 2026-10-08)', () => {
    expect(creditsBlocks().some((b) => /pali/i.test(b.heading))).toBe(false);
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

describe('the credits name the release (1.0.2)', () => {
  it("leads with the game's name and its version, from package.json", async () => {
    const { readFileSync } = await import('node:fs');
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
    expect(version).toBe('1.0.2');
    expect(creditsBlocks()[0]!.heading).toBe(`Bodhgaia ${version}`);
  });
});

describe('the font is credited, under its licence (SIL OFL 1.1)', () => {
  it('names Jersey 10, its authors and the OFL, and links the licence text that ships with the game', async () => {
    const { readFileSync } = await import('node:fs');
    const all = creditsBlocks();
    const text = all.flatMap((b) => [b.heading, ...b.paragraphs]).join('\n');
    expect(text).toContain('Jersey 10');
    expect(text).toContain('The Soft Type Project Authors');
    expect(text).toMatch(/SIL Open Font License/);
    const link = all.flatMap((b) => b.links ?? []).find((l) => /OFL/i.test(l.label))!;
    expect(link.href).toBe('fonts-OFL.txt');
    expect(readFileSync('public/fonts-OFL.txt', 'utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });
});
