// App shell: community events (docs/design/community-events.md). They come from conditions — the player never calls
// one. Once a game hour each neighbourhood may hold one; the people come from its homes (live/gatherings.ts), and
// when it ends what it did lands in the civic state. Block parties first: a neighbourhood that has come to belong
// and trust beyond the opening closes its busiest home street to cars by day and gathers in it; it belongs and
// trusts more after.

import type { GameMap } from '../engine/map';
import { BuiltKind, type ParcelStore } from '../engine/fabric';
import { ZoneType, zoneTypeOf } from '../engine/zone';
import type { Rng } from '../engine/rng';
import type { AmbientState } from '../live/types';
import type { CivicState } from '../civic/state';
import { SEED_BELONGING, SEED_TRUST } from '../civic/state';
import type { NeighborhoodMap } from '../civic/neighborhoods';
import { startGathering, takeEndedGatherings, type Gathering } from '../live/gatherings';
import { closeTiles } from '../live/network';

/** Wall ms between community steps (events are drawn once a game hour). */
export const COMMUNITY_STEP_MS = 1000;
/** Block parties: the belonging and trust (0..1 above the opening level) a neighbourhood needs; the chance an hour
 *  at full belonging; how long one lasts (substeps, ~1 min); its crowd; and what it leaves behind. */
export const PARTY_BELONGING = 0.3;
export const PARTY_TRUST = 0.2;
export const PARTY_CHANCE = 0.06;
export const PARTY_LIFE = 1400;
export const PARTY_CROWD = 10;
export const PARTY_BELONGING_GAIN = 15;
export const PARTY_TRUST_GAIN = 8;
/** At most this many gatherings at once, city-wide. */
export const MAX_GATHERINGS = 3;

export interface CommunityDeps {
  world: { map: GameMap; parcels: ParcelStore };
  live: AmbientState;
  civic: CivicState;
  partition(): NeighborhoodMap;
  rng: Rng;
  /** The in-game hour; undefined ⇒ nothing is drawn. */
  hour(): number | undefined;
  /** Community events may begin (not during the opening). */
  on(): boolean;
  news(text: string): void;
}

const above = (v: number, seed: number): number => (v <= seed ? 0 : (v - seed) / (255 - seed));
const isHomeStreet = (k: number): boolean => k === BuiltKind.RoadStreet || k === BuiltKind.QuietStreet;

/** The neighbourhood's busiest home street: a run of up to 3 street tiles with the most homes within 2 tiles. */
function partySite(map: GameMap, parcels: ParcelStore, part: NeighborhoodMap, hood: number): Gathering['site'] | null {
  let best = -1;
  let bestScore = 0;
  for (let t = 0; t < map.built.length; t++) {
    if (part.tileToNeighborhood[t] !== hood || !isHomeStreet(map.built[t]!)) continue;
    const x = t % map.width;
    const y = (t - x) / map.width;
    let score = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (!map.inBounds(x + dx, y + dy)) continue;
        const id = map.parcel[map.idx(x + dx, y + dy)]!;
        if (id !== 0 && zoneTypeOf(parcels.kindAt(id - 1)) === ZoneType.Residential) score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  if (best < 0) return null;
  const x = best % map.width;
  const y = (best - x) / map.width;
  const street = (sx: number, sy: number): boolean => map.inBounds(sx, sy) && part.tileToNeighborhood[map.idx(sx, sy)] === hood && isHomeStreet(map.built[map.idx(sx, sy)]!);
  // run along the street's axis
  if (street(x - 1, y) || street(x + 1, y)) {
    const x0 = street(x - 1, y) ? x - 1 : x;
    const x1 = street(x + 1, y) ? x + 1 : x;
    return { x: x0, y, w: x1 - x0 + 1, h: 1 };
  }
  const y0 = street(x, y - 1) ? y - 1 : y;
  const y1 = street(x, y + 1) ? y + 1 : y;
  return { x, y: y0, w: 1, h: y1 - y0 + 1 };
}

function siteTiles(map: GameMap, s: Gathering['site']): Set<number> {
  const out = new Set<number>();
  for (let dy = 0; dy < s.h; dy++) for (let dx = 0; dx < s.w; dx++) out.add(map.idx(s.x + dx, s.y + dy));
  return out;
}

export interface Community {
  frame(now: number): void;
  /** Hold a gathering now, whatever the conditions (demos, live checks): in the neighbourhood with the most homes.
   *  False if there's nowhere to hold it. */
  hold(kind: 'block-party'): boolean;
}

export function createCommunity(deps: CommunityDeps): Community {
  const { world, live, civic, rng } = deps;
  const { map, parcels } = world;
  let last = -Infinity;
  let lastHour: number | undefined;

  const endOf = (g: Gathering): void => {
    if (g.kind === 'block-party') {
      closeTiles(map, `party:${g.id}`, null);
      if (g.hood > 0 && g.hood <= civic.count()) {
        const v = civic.getValues(g.hood);
        civic.setValues(g.hood, { ...v, belonging: Math.min(255, v.belonging + PARTY_BELONGING_GAIN), trust: Math.min(255, v.trust + PARTY_TRUST_GAIN) });
      }
    }
  };

  const holdParty = (part: NeighborhoodMap, hood: number): boolean => {
    const site = partySite(map, parcels, part, hood);
    if (!site) return false;
    const homes = (live.households ?? []).map((h) => map.idx(h.x, h.y)).filter((t) => part.tileToNeighborhood[t] === hood);
    const g = startGathering(live, map, rng, { kind: 'block-party', site, hood, life: PARTY_LIFE, homes, crowd: PARTY_CROWD });
    if (!g) return false;
    closeTiles(map, `party:${g.id}`, siteTiles(map, site), 'cars'); // the street is given over to people
    deps.news('A block party — the neighbours have closed their street to cars');
    return true;
  };

  const draw = (hour: number): void => {
    const part = deps.partition();
    const busy = new Set((live.gatherings ?? []).map((g) => g.hood));
    const daytime = hour >= 10 && hour < 20;
    for (let hood = 1; hood <= civic.count(); hood++) {
      if ((live.gatherings?.length ?? 0) >= MAX_GATHERINGS) return;
      if (busy.has(hood) || !daytime) continue;
      const v = civic.getValues(hood);
      const belonging = above(v.belonging, SEED_BELONGING);
      if (belonging < PARTY_BELONGING || above(v.trust, SEED_TRUST) < PARTY_TRUST) continue;
      if (rng.next() >= PARTY_CHANCE * belonging) continue;
      if (holdParty(part, hood)) busy.add(hood);
    }
  };

  return {
    hold() {
      const part = deps.partition();
      const homesIn = new Map<number, number>();
      for (const h of live.households ?? []) {
        const id = part.tileToNeighborhood[map.idx(h.x, h.y)] ?? 0;
        if (id) homesIn.set(id, (homesIn.get(id) ?? 0) + 1);
      }
      const ranked = [...homesIn].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      return ranked.some(([hood]) => holdParty(part, hood));
    },
    frame(now) {
      if (now - last < COMMUNITY_STEP_MS) return;
      last = now;
      for (const g of takeEndedGatherings(live)) endOf(g);
      const hour = deps.hour();
      if (hour === undefined || hour === lastHour) return;
      lastHour = hour;
      if (deps.on()) draw(hour);
    },
  };
}
