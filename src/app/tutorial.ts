// App shell: the opening's third act — the tutorial (bodhgaia-opening.md §3). The planner is greeted; the camera
// visits the city's worst places (worstSpots), each captioned; "How did things get this bad??" is answered by the
// indictment (the statistics and chronicle overlay); then a spotlight walks the interface, one part at a time.
// Click / Space / Enter moves on; Skip (or Esc) ends it from anywhere. DOM-free: the overlay arrives as TutorialUi.

import { TUTORIAL, type TutorialStep, type WorstSpot } from '../ui/tutorialContent';
import { glide } from '../ui/tourContent';

export interface TutorialUi {
  say(text: string): void;
  /** Spotlight one element (a CSS selector), or none. */
  spotlight(selector: string | null): void;
  /** Hide the dialogue (while the indictment is up). */
  hide(): void;
  onAdvance(cb: () => void): void;
  onSkip(cb: () => void): void;
  remove(): void;
}

export interface TutorialDeps {
  ui: TutorialUi;
  follow(x: number, y: number, zoom?: number): void;
  centre(): { x: number; y: number };
  spots(): readonly WorstSpot[];
  /** Show the indictment; call `onContinue` when the player has read it. */
  indict(onContinue: () => void): void;
  onDone(): void;
}

export interface Tutorial {
  frame(now: number): void;
  active(): boolean;
}

/** How long the camera takes to glide to a worst spot. */
const SPOT_GLIDE_MS = 1800;

type Step = Exclude<TutorialStep, { kind: 'spots' }> | { kind: 'spot'; spot: WorstSpot };

export function createTutorial(deps: TutorialDeps): Tutorial {
  const { ui } = deps;
  let steps: Step[] | null = null;
  let i = -1;
  let done = false;
  let waiting = false; // the indictment is up
  let glideFrom: { x: number; y: number } | null = null;
  let glideSince = 0;
  let lastNow = 0; // the latest frame's time: a step shown between frames starts its glide from it

  const finish = (): void => {
    if (done) return;
    done = true;
    ui.spotlight(null);
    ui.remove();
    deps.onDone();
  };
  const show = (k: number): void => {
    i = k;
    const s = steps![k];
    if (!s) return finish();
    glideFrom = null;
    switch (s.kind) {
      case 'say':
        ui.spotlight(null);
        ui.say(s.text);
        return;
      case 'spot':
        ui.spotlight(null);
        ui.say(s.spot.caption);
        glideFrom = deps.centre();
        glideSince = lastNow;
        return;
      case 'indict':
        ui.spotlight(null);
        ui.hide();
        waiting = true;
        deps.indict(() => {
          waiting = false;
          show(i + 1);
        });
        return;
      case 'ui':
        ui.spotlight(s.target);
        ui.say(s.text);
        return;
    }
  };
  ui.onAdvance(() => {
    if (done || waiting || !steps) return;
    show(i + 1);
  });
  ui.onSkip(finish);

  return {
    active: () => !done,
    frame(now) {
      if (done) return;
      lastNow = now;
      if (!steps) {
        steps = TUTORIAL.flatMap((s): Step[] => (s.kind === 'spots' ? deps.spots().map((spot) => ({ kind: 'spot', spot })) : [s]));
        show(0);
        return;
      }
      const s = steps[i];
      if (s?.kind === 'spot' && glideFrom) {
        const p = glide(glideFrom, s.spot, (now - glideSince) / SPOT_GLIDE_MS);
        deps.follow(p.x, p.y, s.spot.zoom);
      }
    },
  };
}
