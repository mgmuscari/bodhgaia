// Credits (PURE — strings and links only). Licence compliance for conveying the built game: the project is
// GPL-3.0-or-later and derives from the old simulator, whose GPL carries §7 ADDITIONAL TERMS — every conveyance must
// include the the original publisher copyright notice and those terms verbatim, must not use the the classic city-builder trademark or
// claim EA affiliation, and must mark itself as a modified version. Read by the help panel and the opening.
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

/** The upstream copyright notice, verbatim from the the old simulator source headers. */
export const EA_NOTICE =
  'the old simulator, Unix Version. This game was released for the Unix platform in or about 1990 and has been ' +
  'modified for inclusion in the a laptop programme program. Copyright (C) 1989 - 2007 the original publisher Inc. ' +
  'If you need assistance with this program, you may contact: http://example.org or email ' +
  'example.org.';

/** "ADDITIONAL TERMS per GNU GPL Section 7", verbatim from upstream (one string per paragraph). */
export const GPL7_TERMS: string[] = [
  'No trademark or publicity rights are granted. This license does NOT give you any right, title or interest ' +
    'in the trademark the classic city-builder or any other the original publisher trademark. You may not distribute any modification ' +
    'of this program using the trademark the classic city-builder or claim any affliation or association with the original publisher ' +
    'Inc. or its employees.',
  'Any propagation or conveyance of this program must include this copyright notice and these terms.',
  'If you convey this program (or any modifications of it) and assume contractual liability for the program ' +
    'to recipients of it, you agree to indemnify the original publisher for any liability that those contractual ' +
    'assumptions impose on the original publisher.',
  'You may not misrepresent the origins of this program; modified versions of the program must be marked as ' +
    'such and not identified as the original program.',
  'This disclaimer supplements the one included in the General Public License. TO THE FULLEST EXTENT ' +
    'PERMISSIBLE UNDER APPLICABLE LAW, THIS PROGRAM IS PROVIDED TO YOU "AS IS," WITH ALL FAULTS, WITHOUT ' +
    'WARRANTY OF ANY KIND, AND YOUR USE IS AT YOUR SOLE RISK. THE ENTIRE RISK OF SATISFACTORY QUALITY AND ' +
    'PERFORMANCE RESIDES WITH YOU. THE ORIGINAL PUBLISHER DISCLAIMS ANY AND ALL EXPRESS, IMPLIED OR STATUTORY ' +
    'WARRANTIES, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, SATISFACTORY QUALITY, FITNESS FOR A ' +
    'PARTICULAR PURPOSE, NONINFRINGEMENT OF THIRD PARTY RIGHTS, AND WARRANTIES (IF ANY) ARISING FROM A COURSE ' +
    'OF DEALING, USAGE, OR TRADE PRACTICE. THE ORIGINAL PUBLISHER DOES NOT WARRANT AGAINST INTERFERENCE WITH YOUR ' +
    'ENJOYMENT OF THE PROGRAM; THAT THE PROGRAM WILL MEET YOUR REQUIREMENTS; THAT OPERATION OF THE PROGRAM ' +
    'WILL BE UNINTERRUPTED OR ERROR-FREE, OR THAT THE PROGRAM WILL BE COMPATIBLE WITH THIRD PARTY SOFTWARE OR ' +
    'THAT ANY ERRORS IN THE PROGRAM WILL BE CORRECTED. NO ORAL OR WRITTEN ADVICE PROVIDED BY THE ORIGINAL PUBLISHER ' +
    'OR ANY AUTHORIZED REPRESENTATIVE SHALL CREATE A WARRANTY. SOME JURISDICTIONS DO NOT ALLOW THE EXCLUSION ' +
    'OF OR LIMITATIONS ON IMPLIED WARRANTIES OR THE LIMITATIONS ON THE APPLICABLE STATUTORY RIGHTS OF A ' +
    'CONSUMER, SO SOME OR ALL OF THE ABOVE EXCLUSIONS AND LIMITATIONS MAY NOT APPLY TO YOU.',
];

/** The credits as headed blocks — the help panel renders these in order. */
export function creditsBlocks(): CreditsBlock[] {
  return [
    {
      heading: GAME_NAME,
      paragraphs: [
        `By ${AUTHOR}. Free software under the GNU General Public License, ${LICENCE}.`,
        `${GAME_NAME} is derived from the old simulator, the GPL release of the original 1989 city simulator. ` +
          'It is a modified version, not the original program, and is not affiliated with or endorsed by ' +
          'the original publisher.',
      ],
      links: [
        { label: `Source: ${SOURCE_URL}`, href: SOURCE_URL },
        { label: 'Licence: GNU GPL v3 (COPYING)', href: COPYING_HREF },
      ],
    },
    { heading: 'the old simulator', paragraphs: [EA_NOTICE] },
    { heading: 'Additional terms per GNU GPL Section 7', paragraphs: [...GPL7_TERMS] },
    openingCredits(),
    musicCredits(),
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

/** The short credit under the opening — the full notice and terms live in Help. */
export function openingCreditLine(): string {
  return (
    `${GAME_NAME} · ${LICENCE} · derived from the old simulator, Copyright (C) 1989 - 2007 the original publisher Inc. ` +
    '· full credits and licence terms under Help (?)'
  );
}
