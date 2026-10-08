// The music manifest: every shipped piece is openly licensed (verified at its source page), credited, present on
// disk, and parses.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMidi } from '../../../src/audio/music/midi';
import { LICENCES, MUSIC_TRACKS } from '../../../src/audio/music/tracks';

const midiTracks = MUSIC_TRACKS.filter((t) => t.file);
/** Mutopia's typeset pieces, and the arrangements made for the game (Maddy 2026-10-08). */
const sourced = midiTracks.filter((t) => !t.credit.arranged);
const arranged = midiTracks.filter((t) => t.credit.arranged);

describe('music manifest', () => {
  it('ships 6–12 sourced pieces', () => {
    expect(sourced.length).toBeGreaterThanOrEqual(6);
    expect(sourced.length).toBeLessThanOrEqual(12);
  });

  it("ships Madeleine Muscari's arrangements for the game — GPL with the game, city music (not sacred)", () => {
    expect(arranged.map((t) => t.id).sort()).toEqual(['after-youve-gone', 'kyabdro-night', 'motherless-night', 'namo-bossa', 'om-mani-town', 'st-louis-blues']);
    for (const t of arranged) {
      expect(t.credit.typesetter).toBe('Madeleine Muscari');
      expect(t.credit.licence).toBe('gpl-3.0-or-later');
      expect(t.credit.source).toBe('https://github.com/mgmuscari/bodhgaia');
      expect(t.sacred).toBeFalsy();
      expect(t.moods.some((m) => m === 'day' || m === 'night')).toBe(true);
    }
  });

  it('has unique, slug-shaped ids', () => {
    const ids = MUSIC_TRACKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('only public domain or CC BY / BY-SA — each with its licence deed and a source page', () => {
    for (const t of MUSIC_TRACKS) {
      const lic = LICENCES[t.credit.licence];
      expect(lic, t.id).toBeDefined();
      if (t.file && t.credit.arranged) {
        // arranged for the game: part of it, under its licence
        expect(t.credit.licence).toBe('gpl-3.0-or-later');
      } else if (t.file) {
        // sourced files: only an open licence verified at the source — never anything else
        expect(t.credit.licence).toMatch(/^(public-domain|cc-by-4\.0|cc-by-sa-4\.0)$/); // 4.0 only: GPLv3-compatible
        expect(lic.url).toMatch(/^https:\/\/creativecommons\.org\/(licenses\/publicdomain|licenses\/by(-sa)?\/4\.0)\/$/);
        expect(t.credit.source).toMatch(/^https:\/\/www\.mutopiaproject\.org\/cgibin\/piece-info\.cgi\?id=\d+$/);
        expect(t.credit.download).toMatch(/^https:\/\/www\.mutopiaproject\.org\/ftp\/.+\.mid$/);
        expect(t.credit.typesetter.length).toBeGreaterThan(0);
      } else {
        // authored here (the chant transcriptions): part of the game, under its own licence
        expect(t.credit.licence).toBe('gpl-3.0-or-later');
      }
    }
  });

  it('carries Chopin Op. 9 No. 3 (BY-SA 4.0) in place of Op. 9 No. 2 (BY-SA 3.0)', () => {
    const ids = MUSIC_TRACKS.map((t) => t.id);
    expect(ids).toContain('chopin-nocturne-op9-no3');
    expect(ids).not.toContain('chopin-nocturne-op9-no2');
    expect(Object.keys(LICENCES)).not.toContain('cc-by-sa-3.0');
  });

  it('every file exists in public/music, is small, and parses to notes', () => {
    for (const t of midiTracks) {
      const bytes = readFileSync(`public/music/${t.file}`);
      expect(bytes.length, t.id).toBeLessThan(64 * 1024);
      const piece = parseMidi(new Uint8Array(bytes));
      expect(piece.notes.length, t.id).toBeGreaterThan(50);
      expect(piece.duration, t.id).toBeGreaterThan(30);
    }
  });

  it('ships no file that the manifest does not credit', () => {
    const credited = new Set(midiTracks.map((t) => t.file));
    for (const f of readdirSync('public/music')) expect(credited.has(f), f).toBe(true);
  });

  it('every mood has music; the sacred recitations are tagged calm ONLY', () => {
    for (const mood of ['day', 'night', 'calm'] as const)
      expect(MUSIC_TRACKS.some((t) => t.moods.includes(mood)), mood).toBe(true);
    for (const t of MUSIC_TRACKS.filter((x) => x.sacred)) expect(t.moods).toEqual(['calm']);
  });

  it('ships the Pali recitations as sacred, calm-only transcriptions voiced by the chant instrument', () => {
    const sacred = MUSIC_TRACKS.filter((t) => t.sacred);
    expect(sacred.map((t) => t.id).sort()).toEqual(['pali-metta-sutta', 'pali-tisarana']);
    for (const t of sacred) {
      expect(t.file).toBeUndefined();
      expect(t.voices?.[0]).toBe('chant');
      const piece = t.piece!();
      expect(piece.notes.length).toBeGreaterThan(50);
    }
    // the chant voice is reserved for recitation
    for (const t of MUSIC_TRACKS.filter((x) => !x.sacred))
      expect(Object.values(t.voices ?? {})).not.toContain('chant');
  });
});
