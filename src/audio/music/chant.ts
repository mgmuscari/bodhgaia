// Pali recitation (PURE). No openly licensed notation or MIDI of Theravāda chant could be found (searched
// 2026-10-06), so these are TRANSCRIPTIONS of the traditional recitation, authored here as note data — not
// recordings. Style: the Thai "Makhot" manner, where nearly every syllable sits on one reciting pitch and a
// syllable that is long, unstopped and begins with s/h/ch/th/ṭh/kh/ph takes a high-falling tone a whole step up;
// long syllables last about twice the short; the chanters pause to breathe between phrases. The rules follow the
// Metta Forest Monastery guide "Tone Rules for Pāḷi Chanting in the Thai Tradition" (dhammatalks.org) — the rules
// only; no notation was copied. The Pali texts are the ancient canonical formulas, checked against the Dhammayut
// Order's chanting guide; the English renderings are our own.
//
// These are sacred texts. They are tagged 'calm' only: never a jingle, an alert, or a loop under game events.
import type { MidiNote, MidiPiece } from './midi';

/** The reciting tone: G3 (MIDI 55). The high tone is a whole step above. */
export const CHANT_PITCH = 55;
const HIGH_STEP = 2;
/** Seconds for a short syllable; a long syllable takes two. */
const UNIT = 0.24;
/** The breath between phrases. */
const BREATH = 1.6;
/** A phrase's last syllable is drawn out. */
const FINAL_STRETCH = 1.6;
/** In a high-falling syllable, the share held on the high pitch before it falls to the base. */
const FALL_AT = 0.6;
const CHANT_VELOCITY = 0.7;
const DRONE_VELOCITY = 0.35;

export interface ChantVerse {
  /** One entry per breath-phrase, as chanted. */
  pali: string[];
  /** Our English rendering of the verse. */
  meaning: string;
  /** Times the verse is recited (the Namo: three). Default 1. */
  repeat?: number;
}

export interface ChantText {
  id: string;
  title: string;
  verses: ChantVerse[];
}

export type Tone = 'base' | 'high';

export interface Syllable {
  text: string;
  long: boolean;
  stopped: boolean;
  tone: Tone;
}

export interface TimedSyllable extends Syllable {
  time: number;
  duration: number;
}

export interface Recitation {
  piece: MidiPiece;
  /** Every syllable voiced, with its time — the text aligned to the notes. */
  syllables: TimedSyllable[];
  /** Every breath-phrase voiced, with its time. */
  lines: { pali: string; time: number; duration: number }[];
}

// ---- syllables ----

const VOWELS = new Set(['a', 'ā', 'i', 'ī', 'u', 'ū', 'e', 'o']);
const LONG_VOWELS = new Set(['ā', 'ī', 'ū', 'e', 'o']);
const NIGGAHITA = new Set(['ṁ', 'ṃ']);
const ASPIRATES = new Set(['kh', 'gh', 'ch', 'jh', 'ṭh', 'ḍh', 'th', 'dh', 'ph', 'bh']);
const STOPS = new Set(['k', 'c', 't', 'ṭ', 'p', 'g', 'j', 'd', 'ḍ', 'b', 's']);
const HIGH_INITIALS = new Set(['s', 'h', 'ch', 'th', 'ṭh', 'kh', 'ph']);

/** A word (hyphens and elisions joined, as chanted) → its phonemes: vowels, ṁ, and consonants with the
 *  aspirates (kh, th, …) as single sounds. */
function phonemes(word: string): string[] {
  const s = word
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^a-zāīūṁṃṅñṭḍṇḷ]/g, '');
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (ASPIRATES.has(two)) {
      out.push(two);
      i++;
    } else out.push(s[i]!);
  }
  return out;
}

/** Pali syllabification: a single consonant between vowels opens the next syllable; in a cluster the first
 *  consonant closes the previous one; ṁ always closes; a word-initial cluster stays together. */
export function syllabify(word: string): string[] {
  const ph = phonemes(word);
  const sylls: string[][] = [];
  let pending: string[] = []; // consonants since the last vowel
  for (const p of ph) {
    if (VOWELS.has(p)) {
      if (sylls.length && pending.length > 1) sylls[sylls.length - 1]!.push(pending.shift()!);
      sylls.push([...pending, p]);
      pending = [];
    } else if (NIGGAHITA.has(p) && sylls.length && !pending.length) {
      sylls[sylls.length - 1]!.push(p);
    } else pending.push(p);
  }
  if (pending.length && sylls.length) sylls[sylls.length - 1]!.push(...pending);
  return sylls.map((x) => x.join(''));
}

function analyse(syll: string, prevCoda: string | null): Syllable {
  const ph = phonemes(syll);
  const v = ph.findIndex((p) => VOWELS.has(p));
  const onset = ph.slice(0, v);
  const coda = ph.slice(v + 1);
  const vowel = ph[v] ?? 'a';
  const long = LONG_VOWELS.has(vowel) || coda.length > 0;
  const last = coda[coda.length - 1];
  const stopped = last !== undefined && STOPS.has(last);
  // an initial m after a final s takes the s's tone (tas-mā, ā-yas-mā)
  let initial = onset[0] ?? '';
  if (initial === 'm' && onset.length === 1 && prevCoda === 's') initial = 's';
  const tone: Tone = long && !stopped && HIGH_INITIALS.has(initial) ? 'high' : 'base';
  return { text: syll, long, stopped, tone };
}

/** A phrase → its syllables with length and tone. */
export function syllableTones(phrase: string): Syllable[] {
  const out: Syllable[] = [];
  let prevCoda: string | null = null;
  for (const word of phrase.split(/\s+/).filter(Boolean)) {
    for (const syll of syllabify(word)) {
      const s = analyse(syll, prevCoda);
      out.push(s);
      const ph = phonemes(syll);
      const last = ph[ph.length - 1]!;
      prevCoda = VOWELS.has(last) ? null : last;
    }
  }
  return out;
}

// ---- recitation → notes ----

const note = (time: number, duration: number, pitch: number, velocity: number, channel: number): MidiNote => ({
  time,
  duration,
  pitch,
  velocity,
  channel,
  program: 0,
  percussion: false,
});

export function recite(text: ChantText): Recitation {
  const notes: MidiNote[] = [];
  const syllables: TimedSyllable[] = [];
  const lines: Recitation['lines'] = [];
  let t = 0.5;
  for (const verse of text.verses) {
    for (let r = 0; r < (verse.repeat ?? 1); r++) {
      for (const pali of verse.pali) {
        const sylls = syllableTones(pali);
        const lineStart = t;
        sylls.forEach((s, i) => {
          let d = (s.long ? 2 : 1) * UNIT;
          if (i === sylls.length - 1) d *= FINAL_STRETCH;
          if (s.tone === 'high') {
            notes.push(note(t, d * FALL_AT, CHANT_PITCH + HIGH_STEP, CHANT_VELOCITY, 0));
            notes.push(note(t + d * FALL_AT, d * (1 - FALL_AT), CHANT_PITCH, CHANT_VELOCITY * 0.85, 0));
          } else notes.push(note(t, d, CHANT_PITCH, CHANT_VELOCITY, 0));
          syllables.push({ ...s, time: t, duration: d });
          t += d;
        });
        const duration = t - lineStart;
        lines.push({ pali, time: lineStart, duration });
        // the drone: the reciting tone an octave below, under the phrase and into the breath
        notes.push(note(lineStart, duration + BREATH * 0.6, CHANT_PITCH - 12, DRONE_VELOCITY, 1));
        t += BREATH;
      }
    }
  }
  notes.sort((a, b) => a.time - b.time || a.pitch - b.pitch);
  return { piece: { notes, duration: t }, syllables, lines };
}

// ---- the texts ----

const NAMO: ChantVerse = {
  pali: ['Namo tassa bhagavato arahato sammā-sambuddhassa.'],
  meaning: 'Homage to the Blessed One, the Worthy One, the perfectly self-awakened.',
  repeat: 3,
};

export const TISARANA: ChantText = {
  id: 'pali-tisarana',
  title: 'Namo tassa · Tisaraṇa (Homage and the Three Refuges)',
  verses: [
    NAMO,
    {
      pali: ['Buddhaṃ saraṇaṃ gacchāmi.', 'Dhammaṃ saraṇaṃ gacchāmi.', 'Saṅghaṃ saraṇaṃ gacchāmi.'],
      meaning:
        'I go to the Buddha as my refuge. I go to the Dhamma, the teaching, as my refuge. I go to the ' +
        'Saṅgha, the community, as my refuge.',
    },
    {
      pali: [
        'Dutiyampi buddhaṃ saraṇaṃ gacchāmi.',
        'Dutiyampi dhammaṃ saraṇaṃ gacchāmi.',
        'Dutiyampi saṅghaṃ saraṇaṃ gacchāmi.',
      ],
      meaning: 'A second time, I go to the Buddha, the Dhamma and the Saṅgha as my refuge.',
    },
    {
      pali: [
        'Tatiyampi buddhaṃ saraṇaṃ gacchāmi.',
        'Tatiyampi dhammaṃ saraṇaṃ gacchāmi.',
        'Tatiyampi saṅghaṃ saraṇaṃ gacchāmi.',
      ],
      meaning: 'A third time, I go to the Buddha, the Dhamma and the Saṅgha as my refuge.',
    },
  ],
};

export const METTA_SUTTA: ChantText = {
  id: 'pali-metta-sutta',
  title: 'Karaṇīya Mettā Sutta (The Discourse on Loving-kindness)',
  verses: [
    {
      pali: ['Karaṇīyam-attha-kusalena', 'yantaṃ santaṃ padaṃ abhisamecca,'],
      meaning: 'This is what should be done by one skilled in the good, who would reach the state of peace:',
    },
    {
      pali: ['Sakko ujū ca suhujū ca', 'suvaco cassa mudu anatimānī,'],
      meaning: 'let them be able and upright, truly upright, easy to speak to, gentle, and without pride;',
    },
    {
      pali: ['Santussako ca subharo ca', 'appakicco ca sallahuka-vutti,'],
      meaning: 'content and easily supported, with few tasks, living simply;',
    },
    {
      pali: ['Santindriyo ca nipako ca', 'appagabbho kulesu ananugiddho.'],
      meaning: 'their senses calm, prudent, not brash, not greedy among families.',
    },
    {
      pali: ['Na ca khuddaṃ samācare kiñci', 'yena viññū pare upavadeyyuṃ.'],
      meaning: 'Let them do nothing, however small, that the wise would reprove.',
    },
    {
      pali: ['Sukhino vā khemino hontu', 'sabbe sattā bhavantu sukhitattā.'],
      meaning: 'May all beings be happy and secure; may they be happy at heart.',
    },
    {
      pali: ['Ye keci pāṇa-bhūtatthi', 'tasā vā thāvarā vā anavasesā,'],
      meaning: 'Whatever living beings there are, trembling or steady, without exception,',
    },
    {
      pali: ['Dīghā vā ye mahantā vā', 'majjhimā rassakā aṇuka-thūlā,'],
      meaning: 'long or great, middling or short, small or large,',
    },
    {
      pali: ['Diṭṭhā vā ye ca adiṭṭhā', 'ye ca dūre vasanti avidūre,'],
      meaning: 'seen or unseen, dwelling far away or near,',
    },
    {
      pali: ['Bhūtā vā sambhavesī vā', 'sabbe sattā bhavantu sukhitattā.'],
      meaning: 'born or yet to be born: may all beings be happy at heart.',
    },
    {
      pali: ['Na paro paraṃ nikubbetha', 'nātimaññetha katthaci naṃ kiñci,'],
      meaning: 'Let none deceive another, nor despise anyone anywhere;',
    },
    {
      pali: ['Byārosanā paṭīgha-saññā', 'nāññam-aññassa dukkham-iccheyya.'],
      meaning: 'in anger or ill will let none wish suffering on another.',
    },
    {
      pali: ['Mātā yathā niyaṃ puttaṃ', 'āyusā eka-puttam-anurakkhe,'],
      meaning: 'As a mother would guard with her life her child, her only child,',
    },
    {
      pali: ['Evam-pi sabba-bhūtesu', 'māna-sambhāvaye aparimāṇaṃ.'],
      meaning: 'so toward all beings let one cultivate a boundless heart.',
    },
    {
      pali: ['Mettañca sabba-lokasmiṃ', 'māna-sambhāvaye aparimāṇaṃ,'],
      meaning: 'With loving-kindness for the whole world let one cultivate a boundless heart:',
    },
    {
      pali: ['Uddhaṃ adho ca tiriyañca', 'asambādhaṃ averaṃ asapattaṃ.'],
      meaning: 'above, below and all around, unconfined, free of hatred and of enmity.',
    },
    {
      pali: ["Tiṭṭhañ'caraṃ nisinno vā", 'sayāno vā yāvatassa vigatam-iddho,'],
      meaning: 'Standing, walking, sitting or lying down, for as long as one is awake,',
    },
    {
      pali: ['Etaṃ satiṃ adhiṭṭheyya', 'brahmam-etaṃ vihāraṃ idham-āhu.'],
      meaning: 'let one hold to this mindfulness: this, they say, is the sublime abiding, here and now.',
    },
    {
      pali: ['Diṭṭhiñca anupagamma', 'sīlavā dassanena sampanno,'],
      meaning: 'Not grasping at views, virtuous, and whole in insight,',
    },
    {
      pali: ['Kāmesu vineyya gedhaṃ,', 'Na hi jātu gabbha-seyyaṃ punaretīti.'],
      meaning: 'having let go of craving for sense pleasures, one comes no more to lie in a womb.',
    },
  ],
};

export const CHANT_TEXTS: ChantText[] = [TISARANA, METTA_SUTTA];
