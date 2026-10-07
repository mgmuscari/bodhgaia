import { describe, it, expect } from 'vitest';
import { planVoice, levelAt } from '../../src/audio/synth/plan';
import { bakeInstrument } from '../../src/audio/synth/instruments';
import { envelopeAt } from '../../src/audio/synth/envelope';
import { midiToHz, SAMPLE_RATE } from '../../src/audio/synth/dsp';

// planVoice turns a contract NoteSpec into everything the WebAudio shell needs (start, rate, filter, pan, the
// envelope automation and when the voice falls silent) — so the shell only replays it.

const piano = bakeInstrument('piano');
const noise = bakeInstrument('noise');
const click = bakeInstrument('click');

describe('planVoice', () => {
  it('pitches tonal instruments by playback rate from the sample root', () => {
    const p = planVoice(piano, { instrument: 'piano', pitch: 72, velocity: 1, bus: 'music' }, 5);
    expect(p.rate).toBeCloseTo(midiToHz(72) / piano.rootHz, 9);
    expect(p.filterHz).toBeNull();
  });

  it('noise plays at rate 1 and the pitch sets the filter centre', () => {
    const p = planVoice(noise, { instrument: 'noise', pitch: 69, velocity: 1, bus: 'ambience' }, 0);
    expect(p.rate).toBe(1);
    expect(p.filterHz).toBeCloseTo(440, 6);
  });

  it('never schedules in the past; `at` in the future is honoured', () => {
    expect(planVoice(piano, { instrument: 'piano', pitch: 60, velocity: 1, bus: 'music', at: 1 }, 5).start).toBe(5);
    expect(planVoice(piano, { instrument: 'piano', pitch: 60, velocity: 1, bus: 'music', at: 7 }, 5).start).toBe(7);
  });

  it('peak = velocity × instrument gain, clamped; pan clamped; garbage pitch tolerated', () => {
    const p = planVoice(piano, { instrument: 'piano', pitch: NaN, velocity: 3, bus: 'music', pan: -9 }, 0);
    expect(p.peak).toBeCloseTo(piano.gain, 9);
    expect(p.pan).toBe(-1);
    expect(Number.isFinite(p.rate)).toBe(true);
    expect(p.rate).toBeGreaterThan(0);
  });

  it('a duration gates off and releases; the voice ends when the release does', () => {
    const p = planVoice(piano, { instrument: 'piano', pitch: 60, velocity: 0.5, bus: 'music', at: 2, duration: 1 }, 0);
    expect(p.stopAt).toBe(3);
    expect(p.end).toBeCloseTo(3 + piano.envelope.release, 9);
    expect(p.events.at(-1)).toEqual({ kind: 'linear', t: p.end, v: 0 });
  });

  it('a held looped voice (no duration) never ends on its own', () => {
    const p = planVoice(noise, { instrument: 'noise', pitch: 60, velocity: 0.5, bus: 'ambience' }, 0);
    expect(p.stopAt).toBeUndefined();
    expect(p.end).toBe(Infinity);
  });

  it('a one-shot ends when its sample runs out (at its playback rate)', () => {
    const p = planVoice(click, { instrument: 'click', pitch: 84, velocity: 1, bus: 'sfx' }, 1);
    expect(p.end).toBeCloseTo(1 + click.data.length / SAMPLE_RATE / p.rate, 9);
  });

  it('levelAt follows the envelope, including a later gate-off', () => {
    const p = planVoice(piano, { instrument: 'piano', pitch: 60, velocity: 1, bus: 'music', at: 1 }, 0);
    expect(levelAt(p, 1.5)).toBeCloseTo(envelopeAt(piano.envelope, 0.5, p.peak), 9);
    expect(levelAt(p, 1.5, 1.2)).toBeCloseTo(envelopeAt(piano.envelope, 0.5, p.peak, 0.2), 9);
    expect(levelAt(p, 0.5)).toBe(0);
  });
});

// Voice.glide (Maddy 2026-10-07: re-struck beds were heard as stray bass notes): what a glide moves to.
import { glideTargets } from '../../src/audio/synth/plan';
describe('glide targets', () => {
  it('a level change is a gain RATIO against the note as struck (so the envelope stays untouched)', () => {
    const s = bakeInstrument('strings');
    expect(glideTargets(s, 0.4, { velocity: 0.8 }).gain).toBeCloseTo(2, 9);
    expect(glideTargets(s, 0.4, { velocity: 0 }).gain).toBe(0);
  });
  it('a pitch change moves a tonal voice\'s playback rate, a noise voice\'s filter centre', () => {
    const tonal = glideTargets(bakeInstrument('strings'), 0.5, { pitch: 69 });
    expect(tonal.rate).toBeGreaterThan(0);
    expect(tonal.filterHz).toBeUndefined();
    const noise = glideTargets(bakeInstrument('rumble'), 0.5, { pitch: 40 });
    expect(noise.rate).toBeUndefined();
    expect(noise.filterHz).toBeGreaterThan(0);
  });
});
