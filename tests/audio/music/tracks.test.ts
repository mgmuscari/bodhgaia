// The music manifest: every shipped piece is openly licensed (verified at its source page), credited, present on
// disk, and parses.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMidi } from '../../../src/audio/music/midi';
import { LICENCES, MUSIC_TRACKS } from '../../../src/audio/music/tracks';

const midiTracks = MUSIC_TRACKS.filter((t) => t.file);

describe('music manifest', () => {
  it('ships 6–12 sourced pieces', () => {
    expect(midiTracks.length).toBeGreaterThanOrEqual(6);
    expect(midiTracks.length).toBeLessThanOrEqual(12);
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
      if (t.file) {
        // sourced files: only an open licence verified at the source — never anything else
        expect(t.credit.licence).toMatch(/^(public-domain|cc-by-[0-9.]+|cc-by-sa-[0-9.]+)$/);
        expect(lic.url).toMatch(/^https:\/\/creativecommons\.org\//);
        expect(t.credit.source).toMatch(/^https:\/\/www\.mutopiaproject\.org\/cgibin\/piece-info\.cgi\?id=\d+$/);
        expect(t.credit.download).toMatch(/^https:\/\/www\.mutopiaproject\.org\/ftp\/.+\.mid$/);
        expect(t.credit.typesetter.length).toBeGreaterThan(0);
      } else {
        // authored here (the chant transcriptions): part of the game, under its own licence
        expect(t.credit.licence).toBe('gpl-3.0-or-later');
      }
    }
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
