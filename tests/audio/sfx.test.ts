import { describe, it, expect } from 'vitest';
import { INSTRUMENTS } from '../../src/audio/contract';
import { BuiltKind } from '../../src/engine/fabric';
import {
  CUES,
  CUE_NAMES,
  LONG_CUES,
  SFX_LIMITS,
  cueLength,
  createSfx,
  placeCategoryOf,
  PLACE_CATEGORIES,
  type CueName,
} from '../../src/audio/sfx';
import { fakeEngine } from './fakeEngine';

describe('sfx cues as data', () => {
  it('defines every named cue, one per place category', () => {
    for (const c of PLACE_CATEGORIES) expect(CUE_NAMES).toContain(`place-${c}`);
    for (const n of ['uiClick', 'uiOpen', 'uiClose', 'toolSelect', 'bulldoze', 'denied', 'unlock', 'relief', 'loanTaken', 'arrest'])
      expect(CUE_NAMES).toContain(n);
  });

  for (const name of Object.keys(CUES) as CueName[]) {
    const cue = CUES[name];
    it(`${name}: contract instruments only, sane notes, short, under the voice cap`, () => {
      expect(cue.length).toBeGreaterThan(0);
      expect(cue.length).toBeLessThanOrEqual(SFX_LIMITS.voicesPerCue);
      for (const n of cue) {
        expect(INSTRUMENTS).toContain(n.instrument);
        expect(n.velocity).toBeGreaterThan(0);
        expect(n.velocity).toBeLessThanOrEqual(0.6); // small sounds — nothing blares
        expect(n.pitch).toBeGreaterThanOrEqual(24);
        expect(n.pitch).toBeLessThanOrEqual(SFX_LIMITS.maxPitch); // warm, never shrill
        expect(n.offset).toBeGreaterThanOrEqual(0);
        expect(n.duration).toBeGreaterThan(0);
        expect(n.instrument).not.toBe('chant'); // the chant voice is never an alert
      }
      const limit = LONG_CUES.includes(name) ? SFX_LIMITS.maxLongCue : SFX_LIMITS.maxCue;
      expect(cueLength(cue)).toBeLessThanOrEqual(limit);
    });
  }

  it('only unlock and relief run long; the rest stay under a second', () => {
    expect([...LONG_CUES].sort()).toEqual(['relief', 'unlock']);
    expect(SFX_LIMITS.maxCue).toBeLessThan(1);
  });

  it('arrest is sober: low, no bright/bird/bell timbres, no rising jingle', () => {
    const cue = CUES.arrest;
    for (const n of cue) {
      expect(['chime', 'bell', 'chirp', 'marimba', 'harp']).not.toContain(n.instrument);
      expect(n.pitch).toBeLessThan(60);
      expect(n.velocity).toBeLessThanOrEqual(0.35);
    }
    const pitched = [...cue].sort((a, b) => a.offset - b.offset).map((n) => n.pitch);
    expect(pitched[pitched.length - 1]!).toBeLessThanOrEqual(pitched[0]!); // never resolves upward
  });

  it('relief is ambivalent: it carries both a major and a minor third over its root', () => {
    const pcs = new Set(CUES.relief.map((n) => ((n.pitch % 12) + 12) % 12));
    const root = ((Math.min(...CUES.relief.map((n) => n.pitch)) % 12) + 12) % 12;
    expect(pcs.has((root + 3) % 12) || pcs.has((root + 4) % 12)).toBe(true);
    expect(pcs.has((root + 3) % 12) && pcs.has((root + 4) % 12)).toBe(true);
  });

  it('unlock rises — a small bright fanfare', () => {
    const melodic = [...CUES.unlock].sort((a, b) => a.offset - b.offset).map((n) => n.pitch);
    expect(melodic[melodic.length - 1]!).toBeGreaterThan(melodic[0]!);
  });
});

describe('createSfx player', () => {
  it('plays a cue on the sfx bus at engine time + offset', () => {
    const e = fakeEngine();
    e.t = 10;
    const sfx = createSfx(e);
    sfx.uiOpen();
    expect(e.played.length).toBe(CUES.uiOpen.length);
    for (const v of e.played) expect(v.note.bus).toBe('sfx');
    const ats = e.played.map((v) => v.note.at!);
    expect(ats).toEqual(CUES.uiOpen.map((n) => 10 + n.offset));
    for (const v of e.played) expect(v.note.duration).toBeGreaterThan(0); // never an unbounded voice
  });

  it('every method maps to its cue', () => {
    const e = fakeEngine();
    const sfx = createSfx(e);
    const calls: [() => void, CueName][] = [
      [sfx.uiClick, 'uiClick'],
      [sfx.uiClose, 'uiClose'],
      [sfx.toolSelect, 'toolSelect'],
      [sfx.bulldoze, 'bulldoze'],
      [sfx.denied, 'denied'],
      [sfx.unlock, 'unlock'],
      [sfx.relief, 'relief'],
      [sfx.loanTaken, 'loanTaken'],
      [sfx.arrest, 'arrest'],
      [() => sfx.place('commons'), 'place-commons'],
    ];
    for (const [fn, name] of calls) {
      e.t += 5;
      const before = e.played.length;
      fn();
      expect(e.played.slice(before).map((v) => v.note.instrument)).toEqual(CUES[name].map((n) => n.instrument));
    }
  });

  it('rate-limits a road drag: at most one place cue per window, all categories sharing it', () => {
    const e = fakeEngine();
    const sfx = createSfx(e);
    let cues = 0;
    for (let i = 0; i < 100; i++) {
      e.t = i * 0.01; // a 1 s drag, an event every 10 ms
      const before = e.played.length;
      sfx.place(i % 2 ? 'road' : 'zone');
      if (e.played.length > before) cues++;
    }
    expect(cues).toBeGreaterThan(5);
    expect(cues).toBeLessThanOrEqual(Math.ceil(1 / SFX_LIMITS.placeInterval) + 1);
  });

  it('repeated places vary in pitch so a drag does not machine-gun', () => {
    const e = fakeEngine();
    const sfx = createSfx(e);
    const first: number[] = [];
    for (let i = 0; i < 6; i++) {
      e.t = i;
      const before = e.played.length;
      sfx.place('road');
      first.push(e.played[before]!.note.pitch);
    }
    expect(new Set(first).size).toBeGreaterThan(2);
    const base = CUES['place-road'][0]!.pitch;
    for (const p of first) expect(Math.abs(p - base)).toBeLessThanOrEqual(1); // slight, not a melody
  });

  it('rate-limits sober and loud cues too (an arrest sweep is one tone, not a burst)', () => {
    const e = fakeEngine();
    const sfx = createSfx(e);
    sfx.arrest();
    const n = e.played.length;
    e.t = 0.2;
    sfx.arrest();
    expect(e.played.length).toBe(n);
    e.t = 5;
    sfx.arrest();
    expect(e.played.length).toBe(2 * n);
  });

  it('caps simultaneous sfx voices', () => {
    const e = fakeEngine();
    const sfx = createSfx(e);
    // Everything at once, distinct cues (no shared rate-limit).
    sfx.unlock();
    sfx.relief();
    sfx.bulldoze();
    sfx.loanTaken();
    sfx.place('civic');
    sfx.uiOpen();
    const live = e.played.filter((v) => v.note.at! + v.note.duration! > e.t + 0.001);
    expect(live.length).toBeLessThanOrEqual(SFX_LIMITS.maxVoices);
  });

  it('tolerates a locked engine (play → null) without throwing or burning the rate limit', () => {
    const e = fakeEngine();
    e.live = false;
    const sfx = createSfx(e);
    expect(() => sfx.uiClick()).not.toThrow();
    e.live = true;
    sfx.uiClick();
    expect(e.played.length).toBe(CUES.uiClick.length);
  });
});

describe('placeCategoryOf', () => {
  it('maps built kinds onto the six place categories', () => {
    expect(placeCategoryOf(BuiltKind.RoadStreet)).toBe('road');
    expect(placeCategoryOf(BuiltKind.Rail)).toBe('transit');
    expect(placeCategoryOf(BuiltKind.BikePath)).toBe('transit');
    expect(placeCategoryOf(BuiltKind.Apartments)).toBe('zone');
    expect(placeCategoryOf(BuiltKind.Clinic)).toBe('civic');
    expect(placeCategoryOf(BuiltKind.SolarPlant)).toBe('power');
    expect(placeCategoryOf(BuiltKind.EnergyNode)).toBe('power');
    expect(placeCategoryOf(BuiltKind.CommunityGarden)).toBe('commons');
    expect(placeCategoryOf(BuiltKind.Park)).toBe('commons');
    expect(placeCategoryOf(undefined)).toBe('zone');
  });
});
