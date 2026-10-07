import { describe, it, expect } from 'vitest';
import { createSettingsController } from '../../src/app/settings';
import { SETTINGS_KEY } from '../../src/ui/settingsStore';
import { DEFAULT_SETTINGS, CAP_PRESETS } from '../../src/ui/settings';

// The settings controller: the persisted settings blob (loaded once at boot), and the Settings window's
// callbacks — live caps apply at once, world size persists for the next load, the renderer switches at once.
// Every change clamps the merged blob so applied == persisted == shown, and re-persists the whole blob.

function memStorage(seed: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(seed));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

function setup(seed: Record<string, string> = {}) {
  const storage = memStorage(seed);
  const log: string[] = [];
  const s = createSettingsController({
    storage,
    applyLive: (caps) => log.push(`live:${caps.carCap}`),
    setRenderer: (mode) => log.push(`renderer:${mode}`),
  });
  const persisted = () => JSON.parse(storage.getItem(SETTINGS_KEY) ?? 'null');
  return { s, log, persisted };
}

describe('createSettingsController', () => {
  it('loads the defaults when nothing is stored, and a stored blob otherwise', () => {
    expect(setup().s.current()).toEqual(DEFAULT_SETTINGS);
    const stored = { ...DEFAULT_SETTINGS, renderer: 'cpu' };
    expect(setup({ [SETTINGS_KEY]: JSON.stringify(stored) }).s.current().renderer).toBe('cpu');
  });

  it('applies a live-cap change at once, clamped, and persists the whole blob', () => {
    const h = setup();
    h.s.panel.onLiveChange({ ...CAP_PRESETS.medium, carCap: 999_999 });
    const clamped = h.s.current().live.carCap;
    expect(clamped).toBeLessThan(999_999);
    expect(h.log).toEqual([`live:${clamped}`]);
    expect(h.persisted().live.carCap).toBe(clamped);
    expect(h.s.panel.getSettings()).toBe(h.s.current());
  });

  it('persists a world-size change without applying anything (it takes effect on the next load)', () => {
    const h = setup();
    h.s.panel.onWorldChange({ mapWidth: 96, mapHeight: 96 });
    expect(h.log).toEqual([]);
    expect(h.persisted().world).toEqual({ mapWidth: 96, mapHeight: 96 });
  });

  it('persists, then switches the renderer', () => {
    const h = setup();
    h.s.panel.onRendererChange('cpu');
    expect(h.persisted().renderer).toBe('cpu');
    expect(h.log).toEqual(['renderer:cpu']);
  });
});

describe('createSettingsController — audio', () => {
  it('applies an audio change at once, clamped, and persists it', () => {
    const storage = memStorage();
    const applied: unknown[] = [];
    const s = createSettingsController({
      storage,
      applyLive: () => {},
      setRenderer: () => {},
      applyAudio: (a) => applied.push(a),
    });
    s.panel.onAudioChange({ ...DEFAULT_SETTINGS.audio, music: 3, muted: true });
    expect(s.current().audio.music).toBe(1);
    expect(applied).toEqual([s.current().audio]);
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)!).audio).toEqual(s.current().audio);
  });

  it('works without an audio sink (applyAudio is optional)', () => {
    const s = createSettingsController({ storage: memStorage(), applyLive: () => {}, setRenderer: () => {} });
    expect(() => s.panel.onAudioChange({ ...DEFAULT_SETTINGS.audio, muted: true })).not.toThrow();
    expect(s.current().audio.muted).toBe(true);
  });
});
