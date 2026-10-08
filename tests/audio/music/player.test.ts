// The music player: a lookahead scheduler over the AudioEngine contract, tested on a fake engine + fake clock.
import { describe, expect, it } from 'vitest';
import type { AudioEngine, NoteSpec, Voice } from '../../../src/audio/contract';
import type { MidiNote, MidiPiece } from '../../../src/audio/music/midi';
import { createMusicPlayer, type PlayableTrack } from '../../../src/audio/music/player';
import { dueNotes, soften, Polyphony } from '../../../src/audio/music/sequencer';

interface Played extends NoteSpec {
  stoppedAt?: number;
}

function fakeEngine(ready = true) {
  const played: Played[] = [];
  const engine: AudioEngine & { ready: boolean; t: number } = {
    ready,
    t: 0,
    unlock() {},
    now: () => engine.t,
    play(note: NoteSpec): Voice | null {
      if (!engine.ready) return null;
      const p: Played = { ...note };
      played.push(p);
      return {
        stop(at?: number) {
          p.stoppedAt = at ?? engine.t;
        },
      };
    },
    setVolume() {},
    setMuted() {},
  };
  return { engine, played };
}

function fakeTimer() {
  const fns = new Set<() => void>();
  return {
    every(_ms: number, fn: () => void) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    tick() {
      for (const f of [...fns]) f();
    },
    get running() {
      return fns.size;
    },
  };
}

const note = (time: number, pitch: number, extra: Partial<MidiNote> = {}): MidiNote => ({
  time,
  duration: 0.5,
  pitch,
  velocity: 1,
  channel: 0,
  program: 0,
  percussion: false,
  ...extra,
});
const piece = (notes: MidiNote[], duration?: number): MidiPiece => ({
  notes,
  duration: duration ?? Math.max(...notes.map((n) => n.time + n.duration)),
});

/** Advance the fake clock in timer-sized steps, ticking the scheduler each step. */
function run(env: ReturnType<typeof fakeEngine>, timer: ReturnType<typeof fakeTimer>, until: number, step = 0.05) {
  while (env.engine.t < until - 1e-9) {
    env.engine.t = Math.round((env.engine.t + step) * 1e6) / 1e6;
    timer.tick();
  }
}

function setup(tracks: PlayableTrack[], pieces: Record<string, MidiPiece>, opts: { ready?: boolean } = {}) {
  const env = fakeEngine(opts.ready ?? true);
  const timer = fakeTimer();
  let r = 0;
  const player = createMusicPlayer(env.engine, tracks, {
    load: async (t) => pieces[t.id]!,
    every: timer.every,
    random: () => (r = (r + 0.37) % 1),
    lookahead: 0.2,
    gap: 2,
  });
  return { env, timer, player };
}

describe('sequencer (pure timing)', () => {
  it('dueNotes returns the notes whose onset falls before the horizon, advancing a cursor', () => {
    const notes = [note(0, 60), note(0.1, 62), note(0.3, 64), note(1, 65)];
    const a = dueNotes(notes, 0, 0.2);
    expect(a.due.map((n) => n.pitch)).toEqual([60, 62]);
    const b = dueNotes(notes, a.cursor, 0.2);
    expect(b.due).toEqual([]); // nothing twice
    const c = dueNotes(notes, b.cursor, 5);
    expect(c.due.map((n) => n.pitch)).toEqual([64, 65]);
    expect(c.cursor).toBe(4);
  });

  it('soften keeps background music quiet but keeps dynamics ordered', () => {
    expect(soften(1)).toBeLessThanOrEqual(0.6);
    expect(soften(0.05)).toBeGreaterThan(0);
    expect(soften(0.3)).toBeLessThan(soften(0.8));
  });

  it('Polyphony refuses notes beyond the cap while others still sound', () => {
    const p = new Polyphony(2);
    expect(p.admit(0, 1)).toBe(true);
    expect(p.admit(0, 1)).toBe(true);
    expect(p.admit(0.5, 1.5)).toBe(false);
    expect(p.admit(1, 2)).toBe(true); // the first two have ended
  });
});

describe('createMusicPlayer', () => {
  const tracks: PlayableTrack[] = [
    { id: 'a', moods: ['day'] },
    { id: 'b', moods: ['day', 'night'] },
    { id: 'c', moods: ['night'] },
    { id: 'quiet', moods: ['calm'] },
  ];
  const pieces: Record<string, MidiPiece> = {
    a: piece([note(0, 60), note(0.5, 62), note(1, 64, { program: 40 })]),
    b: piece([note(0, 50)]),
    c: piece([note(0, 70)]),
    quiet: piece([note(0, 57, { channel: 0 }), note(0, 45, { channel: 1, duration: 4 })]),
  };

  it('schedules ahead on the engine clock, through the music bus, with mapped instruments', async () => {
    const { env, timer, player } = setup(tracks, pieces);
    await player.play('a');
    expect(player.current).toBe('a');
    run(env, timer, 0.1);
    // only notes within the lookahead are scheduled so far
    expect(env.played.map((n) => n.pitch)).toEqual([60]);
    const start = env.played[0]!.at!;
    expect(start).toBeGreaterThanOrEqual(0);
    run(env, timer, 1.5);
    expect(env.played.map((n) => n.pitch)).toEqual([60, 62, 64]);
    expect(env.played.map((n) => +(n.at! - start).toFixed(6))).toEqual([0, 0.5, 1]);
    for (const n of env.played) {
      expect(n.bus).toBe('music');
      expect(n.velocity).toBeLessThanOrEqual(0.6);
      expect(n.duration).toBeCloseTo(0.5);
      // never scheduled in the past, never further ahead than the lookahead (+ one tick)
    }
    expect(env.played[2]!.instrument).toBe('strings');
  });

  it('never schedules a note in the past or beyond the horizon', async () => {
    const { env, timer, player } = setup(tracks, pieces);
    const seen: number[] = [];
    const orig = env.engine.play.bind(env.engine);
    env.engine.play = (n: NoteSpec) => {
      expect(n.at!).toBeGreaterThanOrEqual(env.engine.t - 1e-9);
      expect(n.at!).toBeLessThanOrEqual(env.engine.t + 0.2 + 0.1);
      seen.push(n.pitch);
      return orig(n);
    };
    await player.play('a');
    run(env, timer, 2);
    expect(seen).toEqual([60, 62, 64]);
  });

  it('stop() releases sounding voices and stops the loop', async () => {
    const { env, timer, player } = setup(tracks, pieces);
    await player.play('quiet');
    run(env, timer, 1);
    player.stop();
    expect(player.current).toBeNull();
    expect(env.played.find((n) => n.pitch === 45)!.stoppedAt).toBeCloseTo(1);
    expect(timer.running).toBe(0);
    const count = env.played.length;
    run(env, timer, 10);
    expect(env.played.length).toBe(count);
  });

  it('plays the next track of the current mood after a gap when a piece ends', async () => {
    const { env, timer, player } = setup(tracks, pieces);
    player.setMood('night');
    await player.play('c'); // ends at 0.5 s
    run(env, timer, 1.5);
    expect(env.played.map((n) => n.pitch)).toEqual([70]); // within the gap: silence
    run(env, timer, 4);
    await new Promise((r) => setTimeout(r, 0)); // let the next track load
    run(env, timer, 5);
    expect(player.current).toBe('b'); // the other night track, not a repeat
    expect(env.played.map((n) => n.pitch)).toEqual([70, 50]);
  });

  it('setMood changes the pool at the piece boundary; next() switches now', async () => {
    const { env, timer, player } = setup(tracks, pieces);
    player.setMood('day');
    await player.play('a');
    player.setMood('calm');
    expect(player.mood).toBe('calm');
    expect(player.current).toBe('a'); // the piece finishes
    await player.next();
    expect(player.current).toBe('quiet'); // the only calm track
    run(env, timer, 0.5);
    expect(env.played.some((n) => n.pitch === 57)).toBe(true);
  });

  it('next() from silence starts a track of the current mood', async () => {
    const { player } = setup(tracks, pieces);
    player.setMood('calm');
    await player.next();
    expect(player.current).toBe('quiet');
  });

  it('waits for the engine to unlock before the piece starts (nothing is lost)', async () => {
    const { env, timer, player } = setup(tracks, pieces, { ready: false });
    await player.play('a');
    run(env, timer, 3);
    expect(env.played).toEqual([]);
    env.engine.ready = true;
    run(env, timer, 5);
    expect(env.played.map((n) => n.pitch)).toEqual([60, 62, 64]);
    expect(env.played[0]!.at!).toBeGreaterThanOrEqual(3);
  });

  it('caps simultaneous notes', async () => {
    const thick = piece(Array.from({ length: 20 }, (_, i) => note(0, 40 + i, { duration: 2 })));
    const { env, timer, player } = setup([{ id: 'thick', moods: ['day'] }], { thick });
    await player.play('thick');
    run(env, timer, 1);
    expect(env.played.length).toBeGreaterThan(0);
    expect(env.played.length).toBeLessThanOrEqual(8);
  });

  it('drops percussion it has no soft sound for, and keeps what it keeps quiet', async () => {
    const drums = piece([
      note(0, 36, { channel: 9, percussion: true }),
      note(0, 49, { channel: 9, percussion: true }),
      note(0, 60),
    ]);
    const { env, timer, player } = setup([{ id: 'd', moods: ['day'] }], { d: drums });
    await player.play('d');
    run(env, timer, 0.5);
    const kick = env.played.find((n) => n.instrument === 'thud')!;
    const piano = env.played.find((n) => n.instrument === 'piano')!;
    expect(env.played).toHaveLength(2);
    expect(kick.velocity).toBeLessThan(piano.velocity);
  });

  it('a rate below 1 slows the piece', async () => {
    const { env, timer, player } = setup([{ id: 'a', moods: ['day'], rate: 0.5 }], pieces);
    await player.play('a');
    run(env, timer, 3);
    const t0 = env.played[0]!.at!;
    expect(env.played.map((n) => +(n.at! - t0).toFixed(6))).toEqual([0, 1, 2]);
    expect(env.played[0]!.duration).toBeCloseTo(1);
  });

  it('rejects an unknown track id', async () => {
    const { player } = setup(tracks, pieces);
    await expect(player.play('nope')).rejects.toThrow(/nope/);
  });
});

describe('the melody is never crowded out (Maddy 2026-10-08: the Gymnopédie lost its lead)', () => {
  it('a lead note sounds even when held chords fill the cap and a comp chord lands with it', async () => {
    const held = [48, 52, 55, 59, 62, 64, 67].map((p) => note(0, p, { duration: 4, channel: 3 })); // a pad, filling the cap
    const comp = [57, 60, 64, 66].map((p) => note(1, p, { duration: 0.5, channel: 2 }));
    const lead = note(1, 78, { duration: 1, channel: 0 });
    const drum = note(1, 51, { duration: 0.2, channel: 9, percussion: true });
    const { env, timer, player } = setup([{ id: 'x', moods: ['day'] }], { x: piece([...held, ...comp, lead, drum], 4) });
    await player.play('x');
    run(env, timer, 2);
    expect(env.played.some((p) => p.pitch === 78)).toBe(true); // the melody is heard
    expect(env.played.filter((p) => p.pitch >= 57 && p.pitch <= 66 && (p.at ?? 0) > 0.5).length).toBeLessThan(4); // the comp gave way
  });
});
