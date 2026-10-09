import { describe, it, expect } from 'vitest';
import { applyAudioSettings, createAudio, installAudioUnlock } from '../../src/app/audio';
import type { AudioEngine } from '../../src/audio/contract';

// The app's audio handle. The AudioContext is created lazily inside the first user gesture (browsers block sound
// until then), so before unlock — and on a platform with no WebAudio at all (this node test) — the engine is a
// silent, safe no-op: play() → null, nothing throws.

describe('createAudio without WebAudio', () => {
  it('is a safe silent engine: not ready, play → null, controls and dispose are no-ops', () => {
    const a = createAudio();
    expect(a.ready).toBe(false);
    expect(a.now()).toBe(0);
    expect(a.play({ instrument: 'piano', pitch: 60, velocity: 1, bus: 'music' })).toBeNull();
    a.setVolume('master', 0.3);
    a.setVolume('music', 2);
    a.setMuted(true);
    a.unlock(); // no AudioContext in node → stays not ready, no throw
    expect(a.ready).toBe(false);
    a.dispose();
  });
});

describe('installAudioUnlock', () => {
  // The engine counts unlocks, and is "ready" once one lands — until the device sleeps and the browser suspends it.
  const engineLike = () => {
    let n = 0;
    const e = { ready: false, unlock: () => void (n++, (e.ready = true)) };
    return { engine: e as unknown as AudioEngine & { ready: boolean }, count: () => n, sleep: () => void (e.ready = false) };
  };

  it('unlocks on the first pointerdown, and not again while the sound runs', () => {
    const t = new EventTarget();
    const e = engineLike();
    installAudioUnlock(e.engine, t);
    t.dispatchEvent(new Event('pointerdown'));
    t.dispatchEvent(new Event('pointerdown'));
    t.dispatchEvent(new Event('keydown'));
    expect(e.count()).toBe(1);
  });

  it('or on the first keydown — or a finger lifting (phones only count the lift as a gesture)', () => {
    for (const type of ['keydown', 'touchend', 'pointerup']) {
      const t = new EventTarget();
      const e = engineLike();
      installAudioUnlock(e.engine, t);
      t.dispatchEvent(new Event(type));
      expect(e.count(), type).toBe(1);
    }
  });

  // Maddy 2026-10-08: "if the device goes to sleep the sound is gone when it wakes back up".
  it('after the device sleeps (the browser suspends the sound), the next tap brings it back', () => {
    const t = new EventTarget();
    const e = engineLike();
    installAudioUnlock(e.engine, t);
    t.dispatchEvent(new Event('pointerdown'));
    e.sleep();
    t.dispatchEvent(new Event('pointerdown'));
    expect(e.count()).toBe(2);
    expect(e.engine.ready).toBe(true);
  });

  it('and coming back into view tries at once, without waiting for a tap', () => {
    const t = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const e = engineLike();
    installAudioUnlock(e.engine, t, doc as unknown as Document);
    t.dispatchEvent(new Event('pointerdown'));
    e.sleep();
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(e.count()).toBe(2);
  });

  it('returns an uninstaller', () => {
    const t = new EventTarget();
    const e = engineLike();
    const off = installAudioUnlock(e.engine, t);
    off();
    t.dispatchEvent(new Event('pointerdown'));
    expect(e.count()).toBe(0);
  });
});

describe('applyAudioSettings', () => {
  it('maps the settings onto the engine buses (effects → sfx) and the mute', () => {
    const calls: string[] = [];
    const engine = {
      setVolume: (bus: string, v: number) => calls.push(`${bus}=${v}`),
      setMuted: (m: boolean) => calls.push(`muted=${m}`),
    } as unknown as AudioEngine;
    applyAudioSettings(engine, { master: 0.7, music: 0.5, effects: 0.6, ambience: 0.4, muted: true });
    expect(calls).toEqual(['master=0.7', 'music=0.5', 'sfx=0.6', 'ambience=0.4', 'muted=true']);
  });
});
