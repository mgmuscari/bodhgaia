// Bridges between pieces (PURE — notes in, notes out). When one piece gives way to the next, the player plays a short
// generated passage instead of a silent gap: from the chord A ends on (or was sounding when it was cut), through one
// chord a bar, to the dominant seventh of the chord B opens on, which resolves on B's first downbeat. Near keys take 2 bars, far
// ones up to 4, stepping around the circle of fifths. The voices are A's lead and bass instruments handing over to
// B's, voice-led to the nearest notes, and the tempo glides beat by beat from A's closing tempo to B's opening one.
// The same pair of pieces always gets the same bridge.
import type { MidiNote, MidiPiece } from './midi';

export interface Key {
  /** Pitch class, 0 = C. */
  tonic: number;
  minor: boolean;
}

export interface Chord {
  /** Pitch class of the root. */
  root: number;
  minor: boolean;
  /** A dominant seventh (major triad + minor seventh). */
  seventh?: boolean;
}

/** One side of a bridge: a piece, where in it the bridge leaves from (piece seconds) and its playback rate. */
export interface BridgeFrom {
  piece: MidiPiece;
  at: number;
  rate?: number;
}
export interface BridgeTo {
  piece: MidiPiece;
  rate?: number;
}

// Krumhansl–Kessler key profiles.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Seconds of piece read for the closing chord and voices (and the opening ones of B). */
const WINDOW = 2;
const VOICE_WINDOW = 4;
const BEATS_PER_BAR = 4;
/** The glide's tempo is kept to a gentle range (a file's default 120 is not always meant). */
const BPM_MIN = 40;
const BPM_MAX = 160;
/** Ranges: the three upper voices, and the bass. */
const UPPER_LO = 50;
const UPPER_HI = 81;
const BASS_LO = 36;
const BASS_HI = 50;
/** Furthest a voice moves from one chord to the next (a fifth). */
const MAX_STEP = 7;

const mod12 = (n: number) => ((n % 12) + 12) % 12;
const pitched = (notes: readonly MidiNote[]) => notes.filter((n) => !n.percussion);

/** Duration × velocity per pitch class of the notes sounding within [from, to] (all of them when no window). */
function pcWeights(notes: readonly MidiNote[], from = -Infinity, to = Infinity): number[] {
  const w = new Array<number>(12).fill(0);
  for (const n of pitched(notes)) {
    const overlap = Math.min(to, n.time + n.duration) - Math.max(from, n.time);
    if (overlap > 0) w[mod12(n.pitch)]! += overlap * n.velocity;
  }
  return w;
}

function correlate(w: readonly number[], profile: readonly number[], shift: number): number {
  const mw = w.reduce((s, x) => s + x, 0) / 12;
  const mp = profile.reduce((s, x) => s + x, 0) / 12;
  let num = 0;
  let dw = 0;
  let dp = 0;
  for (let i = 0; i < 12; i++) {
    const a = w[mod12(i + shift)]! - mw;
    const b = profile[i]! - mp;
    num += a * b;
    dw += a * a;
    dp += b * b;
  }
  return dw && dp ? num / Math.sqrt(dw * dp) : 0;
}

/** How much a key gains for having the closing chord as its tonic (a correlation is −1..1): enough to settle a
 *  key against its dominant, the profile's usual confusion, never enough to override a clear reading. */
const HOME_BONUS = 0.1;
const HOME_MODE_BONUS = 0.03;

/** The key, by correlating the piece's pitch-class weights with the major and minor profiles (C major when silent);
 *  `closing`, the chord the piece ends on, breaks the near ties — pieces end home. */
export function keyOf(notes: readonly MidiNote[], closing?: Chord | null): Key {
  const w = pcWeights(notes);
  let best: Key = { tonic: 0, minor: false };
  let score = -Infinity;
  for (const minor of [false, true]) {
    for (let tonic = 0; tonic < 12; tonic++) {
      let s = correlate(w, minor ? MINOR : MAJOR, tonic);
      if (closing && closing.root === tonic) s += HOME_BONUS + (closing.minor === minor ? HOME_MODE_BONUS : 0);
      if (s > score + 1e-12) {
        score = s;
        best = { tonic, minor };
      }
    }
  }
  return best;
}

const triad = (c: Chord): number[] => {
  const tones = [c.root, mod12(c.root + (c.minor ? 3 : 4)), mod12(c.root + 7)];
  if (c.seventh) tones.push(mod12(c.root + 10));
  return tones;
};

/** The triad that best explains the notes sounding in [from, to]; the bass note leans toward being its root. */
export function chordAt(notes: readonly MidiNote[], from: number, to: number): Chord | null {
  const w = pcWeights(notes, from, to);
  const total = w.reduce((s, x) => s + x, 0);
  if (total <= 0) return null;
  let bass = Infinity;
  for (const n of pitched(notes)) if (n.time < to && n.time + n.duration > from) bass = Math.min(bass, n.pitch);
  let best: Chord | null = null;
  let score = -Infinity;
  for (let root = 0; root < 12; root++) {
    for (const minor of [false, true]) {
      const tones = triad({ root, minor });
      const inChord = tones.reduce((s, pc) => s + w[pc]!, 0);
      let s = inChord - 0.6 * (total - inChord) + (mod12(bass) === root ? 0.25 * total : 0);
      if (!w[root]) s -= total; // a chord with no root in sight is a guess
      if (s > score + 1e-12) {
        score = s;
        best = { root, minor };
      }
    }
  }
  return best;
}

/** A key's place on the circle of fifths (C = 0, G = 1, F = −1); a minor key stands with its relative major. */
const fifthsOf = (k: Key): number => {
  const f = mod12((k.minor ? k.tonic + 3 : k.tonic) * 7);
  return f > 6 ? f - 12 : f;
};
/** Signed steps around the circle from a to b (−5..6). */
export function fifthsBetween(a: Key, b: Key): number {
  const d = mod12(fifthsOf(b) - fifthsOf(a));
  return d > 6 ? d - 12 : d;
}
const majorTonicAt = (fifths: number): number => mod12(fifths * 7);

/** One chord a bar: the tonics of the keys passed on the way round the circle, the new key's predominant (ii, or iv
 *  into minor), then its dominant seventh. 2 bars for keys a fifth apart or closer, 3 for 2–3 steps, 4 beyond. */
export function planBridge(from: { key: Key; chord: Chord }, to: Key): Chord[] {
  const d = fifthsBetween(from.key, to);
  const bars = Math.abs(d) <= 1 ? 2 : Math.abs(d) <= 3 ? 3 : 4;
  const mids = bars - 2;
  const plan: Chord[] = [];
  for (let j = 1; j <= mids; j++) plan.push({ root: majorTonicAt(fifthsOf(from.key) + Math.round((d * j) / (mids + 1))), minor: false });
  plan.push(to.minor ? { root: mod12(to.tonic + 5), minor: true } : { root: mod12(to.tonic + 2), minor: true });
  plan.push({ root: mod12(to.tonic + 7), minor: false, seventh: true });
  return plan;
}

/** The three upper voices of `c` nearest `prev`: no crossing, each within a fifth, root and third present (third and
 *  seventh for a dominant seventh, which drops its fifth). */
function voice(c: Chord, prev: readonly number[]): number[] {
  const tones = triad(c);
  const need = c.seventh ? [tones[1]!, tones[3]!] : [tones[0]!, tones[1]!];
  const cands = prev.map((p) => {
    const out: number[] = [];
    for (let q = Math.max(UPPER_LO, p - MAX_STEP); q <= Math.min(UPPER_HI, p + MAX_STEP); q++) if (tones.includes(mod12(q))) out.push(q);
    return out;
  });
  let best: number[] | null = null;
  let cost = Infinity;
  for (const a of cands[0]!)
    for (const b of cands[1]!)
      for (const c3 of cands[2]!) {
        if (!(a < b && b < c3)) continue;
        const pcs = [a, b, c3].map(mod12);
        if (!need.every((pc) => pcs.includes(pc))) continue;
        const k = Math.abs(a - prev[0]!) + Math.abs(b - prev[1]!) + Math.abs(c3 - prev[2]!);
        if (k < cost) {
          cost = k;
          best = [a, b, c3];
        }
      }
  if (best) return best;
  // no smooth voicing (a far leap): close position around the old centre
  const centre = Math.round((prev[0]! + prev[2]!) / 2);
  const close = need.concat(tones.filter((t) => !need.includes(t))).slice(0, 3);
  return close.map((pc) => centre - 6 + mod12(pc - (centre - 6))).sort((x, y) => x - y);
}

const nearestIn = (pc: number, ref: number, lo: number, hi: number): number => {
  let best = lo + mod12(pc - lo);
  for (let q = best; q < hi; q += 12) if (Math.abs(q - ref) < Math.abs(best - ref)) best = q;
  return best;
};

/** The instruments in a stretch of a piece: the lead (channel 0's program, else the highest part's) and the bass
 *  (the lowest part's), and how loud it is played. */
function voicesIn(notes: readonly MidiNote[], from: number, to: number): { lead: number; bass: number; velocity: number } | null {
  const near = pitched(notes).filter((n) => n.time < to && n.time + n.duration > from);
  if (!near.length) return null;
  const byChannel = new Map<number, { sum: number; count: number; program: number }>();
  for (const n of near) {
    const c = byChannel.get(n.channel) ?? { sum: 0, count: 0, program: n.program };
    c.sum += n.pitch;
    c.count++;
    byChannel.set(n.channel, c);
  }
  const chans = [...byChannel.entries()].sort((a, b) => a[0] - b[0]);
  const mean = (c: { sum: number; count: number }) => c.sum / c.count;
  const high = chans.reduce((m, c) => (mean(c[1]) > mean(m[1]) ? c : m));
  const low = chans.reduce((m, c) => (mean(c[1]) < mean(m[1]) ? c : m));
  const lead = byChannel.get(0)?.program ?? high[1].program;
  const velocity = near.reduce((s, n) => s + n.velocity, 0) / near.length;
  return { lead, bass: low[1].program, velocity };
}

const closingChord = (p: MidiPiece): Chord | null => chordAt(p.notes, p.duration - WINDOW, p.duration);
const firstOnset = (p: MidiPiece): number => pitched(p.notes)[0]?.time ?? p.notes[0]?.time ?? 0;
const clampBpm = (bpm: number) => Math.max(BPM_MIN, Math.min(BPM_MAX, bpm));

/** The passage from A (leaving at `a.at`) into B, in real seconds from the moment A gives way. Its `duration` is the
 *  instant B's first downbeat should land. Channel 0 is the top voice, 1 the inner voices, 2 the bass. */
export function bridge(a: BridgeFrom, b: BridgeTo): MidiPiece {
  const rateA = a.rate ?? 1;
  const rateB = b.rate ?? 1;
  const bStart = firstOnset(b.piece);
  // the cadence lands on B's first downbeat, so it resolves onto the chord sounding there (B's key when none reads)
  const opening = chordAt(b.piece.notes, bStart, bStart + WINDOW);
  const keyB = opening ? { tonic: opening.root, minor: opening.minor } : keyOf(b.piece.notes, closingChord(b.piece));
  const aSounds = pitched(a.piece.notes).length > 0;
  const keyA = aSounds ? keyOf(a.piece.notes, closingChord(a.piece)) : keyB;
  const endChord = chordAt(a.piece.notes, a.at - WINDOW, a.at) ?? { root: keyA.tonic, minor: keyA.minor };
  const plan = planBridge({ key: keyA, chord: endChord }, keyB);

  const fallback = { lead: 0, bass: 0, velocity: 0.5 };
  const vb = voicesIn(b.piece.notes, bStart, bStart + VOICE_WINDOW) ?? fallback;
  const va = voicesIn(a.piece.notes, a.at - VOICE_WINDOW, a.at) ?? vb;

  // the tempo glide: each beat at the tempo interpolated to its middle
  const bpmA = clampBpm((a.piece.tempo?.end ?? 120) * rateA);
  const bpmB = clampBpm((b.piece.tempo?.start ?? 120) * rateB);
  const beats = plan.length * BEATS_PER_BAR;
  const beatAt: number[] = [0];
  for (let i = 0; i < beats; i++) beatAt.push(beatAt[i]! + 60 / (bpmA + ((bpmB - bpmA) * (i + 0.5)) / beats));

  const notes: MidiNote[] = [];
  const push = (time: number, duration: number, pitch: number, velocity: number, channel: number, program: number) =>
    notes.push({ time, duration, pitch, velocity, channel, program, percussion: false });

  let upper = voice(endChord, [55, 60, 64]);
  let bass = nearestIn(endChord.root, 43, BASS_LO, BASS_HI);
  const voiced = plan.map((c) => {
    upper = voice(c, upper);
    bass = nearestIn(c.root, bass, BASS_LO, BASS_HI);
    return { upper, bass };
  });
  const handover = Math.floor(plan.length / 2); // bars before this are A's voice, from it B's
  voiced.forEach((v, bar) => {
    const ins = bar < handover ? va : vb;
    const vel = va.velocity + ((vb.velocity - va.velocity) * (bar + 0.5)) / plan.length;
    const t0 = beatAt[bar * BEATS_PER_BAR]!;
    const t1 = beatAt[(bar + 1) * BEATS_PER_BAR]!;
    v.upper.forEach((p, i) => push(t0, (t1 - t0) * 0.98, p, vel * (i === 2 ? 1 : 0.8), i === 2 ? 0 : 1, ins.lead));
    for (const beat of [0, 2]) {
      const s = beatAt[bar * BEATS_PER_BAR + beat]!;
      const e = beatAt[bar * BEATS_PER_BAR + beat + 2]!;
      push(s, (e - s) * 0.95, v.bass, vel * 0.85, 2, ins.bass);
    }
    // the top voice anticipates the next chord on the last half-beat
    const next = voiced[bar + 1];
    if (next && next.upper[2] !== v.upper[2]) {
      const nextIns = bar + 1 < handover ? va : vb;
      const half = (t1 - beatAt[bar * BEATS_PER_BAR + 3]!) / 2;
      push(t1 - half, half * 0.9, next.upper[2]!, vel * 0.7, 0, nextIns.lead);
    }
  });
  notes.sort((x, y) => x.time - y.time || x.pitch - y.pitch);
  return { notes, duration: beatAt[beats]!, tempo: { start: bpmA, end: bpmB } };
}
