// App shell: SOUND (Maddy 2026-10-07: "we need audio … SNES style"). Owns the engine (src/app/audio.ts — silent
// until the first gesture unlocks it), the cues (src/audio/sfx.ts), the city's soundscape (src/audio/ambience.ts)
// and the music (src/audio/music — Mutopia classical by day and night, the transcribed Pali recitation on quiet
// nights in a city that has made room for healing). A few times a second it listens to the live city through the
// camera: what's in VIEW feeds the ambience, the hour picks the music's mood, and a rise in police violence is
// heard as an arrest. The pure parts are exported and tested; the rest is a thin timer.

import { createAudio, installAudioUnlock, applyAudioSettings } from './audio';
import { createSfx, type Sfx } from '../audio/sfx';
import { createAmbience, type AmbienceSnapshot } from '../audio/ambience';
import { createMusicPlayer, type Mood } from '../audio/music/player';
import { MUSIC_TRACKS } from '../audio/music/tracks';
import type { AmbientState } from '../live/types';
import type { AudioSettings } from '../ui/settings';

/** The tile rectangle the camera shows (inclusive-exclusive). */
export interface ViewRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** How many of each fill the ambience's 0..1 (a busy view). */
const FULL = { cars: 30, peds: 60, flocks: 3 } as const;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const inView = (v: ViewRect, x: number, y: number): boolean => x >= v.x0 && x < v.x1 && y >= v.y0 && y < v.y1;

/** What the camera hears: moving cars, walkers on the street and flocks in view. No rain yet — the live layer's
 *  storms aren't visible, and rain you can hear but not see would only confuse. */
export function soundSnapshot(s: AmbientState, view: ViewRect, night: boolean): AmbienceSnapshot {
  let cars = 0;
  for (const c of s.cars) if (!c.parked && inView(view, c.x, c.y)) cars++;
  let peds = 0;
  for (const p of s.peds) if (p.phase !== 'inside' && p.phase !== 'driving' && inView(view, p.x, p.y)) peds++;
  let flocks = 0;
  for (const f of s.birds) if (f.birds.some((b) => inView(view, b.x, b.y))) flocks++;
  return { traffic01: clamp01(cars / FULL.cars), peds01: clamp01(peds / FULL.peds), birds01: clamp01(flocks / FULL.flocks), rain: false, night };
}

/** The music's mood from the hour: day, night — and calm (the Pali recitation) on a night in a city that has a
 *  healing commons. The chants are for the quiet hours only, never under the day's bustle. */
export function moodFor(hour: number, hasHealing: boolean): Mood {
  const night = hour >= 20 || hour < 6;
  return night ? (hasHealing ? 'calm' : 'night') : 'day';
}

/** True when police violence rose since the last listen — an arrest happened (the stain fading is not one). */
export function arrestsSince(prev: number, now: number): boolean {
  return now > prev + 1e-9;
}

export interface SoundDeps {
  live: AmbientState;
  /** The camera's tile rectangle now. */
  view(): ViewRect;
  /** The in-game hour 0..23. */
  hour(): number;
  /** Does the city have a healing commons? */
  hasHealing(): boolean;
  /** Is the tab hidden (the soundscape rests)? */
  hidden(): boolean;
}

export interface Sound {
  sfx: Sfx;
  applySettings(a: AudioSettings): void;
}

const LISTEN_MS = 250;

export function createSound(deps: SoundDeps): Sound {
  const engine = createAudio();
  installAudioUnlock(engine);
  const sfx = createSfx(engine);
  const ambience = createAmbience(engine);
  let mood = moodFor(deps.hour(), deps.hasHealing());
  const music = createMusicPlayer(engine, MUSIC_TRACKS, { mood });
  void music.next().catch(() => {}); // waits for the unlock, then the first piece of the mood
  const violence = (): number => {
    let t = 0;
    for (const v of deps.live.policeViolence.values()) t += v;
    return t;
  };
  let lastViolence = violence();
  let resting = false;
  setInterval(() => {
    if (deps.hidden()) {
      if (!resting) ambience.stop();
      resting = true;
      return;
    }
    resting = false;
    const m = moodFor(deps.hour(), deps.hasHealing());
    if (m !== mood) {
      mood = m;
      music.setMood(m); // the next piece follows the hour; the current one finishes
    }
    const night = m !== 'day';
    ambience.update(soundSnapshot(deps.live, deps.view(), night));
    const v = violence();
    if (arrestsSince(lastViolence, v)) sfx.arrest();
    lastViolence = v;
  }, LISTEN_MS);
  return { sfx, applySettings: (a) => applyAudioSettings(engine, a) };
}
