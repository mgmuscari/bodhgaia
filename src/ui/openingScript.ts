// The opening's words and timing (bodhgaia-opening.md §3, from Maddy's notes). Pure — no DOM.

export interface Epigraph {
  lines: readonly string[];
  source: string;
}

export const EPIGRAPHS: readonly Epigraph[] = [
  {
    lines: [
      'Avalokiteshvara Bodhisattva,',
      'when practicing deeply the Prajñaparamita,',
      'perceived that all Five Skandhas in their own being are empty',
      'and was saved from all suffering.',
    ],
    source: 'The Heart Sutra',
  },
  {
    lines: [
      'Firewood becomes ash, and it does not become firewood again.',
      'Yet, do not suppose that the ash is future and the firewood past.',
    ],
    source: 'Eihei Dōgen',
  },
];

export const MANTRA: readonly string[] = ['GATÉ,', 'GATÉ,', 'PĀRAGATÉ,', 'PĀRASAMGATÉ,', 'BODHI!', 'SVĀHĀ!'];

export const AWAKENING = 'The City is Awakening!!';

export const OPENING_TIMING = {
  /** Each epigraph holds this long (click or Space moves on sooner). */
  epigraphMs: 9000,
  /** The walk, in live substeps (~30 s). */
  walkSubsteps: 600,
  /** After they fall, the camera stays with them this long before the mantra. */
  holdMs: 4000,
  /** Each word of the mantra lands this far apart; the whole line then holds. */
  mantraWordMs: 900,
  mantraHoldMs: 1800,
  /** "The City is Awakening!!" holds this long. */
  awakeningMs: 4500,
  /** The city opens at this hour behind the epigraphs; dawn is this hour. */
  startHour: 23,
  dawnHour: 6,
  /** The camera's zoom while it follows the walker. */
  followZoom: 3,
} as const;
