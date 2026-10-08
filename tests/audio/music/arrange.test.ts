// The arranger (Maddy 2026-10-08: "rearrange the classical music to the style of these tracks"): a solo-piano score
// becomes an ensemble in the shape of her arrangements — lead and counter-line, comp, pad, colour, bass, a soft drum
// groove — keeping the composer's melody, harmony, meter and tempo.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMidi } from '../../../src/audio/music/midi';
import { arrange, readScore, writeMidi, STYLES, type Arrangement } from '../../../src/audio/music/arrange';

const src = new Uint8Array(readFileSync('assets/music-originals/satie-gymnopedie-1.mid'));
const plan: Arrangement = { style: 'waltz', title: 'Gymnopédie No. 1', lead: 73, counter: 71, comp: 4, pad: 48, colour: 11, bass: 32, bells: 8 };
const out = arrange(src, plan);
const piece = parseMidi(out);
const score = readScore(src);
const on = (ch: number) => piece.notes.filter((n) => n.channel === ch);

describe('the MIDI writer', () => {
  it('writes what the player reads back: notes, channels, programs, tempo', () => {
    const bytes = writeMidi({
      division: 480,
      tempos: [{ tick: 0, usPerQuarter: 1_000_000 }],
      meters: [{ tick: 0, num: 4, den: 4 }],
      markers: [{ tick: 0, text: 'loopStart' }],
      tracks: [{ name: 'lead', channel: 0, program: 73, notes: [{ tick: 480, dur: 480, pitch: 72, vel: 100 }] }],
    });
    const p = parseMidi(bytes);
    expect(p.notes).toHaveLength(1);
    expect(p.notes[0]!.time).toBeCloseTo(1, 6); // a beat at 60 bpm
    expect(p.notes[0]!.duration).toBeCloseTo(1, 6);
    expect(p.notes[0]!.program).toBe(73);
    expect(p.notes[0]!.pitch).toBe(72);
  });
});

describe('an arrangement', () => {
  it('is an ensemble in her shape: lead, counter, comp, pad, colour, bass, bells, drums', () => {
    for (const ch of [0, 1, 2, 3, 4, 5, 6, 9]) expect(on(ch).length, `ch${ch}`).toBeGreaterThan(0);
    expect(on(0)[0]!.program).toBe(73);
    expect(on(5)[0]!.program).toBe(32);
    expect(on(9).every((n) => n.percussion)).toBe(true);
  });

  it("keeps the composer's melody, note for note, on the lead", () => {
    const melody = score.melody;
    expect(melody.length).toBeGreaterThan(50);
    const lead = on(0);
    expect(lead).toHaveLength(melody.length);
    const sec = (tick: number) => (tick / score.division) * (score.tempos[0]!.usPerQuarter / 1e6);
    lead.forEach((n, i) => {
      expect(n.pitch).toBe(melody[i]!.pitch);
      expect(n.time).toBeCloseTo(sec(melody[i]!.tick), 3);
    });
  });

  it('voices only the harmony sounding in the score: comp and pad pitch classes are the beat’s own', () => {
    const sec = (tick: number) => (tick / score.division) * (score.tempos[0]!.usPerQuarter / 1e6);
    const soundingAt = (t: number, len: number) =>
      new Set(score.notes.filter((s) => sec(s.tick) < t + len - 1e-6 && sec(s.tick + s.dur) > t + 1e-6).map((s) => s.pitch % 12));
    for (const n of [...on(2), ...on(3)]) {
      const bar = sec(score.division * 3); // a 3/4 bar
      const t0 = Math.floor(n.time / bar + 1e-9) * bar;
      expect(soundingAt(t0, bar).has(n.pitch % 12), `${n.channel}@${n.time.toFixed(2)} ${n.pitch}`).toBe(true);
    }
  });

  it('sits each part in its register, at her balance', () => {
    for (const n of on(5)) expect(n.pitch).toBeGreaterThanOrEqual(28), expect(n.pitch).toBeLessThanOrEqual(52);
    for (const n of on(3)) expect(n.pitch).toBeGreaterThanOrEqual(48), expect(n.pitch).toBeLessThanOrEqual(70);
    const vel = (ch: number) => on(ch).reduce((s, n) => s + n.velocity, 0) / on(ch).length;
    expect(vel(0)).toBeGreaterThan(vel(2)); // the lead over the comp
    expect(vel(2)).toBeGreaterThan(vel(3)); // the comp over the pad
    expect(vel(9)).toBeLessThan(vel(0)); // soft drums
  });

  it('grooves through every bar, and lasts as long as the score', () => {
    const src0 = parseMidi(src); // the score the arrangement came from
    expect(piece.duration).toBeGreaterThan(src0.duration * 0.97);
    expect(piece.duration).toBeLessThan(src0.duration * 1.05);
    const bar = (score.division * 3 * score.tempos[0]!.usPerQuarter) / score.division / 1e6;
    const bars = Math.floor(src0.duration / bar);
    for (let b = 0; b < bars; b++) expect(on(9).some((n) => n.time >= b * bar - 1e-6 && n.time < (b + 1) * bar - 1e-6), `bar ${b}`).toBe(true);
  });

  it('carries the loop markers and a title, as hers do', () => {
    const text = new TextDecoder('latin1').decode(out);
    expect(text).toContain('loopStart');
    expect(text).toContain('loopEnd');
    expect(text).toContain('Gymnopédie No. 1');
  });

  it('every style knows how to fill a bar', () => {
    expect(Object.keys(STYLES).sort()).toEqual(['ballad', 'bossa', 'swing', 'waltz']);
  });
});
