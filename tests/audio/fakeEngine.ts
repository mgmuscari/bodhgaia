// A fake AudioEngine for the sound-design tests: a settable clock, a record of every play() and stop(),
// and switches for "not ready" (play → null). Built against the contract only — never the real engine.
import type { AudioEngine, Bus, NoteSpec, Voice } from '../../src/audio/contract';

export interface FakeVoice extends Voice {
  note: NoteSpec;
  stoppedAt: number | null;
  glides: Array<{ velocity?: number; pitch?: number; seconds: number }>;
}

export interface FakeEngine extends AudioEngine {
  t: number;
  /** When false, play() returns null (locked / muted / budget spent). */
  live: boolean;
  played: FakeVoice[];
  volumes: Partial<Record<Bus | 'master', number>>;
}

/** `glide: false` models an engine without Voice.glide (the beds' crossfade fallback). */
export function fakeEngine(opts: { glide?: boolean } = {}): FakeEngine {
  const e: FakeEngine = {
    t: 0,
    live: true,
    played: [],
    volumes: {},
    get ready() {
      return e.live;
    },
    unlock() {
      e.live = true;
    },
    now: () => e.t,
    play(note: NoteSpec): Voice | null {
      if (!e.live) return null;
      const v: FakeVoice = {
        note,
        stoppedAt: null,
        glides: [],
        stop(at?: number) {
          v.stoppedAt = at ?? e.t;
        },
        ...(opts.glide === false
          ? {}
          : {
              glide(to: { velocity?: number; pitch?: number }, seconds: number) {
                v.glides.push({ ...to, seconds });
              },
            }),
      };
      e.played.push(v);
      return v;
    },
    setVolume(bus, volume) {
      e.volumes[bus] = volume;
    },
    setMuted() {},
  };
  return e;
}
