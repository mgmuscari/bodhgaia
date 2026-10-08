// The opening's words and timing (bodhgaia-opening.md §3, from Maddy's notes). Pure — no DOM.

export interface Epigraph {
  lines: readonly string[];
  source: string;
}

/** The opening's first cards (Maddy 2026-10-08): the byline, then the name, each alone on the dark. */
export const TITLE_CARDS = ['a game by madeleine muscari', 'BODHGAIA'] as const;

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

/** The second act: the vows, while the camera tours the city. */
export const VOWS: readonly string[] = [
  'May I continually cultivate the ground of peace for myself and others and persist, mindful and dedicated to this work, independent of results.',
  "May I know that my peace and the world's peace are not separate; that our peace in the world is a result of our work for justice.",
  'May all beings be well, happy, and peaceful.',
  'Homage to the future Maitreya Buddha!',
];

export const OPENING_TIMING = {
  /** Each title card holds this long (click or Space moves on sooner). */
  creditMs: 4000,
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
  followZoom: 4,
  /** Each vow holds this long (click or Space moves on sooner); the camera glides to its stop over the first
   *  `glideShare` of it. */
  vowMs: 8500,
  glideShare: 0.65,
} as const;
