// General MIDI program → the engine's instrument set (PURE). One table, by GM family with the exceptions that
// matter for the classical repertoire. The sound-effects bank (120..127) is dropped: this is background music.
import type { InstrumentId } from '../contract';

const OVERRIDES: Record<number, InstrumentId> = {
  6: 'pluck', // harpsichord
  7: 'pluck', // clavinet
  11: 'bell', // vibraphone
  12: 'marimba',
  13: 'marimba', // xylophone
  15: 'pluck', // dulcimer
  45: 'pluck', // pizzicato strings
  46: 'harp', // orchestral harp
  47: 'bass', // timpani
  52: 'choir', // choir aahs
  53: 'choir', // voice oohs
  54: 'choir', // synth voice
  108: 'marimba', // kalimba
  109: 'oboe', // bagpipe
  110: 'strings', // fiddle
  111: 'oboe', // shanai
  112: 'bell', // tinkle bell
  113: 'bell', // agogo
  114: 'marimba', // steel drums
  115: 'click', // woodblock
  116: 'thud', // taiko
  117: 'thud', // melodic tom
  118: 'thud', // synth drum
};

/** GM family (program >> 3) → instrument. */
const FAMILY: (InstrumentId | null)[] = [
  'piano', // 0 piano
  'bell', // 1 chromatic percussion
  'organ', // 2 organ
  'pluck', // 3 guitar
  'bass', // 4 bass
  'strings', // 5 strings
  'strings', // 6 ensemble
  'horn', // 7 brass
  'oboe', // 8 reed
  'flute', // 9 pipe
  'flute', // 10 synth lead
  'pad', // 11 synth pad
  'pad', // 12 synth effects
  'pluck', // 13 ethnic
  'thud', // 14 percussive
  null, // 15 sound effects
];

export function instrumentForProgram(program: number): InstrumentId | null {
  const p = program & 0x7f;
  return OVERRIDES[p] ?? FAMILY[p >> 3] ?? null;
}

/** GM percussion key (channel 10) → a soft engine sound, or null to drop it. Only the time-keepers survive. */
export function percussionFor(key: number): InstrumentId | null {
  switch (key) {
    case 35:
    case 36:
      return 'thud'; // kicks
    case 37:
    case 38:
    case 40:
    case 39:
      return 'click'; // side stick, snares, clap
    case 42:
    case 44:
      return 'noise'; // closed / pedal hi-hat
    default:
      return null;
  }
}
