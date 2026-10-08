// The opening's third act — the tutorial (bodhgaia-opening.md §3; Maddy's notes): the planner is greeted, shown the
// city's worst places, asked how it got this bad (the indictment answers), then walked through the interface. Pure —
// no DOM, no transcendental Math (pure-ui allowlist): the script and the worst-spot finder.

import type { GameMap } from '../engine/map';
import { BuiltKind, type ParcelStore } from '../engine/fabric';
import type { AmbientState } from '../live/types';
import { ENCAMPMENT_WEAR } from '../live/tuning';

export type SpotKind = 'smog' | 'police' | 'unhoused' | 'decay' | 'water';

export interface WorstSpot {
  kind: SpotKind;
  /** Centre, in tiles. */
  x: number;
  y: number;
  zoom: number;
  caption: string;
}

const CAPTIONS: Record<SpotKind, string> = {
  smog: 'The air is thickest here — smoke from the plants and the traffic settles over these blocks.',
  police: 'This is where the police take people.',
  unhoused: 'People sleep here, in tents, with nowhere else to go.',
  decay: 'These buildings are falling apart. Nobody has put money into them for decades.',
  water: 'The water here is poisoned.',
};

/** The weighted centre of the densest cluster of a sparse field (tile → value), or null if it is empty. Each entry
 *  is scored by the sum of the values within `r` (Chebyshev) of it; the best one's neighbourhood gives the centre. */
function hotspot(map: GameMap, field: ReadonlyMap<number, number>, r = 2): { x: number; y: number } | null {
  let best = -1;
  let bestScore = 0;
  for (const [t] of field) {
    const x = t % map.width;
    const y = (t - x) / map.width;
    let s = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (map.inBounds(x + dx, y + dy)) s += field.get(map.idx(x + dx, y + dy)) ?? 0;
    if (s > bestScore || (s === bestScore && t < best)) {
      bestScore = s;
      best = t;
    }
  }
  if (best < 0 || bestScore <= 0) return null;
  const bx = best % map.width;
  const by = (best - bx) / map.width;
  let wx = 0;
  let wy = 0;
  let w = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (!map.inBounds(bx + dx, by + dy)) continue;
      const v = field.get(map.idx(bx + dx, by + dy)) ?? 0;
      wx += (bx + dx) * v;
      wy += (by + dy) * v;
      w += v;
    }
  }
  return { x: wx / w, y: wy / w };
}

/** The city's worst places, in the order the tutorial visits them; a harm the city doesn't have is skipped. */
export function worstSpots(map: GameMap, parcels: ParcelStore, live: AmbientState): WorstSpot[] {
  const camps = new Map<number, number>();
  for (const [t, w] of live.wear) if (w >= ENCAMPMENT_WEAR) camps.set(t, w);
  const decay = new Map<number, number>();
  for (const i of parcels.aliveIndices()) {
    const p = parcels.get(i);
    if (p.kind === BuiltKind.Yard || p.condition >= 128) continue;
    decay.set(map.idx(p.x, p.y), 255 - p.condition);
  }
  const found: [SpotKind, { x: number; y: number } | null, number][] = [
    ['smog', hotspot(map, live.pollution), 3],
    ['police', hotspot(map, live.policeViolence), 3],
    ['unhoused', hotspot(map, camps), 4],
    ['decay', hotspot(map, decay), 3],
    ['water', hotspot(map, live.waterPollution), 3],
  ];
  return found.filter((f): f is [SpotKind, { x: number; y: number }, number] => f[1] !== null).map(([kind, at, zoom]) => ({ kind, x: at.x, y: at.y, zoom, caption: CAPTIONS[kind] }));
}

export type TutorialStep =
  | { kind: 'say'; text: string }
  /** The camera visits each of the worst spots, captioned. */
  | { kind: 'spots' }
  /** The city's indictment — its statistics and its chronicle (the old opening overlay). */
  | { kind: 'indict' }
  /** A spotlight on one part of the interface (a CSS selector), explained. */
  | { kind: 'ui'; target: string; text: string };

export const TUTORIAL: readonly TutorialStep[] = [
  { kind: 'say', text: 'Greetings, Planner.' },
  { kind: 'say', text: 'You do not live here.' },
  { kind: 'say', text: "You don't even live in this reality." },
  { kind: 'say', text: 'Look at this place! What a mess.' },
  { kind: 'spots' },
  { kind: 'say', text: 'How did things get this bad??' },
  { kind: 'indict' },
  { kind: 'say', text: 'There is a lot of work to do here…' },
  {
    kind: 'ui',
    target: '.pulse-dock',
    text: "The city's pulse: its money and what it makes each hour; communal effort — your neighbours' time and energy; approval; trust; wellbeing; and how many people have no home.",
  },
  {
    kind: 'ui',
    target: '.toolbar',
    text: 'Your tools. Inspect anything to see what it is. Lay streets, homes and shops — and, as the city learns new practices, gardens, co-ops, clean power and more.',
  },
  {
    kind: 'ui',
    target: '[data-tool-id="bulldoze"]',
    text: 'Bulldoze. Tearing down homes, care and shops costs effort — people live and work in these buildings.',
  },
  {
    kind: 'ui',
    target: '[data-meta-id="tech"]',
    text: 'The Commons: the practices your city can learn. Each costs money to begin and effort over its days, and says exactly what it changes.',
  },
  {
    kind: 'ui',
    target: '[data-meta-id="budget"]',
    text: 'The Budget: taxes, the police budget, loans. A city short of money can borrow — at a price its standing sets.',
  },
  {
    kind: 'ui',
    target: '[data-meta-id="redline"]',
    text: "Overlays show what the map hides: ecology, civic life, the redlining that made this city, police violence, services, power.",
  },
  {
    kind: 'ui',
    target: '[data-meta-id="restore"]',
    text: 'Restoration: what is healing, and how fast.',
  },
  {
    kind: 'ui',
    target: '.toolbar-status',
    text: 'The news — deaths, arrests, blackouts, people losing their homes, and the things that go right. When something happens, a camera shows you.',
  },
  { kind: 'say', text: 'Repair. Restore. Heal. The city is awake — begin.' },
];
