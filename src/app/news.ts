// App shell: the city's NEWS ticker (Maddy 2026-10-07: "the bottom bar could scroll news like arrests, citizens
// becoming homeless, traffic jams, power outages"). Every few seconds it samples the city (src/ui/newsContent.ts
// turns the change into headlines) and keeps a short rolling feed for the status bar; the economy's moments
// (a practice taking root, the relief grant, a loan) are pushed in directly. The pure parts are exported + tested.

import { headlines, type NewsSample, type Spot } from '../ui/newsContent';

/** Headlines kept on the ticker. */
export const FEED_MAX = 8;
/** How often the city is sampled. */
const SAMPLE_MS = 5000;
/** Traffic (0..255) at or above this on a road tile is a jam. */
export const JAM_LEVEL = 200;

/** Arrests are gathered and reported at most every this many samples (~30 s) — in a heavily policed city one
 *  came every few seconds and flooded the ticker. */
export const ARREST_NEWS_EVERY = 6;

/** Gather this sample's arrests; on every ARREST_NEWS_EVERY-th sample hand the whole batch over. → [held, out] */
export function arrestBatch(held: readonly Spot[], fresh: readonly Spot[], sample: number): [Spot[], Spot[]] {
  const all = [...held, ...fresh];
  return sample % ARREST_NEWS_EVERY === 0 ? [[], all] : [all, []];
}

/** The feed with new headlines appended, oldest dropped past FEED_MAX. */
export function feedWith(feed: readonly string[], items: readonly string[]): string[] {
  const next = [...feed, ...items];
  return next.length > FEED_MAX ? next.slice(next.length - FEED_MAX) : next;
}

/** Arrests since the last sample: police-violence stains that grew (or appeared). A fading stain is not one. */
export function newArrests(prev: ReadonlyMap<number, number>, now: ReadonlyMap<number, number>, width: number): Spot[] {
  const out: Spot[] = [];
  for (const [tile, v] of now) {
    if (v <= (prev.get(tile) ?? 0) + 1e-9) continue;
    const x = tile % width;
    out.push({ x, y: (tile - x) / width });
  }
  return out;
}

/** Jammed road tiles and the worst of them. */
export function jamOf(traffic: ReadonlyMap<number, number>, width: number, level = JAM_LEVEL): { jammed: number; jamAt?: Spot } {
  let jammed = 0;
  let worst = -1;
  let worstAt = -1;
  for (const [tile, v] of traffic) {
    if (v < level) continue;
    jammed++;
    if (v > worst) {
      worst = v;
      worstAt = tile;
    }
  }
  if (jammed === 0) return { jammed: 0 };
  const x = worstAt % width;
  return { jammed, jamAt: { x, y: (worstAt - x) / width } };
}

export interface NewsDeps {
  width: number;
  height: number;
  policeViolence: () => ReadonlyMap<number, number>;
  traffic: () => ReadonlyMap<number, number>;
  unhoused: () => number;
  /** Homes without power now, and one of them. */
  dark: () => { dark: number; darkAt?: Spot };
  show(items: readonly string[]): void;
}

export interface News {
  /** Put a headline on the ticker now (the economy's moments). */
  push(text: string): void;
}

export function createNews(deps: NewsDeps): News {
  let feed: string[] = [];
  let lastViolence = new Map(deps.policeViolence());
  let prev: NewsSample | null = null;
  let held: Spot[] = [];
  let sample = 0;
  const add = (items: readonly string[]): void => {
    if (items.length === 0) return;
    feed = feedWith(feed, items);
    deps.show(feed);
  };
  setInterval(() => {
    const violence = deps.policeViolence();
    sample++;
    const [keep, due] = arrestBatch(held, newArrests(lastViolence, violence, deps.width), sample);
    held = keep;
    const now: NewsSample = {
      arrests: due,
      unhoused: deps.unhoused(),
      ...jamOf(deps.traffic(), deps.width),
      ...deps.dark(),
    };
    lastViolence = new Map(violence);
    add(headlines(prev, now, deps.width, deps.height));
    prev = now;
  }, SAMPLE_MS);
  return { push: (text) => add([text]) };
}
