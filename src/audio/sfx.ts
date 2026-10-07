// SOUND DESIGN — the UI/build cues. Each cue is a tiny SNES-style phrase written as DATA (a list of notes on the
// contract's instruments), played on the 'sfx' bus. Tone: a contemplative game about repair — warm, small,
// never shrill. Arrests make NO sound (Maddy 2026-10-07: "i don't want the tone on arrests" — police violence is
// shown on the map, not scored); the relief grant is ambivalent (a major colour that sinks to minor — it comes with strings).
//
// Built against src/audio/contract.ts only. PURE apart from the player, whose only clock is engine.now().

import type { AudioEngine, InstrumentId } from './contract';
import { BuiltKind, isCommonsKind, isPowerPlant, isRoadKind } from '../engine/fabric';

/** One note of a cue. `offset` is seconds after the cue starts; `pitch` is MIDI (fractional = detune). */
export interface CueNote {
  instrument: InstrumentId;
  pitch: number;
  velocity: number;
  offset: number;
  duration: number;
  pan?: number;
}
export type Cue = readonly CueNote[];

export const PLACE_CATEGORIES = ['road', 'zone', 'civic', 'power', 'commons', 'transit'] as const;
export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

export const CUE_NAMES = [
  'uiClick',
  'uiOpen',
  'uiClose',
  'toolSelect',
  ...PLACE_CATEGORIES.map((c) => `place-${c}` as const),
  'bulldoze',
  'denied',
  'unlock',
  'relief',
  'loanTaken',
] as const;
export type CueName = (typeof CUE_NAMES)[number];

export const SFX_LIMITS = {
  /** Max length of an ordinary cue, seconds. */
  maxCue: 0.95,
  /** Max length of the two long cues (unlock, relief). */
  maxLongCue: 1.6,
  /** Notes in one cue. */
  voicesPerCue: 5,
  /** Simultaneous sfx notes across all cues; a cue that would exceed it is dropped. */
  maxVoices: 10,
  /** No note above this MIDI pitch — nothing shrill. */
  maxPitch: 88,
  /** A painted drag plays at most one place cue per this many seconds. */
  placeInterval: 0.08,
} as const;

export const LONG_CUES: readonly CueName[] = ['unlock', 'relief'];

const n = (instrument: InstrumentId, pitch: number, velocity: number, offset: number, duration: number, pan?: number): CueNote =>
  pan === undefined ? { instrument, pitch, velocity, offset, duration } : { instrument, pitch, velocity, offset, duration, pan };

export const CUES: Readonly<Record<CueName, Cue>> = {
  // UI — wooden, soft, almost tactile.
  uiClick: [n('click', 76, 0.25, 0, 0.04)],
  uiOpen: [n('pluck', 67, 0.22, 0, 0.12), n('pluck', 74, 0.2, 0.05, 0.16)],
  uiClose: [n('pluck', 74, 0.2, 0, 0.12), n('pluck', 67, 0.18, 0.05, 0.16)],
  toolSelect: [n('marimba', 72, 0.28, 0, 0.12), n('click', 79, 0.1, 0, 0.03)],

  // Placing — each kind of thing has its own small material.
  'place-road': [n('thud', 45, 0.35, 0, 0.1), n('click', 64, 0.14, 0.02, 0.04)], // laid stone
  'place-zone': [n('marimba', 67, 0.28, 0, 0.12), n('marimba', 74, 0.22, 0.06, 0.14)], // timber, two knocks
  'place-civic': [n('marimba', 67, 0.24, 0, 0.14), n('bell', 79, 0.2, 0.05, 0.4)], // a doorbell of a public room
  'place-power': [n('thud', 40, 0.3, 0, 0.12), n('organ', 55, 0.14, 0.03, 0.3)], // a hum coming on
  'place-commons': [n('harp', 72, 0.22, 0, 0.3), n('harp', 76, 0.2, 0.05, 0.3), n('harp', 79, 0.18, 0.1, 0.35)], // a gathering
  'place-transit': [n('chime', 76, 0.2, 0, 0.25), n('chime', 81, 0.18, 0.07, 0.3)], // a platform chime

  bulldoze: [n('thud', 36, 0.4, 0, 0.18), n('rumble', 38, 0.35, 0, 0.35)],
  // Can't afford / invalid: a low, soft falling half-step — a shake of the head, not a buzzer.
  denied: [n('pluck', 52, 0.24, 0, 0.1), n('pluck', 51, 0.2, 0.09, 0.14)],

  // A practice granted: a small rising arpeggio and a bell — bright, brief.
  unlock: [
    n('harp', 67, 0.24, 0, 0.35),
    n('harp', 71, 0.22, 0.07, 0.35),
    n('harp', 74, 0.22, 0.14, 0.4),
    n('bell', 79, 0.22, 0.22, 0.9),
    n('chime', 86, 0.1, 0.3, 0.5),
  ],
  // The relief grant: G major under strings, then the oboe answers with B♭ — help, with oversight attached.
  relief: [
    n('strings', 55, 0.22, 0, 1.4),
    n('pad', 62, 0.16, 0, 1.4),
    n('flute', 71, 0.16, 0.1, 0.45),
    n('oboe', 70, 0.2, 0.6, 0.8),
  ],
  // A loan: a coin set down, then a step down — weight taken on.
  loanTaken: [n('marimba', 60, 0.24, 0, 0.14), n('pluck', 55, 0.2, 0.1, 0.25)],
};

/** Seconds from a cue's start to its last note's end. */
export const cueLength = (cue: Cue): number => cue.reduce((m, x) => Math.max(m, x.offset + x.duration), 0);

/** Minimum seconds between two plays of the same rate-limit group. */
const RATE: Readonly<Record<string, number>> = {
  place: SFX_LIMITS.placeInterval,
  bulldoze: 0.08,
  ui: 0.04,
  denied: 0.25,
  unlock: 0.5,
  relief: 2,
  loanTaken: 0.3,
};
const groupOf = (name: CueName): string => {
  if (name.startsWith('place-')) return 'place';
  if (name === 'uiClick' || name === 'uiOpen' || name === 'uiClose' || name === 'toolSelect') return `ui:${name}`;
  return name;
};
const rateOf = (group: string): number => RATE[group.startsWith('ui:') ? 'ui' : group] ?? 0.05;

/** Slight pitch variation for repeated drag cues (semitones), cycled deterministically. */
const DETUNE = [0, 0.4, -0.3, 0.7, -0.6, 0.2, 1, -0.9] as const;
const VARIED: ReadonlySet<string> = new Set(['place', 'bulldoze']);

/** Map a built kind (ToolDef.kind) to its place sound. */
export function placeCategoryOf(kind: number | undefined): PlaceCategory {
  if (kind === undefined) return 'zone';
  if (isRoadKind(kind) || kind === BuiltKind.RoadRamp || kind === BuiltKind.QuietStreet) return 'road';
  if (kind >= 4 && kind <= 15) return kind === BuiltKind.PlantedMedian ? 'commons' : 'transit';
  if (isPowerPlant(kind) || kind === BuiltKind.EnergyNode) return 'power';
  if (isCommonsKind(kind)) return 'commons';
  if (
    kind === BuiltKind.FireStation ||
    kind === BuiltKind.Clinic ||
    kind === BuiltKind.Library ||
    kind === BuiltKind.School ||
    kind === BuiltKind.Civic ||
    kind === BuiltKind.WastewaterWorks ||
    kind === BuiltKind.AINode
  )
    return 'civic';
  return 'zone';
}

export interface Sfx {
  uiClick(): void;
  uiOpen(): void;
  uiClose(): void;
  toolSelect(): void;
  place(category: PlaceCategory): void;
  bulldoze(): void;
  denied(): void;
  unlock(): void;
  relief(): void;
  loanTaken(): void;
  /** Any cue by name. */
  play(name: CueName): void;
}

export function createSfx(engine: AudioEngine): Sfx {
  const lastAt = new Map<string, number>();
  const variation = new Map<string, number>();
  let ends: number[] = []; // end times of scheduled notes (the voice cap)

  const play = (name: CueName): void => {
    const now = engine.now();
    const group = groupOf(name);
    const prev = lastAt.get(group);
    if (prev !== undefined && now - prev < rateOf(group)) return;
    const cue = CUES[name];
    ends = ends.filter((e) => e > now);
    if (ends.length + cue.length > SFX_LIMITS.maxVoices) return;
    let detune = 0;
    if (VARIED.has(group)) {
      const i = variation.get(group) ?? 0;
      detune = DETUNE[i % DETUNE.length]!;
      variation.set(group, i + 1);
    }
    let sounded = false;
    for (const note of cue) {
      const v = engine.play({
        instrument: note.instrument,
        pitch: note.pitch + detune,
        velocity: note.velocity,
        bus: 'sfx',
        at: now + note.offset,
        duration: note.duration,
        ...(note.pan === undefined ? {} : { pan: note.pan }),
      });
      if (v === null && !sounded) return; // locked/muted: don't burn the rate limit on silence
      sounded = true;
      ends.push(now + note.offset + note.duration);
    }
    lastAt.set(group, now);
  };

  return {
    uiClick: () => play('uiClick'),
    uiOpen: () => play('uiOpen'),
    uiClose: () => play('uiClose'),
    toolSelect: () => play('toolSelect'),
    place: (c) => play(`place-${c}`),
    bulldoze: () => play('bulldoze'),
    denied: () => play('denied'),
    unlock: () => play('unlock'),
    relief: () => play('relief'),
    loanTaken: () => play('loanTaken'),
    play,
  };
}
