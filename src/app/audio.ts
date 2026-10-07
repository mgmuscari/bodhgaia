// App shell: the game's audio handle. Browsers block sound until a user gesture, so the AudioContext is created
// LAZILY inside the first gesture (`installAudioUnlock`: the first pointerdown/keydown) — no autoplay warning, no
// context at all for a player who never interacts. Until then (and on a platform without WebAudio) the engine
// is a silent no-op: play() → null, volumes/mute are remembered and applied when the context arrives.

import type { AudioEngine, Bus } from '../audio/contract';
import { createSynthEngine, type SynthEngine } from '../audio/engine';
import type { AudioSettings } from '../ui/settings';

export type GameAudio = AudioEngine & { dispose(): void };

export function createAudio(): GameAudio {
  let engine: SynthEngine | null = null;
  const volumes = new Map<Bus | 'master', number>();
  let muted = false;

  const start = (): SynthEngine | null => {
    if (engine) return engine;
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctor) return null;
    try {
      engine = createSynthEngine(new Ctor({ latencyHint: 'interactive' }));
    } catch {
      return null; // no audio device / blocked — stay silent
    }
    for (const [bus, v] of volumes) engine.setVolume(bus, v);
    engine.setMuted(muted);
    return engine;
  };

  return {
    get ready() {
      return engine?.ready ?? false;
    },
    unlock: () => start()?.unlock(),
    now: () => engine?.now() ?? 0,
    play: (note) => engine?.play(note) ?? null,
    setVolume: (bus, volume) => {
      volumes.set(bus, volume);
      engine?.setVolume(bus, volume);
    },
    setMuted: (m) => {
      muted = m;
      engine?.setMuted(m);
    },
    dispose: () => {
      if (!engine) return;
      engine.dispose();
      void (engine.context as AudioContext).close?.().catch(() => {});
      engine = null;
    },
  };
}

/** Apply the player's mixer settings to the engine (Settings' "effects" is the engine's `sfx` bus). */
export function applyAudioSettings(engine: AudioEngine, a: AudioSettings): void {
  engine.setVolume('master', a.master);
  engine.setVolume('music', a.music);
  engine.setVolume('sfx', a.effects);
  engine.setVolume('ambience', a.ambience);
  engine.setMuted(a.muted);
}

/** Unlock audio on the first pointerdown/keydown (once). Returns an uninstaller. */
export function installAudioUnlock(engine: AudioEngine, target: EventTarget = window): () => void {
  const events = ['pointerdown', 'keydown'] as const;
  const off = (): void => {
    for (const e of events) target.removeEventListener(e, onGesture, true);
  };
  function onGesture(): void {
    off();
    engine.unlock();
  }
  for (const e of events) target.addEventListener(e, onGesture, true);
  return off;
}
