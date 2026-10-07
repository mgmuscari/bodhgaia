// SOUND DESIGN — the living city's soundscape, on the 'ambience' bus. The host builds a small plain snapshot a few
// times a second; this module turns it into:
//   • BEDS — long-running open voices (a low 'rumble' traffic bed, soft 'noise' wind, rain, a crowd murmur). The
//     contract's Voice can't be re-levelled, so a bed changes level by CROSSFADE: start a new voice at the new
//     level, release the old through its envelope. Levels are smoothed (one-pole, AMBIENCE.tau) and only re-voiced
//     on a quantized step (AMBIENCE.levelStep) no faster than AMBIENCE.minRevoice — so a surge ramps in gentle
//     steps, and a steady city settles to zero new voices.
//   • EVENTS — sparse short calls: birdsong ('chirp', fewer at night and in rain), night crickets (soft 'click'
//     trills), and the odd wind-chime where healing is happening near the camera.
// Tone: warm and small. Hardship is not turned into a sound effect — exposure (unhoused01) only sharpens the wind.
//
// Built against src/audio/contract.ts only. ambienceTargets is pure; the scheduler's clock is engine.now() and its
// randomness a seeded generator (deterministic for a seed; no Math.random).

import type { AudioEngine, InstrumentId, Voice } from './contract';

/** What the host tells the soundscape — all cheap aggregates near the camera (0..1; out-of-range is clamped). */
export interface AmbienceSnapshot {
  /** Traffic density (moving cars in view / some saturating count). */
  traffic01: number;
  /** Pedestrians in view. */
  peds01: number;
  /** Birdlife / greenness in view (live birds, canopy, rewilded land). */
  birds01: number;
  rain: boolean;
  night: boolean;
  /** Unhoused share citywide — sharpens the wind a touch, nothing more. */
  unhoused01?: number;
  /** Healing / commons activity near the camera — an occasional wind-chime. */
  healing01?: number;
}

export const BEDS = ['traffic', 'wind', 'rain', 'crowd'] as const;
export type BedId = (typeof BEDS)[number];

export interface BedTarget {
  /** Velocity of the bed voice, 0..AMBIENCE.maxBedLevel (0 = silent / stopped). */
  level: number;
  /** MIDI pitch — for the noise instruments, the filter centre. */
  pitch: number;
}

export type AmbienceTargets = Record<BedId, BedTarget> & {
  /** Expected bird phrases per second. */
  birdRate: number;
  /** Expected cricket trills per second. */
  cricketRate: number;
  /** Expected wind-chimes per second. */
  chimeRate: number;
};

export const AMBIENCE = {
  /** Seconds a bed glides to a new level/pitch (engines that support Voice.glide). */
  glide: 1.0,
  maxBedLevel: 0.45,
  /** Smoothing time constant for bed levels/pitches, seconds. */
  tau: 2,
  /** A bed is re-voiced only when its smoothed level drifts this far from the sounding voice… */
  levelStep: 0.04,
  /** …or its pitch this many semitones… */
  pitchStep: 1,
  /** …and no more often than this, seconds. */
  minRevoice: 0.5,
  /** Below this a bed is stopped. */
  minLevel: 0.01,
  /** Updates further apart than this (a backgrounded tab) are treated as this long. */
  maxDt: 1,
} as const;

const BED_INSTRUMENT: Readonly<Record<BedId, InstrumentId>> = { traffic: 'rumble', wind: 'noise', rain: 'noise', crowd: 'noise' };
const BED_PAN: Readonly<Record<BedId, number>> = { traffic: 0, wind: -0.2, rain: 0.1, crowd: 0.15 };

const c01 = (x: number | undefined): number => (x === undefined || !(x >= 0) ? 0 : x > 1 ? 1 : x);

/** Snapshot → target bed levels and event rates. PURE. */
export function ambienceTargets(s: AmbienceSnapshot): AmbienceTargets {
  const t = c01(s.traffic01);
  const p = c01(s.peds01);
  const b = c01(s.birds01);
  const u = c01(s.unhoused01);
  const h = c01(s.healing01);
  const night = s.night;
  const rain = s.rain;
  return {
    traffic: { level: t > 0.01 ? (0.06 + 0.34 * t) * (night ? 0.7 : 1) : 0, pitch: 33 + 12 * t },
    wind: { level: 0.05 + 0.04 * (1 - t) + (rain ? 0.04 : 0) + 0.04 * u, pitch: night ? 45 : 48 },
    rain: { level: rain ? 0.28 : 0, pitch: 79 },
    crowd: { level: 0.12 * p * (night ? 0.5 : 1), pitch: 64 },
    birdRate: 0.7 * b * (night ? 0.1 : 1) * (rain ? 0.3 : 1) * (1 - 0.4 * t),
    cricketRate: night ? 1.2 * (0.3 + 0.7 * b) * (rain ? 0.2 : 1) * (1 - 0.5 * t) : 0,
    chimeRate: 0.12 * h * (rain ? 0.5 : 1),
  };
}

export interface Ambience {
  /** Feed the latest snapshot (a few times a second). */
  update(s: AmbienceSnapshot): void;
  /** Release every bed (pause / tab hidden / ambience off). The next update() brings them back. */
  stop(): void;
}

export interface AmbienceOptions {
  /** Seed for the event randomness (deterministic per seed). */
  seed?: number;
}

/** mulberry32 — a tiny seeded generator, [0, 1). */
function rng32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

interface BedState {
  level: number;
  pitch: number;
  voice: Voice | null;
  voiceLevel: number;
  voicePitch: number;
  lastRevoice: number;
}

const BIRD_PITCHES = [79, 81, 84, 86, 88] as const;
const CHIME_PITCHES = [72, 74, 76, 79, 81, 84] as const; // pentatonic

export function createAmbience(engine: AudioEngine, opts: AmbienceOptions = {}): Ambience {
  const rnd = rng32(opts.seed ?? 0x5eed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const beds = Object.fromEntries(
    BEDS.map((id) => [id, { level: 0, pitch: 0, voice: null, voiceLevel: 0, voicePitch: 0, lastRevoice: -Infinity }]),
  ) as Record<BedId, BedState>;
  let last: number | null = null;

  const note = (instrument: InstrumentId, pitch: number, velocity: number, at: number, duration: number, pan: number): void => {
    engine.play({ instrument, pitch, velocity, bus: 'ambience', at, duration, pan });
  };

  const stepBed = (id: BedId, target: BedTarget, k: number, now: number): void => {
    const b = beds[id];
    b.level += (target.level - b.level) * k;
    b.pitch = b.voice === null ? target.pitch : b.pitch + (target.pitch - b.pitch) * k;
    if (b.level < AMBIENCE.minLevel) {
      if (b.voice) b.voice.stop(now);
      b.voice = null;
      return;
    }
    const drifted = Math.abs(b.level - b.voiceLevel) >= AMBIENCE.levelStep || Math.abs(b.pitch - b.voicePitch) >= AMBIENCE.pitchStep;
    if (b.voice !== null && !drifted) return;
    // a voice that can glide is struck once and moved smoothly after — a re-strike is heard as a stray note
    if (b.voice?.glide) {
      b.voice.glide({ velocity: b.level, pitch: b.pitch }, AMBIENCE.glide);
      b.voiceLevel = b.level;
      b.voicePitch = b.pitch;
      return;
    }
    if (now - b.lastRevoice < AMBIENCE.minRevoice) return;
    const v = engine.play({ instrument: BED_INSTRUMENT[id], pitch: b.pitch, velocity: b.level, bus: 'ambience', pan: BED_PAN[id] });
    if (v === null) return; // locked/budget: keep whatever is sounding and try again next update
    if (b.voice) b.voice.stop(now); // the crossfade: the old voice releases as the new one attacks
    b.voice = v;
    b.voiceLevel = b.level;
    b.voicePitch = b.pitch;
    b.lastRevoice = now;
  };

  const events = (g: AmbienceTargets, dt: number, now: number): void => {
    if (rnd() < g.birdRate * dt) {
      const pan = rnd() * 1.6 - 0.8;
      const calls = 1 + Math.floor(rnd() * 3);
      const base = pick(BIRD_PITCHES);
      for (let i = 0; i < calls; i++)
        note('chirp', base + (i % 2 === 1 ? -2 : 0), 0.1 + rnd() * 0.1, now + 0.02 + i * 0.11, 0.08, pan);
    }
    if (rnd() < g.cricketRate * dt) {
      const pan = rnd() * 1.4 - 0.7;
      for (let i = 0; i < 3; i++) note('click', 84, 0.05, now + 0.02 + i * 0.05, 0.02, pan);
    }
    if (rnd() < g.chimeRate * dt) note('chime', pick(CHIME_PITCHES), 0.1, now + 0.02, 1.2, rnd() * 1.2 - 0.6);
  };

  return {
    update(s) {
      const now = engine.now();
      const dt = last === null ? 0 : Math.min(AMBIENCE.maxDt, Math.max(0, now - last));
      last = now;
      const g = ambienceTargets(s);
      const k = Math.min(1, dt / AMBIENCE.tau);
      for (const id of BEDS) stepBed(id, g[id], k, now);
      if (dt > 0 && engine.ready) events(g, dt, now);
    },
    stop() {
      const now = engine.now();
      for (const id of BEDS) {
        const b = beds[id];
        if (b.voice) b.voice.stop(now);
        b.voice = null;
        b.lastRevoice = -Infinity;
      }
    },
  };
}
