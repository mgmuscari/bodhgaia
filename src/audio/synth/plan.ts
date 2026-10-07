// A note's plan (PURE): everything the WebAudio shell needs to sound a contract NoteSpec on a baked instrument —
// when it starts, its playback rate (or, for noise, its filter centre), its pan, its envelope automation and when
// it falls silent. Keeping this pure leaves the engine shell a thin replay of the plan.

import type { NoteSpec } from '../contract';
import { SAMPLE_RATE, pitchToRate } from './dsp';
import { envelopeAt, envelopeSchedule, releaseEnd, type EnvEvent, type Envelope } from './envelope';
import { noiseFilterHz, type InstrumentSample } from './instruments';

export interface VoicePlan {
  start: number;
  rate: number;
  /** Noise instruments: the filter centre (Hz); tonal ones: null. */
  filterHz: number | null;
  pan: number;
  peak: number;
  velocity: number;
  /** Gate-off time from the note's duration (undefined = held until stop()). */
  stopAt?: number;
  /** When the voice is silent (Infinity while a looped voice is held). */
  end: number;
  events: EnvEvent[];
  envelope: Envelope;
}

const clamp = (v: number, lo: number, hi: number, dflt: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;

export function planVoice(s: InstrumentSample, note: NoteSpec, now: number): VoicePlan {
  const start = Math.max(now, Number.isFinite(note.at) ? note.at! : now);
  const pitch = clamp(note.pitch, 0, 127, 60);
  const velocity = clamp(note.velocity, 0, 1, 0);
  const rate = s.noise ? 1 : clamp(pitchToRate(pitch, s.rootHz), 1 / 64, 16, 1);
  const stopAt = note.duration !== undefined ? start + clamp(note.duration, 0, 3600, 0) : undefined;
  const natural = s.loop ? Infinity : start + s.data.length / SAMPLE_RATE / rate;
  const end = Math.min(natural, stopAt !== undefined ? releaseEnd(s.envelope, stopAt) : Infinity);
  const peak = velocity * s.gain;
  return {
    start,
    rate,
    filterHz: s.noise ? noiseFilterHz(s, pitch) : null,
    pan: clamp(note.pan ?? 0, -1, 1, 0),
    peak,
    velocity,
    ...(stopAt !== undefined ? { stopAt } : {}),
    end,
    events: envelopeSchedule(s.envelope, start, peak, stopAt),
    envelope: s.envelope,
  };
}

/** The voice's envelope level at engine time `t`, gated off at `off` (engine time) if given. */
export function levelAt(p: VoicePlan, t: number, off = p.stopAt): number {
  return envelopeAt(p.envelope, t - p.start, p.peak, off === undefined ? undefined : off - p.start);
}
