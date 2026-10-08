import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, placeTransport } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { createAmbientState } from '../../src/live/types';
import { createNightOpening, type NightUi } from '../../src/app/openingNight';
import { EPIGRAPHS, MANTRA, AWAKENING, VOWS, TITLE_CARDS, OPENING_TIMING as T } from '../../src/ui/openingScript';

const STOPS = [
  { x: 10, y: 10, zoom: 2 },
  { x: 20, y: 20, zoom: 3 },
  { x: 25, y: 5, zoom: 2 },
  { x: 15, y: 15, zoom: 1 },
];
import { stepWanderer } from '../../src/live/wanderer';
import { stepDeaths } from '../../src/live/death';

function harness() {
  const map = new GameMap(30, 30);
  for (let i = 0; i < 30; i++) placeTransport(map, i, 10, BuiltKind.RoadStreet);
  const live = createAmbientState();
  live.unhoused = 10;
  const log: string[] = [];
  let advance: () => void = () => {};
  let skip: () => void = () => {};
  const ui: NightUi = {
    card: (e) => log.push(`card ${e.source}`),
    credit: (t) => log.push(`credit ${t}`),
    vow: (t) => log.push(`vow ${t.slice(0, 12)}`),
    words: (n) => log.push(`words ${n}`),
    title: (t) => log.push(`title ${t}`),
    clear: () => log.push('clear'),
    onAdvance: (cb) => (advance = cb),
    onSkip: (cb) => (skip = cb),
    remove: () => log.push('remove'),
  };
  let hour: number = T.startHour;
  const follows: number[] = [];
  const zooms: number[] = [];
  const opening = createNightOpening({
    live,
    map,
    rng: createRng('opening').fork('o'),
    ui,
    follow: (x, _y, zoom) => {
      follows.push(x);
      zooms.push(zoom ?? T.followZoom);
    },
    centre: () => ({ x: 0, y: 0 }),
    stops: () => STOPS,
    hour: () => hour,
    setHour: (h) => {
      hour = h;
      log.push(`hour ${h}`);
    },
    onDone: () => log.push('done'),
  });
  return { live, map, log, opening, follows, zooms, advance: () => advance(), skip: () => skip(), setHourTo: (h: number) => (hour = h) };
}

describe('the night opening (act one)', () => {
  it('opens on the byline and the title (Maddy 2026-10-08), each alone on the dark', () => {
    expect(TITLE_CARDS).toEqual(['a game by madeleine muscari', 'BODHGAIA']);
    const h = harness();
    h.opening.frame(0);
    expect(h.log).toEqual(['credit a game by madeleine muscari']);
    h.opening.frame(T.creditMs + 1); // it holds, then moves on
    expect(h.log.at(-1)).toBe('credit BODHGAIA');
    h.advance(); // a click moves on sooner
    h.opening.frame(T.creditMs + 10);
    expect(h.log.at(-1)).toBe(`card ${EPIGRAPHS[0]!.source}`);
  });

  it('epigraphs, the walk to a death, the mantra, the awakening at dawn — then hands on', () => {
    const h = harness();
    let t = 0;
    h.opening.frame(t);
    for (let i = 0; i < TITLE_CARDS.length; i++) {
      h.advance();
      h.opening.frame((t += 10));
    }
    expect(h.log).toEqual([...TITLE_CARDS.map((c) => `credit ${c}`), `card ${EPIGRAPHS[0]!.source}`]);
    h.advance(); // a click moves on
    h.opening.frame((t += 10));
    expect(h.log.at(-1)).toBe(`card ${EPIGRAPHS[1]!.source}`);
    h.opening.frame((t += T.epigraphMs)); // the last card times out → the walk begins
    expect(h.log.at(-1)).toBe('clear');
    expect(h.live.wanderer).toBeDefined();
    // the live layer walks them; the camera follows
    const rng = createRng('steps').fork('s');
    while (h.live.wanderer) {
      stepWanderer(h.live, h.map, rng);
      h.opening.frame((t += 50));
    }
    expect(h.follows.length).toBeGreaterThan(10);
    for (let i = 0; i < 10; i++) stepDeaths(h.live);
    h.opening.frame((t += T.holdMs + 1));
    expect(h.log.at(-1)).toBe('words 1');
    for (let k = 2; k <= MANTRA.length; k++) h.opening.frame((t += T.mantraWordMs));
    expect(h.log.at(-1)).toBe(`words ${MANTRA.length}`);
    h.setHourTo(4);
    h.opening.frame((t += T.mantraHoldMs + 1));
    expect(h.log.slice(-2)).toEqual([`hour ${T.dawnHour}`, `title ${AWAKENING}`]);
    // act two: the vows, the camera gliding from stop to stop, ending wide on the whole city
    for (let i = 0; i < VOWS.length; i++) {
      h.opening.frame((t += i === 0 ? T.awakeningMs + 1 : T.vowMs + 1));
      expect(h.log.at(-1)).toBe(`vow ${VOWS[i]!.slice(0, 12)}`);
      h.opening.frame((t += T.vowMs * T.glideShare + 1)); // the glide has arrived
      expect(h.follows.at(-1)).toBe(STOPS[i]!.x);
      expect(h.zooms.at(-1)).toBe(STOPS[i]!.zoom);
    }
    h.opening.frame((t += T.vowMs));
    expect(h.log.slice(-2)).toEqual(['remove', 'done']);
    expect(h.opening.active()).toBe(false);
  });

  it('Esc skips it all at once — the walker simply goes (nobody dies), the sequence hands on', () => {
    const h = harness();
    h.opening.frame(0);
    h.opening.frame(OPENING_T_SKIP);
    h.skip();
    expect(h.log.slice(-3)).toEqual([`hour ${T.dawnHour}`, 'remove', 'done']); // skipped at night: the city still wakes
    expect(h.live.wanderer).toBeUndefined();
    expect(h.live.fallen ?? []).toEqual([]);
    expect(h.opening.active()).toBe(false);
  });
});
const OPENING_T_SKIP = 2 * T.epigraphMs + 100; // mid-walk
