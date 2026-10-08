// The audio CONTRACT (Maddy 2026-10-07: "we need audio … SNES style"). One interface the three halves build
// against: the engine (src/audio/engine*.ts — a small SNES-flavoured synth over WebAudio), the music player
// (src/audio/music/* — Standard MIDI Files through the engine) and the sound design (src/audio/sfx*.ts,
// src/audio/ambience*.ts — UI/build cues and the living city's soundscape). Like the art, every instrument is
// generated in code: short looped waveforms with the SNES's 32 kHz crunch, ADSR envelopes, a gentle low-pass and
// the S-DSP's signature echo. PURE (types and data only).

/** Mixer buses, each with its own volume (Settings: master / music / effects / ambience). */
export type Bus = 'music' | 'sfx' | 'ambience';

/** The engine's instrument set — fixed names so the music map (General MIDI → these) and the sound design can
 *  rely on them. The engine must provide every one. */
export const INSTRUMENTS = [
  // melodic (music)
  'piano',
  'harp',
  'strings',
  'flute',
  'oboe',
  'horn',
  'organ',
  'choir',
  'bell',
  'marimba',
  'bass',
  'pluck',
  'pad',
  // percussive / sound design
  'click',
  'thud',
  'chime',
  'noise', // filtered white noise (wind, rain, traffic hiss — shape it with pitch/duration)
  'rumble', // low filtered noise (traffic bed, machinery)
  'chirp', // short pitched bird call
] as const;
export type InstrumentId = (typeof INSTRUMENTS)[number];

/** One note or sound. `pitch` is a MIDI note number (60 = middle C; for noise instruments it sets the filter
 *  centre). `at` is engine time in seconds (default: now). `duration` omitted = until stopped (loops/ambience). */
export interface NoteSpec {
  instrument: InstrumentId;
  pitch: number;
  /** 0..1 */
  velocity: number;
  bus: Bus;
  at?: number;
  duration?: number;
  /** −1 (left) … +1 (right). */
  pan?: number;
}

/** A sounding note; stop() releases it through its envelope. glide() (optional — engines that can) moves a
 *  long-running voice's level and pitch (for noise: its filter centre) smoothly over `seconds`, so a bed that
 *  follows the city never has to be re-struck (a re-strike is heard as a stray note — Maddy 2026-10-07: "something
 *  atonal going on in the bass notes here and there"). */
export interface Voice {
  stop(at?: number): void;
  glide?(to: { velocity?: number; pitch?: number }, seconds: number): void;
}

export interface AudioEngine {
  /** True once a user gesture has unlocked audio (browsers block sound until then). */
  readonly ready: boolean;
  /** Call from a user gesture (pointerdown/keydown); idempotent. */
  unlock(): void;
  /** The engine clock, seconds (for scheduling music ahead). */
  now(): number;
  /** Play a note (null when not ready, muted, or the voice budget is spent — callers must tolerate null). */
  play(note: NoteSpec): Voice | null;
  setVolume(bus: Bus | 'master', volume: number): void;
  setMuted(muted: boolean): void;
}
