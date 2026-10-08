// App shell: the opening's first act (bodhgaia-opening.md §3) — the night. Two epigraphs on a dark screen; then
// the city at night, the camera following one unhoused resident through the streets until they die; the mantra;
// "The City is Awakening!!" as the dawn comes up; then it hands on (`onDone`). Esc skips it all (the walker simply
// goes — nobody dies). Driven once per frame; the overlay (NightUi) and the clock arrive as deps so the sequence
// is testable without a DOM.

import type { GameMap } from '../engine/map';
import type { Rng } from '../engine/rng';
import type { AmbientState } from '../live/types';
import { startWanderer } from '../live/wanderer';
import { AWAKENING, EPIGRAPHS, MANTRA, OPENING_TIMING as T, type Epigraph } from '../ui/openingScript';

/** The act's overlay (DOM in ui/openingNight.ts; a fake in tests). */
export interface NightUi {
  card(e: Epigraph): void;
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
  /** Centre the camera on (x, y) tiles at the follow zoom. */
  follow(x: number, y: number): void;
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
  | { kind: 'done' };

export function createNightOpening(deps: NightDeps): NightOpening {
  const { live, map, ui } = deps;
  let phase: Phase | null = null; // starts on the first frame
  let advanced = false;
  ui.onAdvance(() => (advanced = true));

  const finish = (): void => {
    live.wanderer = undefined;
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
          if (now - phase.since >= T.awakeningMs) finish();
          return;
      }
    },
  };
}
