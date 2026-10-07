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
  const counting = () => {
    let n = 0;
    const engine = { unlock: () => void n++ } as unknown as AudioEngine;
    return { engine, count: () => n };
  };

  it('unlocks on the first pointerdown, once', () => {
    const t = new EventTarget();
    const e = counting();
    installAudioUnlock(e.engine, t);
    t.dispatchEvent(new Event('pointerdown'));
    t.dispatchEvent(new Event('pointerdown'));
    t.dispatchEvent(new Event('keydown'));
    expect(e.count()).toBe(1);
  });

  it('or on the first keydown', () => {
    const t = new EventTarget();
    const e = counting();
    installAudioUnlock(e.engine, t);
    t.dispatchEvent(new Event('keydown'));
    expect(e.count()).toBe(1);
  });

  it('returns an uninstaller', () => {
    const t = new EventTarget();
    const e = counting();
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
