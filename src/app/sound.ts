// App shell: SOUND (Maddy 2026-10-07: "we need audio … SNES style"). Owns the engine (src/app/audio.ts — silent
// until the first gesture unlocks it), the cues (src/audio/sfx.ts), the city's soundscape (src/audio/ambience.ts)
// and the music (src/audio/music — Mutopia classical and the game's own arrangements by day and night, the
// gentlest pieces on quiet nights in a city that has made room for healing). A few times a second it listens to the live city through the
// camera: what's in VIEW feeds the ambience and the hour picks the music's mood. Arrests make no sound (Maddy
// 2026-10-07). The pure parts are exported and tested; the rest is a thin timer.

import { createAudio, installAudioUnlock, applyAudioSettings } from './audio';
import { createSfx, type Sfx } from '../audio/sfx';
import { createAmbience, type AmbienceSnapshot } from '../audio/ambience';
import { createMusicPlayer, type Mood } from '../audio/music/player';
import type { MusicControl } from '../ui/musicPickerContent';
import { MUSIC_TRACKS, OPENING_TRACK } from '../audio/music/tracks';
import type { Ambulance, AmbientState, Mover, Truck } from '../live/types';
import { offStreet } from '../live/types';
import { policePhase } from '../live/police';
import type { Voice } from '../audio/contract';
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

/** What the camera hears: moving cars, walkers on the street and flocks in view, and the rain while a storm lasts
 *  (it is on screen too — app/weather.ts). */
export function soundSnapshot(s: AmbientState, view: ViewRect, night: boolean): AmbienceSnapshot {
  let cars = 0;
  for (const c of s.cars) if (!c.parked && inView(view, c.x, c.y)) cars++;
  let peds = 0;
  for (const p of s.peds) if (!offStreet(p) && inView(view, p.x, p.y)) peds++;
  let flocks = 0;
  for (const f of s.birds) if (f.birds.some((b) => inView(view, b.x, b.y))) flocks++;
  return { traffic01: clamp01(cars / FULL.cars), peds01: clamp01(peds / FULL.peds), birds01: clamp01(flocks / FULL.flocks), rain: s.rain !== undefined, night };
}

/** The music's mood from the hour: day, night — and calm (the gentlest classical pieces) on a night in a city that
 *  has a healing commons. */
export function moodFor(hour: number, hasHealing: boolean): Mood {
  const night = hour >= 20 || hour < 6;
  return night ? (hasHealing ? 'calm' : 'night') : 'day';
}


/** The siren (Maddy 2026-10-07: "police could make a siren noise"): a soft, distant two-tone wail — one voice that
 *  GLIDES between two pitches, never re-struck. */
export const SIREN = { lo: 74, hi: 79, swapEvery: 2, base: 0.08, per: 0.05, max: 0.22 } as const;

/** Does a siren wail now, where, and how loud? Only while a cruiser IN VIEW is chasing (not on patrol, not out of
 *  sight); panned toward the cruisers; louder with more of them, but always distant. */
export function sirenFor(
  cruisers: readonly Mover[],
  phase: 'scatter' | 'chase',
  view: ViewRect,
): { on: boolean; pan: number; level: number } {
  if (phase !== 'chase') return { on: false, pan: 0, level: 0 };
  return heardIn(cruisers, view);
}

/** Fire trucks' and ambulances' shared siren (Maddy 2026-10-12: "a different siren from police cars"): a slow wail
 *  rising and falling across a wide span, `sweepTicks` listens each way — not the cruisers' quick two-tone. */
export const WAIL = { lo: 67, hi: 79, sweepTicks: 6 } as const;

/** Does the emergency wail sound now? While a fire truck IN VIEW races to a fire, or an ambulance races to a
 *  patient or carries one back — not while spraying, loading or going home empty. Panned and levelled like the
 *  police siren. */
export function emergencySirenFor(
  trucks: readonly Truck[],
  ambulances: readonly Ambulance[],
  view: ViewRect,
): { on: boolean; pan: number; level: number } {
  const racing: Mover[] = trucks.filter((t) => t.call === 'to-fire');
  for (const a of ambulances) if (a.call === 'to-patient' || (a.call === 'home' && a.patient.carried)) racing.push(a);
  return heardIn(racing, view);
}

/** Panned toward the movers in view; louder with more of them, but always distant. */
function heardIn(movers: readonly Mover[], view: ViewRect): { on: boolean; pan: number; level: number } {
  let n = 0;
  let sx = 0;
  for (const c of movers) {
    if (!inView(view, c.x, c.y)) continue;
    n++;
    sx += c.x;
  }
  if (n === 0) return { on: false, pan: 0, level: 0 };
  const mid = (view.x0 + view.x1) / 2;
  const half = Math.max(1, (view.x1 - view.x0) / 2);
  const pan = Math.max(-1, Math.min(1, (sx / n - mid) / half));
  return { on: true, pan, level: Math.min(SIREN.max, SIREN.base + SIREN.per * (n - 1)) };
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
  /** Play this track first instead of the mood's pick (DEV auditions: ?track=<id>). */
  firstTrack?: string;
  /** The intro (the opening night) is playing: it opens on Kyabdro. */
  intro?: boolean;
}

export interface Sound {
  sfx: Sfx;
  applySettings(a: AudioSettings): void;
  /** The music player as the Settings picker drives it. */
  music: MusicControl;
}

const LISTEN_MS = 250;

/** The first piece of a session: the piece a DEV audition asks for; else Kyabdro while the intro plays (Maddy
 *  2026-10-08: "the music that plays when the intro plays, not every load"); else none — the mood's own pick. */
export function firstPiece(intro: boolean, audition?: string): string | undefined {
  return audition ?? (intro ? OPENING_TRACK : undefined);
}

export function createSound(deps: SoundDeps): Sound {
  const engine = createAudio();
  installAudioUnlock(engine);
  const sfx = createSfx(engine);
  const ambience = createAmbience(engine);
  let mood = moodFor(deps.hour(), deps.hasHealing());
  const music = createMusicPlayer(engine, MUSIC_TRACKS, { mood });
  // waits for the unlock, then the intro's song (or the piece asked for, or the mood's pick); the mood's picks follow
  const first = firstPiece(deps.intro ?? false, deps.firstTrack);
  void (first ? music.play(first) : music.next()).catch(() => music.next().catch(() => {}));
  let resting = false;
  let siren: Voice | null = null;
  let sirenTick = 0;
  const sirenOff = (): void => {
    siren?.stop();
    siren = null;
  };
  let wail: Voice | null = null;
  let wailTick = 0;
  const wailOff = (): void => {
    wail?.stop();
    wail = null;
  };
  setInterval(() => {
    if (deps.hidden()) {
      if (!resting) {
        ambience.stop();
        sirenOff();
        wailOff();
      }
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
    const view = deps.view();
    ambience.update(soundSnapshot(deps.live, view, night));
    const s = sirenFor(deps.live.cruisers, policePhase(deps.live.policeTick), view);
    if (!s.on) sirenOff();
    else if (siren === null) {
      siren = engine.play({ instrument: 'flute', pitch: SIREN.lo, velocity: s.level, bus: 'ambience', pan: s.pan });
      sirenTick = 0;
    } else {
      sirenTick++;
      const high = Math.floor(sirenTick / SIREN.swapEvery) % 2 === 1;
      siren.glide?.({ pitch: high ? SIREN.hi : SIREN.lo, velocity: s.level }, 0.4);
    }
    const e = emergencySirenFor(deps.live.trucks ?? [], deps.live.ambulances ?? [], view);
    if (!e.on) wailOff();
    else {
      if (wail === null) {
        wail = engine.play({ instrument: 'flute', pitch: WAIL.lo, velocity: e.level, bus: 'ambience', pan: e.pan });
        wailTick = 0;
      }
      // rise for sweepTicks listens, fall for as many: one long glide each way
      const at = wailTick++ % (2 * WAIL.sweepTicks);
      const sweep = (WAIL.sweepTicks * LISTEN_MS) / 1000;
      if (at === 0) wail?.glide?.({ pitch: WAIL.hi, velocity: e.level }, sweep);
      else if (at === WAIL.sweepTicks) wail?.glide?.({ pitch: WAIL.lo, velocity: e.level }, sweep);
    }
  }, LISTEN_MS);
  return {
    sfx,
    applySettings: (a) => applyAudioSettings(engine, a),
    music: {
      tracks: MUSIC_TRACKS,
      current: () => music.current,
      play: (id) => void music.play(id).catch(() => {}),
      next: () => void music.next().catch(() => {}),
    },
  };
}
