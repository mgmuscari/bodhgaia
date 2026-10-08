// App shell: the opening's first two acts (bodhgaia-opening.md §3) — the night, then the vows. Two epigraphs on a dark screen; then
// the city at night, the camera following one unhoused resident through the streets until they die; the mantra;
// "The City is Awakening!!" as the dawn comes up; then the vows, the camera gliding across the city from stop to
// stop and ending wide on the whole of it; then it hands on (`onDone`). Esc skips it all (the walker simply
// goes — nobody dies). Driven once per frame; the overlay (NightUi) and the clock arrive as deps so the sequence
// is testable without a DOM.

import type { GameMap } from '../engine/map';
import type { Rng } from '../engine/rng';
import type { AmbientState } from '../live/types';
import { startWanderer } from '../live/wanderer';
import { AWAKENING, EPIGRAPHS, MANTRA, VOWS, OPENING_TIMING as T, type Epigraph } from '../ui/openingScript';
import { glide, type TourStop } from '../ui/tourContent';

/** The act's overlay (DOM in ui/openingNight.ts; a fake in tests). */
export interface NightUi {
  card(e: Epigraph): void;
  /** Act two: one vow, over the city (the camera touring). */
  vow(text: string): void;
  /** Show the first `n` words of the mantra. */
  words(n: number): void;
  title(text: string): void;
  clear(): void;
  onAdvance(cb: () => void): void;
  onSkip(cb: () => void): void;
  remove(): void;
}

export interface NightDeps {
  live: AmbientState;
  map: GameMap;
  rng: Rng;
  ui: NightUi;
  /** Centre the camera on (x, y) tiles at `zoom` (default: the follow zoom). */
  follow(x: number, y: number, zoom?: number): void;
  /** Where the camera is centred now (tiles) — the tour's glides start from it. */
  centre(): { x: number; y: number };
  /** The tour's stops (act two). */
  stops(): readonly TourStop[];
  hour(): number;
  setHour(hour: number): void;
  onDone(): void;
}

export interface NightOpening {
  frame(now: number): void;
  active(): boolean;
}

type Phase =
  | { kind: 'epigraph'; i: number; since: number }
  | { kind: 'walk' }
  | { kind: 'hold'; since: number; x: number; y: number }
  | { kind: 'mantra'; since: number; shown: number; x: number; y: number }
  | { kind: 'awaken'; since: number; x: number; y: number }
  | { kind: 'vow'; i: number; since: number; from: { x: number; y: number }; stops: readonly TourStop[] }
  | { kind: 'done' };

export function createNightOpening(deps: NightDeps): NightOpening {
  const { live, map, ui } = deps;
  let phase: Phase | null = null; // starts on the first frame
  let advanced = false;
  ui.onAdvance(() => (advanced = true));

  const finish = (): void => {
    live.wanderer = undefined;
    // skipped in the night? the city still wakes: forward to dawn (never backwards in the day)
    const h = deps.hour();
    if (h < T.dawnHour || h >= 20) deps.setHour(T.dawnHour);
    ui.remove();
    phase = { kind: 'done' };
    deps.onDone();
  };
  ui.onSkip(() => {
    if (phase?.kind !== 'done') finish(); // Esc: at once
  });
  const toWalk = (): void => {
    ui.clear();
    if (startWanderer(live, map, deps.rng, T.walkSubsteps)) phase = { kind: 'walk' };
    else toAwaken(0, map.width >> 1, map.height >> 1); // nowhere to walk: straight to the dawn
  };
  const toVow = (i: number, now: number, stops: readonly TourStop[]): void => {
    if (stops.length === 0) return finish();
    advanced = false;
    ui.vow(VOWS[i]!);
    phase = { kind: 'vow', i, since: now, from: deps.centre(), stops };
  };
  const toAwaken = (now: number, x: number, y: number): void => {
    const h = deps.hour();
    if (h < T.dawnHour || h >= 20) deps.setHour(T.dawnHour); // forward to dawn (never backwards in the day)
    ui.title(AWAKENING);
    phase = { kind: 'awaken', since: now, x, y };
  };

  return {
    active: () => phase?.kind !== 'done',
    frame(now) {
      if (phase?.kind === 'done') return;
      if (!phase) {
        phase = { kind: 'epigraph', i: 0, since: now };
        ui.card(EPIGRAPHS[0]!);
        return;
      }
      switch (phase.kind) {
        case 'epigraph': {
          if (!advanced && now - phase.since < T.epigraphMs) return;
          advanced = false;
          const i = phase.i + 1;
          if (i < EPIGRAPHS.length) {
            phase = { kind: 'epigraph', i, since: now };
            ui.card(EPIGRAPHS[i]!);
          } else toWalk();
          return;
        }
        case 'walk': {
          const w = live.wanderer;
          if (w) return deps.follow(w.x + 0.5, w.y + 0.5);
          const f = live.fallen?.at(-1) ?? live.memorials?.at(-1);
          phase = { kind: 'hold', since: now, x: f ? f.x : 0, y: f ? f.y : 0 };
          return;
        }
        case 'hold':
          deps.follow(phase.x + 0.5, phase.y + 0.5);
          if (now - phase.since >= T.holdMs) {
            phase = { kind: 'mantra', since: now, shown: 1, x: phase.x, y: phase.y };
            ui.words(1);
          }
          return;
        case 'mantra': {
          deps.follow(phase.x + 0.5, phase.y + 0.5); // the camera stays with them
          if (phase.shown < MANTRA.length) {
            if (now - phase.since >= T.mantraWordMs) {
              phase = { ...phase, since: now, shown: phase.shown + 1 };
              ui.words(phase.shown);
            }
            return;
          }
          if (now - phase.since >= T.mantraHoldMs) toAwaken(now, phase.x, phase.y);
          return;
        }
        case 'awaken':
          deps.follow(phase.x + 0.5, phase.y + 0.5);
          if (now - phase.since >= T.awakeningMs) toVow(0, now, deps.stops());
          return;
        case 'vow': {
          const stop = phase.stops[phase.i]!;
          const p = glide(phase.from, stop, (now - phase.since) / (T.vowMs * T.glideShare));
          deps.follow(p.x, p.y, stop.zoom);
          if (!advanced && now - phase.since < T.vowMs) return;
          advanced = false;
          if (phase.i + 1 < VOWS.length && phase.i + 1 < phase.stops.length) toVow(phase.i + 1, now, phase.stops);
          else finish();
          return;
        }
      }
    },
  };
}
