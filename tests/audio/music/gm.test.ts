// General MIDI → the contract's instrument set.
import { describe, expect, it } from 'vitest';
import { INSTRUMENTS } from '../../../src/audio/contract';
import { instrumentForProgram, percussionFor } from '../../../src/audio/music/gm';

describe('instrumentForProgram', () => {
  it('maps every GM family to a sensible engine instrument', () => {
    const cases: [number, string | null][] = [
      [0, 'piano'], // Acoustic Grand
      [4, 'piano'], // Electric Piano 1
      [6, 'pluck'], // Harpsichord
      [8, 'bell'], // Celesta
      [12, 'marimba'],
      [19, 'organ'], // Church Organ
      [24, 'pluck'], // Nylon Guitar
      [32, 'bass'],
      [40, 'strings'], // Violin
      [45, 'pluck'], // Pizzicato
      [46, 'harp'],
      [48, 'strings'], // String Ensemble
      [52, 'choir'], // Choir Aahs
      [56, 'horn'], // Trumpet
      [60, 'horn'], // French Horn
      [68, 'oboe'],
      [71, 'oboe'], // Clarinet
      [73, 'flute'],
      [74, 'flute'], // Recorder
      [89, 'pad'], // Warm Pad
      [107, 'pluck'], // Koto
      [112, 'bell'], // Tinkle Bell
      [120, null], // Guitar Fret Noise: SFX bank — dropped
      [127, null], // Gunshot — never in this game's music
    ];
    for (const [program, want] of cases) expect([program, instrumentForProgram(program)]).toEqual([program, want]);
  });

  it('only ever returns instruments the engine provides (or null)', () => {
    for (let p = 0; p < 128; p++) {
      const i = instrumentForProgram(p);
      if (i !== null) expect(INSTRUMENTS).toContain(i);
    }
  });

  it('never voices music through the chant instrument (reserved for recitation)', () => {
    for (let p = 0; p < 128; p++) expect(instrumentForProgram(p)).not.toBe('chant');
  });
});

describe('percussionFor (channel 10, used sparingly)', () => {
  it('maps kick → thud, snare/stick → click, hats → noise, and drops the rest', () => {
    expect(percussionFor(36)).toBe('thud');
    expect(percussionFor(38)).toBe('click');
    expect(percussionFor(42)).toBe('noise');
    expect(percussionFor(49)).toBeNull(); // crash cymbal
    expect(percussionFor(57)).toBeNull();
  });
});
