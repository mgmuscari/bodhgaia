// Release notes (Maddy 2026-10-13): "changelogs for new releases that display the next time a player launches the
// game if their browser/pwa sees a new version". The notes live in one list, newest first; a returning player whose
// last-seen version is older sees every release since — a first-time player sees none.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CHANGELOG, compareVersions, whatsNew } from '../../src/ui/changelogContent';

describe('compareVersions', () => {
  it('compares numerically, part by part', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.9', '1.0.10')).toBeLessThan(0);
    expect(compareVersions('1.1.0', '1.0.99')).toBeGreaterThan(0);
    expect(compareVersions('1.0.15', '1.0.15')).toBe(0);
  });
});

describe('whatsNew', () => {
  it('a first-time player (nothing seen) gets nothing', () => {
    expect(whatsNew(null, '1.0.15')).toEqual([]);
  });
  it('nothing when they have seen this version (or a newer one)', () => {
    expect(whatsNew('1.0.15', '1.0.15')).toEqual([]);
    expect(whatsNew('2.0.0', '1.0.15')).toEqual([]);
  });
  it('every release since the last seen, newest first — never one newer than the running build', () => {
    const list = [
      { version: '1.0.16', notes: ['c'] },
      { version: '1.0.15', notes: ['b'] },
      { version: '1.0.14', notes: ['a'] },
      { version: '1.0.13', notes: ['z'] },
    ];
    expect(whatsNew('1.0.13', '1.0.15', list).map((e) => e.version)).toEqual(['1.0.15', '1.0.14']);
  });
});

describe('the changelog itself', () => {
  it('is newest first, each entry with notes', () => {
    for (let i = 1; i < CHANGELOG.length; i++) expect(compareVersions(CHANGELOG[i - 1]!.version, CHANGELOG[i]!.version)).toBeGreaterThan(0);
    for (const e of CHANGELOG) expect(e.notes.length).toBeGreaterThan(0);
  });
  it('the release has its notes: an entry for the version in package.json', () => {
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
    expect(CHANGELOG.some((e) => e.version === version)).toBe(true);
  });
  it('keeps the language rule (no planning euphemisms)', () => {
    expect(CHANGELOG.flatMap((e) => e.notes).join(' ')).not.toMatch(/blight|urban renewal|redevelop|revitali/i);
  });
});
