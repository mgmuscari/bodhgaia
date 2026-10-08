import { describe, it, expect } from 'vitest';
import { createTutorial, type TutorialUi } from '../../src/app/tutorial';
import { TUTORIAL } from '../../src/ui/tutorialContent';

const SPOTS = [
  { kind: 'smog' as const, x: 10, y: 10, zoom: 3, caption: 'The air is thickest here.' },
  { kind: 'water' as const, x: 40, y: 5, zoom: 3, caption: 'The water here is poisoned.' },
];

function harness() {
  const log: string[] = [];
  let advance: () => void = () => {};
  let skip: () => void = () => {};
  let cont: () => void = () => {};
  const ui: TutorialUi = {
    say: (t) => log.push(`say ${t}`),
    spotlight: (sel) => log.push(`spot ${sel}`),
    hide: () => log.push('hide'),
    onAdvance: (cb) => (advance = cb),
    onSkip: (cb) => (skip = cb),
    remove: () => log.push('remove'),
  };
  const follows: { x: number; y: number; zoom?: number }[] = [];
  const t = createTutorial({
    ui,
    follow: (x, y, zoom) => follows.push({ x, y, zoom }),
    centre: () => ({ x: 0, y: 0 }),
    spots: () => SPOTS,
    indict: (onContinue) => {
      log.push('indict');
      cont = onContinue;
    },
    onDone: () => log.push('done'),
  });
  return { log, follows, t, advance: () => advance(), skip: () => skip(), cont: () => cont() };
}

describe('the tutorial (act three)', () => {
  it('greets, visits each worst spot, indicts, walks the interface, then hands over the city', () => {
    const h = harness();
    let now = 0;
    h.t.frame(now);
    expect(h.log).toEqual(['spot null', 'say Greetings, Planner.']);
    for (let i = 0; i < 3; i++) h.advance();
    expect(h.log.at(-1)).toBe('say Look at this place! What a mess.');
    h.advance();
    expect(h.log.at(-1)).toBe(`say ${SPOTS[0]!.caption}`);
    h.t.frame((now += 3000)); // the camera has glided there
    expect(h.follows.at(-1)).toEqual({ x: 10, y: 10, zoom: 3 });
    h.advance();
    expect(h.log.at(-1)).toBe(`say ${SPOTS[1]!.caption}`);
    h.advance();
    expect(h.log.at(-1)).toBe('say How did things get this bad??');
    h.advance();
    expect(h.log.slice(-2)).toEqual(['hide', 'indict']);
    h.advance(); // clicks don't advance while the indictment is up
    expect(h.log.at(-1)).toBe('indict');
    h.cont();
    expect(h.log.at(-1)).toBe('say There is a lot of work to do here…');
    const uiSteps = TUTORIAL.filter((s) => s.kind === 'ui');
    for (const s of uiSteps) {
      h.advance();
      expect(h.log.slice(-2)).toEqual([`spot ${s.target}`, `say ${s.text}`]);
    }
    h.advance();
    expect(h.log.slice(-2)).toEqual(['spot null', `say ${(TUTORIAL.at(-1) as { text: string }).text}`]);
    h.advance();
    expect(h.log.slice(-2)).toEqual(['remove', 'done']);
    expect(h.t.active()).toBe(false);
  });

  it('Skip ends it at once, from anywhere', () => {
    const h = harness();
    h.t.frame(0);
    h.advance();
    h.skip();
    expect(h.log.slice(-2)).toEqual(['remove', 'done']);
    h.advance();
    expect(h.log.at(-1)).toBe('done');
  });
});
