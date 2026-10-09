// The music player: plays parsed pieces through the AudioEngine's 'music' bus with a lookahead scheduler — every
// tick (~50 ms) it hands the engine the notes that fall within the next ~200 ms, timed on the engine clock, so
// timer jitter never reaches the music. Moods pick from tagged tracks ('day', 'night', 'calm'); every change of piece
// is joined by a generated bridge (bridge.ts) that resolves into the next. Gentle by construction: softened
// velocities, a voice cap, long notes trimmed, most drums dropped. The engine is the contract only — this module never touches WebAudio.
import type { AudioEngine, InstrumentId, Voice } from '../contract';
import { instrumentForProgram, percussionFor } from './gm';
import { parseMidi, type MidiNote, type MidiPiece } from './midi';
import { dueNotes, Polyphony, soften } from './sequencer';
import { bridge, type BridgeFrom } from './bridge';

export type Mood = 'day' | 'night' | 'calm';

/** What the player needs to know about a track (the manifest in tracks.ts adds the credits). */
export interface PlayableTrack {
  id: string;
  moods: readonly Mood[];
  /** A Standard MIDI File under public/music/. */
  file?: string;
  /** Playback-rate multiplier (< 1 slower). Default 1. */
  rate?: number;
}

export interface MusicPlayerOptions {
  /** Fetch + parse a track. Default: fetch `${BASE_URL}music/${file}` . */
  load?: (track: PlayableTrack) => Promise<MidiPiece>;
  /** Run `fn` every `ms`; returns a canceller. Default setInterval. */
  every?: (ms: number, fn: () => void) => () => void;
  /** 0..1 — picks the next track. Default Math.random. */
  random?: () => number;
  /** Seconds scheduled ahead of the engine clock. Default 0.2. */
  lookahead?: number;
  /** Scheduler tick, ms. Default 50. */
  tickMs?: number;
  /** Simultaneous-note cap. Default 8. */
  maxVoices?: number;
  /** Seconds of silence between pieces when they are not bridged. Default 6. */
  gap?: number;
  /** Join every change of piece with a generated bridge (bridge.ts) instead of a gap. Default true. */
  bridges?: boolean;
  /** Initial mood. Default 'day'. */
  mood?: Mood;
}

export interface MusicPlayer {
  /** Start a track by id now (releasing whatever was playing). Rejects on an unknown id or a failed load. */
  play(trackId: string): Promise<void>;
  /** Release everything and stay silent until play()/next(). */
  stop(): void;
  /** Switch now to another track of the current mood (from silence too). */
  next(): Promise<void>;
  /** Choose the pool the NEXT piece is drawn from; the current piece finishes first (call next() to switch now). */
  setMood(mood: Mood): void;
  readonly mood: Mood;
  /** The playing track's id, or null when silent. */
  readonly current: string | null;
  readonly tracks: readonly PlayableTrack[];
}

/** Seconds between play() and the first note — room for the first scheduler tick. */
const LEAD = 0.1;
/** Long notes (held pedal, drones) are trimmed so voices free up. */
const MAX_NOTE = 8;
/** The melody's channel (an arrangement's lead, the right hand of a score): admitted first among notes
 *  due together; its highest note at each onset (the melody note) may take LEAD_HEADROOM voices past the cap — a held
 *  pad or a comp chord never crowds the tune out. */
const LEAD_CHANNEL = 0;
const LEAD_HEADROOM = 2;
/** The order notes due together are admitted in: the lead, then pitched parts high to low, then drums. */
const priority = (n: MidiNote): number => (n.channel === LEAD_CHANNEL ? 0 : n.percussion ? 2 : 1);
/** Drums, when kept at all, sit well under the melody. */
const PERCUSSION_GAIN = 0.4;
/** A light stereo spread by register: low left, high right, never far. */
const pan = (pitch: number) => Math.max(-0.35, Math.min(0.35, (pitch - 64) / 60));

/** The bridge from `from` followed by `p`, as one piece in `p`'s own time (scaled by its rate), the bridge
 *  resolving exactly on p's first note. */
function bridged(from: BridgeFrom, p: MidiPiece, rateB: number): MidiPiece {
  const br = bridge(from, { piece: p, rate: rateB });
  const shift = br.duration * rateB - (p.notes[0]?.time ?? 0);
  return {
    notes: [
      ...br.notes.map((n) => ({ ...n, time: n.time * rateB, duration: n.duration * rateB })),
      ...p.notes.map((n) => ({ ...n, time: n.time + shift })),
    ],
    duration: p.duration + shift,
    tempo: p.tempo,
  };
}

function defaultLoad(track: PlayableTrack): Promise<MidiPiece> {
  if (!track.file) return Promise.reject(new Error(`music: track ${track.id} has no file`));
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return fetch(`${base}music/${track.file}`)
    .then((r) => {
      if (!r.ok) throw new Error(`music: ${track.file}: HTTP ${r.status}`);
      return r.arrayBuffer();
    })
    .then((b) => parseMidi(new Uint8Array(b)));
}

const defaultEvery = (ms: number, fn: () => void) => {
  const h = setInterval(fn, ms);
  return () => clearInterval(h);
};

export function createMusicPlayer(
  engine: AudioEngine,
  tracks: readonly PlayableTrack[],
  options: MusicPlayerOptions = {},
): MusicPlayer {
  const load = options.load ?? defaultLoad;
  const every = options.every ?? defaultEvery;
  const random = options.random ?? Math.random;
  const lookahead = options.lookahead ?? 0.2;
  const tickMs = options.tickMs ?? 50;
  const bridges = options.bridges ?? true;
  const gap = bridges ? 0 : (options.gap ?? 6);
  const poly = new Polyphony(options.maxVoices ?? 8);
  const cache = new Map<string, MidiPiece>();

  let mood: Mood = options.mood ?? 'day';
  let track: PlayableTrack | null = null;
  let piece: MidiPiece | null = null;
  let cursor = 0;
  let start = 0; // engine time of piece-second 0
  let started = false; // first note handed to the engine (start is fixed from then on)
  let generation = 0; // bumps on every play/stop — stale loads are dropped
  let cancel: (() => void) | null = null;
  let advancing = false;
  let sounding: { voice: Voice; end: number }[] = [];

  const rate = () => track?.rate ?? 1;

  function release(): void {
    const now = engine.now();
    for (const s of sounding) if (s.end > now) s.voice.stop(now);
    sounding = [];
    poly.clear();
  }

  function halt(): void {
    generation++;
    release();
    cancel?.();
    cancel = null;
    track = null;
    piece = null;
  }

  function instrumentFor(n: MidiNote): InstrumentId | null {
    return n.percussion ? percussionFor(n.pitch) : instrumentForProgram(n.program);
  }

  function emit(n: MidiNote, melody = false): void {
    const instrument = instrumentFor(n);
    if (!instrument) return;
    const at = start + n.time / rate();
    const duration = Math.min(MAX_NOTE, Math.max(0.05, n.duration / rate()));
    if (!poly.admit(at, at + duration, melody ? LEAD_HEADROOM : 0)) return;
    const velocity = soften(n.velocity) * (n.percussion ? PERCUSSION_GAIN : 1);
    const voice = engine.play({ instrument, pitch: n.pitch, velocity, bus: 'music', at, duration, pan: pan(n.pitch) });
    if (voice) sounding.push({ voice, end: at + duration });
  }

  function tick(): void {
    if (!piece) return;
    const now = engine.now();
    if (!engine.ready) {
      if (!started) start = now + LEAD; // hold the downbeat until audio unlocks
      return;
    }
    started = true;
    sounding = sounding.filter((s) => s.end > now);
    const r = dueNotes(piece.notes, cursor, (now + lookahead - start) * rate());
    cursor = r.cursor;
    // the melody note of each onset: the highest on the lead channel — it alone gets the headroom
    const melody = new Map<number, MidiNote>();
    for (const n of r.due) if (n.channel === LEAD_CHANNEL && !n.percussion && (melody.get(n.time)?.pitch ?? -1) < n.pitch) melody.set(n.time, n);
    for (const n of [...r.due].sort((a, b) => priority(a) - priority(b) || a.time - b.time || b.pitch - a.pitch)) emit(n, melody.get(n.time) === n);
    if (cursor >= piece.notes.length && now >= start + piece.duration / rate() + gap && !advancing) {
      advancing = true;
      next().catch(() => halt()).finally(() => (advancing = false));
    }
  }

  /** Where the playing piece is leaving from, for a bridge out of it (null from silence). */
  function leaving(): BridgeFrom | null {
    if (!piece || !track || !bridges) return null;
    const at = cursor >= piece.notes.length ? piece.duration : Math.max(0, Math.min(piece.duration, (engine.now() - start) * rate()));
    return { piece, at, rate: rate() };
  }

  async function begin(t: PlayableTrack): Promise<void> {
    const from = leaving();
    halt();
    const gen = generation;
    const p = cache.get(t.id) ?? (await load(t));
    cache.set(t.id, p);
    if (gen !== generation) return; // superseded while loading
    track = t;
    piece = from ? bridged(from, p, t.rate ?? 1) : p;
    cursor = 0;
    started = false;
    start = engine.now() + LEAD;
    cancel = every(tickMs, tick);
    tick();
  }

  function pick(): PlayableTrack | null {
    const pool = tracks.filter((t) => t.moods.includes(mood));
    const fresh = pool.length > 1 ? pool.filter((t) => t.id !== track?.id) : pool;
    if (!fresh.length) return null;
    return fresh[Math.min(fresh.length - 1, Math.floor(random() * fresh.length))]!;
  }

  async function next(): Promise<void> {
    const t = pick();
    if (!t) {
      halt();
      return;
    }
    await begin(t);
  }

  return {
    play(trackId) {
      const t = tracks.find((x) => x.id === trackId);
      if (!t) return Promise.reject(new Error(`music: unknown track ${trackId}`));
      return begin(t);
    },
    stop: halt,
    next,
    setMood(m) {
      mood = m;
    },
    get mood() {
      return mood;
    },
    get current() {
      return track?.id ?? null;
    },
    tracks,
  };
}
