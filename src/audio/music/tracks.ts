// The music manifest (PURE data). Every sourced piece is a Standard MIDI File from the Mutopia Project, shipped
// under public/music/; each licence was read at the piece's Mutopia page (`source`) on 2026-10-06 — public domain
// (the CC public-domain dedication) or Creative Commons BY-SA, never assumed. BY-SA requires attribution: the
// credits (src/ui/creditsContent.ts) name the typesetter and licence of each. The files are shipped as separate data
// alongside the GPL program, each under its own licence (an aggregate, not a derived work).
import { METTA_SUTTA, recite, TISARANA, type ChantText } from './chant';
import type { Mood, PlayableTrack } from './player';

export const LICENCES = {
  'public-domain': { name: 'Public Domain', url: 'https://creativecommons.org/licenses/publicdomain/' },
  'cc-by-sa-3.0': {
    name: 'Creative Commons Attribution-ShareAlike 3.0',
    url: 'https://creativecommons.org/licenses/by-sa/3.0/',
  },
  'cc-by-sa-4.0': {
    name: 'Creative Commons Attribution-ShareAlike 4.0',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
  'gpl-3.0-or-later': {
    name: 'GNU GPL v3 or later (with the game)',
    url: 'https://www.gnu.org/licenses/gpl-3.0.html',
  },
} as const;
export type LicenceId = keyof typeof LICENCES;

export interface TrackCredit {
  /** Who typeset / sequenced the MIDI (Mutopia maintainer), or who transcribed it. */
  typesetter: string;
  /** The page where the licence was verified. */
  source: string;
  /** The exact file fetched. */
  download?: string;
  licence: LicenceId;
}

export interface MusicTrack extends PlayableTrack {
  title: string;
  composer: string;
  credit: TrackCredit;
  /** A sacred text (the Pali recitations): 'calm' only — never a jingle, an alert or a loop under game events. */
  sacred?: boolean;
}

const MUTOPIA = 'https://www.mutopiaproject.org';
const page = (id: number) => `${MUTOPIA}/cgibin/piece-info.cgi?id=${id}`;

function mutopia(
  id: string,
  file: string,
  title: string,
  composer: string,
  moods: Mood[],
  pieceId: number,
  ftpPath: string,
  typesetter: string,
  licence: LicenceId,
): MusicTrack {
  return {
    id,
    file,
    title,
    composer,
    moods,
    credit: { typesetter, source: page(pieceId), download: `${MUTOPIA}/ftp/${ftpPath}`, licence },
  };
}

/** The sourced classical pieces: calm piano for a city at dawn, through the day, and at dusk. */
export const CLASSICAL_TRACKS: MusicTrack[] = [
  mutopia(
    'satie-gymnopedie-1',
    'satie-gymnopedie-1.mid',
    'Gymnopédie No. 1',
    'Erik Satie',
    ['day', 'night', 'calm'],
    37,
    'SatieE/gymnopedie_1/gymnopedie_1.mid',
    'Evin Robertson',
    'public-domain',
  ),
  mutopia(
    'satie-gymnopedie-2',
    'satie-gymnopedie-2.mid',
    'Gymnopédie No. 2',
    'Erik Satie',
    ['day'],
    38,
    'SatieE/gymnopedie_2/gymnopedie_2.mid',
    'Evin Robertson',
    'public-domain',
  ),
  mutopia(
    'satie-gymnopedie-3',
    'satie-gymnopedie-3.mid',
    'Gymnopédie No. 3',
    'Erik Satie',
    ['day', 'night'],
    39,
    'SatieE/gymnopedie_3/gymnopedie_3.mid',
    'Evin Robertson',
    'public-domain',
  ),
  mutopia(
    'satie-gnossienne-1',
    'satie-gnossienne-1.mid',
    'Gnossienne No. 1',
    'Erik Satie',
    ['night'],
    2035,
    'SatieE/Gnossienne/no_1/no_1.mid',
    'Knute Snortum',
    'cc-by-sa-4.0',
  ),
  mutopia(
    'debussy-clair-de-lune',
    'debussy-clair-de-lune.mid',
    'Suite bergamasque: Clair de lune',
    'Claude Debussy',
    ['night'],
    1778,
    'DebussyC/L75/debussy_Ste_Bergamesq_Clair/debussy_Ste_Bergamesq_Clair.mid',
    'Keith OHara',
    'public-domain',
  ),
  mutopia(
    'debussy-arabesque-1',
    'debussy-arabesque-1.mid',
    'Première Arabesque',
    'Claude Debussy',
    ['day'],
    1777,
    'DebussyC/L66/debussy_Arabesque_1/debussy_Arabesque_1.mid',
    'Keith OHara',
    'public-domain',
  ),
  mutopia(
    'bach-wtc1-prelude-1',
    'bach-wtc1-prelude-1.mid',
    'The Well-Tempered Clavier I: Prelude No. 1 in C major, BWV 846',
    'Johann Sebastian Bach',
    ['day'],
    5,
    'BachJS/BWV846/wtk1-prelude1/wtk1-prelude1.mid',
    'Tobias Erbsland',
    'public-domain',
  ),
  mutopia(
    'bach-prelude-bwv999',
    'bach-prelude-bwv999.mid',
    'Prelude in D minor, BWV 999',
    'Johann Sebastian Bach',
    ['day'],
    60,
    'BachJS/BWV999/Bach_Prelude_BWV999/Bach_Prelude_BWV999.mid',
    'Jakob Bagterp',
    'public-domain',
  ),
  mutopia(
    'chopin-nocturne-op9-no2',
    'chopin-nocturne-op9-no2.mid',
    'Nocturne in E-flat major, Op. 9 No. 2',
    'Frédéric Chopin',
    ['night'],
    1590,
    'ChopinFF/O9/chopin_nocturne_op9_n2/chopin_nocturne_op9_n2.mid',
    'Renato Biolcati Rinaldi',
    'cc-by-sa-3.0',
  ),
  mutopia(
    'chopin-nocturne-op72-no1',
    'chopin-nocturne-op72-no1.mid',
    'Nocturne No. 19 in E minor, Op. 72 No. 1',
    'Frédéric Chopin',
    ['night'],
    509,
    'ChopinFF/O72/nocturne_in_e_minor/nocturne_in_e_minor.mid',
    'Benjamin D. Esham',
    'cc-by-sa-4.0',
  ),
  mutopia(
    'field-nocturne-h37',
    'field-nocturne-h37.mid',
    'Nocturne No. 5 in B-flat major, H. 37',
    'John Field',
    ['night'],
    2137,
    'FieldJ/H37/Field_Nocturne_5/Field_Nocturne_5.mid',
    'Alex Schreiber',
    'cc-by-sa-4.0',
  ),
];

/** The reference the transcriptions follow (rules only — no notation was copied). */
export const CHANT_REFERENCE = {
  label: 'Tone Rules for Pāḷi Chanting in the Thai Tradition (Metta Forest Monastery, dhammatalks.org)',
  href: 'https://www.dhammatalks.org/Archive/Writings/ChantingToneGuide151003.pdf',
};

function recitation(text: ChantText): MusicTrack {
  return {
    id: text.id,
    title: text.title,
    composer: 'Traditional Theravāda recitation, in Pali',
    moods: ['calm'],
    sacred: true,
    piece: () => recite(text).piece,
    voices: { 0: 'chant', 1: 'pad' },
    credit: { typesetter: 'the Bodhitropolis project', source: CHANT_REFERENCE.href, licence: 'gpl-3.0-or-later' },
  };
}

/** The Pali recitations — transcriptions, not recordings (see chant.ts). Sacred: calm only. */
export const CHANT_TRACKS: MusicTrack[] = [recitation(TISARANA), recitation(METTA_SUTTA)];

/** Everything the player can play. */
export const MUSIC_TRACKS: MusicTrack[] = [...CLASSICAL_TRACKS, ...CHANT_TRACKS];
