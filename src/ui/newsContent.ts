// The city's NEWS (PURE — pure-ui allowlist). Maddy 2026-10-07: "the bottom bar could scroll news like arrests,
// citizens becoming homeless, traffic jams, power outages". A sample of the city is taken every few seconds; this
// compares it with the last and turns changes past a threshold into sober, local-paper headlines, placed by part
// of the city (neighbourhoods have no stable names — the partition moves as the city changes). Recoveries are
// news too. Language rule: no planning euphemisms as neutral words.

export interface Spot {
  x: number;
  y: number;
}

export interface NewsSample {
  /** Arrests since the last sample, where each happened. */
  arrests: Spot[];
  /** Residents without a home now. */
  unhoused: number;
  /** Road tiles jammed now, and the worst of them. */
  jammed: number;
  jamAt?: Spot;
  /** Homes without power now, and one of them. */
  dark: number;
  darkAt?: Spot;
}

/** A change in the unhoused count smaller than this is drift, not news. */
const UNHOUSED_NEWS = 5;
/** Jammed road tiles at or above this is gridlock. */
const GRIDLOCK = 25;

// each with its own preposition: "on the north side", "in the northeast", plain "downtown"
const SIDES = ['in the northwest', 'on the north side', 'in the northeast', 'on the west side', 'downtown', 'on the east side', 'in the southwest', 'on the south side', 'in the southeast'];

/** Where in the city a tile is, as a phrase with its preposition: downtown in the middle third, compass sides
 *  around it ("on the north side", "in the southeast"). */
export function quarterOf(x: number, y: number, w: number, h: number): string {
  const col = x < w / 3 ? 0 : x < (2 * w) / 3 ? 1 : 2;
  const row = y < h / 3 ? 0 : y < (2 * h) / 3 ? 1 : 2;
  return SIDES[row * 3 + col]!;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : `${n} ${many}`);

/** Headlines for what changed between two samples (none for the first). */
export function headlines(prev: NewsSample | null, now: NewsSample, w: number, h: number): string[] {
  if (prev === null) return [];
  const out: string[] = [];

  // arrests, grouped by part of the city
  const bySide = new Map<string, number>();
  for (const a of now.arrests) {
    const side = quarterOf(a.x, a.y, w, h);
    bySide.set(side, (bySide.get(side) ?? 0) + 1);
  }
  for (const [side, n] of bySide) out.push(n === 1 ? `Police take a resident ${side}` : `${n} arrests ${side}`);

  const du = now.unhoused - prev.unhoused;
  if (du >= UNHOUSED_NEWS) out.push(`${du} more residents lose their homes`);
  else if (du <= -UNHOUSED_NEWS) out.push(`${plural(-du, 'A resident finds a home', 'residents find homes')} again`);

  if (prev.jammed < GRIDLOCK && now.jammed >= GRIDLOCK) {
    out.push(now.jamAt ? `Gridlock ${quarterOf(now.jamAt.x, now.jamAt.y, w, h)}` : 'Gridlock across the city');
  } else if (prev.jammed >= GRIDLOCK && now.jammed < GRIDLOCK) out.push('Traffic is moving again');

  if (prev.dark === 0 && now.dark > 0) {
    const where = now.darkAt ? ` ${quarterOf(now.darkAt.x, now.darkAt.y, w, h)}` : '';
    out.push(`Power out for ${plural(now.dark, 'a home', 'homes')}${where}`);
  } else if (prev.dark > 0 && now.dark === 0) out.push('The power is back on');

  return out;
}
