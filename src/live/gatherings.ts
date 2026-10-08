// Gatherings (docs/design/community-events.md): the shared machinery under block parties, craft fairs, festivals,
// parades, protests and uprisings. Neighbours walk from their homes to a place, mill about in it while it lasts and
// walk home after — real people (peds in a 'gathering' phase), so they are drawn, lit, arrested, caught in a
// cloud or hurt like anyone on the street. Live layer: writes only its own state; draws only from the rng handed in.

import type { GameMap } from '../engine/map';
import type { Rng } from '../engine/rng';
import type { AmbientState, Ped } from './types';
import { walkPath } from './pathing';
import { isWalkable } from './network';
import { advanceMover, commitHeading, pathStep } from './motion';
import { PED_SPEED } from './tuning';

export type GatheringKind = 'craft-fair' | 'block-party' | 'festival' | 'parade' | 'protest' | 'uprising';

export interface Gathering {
  id: number;
  kind: GatheringKind;
  /** Where people gather (tiles). */
  site: { x: number; y: number; w: number; h: number };
  /** The neighbourhood it belongs to (0 = the whole city). */
  hood: number;
  /** Substeps since it began, and how long it lasts. */
  age: number;
  life: number;
  /** People have started for home. */
  leaving: boolean;
}

/** Substeps before the end that people start for home (they walk there inside the gathering's life). */
export const GATHER_LEAVE = 400;

/** A walkable tile beside a home (its kerb), or null. */
function kerbOf(map: GameMap, tile: number): { x: number; y: number } | null {
  const x = tile % map.width;
  const y = (tile - x) / map.width;
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
    if (map.inBounds(x + dx, y + dy) && isWalkable(map, x + dx, y + dy)) return { x: x + dx, y: y + dy };
  }
  return null;
}

/** Board a ped onto a committed foot route (as a car boards a road route); false if there's nowhere to walk. */
function board(p: Ped, path: readonly number[] | null, map: GameMap): boolean {
  if (!path || path.length < 2) return false;
  const p0x = path[0]! % map.width;
  const p0y = (path[0]! - p0x) / map.width;
  const p1x = path[1]! % map.width;
  const p1y = (path[1]! - p1x) / map.width;
  p.x = p0x;
  p.y = p0y;
  p.tx = p1x;
  p.ty = p1y;
  commitHeading(p, p1x > p0x ? 1 : p1x < p0x ? 3 : p1y > p0y ? 2 : 0);
  p.path = path;
  p.leg = 2;
  p.recent = undefined;
  return true;
}

const siteTile = (g: Gathering, rng: Rng): { x: number; y: number } => ({ x: g.site.x + rng.nextInt(g.site.w), y: g.site.y + rng.nextInt(g.site.h) });

/** Begin a gathering: up to `crowd` neighbours set out from `homes` (nearest the place first) for it. Null if
 *  nobody can walk there. */
export function startGathering(
  state: AmbientState,
  map: GameMap,
  rng: Rng,
  opts: { kind: GatheringKind; site: Gathering['site']; hood: number; life: number; homes: readonly number[]; crowd: number },
): Gathering | null {
  const g: Gathering = { id: (state.gatheringSeq = (state.gatheringSeq ?? 0) + 1), kind: opts.kind, site: opts.site, hood: opts.hood, age: 0, life: opts.life, leaving: false };
  const cx = opts.site.x + opts.site.w / 2;
  const cy = opts.site.y + opts.site.h / 2;
  const byNear = [...opts.homes].sort((a, b) => {
    const ax = a % map.width, ay = (a - ax) / map.width, bx = b % map.width, by = (b - bx) / map.width;
    return Math.abs(ax - cx) + Math.abs(ay - cy) - (Math.abs(bx - cx) + Math.abs(by - cy)) || a - b;
  });
  let n = 0;
  for (const home of byNear) {
    if (n >= opts.crowd) break;
    const kerb = kerbOf(map, home);
    if (!kerb) continue;
    const to = siteTile(g, rng);
    const p: Ped = { x: kerb.x, y: kerb.y, dir: 0, tx: kerb.x, ty: kerb.y, phase: 'gathering', homeTile: home, gather: { id: g.id, go: 'coming', mill: 0, home: kerb } };
    if (!board(p, walkPath(map, kerb.x, kerb.y, to.x, to.y), map)) continue;
    state.peds.push(p);
    n++;
  }
  if (n === 0) return null;
  (state.gatherings ??= []).push(g);
  return g;
}

/** A gatherer's step (the 'gathering' ped phase): walk there, mill about, walk home. False once home (despawn). */
export function stepGatherer(state: AmbientState, map: GameMap, rng: Rng, p: Ped): boolean {
  const gs = p.gather;
  const g = gs ? state.gatherings?.find((x) => x.id === gs.id) : undefined;
  if (!gs || !g) return false;
  if (gs.go !== 'here') {
    if (p.path && advanceMover(p, PED_SPEED, map, (x, y) => pathStep(map, p, x, y))) return true;
    p.path = undefined;
    p.leg = undefined;
    if (gs.go === 'going') return false; // home
    gs.go = 'here';
    gs.mill = 40 + rng.nextInt(80);
    return true;
  }
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  if (g.leaving) {
    if (!board(p, walkPath(map, x, y, gs.home.x, gs.home.y), map)) return false; // already home
    gs.go = 'going';
    return true;
  }
  if (--gs.mill > 0) return true;
  const to = siteTile(g, rng);
  if (board(p, walkPath(map, x, y, to.x, to.y), map)) gs.go = 'milling';
  else gs.mill = 40;
  return true;
}

/** One substep of every gathering: age it; send people home near its end; end it once everyone has gone. */
export function stepGatherings(state: AmbientState): void {
  if (!state.gatherings?.length) return;
  const still: Gathering[] = [];
  for (const g of state.gatherings) {
    g.age++;
    if (!g.leaving && g.age >= g.life - GATHER_LEAVE) g.leaving = true;
    if (g.age >= g.life && !state.peds.some((p) => p.gather?.id === g.id)) (state.gatheringsEnded ??= []).push(g);
    else still.push(g);
  }
  state.gatherings = still;
}

/** The gatherings that have ended since the last call (the host applies what they did). */
export function takeEndedGatherings(state: AmbientState): Gathering[] {
  const out = state.gatheringsEnded ?? [];
  state.gatheringsEnded = undefined;
  return out;
}
