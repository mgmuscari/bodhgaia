// Bridges between pieces (Maddy 2026-10-08: "bridges the midi files to each other through chord resolution and
// tempo changes"): from the chord A ends on, through a short progression, to the dominant of B's key, resolving on
// B's first downbeat — 2 to 4 bars by how far apart the keys are, voiced on the pieces' own instruments, the tempo
// gliding from A's closing tempo to B's opening one.
import { describe, expect, it } from 'vitest';
import type { MidiNote, MidiPiece } from '../../../src/audio/music/midi';
import { bridge, chordAt, fifthsBetween, keyOf, planBridge, type Key } from '../../../src/audio/music/bridge';

const note = (time: number, pitch: number, extra: Partial<MidiNote> = {}): MidiNote => ({
  time,
  duration: 1,
  pitch,
  velocity: 0.6,
  channel: 0,
  program: 0,
  percussion: false,
  ...extra,
});
/** A scale run, then a held tonic chord — enough to read a key and an ending. */
function tune(scale: number[], chord: number[], extra: Partial<MidiNote> = {}, bpm = 120): MidiPiece {
  const notes = [...scale.map((p, i) => note(i * 0.5, p, { duration: 0.5, ...extra }))];
  const end = scale.length * 0.5;
  notes.push(...chord.map((p) => note(end, p, { duration: 2, ...extra })));
  return { notes, duration: end + 2, tempo: { start: bpm, end: bpm } };
}
const C_MAJOR = [60, 62, 64, 65, 67, 69, 71, 72, 67, 64, 60];
const A_MINOR = [57, 59, 60, 62, 64, 65, 68, 69, 64, 60, 57];
const cPiece = (extra: Partial<MidiNote> = {}, bpm = 120) => tune(C_MAJOR, [48, 60, 64, 67], extra, bpm);
const aPiece = (extra: Partial<MidiNote> = {}, bpm = 120) => tune(A_MINOR, [45, 57, 60, 64], extra, bpm);
const transpose = (p: MidiPiece, by: number): MidiPiece => ({ ...p, notes: p.notes.map((n) => ({ ...n, pitch: n.pitch + by })) });

const C: Key = { tonic: 0, minor: false };

describe('reading a piece', () => {
  it('finds the key from its pitch content', () => {
    expect(keyOf(cPiece().notes)).toEqual({ tonic: 0, minor: false });
    expect(keyOf(aPiece().notes)).toEqual({ tonic: 9, minor: true });
    expect(keyOf(transpose(cPiece(), 7).notes)).toEqual({ tonic: 7, minor: false });
  });

  it('a near tie between a key and its dominant goes to the chord the piece closes on (pieces end home)', () => {
    // C major with F# as often as F: as much G major as C major
    const both = [60, 62, 64, 65, 66, 67, 69, 71].map((p, i) => note(i, p));
    const close = (root: number) => keyOf(both, { root, minor: false }).tonic;
    expect([close(0), close(7)]).toEqual([0, 7]);
  });

  it('names the chord sounding in a window', () => {
    expect(chordAt(cPiece().notes, 5.5, 7.5)).toEqual({ root: 0, minor: false });
    expect(chordAt(aPiece().notes, 5.5, 7.5)).toEqual({ root: 9, minor: true });
    expect(chordAt([], 0, 1)).toBeNull();
  });

  it('drums are not pitches', () => {
    const drums = [0, 0.5, 1].map((t) => note(t, 42, { channel: 9, percussion: true }));
    expect(chordAt(drums, 0, 2)).toBeNull();
  });
});

describe('the key distance sets the length', () => {
  it('counts steps around the circle of fifths, a minor key standing with its relative major', () => {
    expect(fifthsBetween(C, { tonic: 7, minor: false })).toBe(1);
    expect(fifthsBetween(C, { tonic: 5, minor: false })).toBe(-1);
    expect(fifthsBetween(C, { tonic: 9, minor: true })).toBe(0);
    expect(Math.abs(fifthsBetween(C, { tonic: 6, minor: false }))).toBe(6);
  });

  it('near keys take 2 bars, middling 3, far 4 — one chord a bar, ending on the dominant seventh of the new key', () => {
    const from = { key: C, chord: { root: 0, minor: false } };
    const near = planBridge(from, { tonic: 7, minor: false });
    const mid = planBridge(from, { tonic: 2, minor: false });
    const far = planBridge(from, { tonic: 4, minor: false });
    expect([near.length, mid.length, far.length]).toEqual([2, 3, 4]);
    for (const [plan, tonic] of [[near, 7], [mid, 2], [far, 4]] as const) {
      expect(plan[plan.length - 1]).toEqual({ root: (tonic + 7) % 12, minor: false, seventh: true });
    }
  });

  it('into a minor key the dominant is still major (the raised leading tone)', () => {
    const plan = planBridge({ key: C, chord: { root: 0, minor: false } }, { tonic: 9, minor: true });
    expect(plan[plan.length - 1]).toEqual({ root: 4, minor: false, seventh: true });
  });
});

describe('the bridge itself', () => {
  const pitched = (p: MidiPiece) => p.notes.filter((n) => !n.percussion);

  it('lasts its bars at a steady tempo, and resolves into B when it ends', () => {
    const b = bridge({ piece: cPiece({}, 60), at: cPiece().duration }, { piece: transpose(cPiece({}, 60), 7) });
    expect(b.duration).toBeCloseTo(2 * 4 * 1); // 2 bars of 4 beats at 60 bpm
    for (const n of b.notes) expect(n.time + n.duration).toBeLessThanOrEqual(b.duration + 1e-9);
  });

  it('glides the tempo: from 60 into 120, every beat a little quicker than the last', () => {
    const b = bridge({ piece: cPiece({}, 60), at: cPiece().duration }, { piece: transpose(cPiece({}, 120), 7) });
    expect(b.duration).toBeGreaterThan(4); // all at 120 would be 4 s
    expect(b.duration).toBeLessThan(8); // all at 60 would be 8 s
    const bass = b.notes.filter((n) => n.channel === 2).map((n) => n.time);
    const gaps = bass.slice(1).map((t, i) => t - bass[i]!);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeLessThan(gaps[i - 1]!);
  });

  it('borrows the instruments: A’s voice opens it, B’s closes it', () => {
    const a = cPiece({ program: 40 }); // a violin
    const bb = transpose(cPiece({ program: 73 }), 4); // a flute, far away (E)
    const b = bridge({ piece: a, at: a.duration }, { piece: bb });
    const first = pitched(b).filter((n) => n.time < 0.01);
    const last = pitched(b).filter((n) => n.time > b.duration - 2.5);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((n) => n.program === 40)).toBe(true);
    expect(last.every((n) => n.program === 73)).toBe(true);
  });

  it('voices lead smoothly, and the last chord holds the new key’s leading tone', () => {
    const b = bridge({ piece: cPiece(), at: cPiece().duration }, { piece: transpose(cPiece(), 4) });
    const onsets = [...new Set(b.notes.filter((n) => n.channel !== 2).map((n) => n.time))].sort((x, y) => x - y);
    const chords = onsets.map((t) => b.notes.filter((n) => n.channel !== 2 && n.time === t && n.duration > 0.5).map((n) => n.pitch).sort((x, y) => x - y)).filter((c) => c.length === 3);
    expect(chords.length).toBe(4);
    for (let i = 1; i < chords.length; i++) for (let v = 0; v < 3; v++) expect(Math.abs(chords[i]![v]! - chords[i - 1]![v]!)).toBeLessThanOrEqual(7);
    expect(chords[chords.length - 1]!.map((p) => p % 12)).toContain((4 + 11) % 12); // D#, leading tone of E
  });

  it('it resolves onto the chord B opens with, not just B’s key: a C-major piece opening on A minor gets E7', () => {
    const opensOnAm: MidiPiece = { ...cPiece(), notes: [...[45, 57, 60, 64].map((p) => note(0, p, { duration: 2 })), ...cPiece().notes.map((n) => ({ ...n, time: n.time + 2 }))] };
    opensOnAm.duration += 2;
    const b = bridge({ piece: cPiece(), at: cPiece().duration }, { piece: opensOnAm });
    const lastOnset = Math.max(...b.notes.filter((n) => n.channel === 1).map((n) => n.time));
    const last = b.notes.filter((n) => n.time === lastOnset && n.channel !== 2).map((n) => n.pitch % 12);
    expect(last).toContain(8); // G#: E7's third, the leading tone of A
  });

  it('the same pair always gets the same bridge', () => {
    const make = () => bridge({ piece: aPiece(), at: 3 }, { piece: transpose(cPiece({ program: 11 }), 2) });
    expect(make()).toEqual(make());
  });

  it('out of silence or drums, it still finds its way to B', () => {
    const drums: MidiPiece = { notes: [note(0, 42, { channel: 9, percussion: true })], duration: 1 };
    const b = bridge({ piece: drums, at: 1 }, { piece: cPiece() });
    expect(b.duration).toBeGreaterThan(0);
    expect(pitched(b).length).toBeGreaterThan(0);
  });
});
