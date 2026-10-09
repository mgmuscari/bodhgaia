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

/** Unlock audio on a gesture whenever it isn't running: the first one, and again after the device sleeps and the
 *  browser suspends it (Maddy 2026-10-08: the sound was gone on waking). A finger lifting counts — phones only treat
 *  the lift as a gesture — and coming back into view tries at once. Returns an uninstaller. */
export function installAudioUnlock(
  engine: AudioEngine,
  target: EventTarget = window,
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
): () => void {
  const events = ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const;
  const onGesture = (): void => {
    if (!engine.ready) engine.unlock();
  };
  const onVisible = (): void => {
    if (doc?.visibilityState === 'visible') onGesture();
  };
  for (const e of events) target.addEventListener(e, onGesture, true);
  doc?.addEventListener('visibilitychange', onVisible);
  return () => {
    for (const e of events) target.removeEventListener(e, onGesture, true);
    doc?.removeEventListener('visibilitychange', onVisible);
  };
}
