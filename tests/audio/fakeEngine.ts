// A fake AudioEngine for the sound-design tests: a settable clock, a record of every play() and stop(),
// and switches for "not ready" (play → null). Built against the contract only — never the real engine.
import type { AudioEngine, Bus, NoteSpec, Voice } from '../../src/audio/contract';

export interface FakeVoice extends Voice {
  note: NoteSpec;
  stoppedAt: number | null;
}

export interface FakeEngine extends AudioEngine {
  t: number;
  /** When false, play() returns null (locked / muted / budget spent). */
  live: boolean;
  played: FakeVoice[];
  volumes: Partial<Record<Bus | 'master', number>>;
}

export function fakeEngine(): FakeEngine {
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
        stop(at?: number) {
          v.stoppedAt = at ?? e.t;
        },
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
