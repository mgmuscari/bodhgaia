// Credits (PURE — strings and links only). Licence compliance for conveying the built game: it is GPL-3.0-or-later,
// so every conveyance names the licence, ships its text (COPYING) and links the source; the music, the opening's
// words and the typeface are credited under their own terms. Read by the help panel and the opening.
// No DOM / no transcendental Math.

import { LICENCES, MUSIC_TRACKS, type MusicTrack } from '../audio/music/tracks';

export interface CreditLink {
  label: string;
  href: string;
}

export interface CreditsBlock {
  heading: string;
  paragraphs: string[];
  links?: CreditLink[];
}

export const GAME_NAME = 'Bodhgaia';
export const AUTHOR = 'Madeleine Muscari';
export const LICENCE = 'GPL-3.0-or-later';
export const SOURCE_URL = 'https://github.com/mgmuscari/bodhgaia';
/** The GNU GPL v3 text, shipped next to the page (public/COPYING.txt → dist/); relative for subpath hosting, .txt so
 *  browsers display it rather than download it (public/COPYING ships too, by convention). */
export const COPYING_HREF = 'COPYING.txt';

declare const __APP_VERSION__: string;
/** The release, from package.json (vite.config `define`). */
export const GAME_VERSION = __APP_VERSION__;

/** The licence text of the bundled typeface, shipped beside the game (public/fonts-OFL.txt). */
export const FONT_LICENCE_HREF = 'fonts-OFL.txt';

/** The typeface: Jersey 10, under the SIL Open Font License — its notice and licence travel with it. */
function fontCredits(): CreditsBlock {
  return {
    heading: 'Type',
    paragraphs: [
      'Set in Jersey 10, copyright 2023 The Soft Type Project Authors (github.com/scfried/soft-type-jersey), ' +
        'used under the SIL Open Font License, Version 1.1.',
    ],
    links: [
      { label: 'Jersey 10 (source)', href: 'https://github.com/scfried/soft-type-jersey' },
      { label: 'Licence: SIL Open Font License 1.1 (OFL)', href: FONT_LICENCE_HREF },
    ],
  };
}

/** The credits as headed blocks — the help panel renders these in order. */
export function creditsBlocks(): CreditsBlock[] {
  return [
    {
      heading: `${GAME_NAME} ${GAME_VERSION}`,
      paragraphs: [
        `By ${AUTHOR}. Free software under the GNU General Public License, ${LICENCE}: you may share and change ` +
          'it under its terms, and its source is published below.',
      ],
      links: [
        { label: `Source: ${SOURCE_URL}`, href: SOURCE_URL },
        { label: 'Licence: GNU GPL v3 (COPYING)', href: COPYING_HREF },
      ],
    },
    openingCredits(),
    musicCredits(),
    fontCredits(),
  ];
}

/** The opening's words: the epigraphs and the vows, quoted from the Berkeley Zen Center chant book. */
function openingCredits(): CreditsBlock {
  return {
    heading: 'The opening',
    paragraphs: [
      'The opening’s epigraphs — from the Heart Sutra, and Eihei Dōgen’s Genjōkōan (“Firewood becomes ash…”) — and ' +
        'its vows are quoted as they are chanted in the Berkeley Zen Center chant book, with gratitude.',
    ],
    links: [{ label: 'Berkeley Zen Center', href: 'https://www.berkeleyzencenter.org' }],
  };
}

function trackLine(t: MusicTrack): string {
  const lic = LICENCES[t.credit.licence].name;
  if (t.credit.arranged) return `${t.title} — ${t.composer}. Arranged for ${GAME_NAME} by ${t.credit.typesetter}; ${lic}.`;
  if (t.credit.arranger) {
    const arr = LICENCES[t.credit.arrangementLicence ?? t.credit.licence].name;
    return `${t.title} — ${t.composer}. MIDI typeset by ${t.credit.typesetter} for the Mutopia Project (${lic}); arranged for ${GAME_NAME} by ${t.credit.arranger}; ${arr}.`;
  }
  return `${t.title} — ${t.composer}. MIDI typeset by ${t.credit.typesetter} for the Mutopia Project; ${lic}.`;
}

/** The music: each piece with its composer, its typesetter and its licence (BY-SA requires the attribution), plus
 *  links to the page where each licence was verified and to the licence deeds. */
function musicCredits(): CreditsBlock {
  const deeds = [...new Set(MUSIC_TRACKS.map((t) => t.credit.licence))]
    .filter((id) => id !== 'public-domain')
    .map((id) => ({ label: `Licence: ${LICENCES[id].name}`, href: LICENCES[id].url }));
  return {
    heading: 'Music',
    paragraphs: [
      `${GAME_NAME} plays its music on its own small synthesizer, from MIDI scores. The classical pieces come ` +
        'from the Mutopia Project (mutopiaproject.org), volunteers typesetting public-domain music under open ' +
        'licences, and arranged for the game as ensembles by ' + AUTHOR + ' — an arrangement of a ShareAlike score ' +
        'is ShareAlike too. The other ensemble pieces — public-domain songs and traditional Buddhist melodies — were ' +
        'arranged for the game by ' + AUTHOR + '.',
      ...MUSIC_TRACKS.map(trackLine),
    ],
    links: [...MUSIC_TRACKS.map((t) => ({ label: `${t.title} (source)`, href: t.credit.source })), ...deeds],
  };
}

/** Every heading, paragraph and link label/href as one plain string (tests, plain-text renderers). */
export function creditsText(): string {
  return creditsBlocks()
    .flatMap((b) => [b.heading, ...b.paragraphs, ...(b.links ?? []).flatMap((l) => [l.label, l.href])])
    .join('\n');
}

/** The short credit under the opening — the full credits and licence live in Help. */
export function openingCreditLine(): string {
  return `${GAME_NAME} · ${LICENCE} · by ${AUTHOR} · full credits and licence under Help (?)`;
}
