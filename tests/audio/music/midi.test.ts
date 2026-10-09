// The Standard MIDI File parser: bytes → a flat, time-sorted list of notes in seconds.
import { describe, expect, it } from 'vitest';
import { parseMidi } from '../../../src/audio/music/midi';

// ---- tiny SMF writer for the tests ----
function vlq(n: number): number[] {
  const out = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    out.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return out;
}
function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function chunk(id: string, body: number[]): number[] {
  return [...[...id].map((c) => c.charCodeAt(0)), ...u32(body.length), ...body];
}
function header(format: number, ntracks: number, division: number): number[] {
  return chunk('MThd', [0, format, 0, ntracks, (division >> 8) & 0xff, division & 0xff]);
}
/** events: [deltaTicks, ...bytes] */
function track(events: number[][]): number[] {
  const body: number[] = [];
  for (const [delta = 0, ...bytes] of events) body.push(...vlq(delta), ...bytes);
  body.push(0, 0xff, 0x2f, 0); // end of track
  return chunk('MTrk', body);
}
function tempo(usPerQuarter: number): number[] {
  return [0xff, 0x51, 3, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff];
}
const smf = (...parts: number[][]) => new Uint8Array(parts.flat());

describe('parseMidi', () => {
  it('parses a format-0 file at the default tempo (120 bpm) into seconds', () => {
    const bytes = smf(
      header(0, 1, 480),
      track([
        [0, 0x90, 60, 100],
        [480, 0x80, 60, 0], // one quarter = 0.5 s at 120 bpm
        [0, 0x90, 64, 64],
        [960, 0x80, 64, 0],
      ]),
    );
    const piece = parseMidi(bytes);
    expect(piece.notes).toHaveLength(2);
    expect(piece.notes[0]).toMatchObject({ pitch: 60, time: 0, duration: 0.5, channel: 0, program: 0 });
    expect(piece.notes[0]!.velocity).toBeCloseTo(100 / 127);
    expect(piece.notes[1]).toMatchObject({ pitch: 64, time: 0.5, duration: 1 });
    expect(piece.duration).toBeCloseTo(1.5);
  });

  it('honours running status and velocity-0 note-offs', () => {
    const bytes = smf(
      header(0, 1, 96),
      track([
        [0, 0x90, 60, 80],
        [0, 67, 80], // running status: another note-on
        [96, 60, 0], // vel 0 = note off
        [0, 67, 0],
      ]),
    );
    const notes = parseMidi(bytes).notes;
    expect(notes.map((n) => n.pitch).sort()).toEqual([60, 67]);
    for (const n of notes) expect(n.duration).toBeCloseTo(0.5);
  });

  it('applies tempo changes mid-piece (format 1: tempo map in track 0 governs every track)', () => {
    const bytes = smf(
      header(1, 2, 100),
      track([
        [0, ...tempo(1_000_000)], // 60 bpm: one quarter = 1 s
        [200, ...tempo(500_000)], // after 2 s → 120 bpm
      ]),
      track([
        [0, 0x91, 50, 90],
        [100, 0x81, 50, 0], // 0..1 s
        [100, 0x91, 52, 90], // starts at 2 s
        [100, 0x81, 52, 0], // 100 ticks at 120 bpm = 0.5 s
        [0, 0x91, 53, 90],
        [200, 0x81, 53, 0], // 2.5..3.5
      ]),
    );
    const notes = parseMidi(bytes).notes;
    expect(notes.map((n) => [n.pitch, +n.time.toFixed(3), +n.duration.toFixed(3)])).toEqual([
      [50, 0, 1],
      [52, 2, 0.5],
      [53, 2.5, 1],
    ]);
    expect(notes[0]!.channel).toBe(1);
  });

  it('tracks program changes per channel and flags channel 10 as percussion', () => {
    const bytes = smf(
      header(1, 2, 480),
      track([
        [0, 0xc0, 40], // ch0: violin
        [0, 0xc3, 73], // ch3: flute
        [0, 0x90, 60, 100],
        [0, 0x93, 72, 100],
        [480, 0x80, 60, 0],
        [0, 0x83, 72, 0],
        [0, 0xc0, 0], // ch0 back to piano
        [0, 0x90, 62, 100],
        [480, 0x80, 62, 0],
      ]),
      track([
        [0, 0x99, 36, 100], // channel 10 (index 9)
        [10, 0x89, 36, 0],
      ]),
    );
    const notes = parseMidi(bytes).notes;
    const by = (p: number) => notes.find((n) => n.pitch === p)!;
    expect(by(60)).toMatchObject({ program: 40, percussion: false });
    expect(by(72)).toMatchObject({ program: 73, channel: 3 });
    expect(by(62)).toMatchObject({ program: 0 });
    expect(by(36)).toMatchObject({ channel: 9, percussion: true });
  });

  it('skips sysex, meta text and controller events; sorts notes by time', () => {
    const bytes = smf(
      header(1, 2, 480),
      track([
        [0, 0xff, 0x03, 4, 0x54, 0x65, 0x73, 0x74], // track name "Test"
        [0, 0xf0, 3, 1, 2, 0xf7], // sysex
        [0, 0xb0, 7, 100], // controller
        [0, 0xe0, 0, 64], // pitch bend
        [480, 0x90, 70, 100],
        [480, 0x80, 70, 0],
      ]),
      track([
        [0, 0x90, 40, 100],
        [240, 0x80, 40, 0],
      ]),
    );
    const piece = parseMidi(bytes);
    expect(piece.notes.map((n) => n.pitch)).toEqual([40, 70]);
  });

  it('closes notes left hanging at end of track, and handles repeated same-pitch overlaps FIFO', () => {
    const bytes = smf(
      header(0, 1, 480),
      track([
        [0, 0x90, 60, 100],
        [480, 0x90, 60, 100], // re-strike before release
        [480, 0x80, 60, 0], // closes the first
        [480, 0x80, 60, 0], // closes the second
        [0, 0x90, 61, 100], // never released
        [480, 0xb0, 1, 1],
      ]),
    );
    const notes = parseMidi(bytes).notes;
    expect(notes.map((n) => [n.pitch, n.time, n.duration])).toEqual([
      [60, 0, 1],
      [60, 0.5, 1],
      [61, 1.5, 0.5],
    ]);
  });

  it('rejects data that is not a Standard MIDI File', () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3, 4]))).toThrow(/MIDI/);
  });
});

// The bridges between pieces glide from one tempo to the next (Maddy 2026-10-08), so a piece keeps the tempo it
// opens at and the tempo it closes at, in beats per minute.
describe('parseMidi keeps the opening and closing tempo', () => {
  it('a piece that slows from 120 to 60 bpm opens at 120 and closes at 60', () => {
    const bytes = smf(
      header(0, 1, 480),
      track([
        [0, ...tempo(500_000)],
        [0, 0x90, 60, 100],
        [480, 0x80, 60, 0],
        [0, ...tempo(1_000_000)],
        [0, 0x90, 62, 100],
        [480, 0x80, 62, 0],
      ]),
    );
    const p = parseMidi(bytes);
    expect(p.tempo).toEqual({ start: 120, end: 60 });
  });

  it('with no Set Tempo at all, both ends are the default 120', () => {
    const p = parseMidi(smf(header(0, 1, 480), track([[0, 0x90, 60, 100], [480, 0x80, 60, 0]])));
    expect(p.tempo).toEqual({ start: 120, end: 120 });
  });
});
