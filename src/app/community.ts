// App shell: community events (docs/design/community-events.md). They come from conditions — the player never calls
// one. Once a game hour each neighbourhood may hold one; the people come from its homes (live/gatherings.ts), and
// when it ends what it did lands in the civic state. Block parties first: a neighbourhood that has come to belong
// and trust beyond the opening closes its busiest home street to cars by day and gathers in it; it belongs and
// trusts more after.

import type { GameMap } from '../engine/map';
import { BuiltKind, isRoadKind, type ParcelStore } from '../engine/fabric';
import { ZoneType, zoneTypeOf } from '../engine/zone';
import type { Rng } from '../engine/rng';
import type { AmbientState } from '../live/types';
import type { CivicState } from '../civic/state';
import { SEED_BELONGING, SEED_TRUST, SEED_VOICE } from '../civic/state';
import { POLICE_VIOLENCE_MAX, POLL_LAY_BASE, POLL_MAX, REFUGE_KINDS, SAFE_RADIUS, SKID_LAY, SKID_MAX, seconds } from '../live/tuning';
import { junctionBox } from '../ui/decoration';
import { layField } from '../citizens/field';
import type { NeighborhoodMap } from '../civic/neighborhoods';
import { GATHER_LEAVE, startGathering, takeEndedGatherings, type Gathering } from '../live/gatherings';
import { closeTiles } from '../live/network';
import { pairedHoods } from '../engine/pairings';
import { residentCollapses } from '../live/death';

/** Wall ms between community steps (events are drawn once a game hour). */
export const COMMUNITY_STEP_MS = 1000;
/** Block parties: the belonging and trust (0..1 above the opening level) a neighbourhood needs; the chance an hour
 *  at full belonging; how long one lasts (substeps, ~1 min); its crowd; and what it leaves behind. */
export const PARTY_BELONGING = 0.3;
export const PARTY_TRUST = 0.2;
/** …and the neighbourhood health it needs, 0..255 (interdependence §1: health gates the events). */
export const PARTY_HEALTH = 110;
export const PARTY_CHANCE = 0.06;
export const PARTY_LIFE = seconds(70);
export const PARTY_CROWD = 10;
export const PARTY_BELONGING_GAIN = 15;
export const PARTY_TRUST_GAIN = 8;
/** Craft fairs: a neighbourhood with a bazaar or maker space that practises Craft Fairs, and some belonging; the
 *  trade brings money in, and it belongs a little more. */
export const FAIR_BELONGING = 0.15;
export const FAIR_CHANCE = 0.06;
export const FAIR_LIFE = seconds(70);
export const FAIR_CROWD = 10;
export const FAIR_TRADE = 150;
export const FAIR_BELONGING_GAIN = 6;
/** Festivals: city-wide, when approval and trust are high, at the biggest park or a civic hall — with a parade down
 *  the nearest avenue. The whole city is lifted after. */
export const FEST_APPROVAL = 65;
export const FEST_TRUST = 0.2;
export const FEST_CHANCE = 0.04;
export const FEST_LIFE = seconds(90);
export const FEST_CROWD = 24;
export const PARADE_CROWD = 12;
export const FEST_CHEER = { approval: 4, goodwill: 4 } as const;
export const FEST_BELONGING_GAIN = 4;
/** Protests (conditions, not cops): a neighbourhood's grievance — police violence on its streets, encampments, the
 *  memorials of its dead — and the voice to speak with (0..1 above the opening). It gathers at its civic hall, else
 *  its precinct, else in the street; its voice rises after, and approval falls while the cause stands. */
export const PROTEST_VOICE = 0.1;
export const PROTEST_CHANCE = 0.12;
export const PROTEST_LIFE = seconds(70);
export const PROTEST_CROWD = 14;
export const PROTEST_VOICE_GAIN = 12;
export const PROTEST_APPROVAL = -2;
/** A protest is unheard if the grievance hasn't eased by this much since the last one. After UPRISING_AFTER unheard
 *  protests, with police violence still at UPRISING_VIOLENCE, an uprising: fires at the precinct and businesses
 *  (never homes); cruisers within ESCALATE_RADIUS light another and lengthen it; voice or a refuge in reach calms it. */
export const UNHEARD_EASE = 0.05;
export const UPRISING_AFTER = 2;
export const UPRISING_VIOLENCE = 0.5;
export const UPRISING_CHANCE = 0.25;
export const UPRISING_LIFE = seconds(80);
export const UPRISING_CROWD = 20;
export const ESCALATE_RADIUS = 8;
export const ESCALATE_LIFE = seconds(15);
export const UPRISING_MAX_LIFE = seconds(160);
export const CALM_VOICE = 0.6;
export const UPRISING_AFTERMATH = { trust: -10, voice: 20 } as const;
export const UPRISING_APPROVAL = -4;
/** Sideshows (Maddy 2026-10-21: car sideshows, "due to community stress", "at intersections, … more likely and
 *  bigger in bigger intersections", leaving tire marks): at night, below this neighbourhood health (0..255), cars take
 *  over its biggest crossing and spin donuts while the neighbours ring it. The chance an hour scales with how far below,
 *  and with the crossing's size (tiles in its junction box, up to SIDESHOW_SIZE_CAP); so does the number of cars. */
export const SIDESHOW_HEALTH = 100;
export const SIDESHOW_CHANCE = 0.1;
export const SIDESHOW_SIZE_CAP = 6;
export const SIDESHOW_LIFE = seconds(50);
/** Watchers: a few per car. */
export const SIDESHOW_CROWD_PER_CAR = 4;
export const SIDESHOW_MAX_CARS = 4;
export const SIDESHOW_BELONGING_GAIN = 4;
/** …and finds its voice (Maddy 2026-10-22: "a boost to community stats"); broken up by the police, it trusts less. */
export const SIDESHOW_VOICE_GAIN = 3;
export const SIDESHOW_POLICED_TRUST = 8;
/** The chance an hour, per car, that one hits someone watching — they collapse where they stood (an ambulance's minute). */
export const SIDESHOW_INJURY_CHANCE = 0.04;
/** Fireworks (interdependence §6): a festival still on at FIREWORKS_HOUR or later puts on one show — the city belongs
 *  a little more (so its wellbeing rises), and the smoke lays a whisper of smog over the park. */
export const FIREWORKS_HOUR = 20;
export const FIREWORKS_BELONGING = 3;
export const FIREWORKS_SMOG = POLL_LAY_BASE * 6;
/** At most this many gatherings at once, city-wide. */
export const MAX_GATHERINGS = 4;

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
  /** Is this practice part of the city's life? */
  practised(id: string): boolean;
  /** The city's approval, 0..100. */
  approval(): number;
  /** A neighbourhood's health, 0..255 (app/health.ts) — undefined before the first reading. */
  health?(hood: number): number | undefined;
  /** Move the city's approval, goodwill and money (economy). */
  cheer(d: { approval?: number; goodwill?: number; funds?: number }): void;
  /** Set a building alight (the fire controller). */
  ignite(parcel: number): void;
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

/** A footprint grown by one tile (the ground round a building, where people gather), clipped to the map. */
function around(map: GameMap, x: number, y: number, w: number, h: number): Gathering['site'] {
  const x0 = Math.max(0, x - 1);
  const y0 = Math.max(0, y - 1);
  const x1 = Math.min(map.width - 1, x + w);
  const y1 = Math.min(map.height - 1, y + h);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** The first parcel of one of `kinds` in the neighbourhood (or anywhere, hood 0), biggest first. */
function findParcel(map: GameMap, parcels: ParcelStore, part: NeighborhoodMap, hood: number, kinds: readonly number[]): Gathering['site'] | null {
  let best: { x: number; y: number; w: number; h: number } | null = null;
  for (const i of parcels.aliveIndices()) {
    const p = parcels.get(i);
    if (!kinds.includes(p.kind)) continue;
    if (hood > 0 && part.tileToNeighborhood[map.idx(p.x, p.y)] !== hood) continue;
    if (!best || p.width * p.height > best.w * best.h) best = { x: p.x, y: p.y, w: p.width, h: p.height };
  }
  return best ? around(map, best.x, best.y, best.w, best.h) : null;
}

/** A run of up to 6 avenue tiles nearest (cx, cy), within 15 tiles, along the avenue's axis. */
function paradeRoute(map: GameMap, cx: number, cy: number): Gathering['site'] | null {
  let best = -1;
  let bestD = Infinity;
  for (let dy = -15; dy <= 15; dy++) {
    for (let dx = -15; dx <= 15; dx++) {
      const x = Math.round(cx) + dx;
      const y = Math.round(cy) + dy;
      if (!map.inBounds(x, y) || map.built[map.idx(x, y)] !== BuiltKind.RoadAvenue) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < bestD) {
        bestD = d;
        best = map.idx(x, y);
      }
    }
  }
  if (best < 0) return null;
  const x = best % map.width;
  const y = (best - x) / map.width;
  const av = (ax: number, ay: number): boolean => map.inBounds(ax, ay) && map.built[map.idx(ax, ay)] === BuiltKind.RoadAvenue;
  let x0 = x, x1 = x, y0 = y, y1 = y;
  while (x1 - x0 < 5 && (av(x0 - 1, y) || av(x1 + 1, y))) { if (av(x1 + 1, y)) x1++; else x0--; }
  if (x1 > x0) return { x: x0, y, w: x1 - x0 + 1, h: 1 };
  while (y1 - y0 < 5 && (av(x, y0 - 1) || av(x, y1 + 1))) { if (av(x, y1 + 1)) y1++; else y0--; }
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
  hold(kind: 'block-party' | 'craft-fair' | 'festival' | 'protest' | 'uprising' | 'sideshow'): boolean;
}

export function createCommunity(deps: CommunityDeps): Community {
  const { world, live, civic, rng } = deps;
  const { map, parcels } = world;
  let last = -Infinity;
  let lastHour: number | undefined;

  const lift = (hood: number, d: { belonging?: number; trust?: number; voice?: number }): void => {
    if (hood <= 0 || hood > civic.count()) return;
    const v = civic.getValues(hood);
    const c = (x: number): number => Math.max(0, Math.min(255, x));
    civic.setValues(hood, { belonging: c(v.belonging + (d.belonging ?? 0)), voice: c(v.voice + (d.voice ?? 0)), trust: c(v.trust + (d.trust ?? 0)) });
  };

  const endOf = (g: Gathering): void => {
    closeTiles(map, `gathering:${g.id}`, null);
    if (g.kind === 'block-party') lift(g.hood, { belonging: PARTY_BELONGING_GAIN, trust: PARTY_TRUST_GAIN });
    else if (g.kind === 'sideshow') {
      // the neighbours' night out — and if the police broke it up, the trust it cost (Maddy 2026-10-22)
      lift(g.hood, { belonging: SIDESHOW_BELONGING_GAIN, voice: SIDESHOW_VOICE_GAIN, trust: g.policed ? -SIDESHOW_POLICED_TRUST : 0 });
    }
    else if (g.kind === 'craft-fair') {
      lift(g.hood, { belonging: FAIR_BELONGING_GAIN });
      deps.cheer({ funds: FAIR_TRADE });
    } else if (g.kind === 'festival') {
      deps.cheer(FEST_CHEER);
      for (let hood = 1; hood <= civic.count(); hood++) lift(hood, { belonging: FEST_BELONGING_GAIN });
    } else if (g.kind === 'protest') {
      lift(g.hood, { voice: PROTEST_VOICE_GAIN });
      deps.cheer({ approval: PROTEST_APPROVAL });
      const now = harmOf(deps.partition(), g.hood).grievance;
      const m = unheard.get(g.hood) ?? { count: 0, last: 0 };
      unheard.set(g.hood, now >= m.last - UNHEARD_EASE ? { count: m.count + 1, last: now } : { count: 0, last: now });
    } else if (g.kind === 'uprising') {
      lift(g.hood, UPRISING_AFTERMATH);
      deps.cheer({ approval: UPRISING_APPROVAL });
      unheard.delete(g.hood);
      lit.delete(g.id);
    }
  };

  /** Per neighbourhood: how many protests in a row went unheard, and the grievance at the last one. */
  const unheard = new Map<number, { count: number; last: number }>();

  /** A neighbourhood's police violence (0..1) and its grievance (0..1): that violence, its encampments, the
   *  memorials of its dead. */
  const harmOf = (part: NeighborhoodMap, hood: number): { violence: number; grievance: number } => {
    const rec = part.neighborhoods[hood - 1];
    const tiles = Math.max(1, rec?.tileCount ?? 1);
    let pv = 0;
    for (const [t, v] of live.policeViolence) if (part.tileToNeighborhood[t] === hood) pv += v;
    let camps = 0;
    for (const [t, n] of live.camps ?? new Map<number, number>()) if (n >= 1 && part.tileToNeighborhood[t] === hood) camps++;
    let mourned = 0;
    for (const m of [...(live.memorials ?? []), ...(live.fallen ?? [])]) if (part.tileToNeighborhood[map.idx(m.x, m.y)] === hood) mourned++;
    const violence = Math.min(1, pv / tiles / (POLICE_VIOLENCE_MAX / 2));
    return { violence, grievance: Math.min(1, (violence + Math.min(1, camps / 8) + Math.min(1, mourned / 3)) / 1.5) };
  };

  /** Where a neighbourhood speaks: its civic hall, else its precinct, else its busiest street. */
  const protestSite = (part: NeighborhoodMap, hood: number): { site: Gathering['site']; street: boolean } | null => {
    const hall = findParcel(map, parcels, part, hood, [BuiltKind.Civic]) ?? findParcel(map, parcels, part, hood, [BuiltKind.Precinct]);
    if (hall) return { site: hall, street: false };
    const st = partySite(map, parcels, part, hood);
    return st ? { site: st, street: true } : null;
  };

  /** The buildings an uprising sets alight, nearest the place first: the precinct, then businesses — never homes. */
  const targets = (g: Gathering): number[] => {
    const cx = g.site.x + g.site.w / 2;
    const cy = g.site.y + g.site.h / 2;
    const out: { i: number; d: number }[] = [];
    for (const i of parcels.aliveIndices()) {
      const p = parcels.get(i);
      const zone = zoneTypeOf(p.kind);
      if (p.kind !== BuiltKind.Precinct && zone !== ZoneType.Commercial && zone !== ZoneType.Industrial) continue;
      const d = Math.abs(p.x + p.width / 2 - cx) + Math.abs(p.y + p.height / 2 - cy) - (p.kind === BuiltKind.Precinct ? 100 : 0);
      if (d - (p.kind === BuiltKind.Precinct ? -100 : 0) <= 6) out.push({ i, d });
    }
    return out.sort((a, b) => a.d - b.d || a.i - b.i).map((o) => o.i);
  };
  /** Per uprising: the buildings it has set alight. */
  const lit = new Map<number, Set<number>>();
  const lightNext = (g: Gathering): void => {
    const done = lit.get(g.id) ?? new Set<number>();
    const next = targets(g).find((i) => !done.has(i));
    if (next === undefined) return;
    done.add(next);
    lit.set(g.id, done);
    deps.ignite(next);
  };

  /** Each hour of an uprising: cruisers in reach escalate it; voice or a refuge in reach calms it. */
  const tendUprisings = (part: NeighborhoodMap): void => {
    for (const g of live.gatherings ?? []) {
      if (g.kind !== 'uprising' || g.leaving) continue;
      const cx = g.site.x + g.site.w / 2;
      const cy = g.site.y + g.site.h / 2;
      let refuge = false;
      for (let dy = -SAFE_RADIUS; dy <= SAFE_RADIUS && !refuge; dy++) {
        for (let dx = -SAFE_RADIUS; dx <= SAFE_RADIUS; dx++) {
          const x = Math.round(cx) + dx;
          const y = Math.round(cy) + dy;
          if (map.inBounds(x, y) && REFUGE_KINDS.has(map.built[map.idx(x, y)]!) && map.built[map.idx(x, y)] !== BuiltKind.Civic) {
            refuge = true;
            break;
          }
        }
      }
      const voice = g.hood > 0 && g.hood <= civic.count() ? above(civic.getValues(g.hood).voice, SEED_VOICE) : 0;
      if (refuge || voice >= CALM_VOICE) {
        g.leaving = true; // calmed: people go home
        g.life = Math.min(g.life, g.age + GATHER_LEAVE);
        continue;
      }
      if (live.cruisers.some((c) => Math.abs(c.x - cx) + Math.abs(c.y - cy) <= ESCALATE_RADIUS)) {
        lightNext(g); // police sent in: it gets worse
        g.life = Math.min(UPRISING_MAX_LIFE, g.life + ESCALATE_LIFE);
      }
    }
    void part;
  };

  const homesIn = (part: NeighborhoodMap, hood: number): number[] =>
    (live.households ?? []).map((h) => map.idx(h.x, h.y)).filter((t) => hood === 0 || part.tileToNeighborhood[t] === hood);

  /** Begin a gathering of `kind` at `site`; `cars` closes it to cars for its life. */
  const holdAt = (kind: Gathering['kind'], site: Gathering['site'], hood: number, life: number, homes: number[], crowd: number, cars: boolean): Gathering | null => {
    const g = startGathering(live, map, rng, { kind, site, hood, life, homes, crowd });
    if (g && cars) closeTiles(map, `gathering:${g.id}`, siteTiles(map, site), 'cars'); // the street is given over to people
    return g;
  };

  const holdParty = (part: NeighborhoodMap, hood: number): boolean => {
    const site = partySite(map, parcels, part, hood);
    if (!site || !holdAt('block-party', site, hood, PARTY_LIFE, homesIn(part, hood), PARTY_CROWD, true)) return false;
    live.events?.push({ kind: 'party', x: site.x, y: site.y, w: site.w, h: site.h });
    deps.news('A block party — the neighbours have closed their street to cars');
    return true;
  };
  const holdFair = (part: NeighborhoodMap, hood: number): boolean => {
    const site = findParcel(map, parcels, part, hood, [BuiltKind.Bazaar, BuiltKind.MakerSpace]);
    if (!site || !holdAt('craft-fair', site, hood, FAIR_LIFE, homesIn(part, hood), FAIR_CROWD, false)) return false;
    live.events?.push({ kind: 'fair', x: site.x, y: site.y, w: site.w, h: site.h });
    deps.news('A craft fair — stalls out round the bazaar');
    return true;
  };
  const holdProtest = (part: NeighborhoodMap, hood: number, uprising: boolean): boolean => {
    const at = protestSite(part, hood);
    if (!at) return false;
    const kind = uprising ? 'uprising' : 'protest';
    const g = holdAt(kind, at.site, hood, uprising ? UPRISING_LIFE : PROTEST_LIFE, homesIn(part, hood), uprising ? UPRISING_CROWD : PROTEST_CROWD, at.street);
    if (!g) return false;
    live.events?.push({ kind, x: at.site.x, y: at.site.y, w: at.site.w, h: at.site.h });
    if (uprising) {
      lightNext(g);
      deps.news('An uprising — protest went unheard, and the police violence went on');
    } else deps.news('A protest — the neighbours are speaking out');
    return true;
  };
  /** The crossings (junction boxes of streets and avenues, not freeways) a neighbourhood touches: each a box of tiles.
   *  A crossing is usually on a neighbourhood's edge (its own tiles in none), so it counts for every neighbourhood its
   *  approaches reach. */
  type Crossing = { tiles: number[]; x: number; y: number; w: number; h: number; hoods: Set<number> };
  const crossings = (part: NeighborhoodMap): Crossing[] => {
    const isBox = (t: number): boolean => {
      const k = map.built[t]!;
      if (k !== BuiltKind.RoadStreet && k !== BuiltKind.RoadAvenue && k !== BuiltKind.QuietStreet) return false;
      const x = t % map.width;
      return junctionBox(map, x, (t - x) / map.width);
    };
    const seen = new Set<number>();
    const out: Crossing[] = [];
    for (let t = 0; t < map.built.length; t++) {
      if (seen.has(t) || !isBox(t)) continue;
      const tiles: number[] = [];
      const stack = [t];
      seen.add(t);
      while (stack.length) {
        const c = stack.pop()!;
        tiles.push(c);
        const cx = c % map.width;
        const cy = (c - cx) / map.width;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          if (!map.inBounds(cx + dx, cy + dy)) continue;
          const n = map.idx(cx + dx, cy + dy);
          if (!seen.has(n) && isBox(n)) {
            seen.add(n);
            stack.push(n);
          }
        }
      }
      const xs = tiles.map((i) => i % map.width);
      const ys = tiles.map((i) => Math.floor(i / map.width));
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      const box: Crossing = { tiles, x: x0, y: y0, w: Math.max(...xs) - x0 + 1, h: Math.max(...ys) - y0 + 1, hoods: new Set() };
      const ring = around(map, box.x, box.y, box.w, box.h);
      for (let dy = 0; dy < ring.h; dy++) for (let dx = 0; dx < ring.w; dx++) box.hoods.add(part.tileToNeighborhood[map.idx(ring.x + dx, ring.y + dy)] ?? 0);
      out.push(box);
    }
    return out;
  };
  /** A sideshow at the neighbourhood's biggest crossing, at `chance` scaled by its size; false if none was held. */
  const trySideshow = (part: NeighborhoodMap, all: readonly Crossing[], hood: number, stress: number, force = false): boolean => {
    const xs = all.filter((c) => c.hoods.has(hood));
    if (xs.length === 0) return false;
    const box = xs.reduce((a, b) => (b.tiles.length > a.tiles.length || (b.tiles.length === a.tiles.length && b.tiles[0]! < a.tiles[0]!) ? b : a));
    const size = Math.min(SIDESHOW_SIZE_CAP, box.tiles.length);
    if (!force && rng.next() >= SIDESHOW_CHANCE * stress * (0.5 + size / 2)) return false; // a 2×2 box: 5× a lone crossing's
    const cars = Math.min(SIDESHOW_MAX_CARS, 1 + Math.floor(size / 2));
    const site = around(map, box.x, box.y, box.w, box.h); // the crossing and its approaches, where people stand
    const g = holdAt('sideshow', site, hood, SIDESHOW_LIFE, homesIn(part, hood), cars * SIDESHOW_CROWD_PER_CAR, true);
    if (!g) return false;
    g.cars = cars;
    skid(g);
    live.events?.push({ kind: 'sideshow', x: site.x, y: site.y, w: site.w, h: site.h });
    deps.news(cars > 1 ? `A sideshow — ${cars} cars spinning donuts in the crossing, the neighbours out to watch` : 'A sideshow — a car spinning donuts in the crossing, the neighbours out to watch');
    return true;
  };
  /** A car hits someone watching: they collapse where they stood (live/death.ts — the clinic's ambulance has a minute). */
  const injure = (g: Gathering): void => {
    if (rng.next() >= SIDESHOW_INJURY_CHANCE * (g.cars ?? 1)) return;
    const watchers = live.peds.filter((p) => p.gather?.id === g.id && p.gather.go === 'here');
    if (watchers.length === 0) return;
    const p = watchers[rng.nextInt(watchers.length)]!;
    live.peds = live.peds.filter((q) => q !== p);
    residentCollapses(live, Math.round(p.x), Math.round(p.y), p.homeTile !== undefined ? { home: p.homeTile } : {});
    deps.news('Someone watching the sideshow was hit by a car');
  };
  /** A sideshow's cars lay tire marks on the crossing's road (once an hour while it runs), and a little tire smoke. */
  const skid = (g: Gathering): void => {
    for (let dy = 1; dy < g.site.h - 1; dy++) {
      for (let dx = 1; dx < g.site.w - 1; dx++) {
        const t = map.idx(g.site.x + dx, g.site.y + dy);
        if (!isRoadKind(map.built[t]!)) continue;
        layField(live.skids, t, SKID_LAY * (g.cars ?? 1), SKID_MAX);
        layField(live.pollution, t, POLL_LAY_BASE * 5 * (g.cars ?? 1), POLL_MAX); // the tire smoke
      }
    }
  };
  /** After dark, a festival still on puts on its fireworks — once. */
  const tendFestivals = (hour: number): void => {
    if (hour < FIREWORKS_HOUR && hour >= 5) return;
    for (const g of live.gatherings ?? []) {
      if (g.kind !== 'festival' || g.leaving || g.fireworks) continue;
      g.fireworks = true;
      for (let hood = 1; hood <= civic.count(); hood++) lift(hood, { belonging: FIREWORKS_BELONGING });
      for (const t of siteTiles(map, g.site)) layField(live.pollution, t, Math.ceil(FIREWORKS_SMOG / (g.site.w * g.site.h)), POLL_MAX);
      deps.news('Fireworks over the park');
    }
  };
  const holdFestival = (part: NeighborhoodMap): boolean => {
    const site = findParcel(map, parcels, part, 0, [BuiltKind.Park, BuiltKind.Civic]);
    if (!site || !holdAt('festival', site, 0, FEST_LIFE, homesIn(part, 0), FEST_CROWD, false)) return false;
    live.events?.push({ kind: 'festival', x: site.x, y: site.y, w: site.w, h: site.h });
    const route = paradeRoute(map, site.x + site.w / 2, site.y + site.h / 2);
    if (route) holdAt('parade', route, 0, FEST_LIFE, homesIn(part, 0), PARADE_CROWD, true);
    deps.news(route ? 'A festival in the park — and a parade down the avenue' : 'A festival in the park');
    return true;
  };

  const draw = (hour: number): void => {
    const part = deps.partition();
    const busy = new Set((live.gatherings ?? []).map((g) => g.hood));
    const daytime = hour >= 10 && hour < 20;
    if (hour >= 21 || hour < 3) {
      // the night: a hard-pressed neighbourhood's sideshows (the crossings found once, only if one is hard pressed)
      let all: Crossing[] | null = null;
      for (let hood = 1; hood <= civic.count(); hood++) {
        if ((live.gatherings?.length ?? 0) >= MAX_GATHERINGS) return;
        if (busy.has(hood)) continue;
        const health = deps.health?.(hood);
        if (health === undefined || health >= SIDESHOW_HEALTH) continue;
        all ??= crossings(part);
        if (trySideshow(part, all, hood, (SIDESHOW_HEALTH - health) / SIDESHOW_HEALTH)) busy.add(hood);
      }
      return;
    }
    if (!daytime) return;
    // the city's festival (with its parade): at most one at a time
    if (!busy.has(0) && (live.gatherings?.length ?? 0) + 2 <= MAX_GATHERINGS && deps.approval() >= FEST_APPROVAL) {
      let trust = 0;
      for (let hood = 1; hood <= civic.count(); hood++) trust += above(civic.getValues(hood).trust, SEED_TRUST);
      if (civic.count() > 0 && trust / civic.count() >= FEST_TRUST && rng.next() < FEST_CHANCE && holdFestival(part)) busy.add(0);
    }
    const fairs = deps.practised('craft-fairs');
    // a maker space paired with a bazaar: craft fairs twice as often there (lane pairing, interdependence §9)
    const makersAtBazaars = fairs ? pairedHoods(deps.world.map, deps.world.parcels, part.tileToNeighborhood, BuiltKind.MakerSpace, BuiltKind.Bazaar) : new Set<number>();
    for (let hood = 1; hood <= civic.count(); hood++) {
      if ((live.gatherings?.length ?? 0) >= MAX_GATHERINGS) return;
      if (busy.has(hood)) continue;
      const v = civic.getValues(hood);
      // grievance first: a harmed neighbourhood with a voice speaks out; unheard, it rises up
      const voice = above(v.voice, SEED_VOICE);
      if (voice >= PROTEST_VOICE) {
        const { violence, grievance } = harmOf(part, hood);
        const unheardCount = unheard.get(hood)?.count ?? 0;
        if (unheardCount >= UPRISING_AFTER && violence >= UPRISING_VIOLENCE && rng.next() < UPRISING_CHANCE && holdProtest(part, hood, true)) {
          busy.add(hood);
          continue;
        }
        if (grievance > 0 && rng.next() < PROTEST_CHANCE * grievance * (0.5 + voice) && holdProtest(part, hood, false)) {
          busy.add(hood);
          continue;
        }
      }
      const belonging = above(v.belonging, SEED_BELONGING);
      if (fairs && belonging >= FAIR_BELONGING && rng.next() < FAIR_CHANCE * (makersAtBazaars.has(hood) ? 2 : 1) && holdFair(part, hood)) {
        busy.add(hood);
        continue;
      }
      if (belonging < PARTY_BELONGING || above(v.trust, SEED_TRUST) < PARTY_TRUST) continue;
      if ((deps.health?.(hood) ?? PARTY_HEALTH) < PARTY_HEALTH) continue; // a frayed neighbourhood doesn't party
      if (rng.next() >= PARTY_CHANCE * belonging) continue;
      if (holdParty(part, hood)) busy.add(hood);
    }
  };

  return {
    hold(kind) {
      const part = deps.partition();
      if (kind === 'festival') return holdFestival(part);
      if (kind === 'sideshow') {
        // a demo: the crossing nearest a precinct, so the police come (else any)
        const all = crossings(part);
        const pre: number[] = [];
        for (let t = 0; t < map.built.length; t++) if (map.built[t] === BuiltKind.Precinct) pre.push(t);
        const dist = (c: (typeof all)[number]): number =>
          pre.length === 0 ? 0 : Math.min(...pre.map((t) => Math.abs((t % map.width) - c.x) + Math.abs(Math.floor(t / map.width) - c.y)));
        const near = [...all].sort((a, b) => dist(a) - dist(b) || a.tiles[0]! - b.tiles[0]!);
        for (const c of near) {
          for (const hood of [...c.hoods].sort((a, b) => a - b)) {
            if (hood <= 0 || (live.gatherings ?? []).some((g) => g.hood === hood)) continue;
            if (trySideshow(part, [c], hood, 1, true)) return true;
          }
        }
        return false;
      }
      if (kind === 'protest' || kind === 'uprising') {
        // the neighbourhood the police have harmed most, if it isn't already out
        let best = 0;
        let worst = -1;
        for (let hood = 1; hood <= civic.count(); hood++) {
          const v = harmOf(part, hood).violence;
          if (v > worst) {
            worst = v;
            best = hood;
          }
        }
        if (best === 0 || (live.gatherings ?? []).some((g) => g.hood === best)) return false;
        return holdProtest(part, best, kind === 'uprising');
      }
      if (kind === 'craft-fair') {
        for (let hood = 1; hood <= civic.count(); hood++) if (holdFair(part, hood)) return true;
        return false;
      }
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
      tendUprisings(deps.partition());
      tendFestivals(hour);
      for (const g of live.gatherings ?? []) if (g.kind === 'sideshow' && !g.leaving) {
        skid(g);
        injure(g);
      }
      if (deps.on()) draw(hour);
    },
  };
}
