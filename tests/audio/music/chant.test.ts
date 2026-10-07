// Pali recitation in the Thai Makhot style: syllables, the long/stopped/high-tone rules, and the note data.
import { describe, expect, it } from 'vitest';
import {
  CHANT_PITCH,
  CHANT_TEXTS,
  recite,
  syllabify,
  syllableTones,
} from '../../../src/audio/music/chant';

describe('syllabify (Pali)', () => {
  // the worked examples of the tone-rules guide
  const cases: [string, string[]][] = [
    ['abhivādemi', ['a', 'bhi', 'vā', 'de', 'mi']],
    ['supaṭipanno', ['su', 'pa', 'ṭi', 'pan', 'no']],
    ['sambuddho', ['sam', 'bud', 'dho']],
    ['svākkhāto', ['svāk', 'khā', 'to']],
    ['Ṭhānissaro', ['ṭhā', 'nis', 'sa', 'ro']],
    ['yathājja', ['ya', 'thāj', 'ja']],
    ['daḷhaṁ', ['daḷ', 'haṁ']],
    ['mayhaṁ', ['may', 'haṁ']],
    ['seyyo', ['sey', 'yo']],
    ['Karaṇīyam-attha-kusalena', ['ka', 'ra', 'ṇī', 'ya', 'mat', 'tha', 'ku', 'sa', 'le', 'na']],
    ['gacchāmi', ['gac', 'chā', 'mi']],
    ['yantaṃ', ['yan', 'taṃ']],
  ];
  for (const [word, want] of cases) it(word, () => expect(syllabify(word)).toEqual(want));
});

describe('the high/falling tone (long, unstopped, initial s/h/ch/th/ṭh/kh/ph)', () => {
  const highs = (phrase: string) =>
    syllableTones(phrase)
      .filter((s) => s.tone === 'high')
      .map((s) => s.text);

  it('marks the guide’s high-tone examples', () => {
    expect(highs('sammā')).toEqual(['sam']);
    expect(highs('ahaṁ')).toEqual(['haṁ']);
    expect(highs('kho')).toEqual(['kho']);
    expect(highs('khandho')).toEqual(['khan']);
    expect(highs('yathā')).toEqual(['thā']);
    expect(highs('seyyo')).toEqual(['sey']);
    expect(highs('hoti honti')).toEqual(['ho', 'hon']);
  });

  it('an m after a final s takes the s’s tone', () => {
    expect(highs('tasmā')).toEqual(['mā']);
    expect(highs('āyasmā')).toEqual(['mā']);
  });

  it('stopped long syllables stay on the base pitch', () => {
    expect(highs('sotthi')).toEqual([]);
    expect(highs('khette')).toEqual([]);
    expect(highs('yathājja')).toEqual([]);
  });

  it('short syllables are base; long syllables last longer', () => {
    const s = syllableTones('Buddhaṁ saraṇaṁ gacchāmi');
    expect(s.map((x) => x.text)).toEqual(['bud', 'dhaṁ', 'sa', 'ra', 'ṇaṁ', 'gac', 'chā', 'mi']);
    expect(s.map((x) => x.tone)).toEqual(['base', 'base', 'base', 'base', 'base', 'base', 'high', 'base']);
    expect(s.map((x) => x.long)).toEqual([true, true, false, false, true, true, true, false]);
  });
});

describe('recite', () => {
  it('voices every syllable on the chant channel, in order, aligned to the text', () => {
    for (const text of CHANT_TEXTS) {
      const r = recite(text);
      const chant = r.piece.notes.filter((n) => n.channel === 0);
      expect(chant.length).toBeGreaterThanOrEqual(r.syllables.length);
      for (let i = 1; i < r.syllables.length; i++)
        expect(r.syllables[i]!.time).toBeGreaterThan(r.syllables[i - 1]!.time);
      // every syllable has a note starting at its time
      for (const s of r.syllables) expect(chant.some((n) => Math.abs(n.time - s.time) < 1e-9)).toBe(true);
    }
  });

  it('stays within the reciting tone: base, a whole step above (and nothing else)', () => {
    for (const text of CHANT_TEXTS) {
      const pitches = new Set(recite(text).piece.notes.filter((n) => n.channel === 0).map((n) => n.pitch));
      for (const p of pitches) expect([CHANT_PITCH, CHANT_PITCH + 2]).toContain(p);
    }
  });

  it('is slow and breathes: a pause between lines, under a soft drone an octave below', () => {
    const r = recite(CHANT_TEXTS[0]!);
    const drone = r.piece.notes.filter((n) => n.channel === 1);
    expect(drone.length).toBeGreaterThan(0);
    for (const d of drone) {
      expect(d.pitch).toBe(CHANT_PITCH - 12);
      expect(d.velocity).toBeLessThan(0.5);
    }
    const perSyllable = r.piece.duration / r.syllables.length;
    expect(perSyllable).toBeGreaterThan(0.3);
    // breath: a line's last syllable ends well before the next line's first
    const starts = r.lines.map((l) => l.time);
    expect(starts.length).toBeGreaterThan(1);
    for (let i = 1; i < r.lines.length; i++) {
      const prevEnd = r.lines[i - 1]!.time + r.lines[i - 1]!.duration;
      expect(r.lines[i]!.time - prevEnd).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps the texts with their meanings, and the Namo three times', () => {
    for (const text of CHANT_TEXTS) {
      expect(text.verses.length).toBeGreaterThan(0);
      for (const v of text.verses) {
        expect(v.pali.length).toBeGreaterThan(0);
        expect(v.meaning.length).toBeGreaterThan(10);
      }
    }
    const namo = CHANT_TEXTS[0]!.verses[0]!;
    expect(namo.pali[0]).toBe('Namo tassa bhagavato arahato sammā-sambuddhassa.');
    expect(namo.repeat).toBe(3);
  });
});
