// The walk to school (Maddy 2026-10-14: "children walk to school"). At SCHOOL_IN_HOUR, up to PUPILS_PER_SCHOOL
// children set off on foot from the homes within SCHOOL_REACH of each school — the nearest first — to its door; at
// SCHOOL_OUT_HOUR as many walk home from it. They walk the pedestrian network at a walker's pace and are gone on
// arriving: the morning and afternoon streets, made visible. Live, renderer-side state.

import type { GameMap } from '../engine/map';
import { BuiltKind } from '../engine/fabric';
import type { AmbientState, Mover } from './types';
import { nearestWalkable, walkPath } from './pathing';
import { advanceMover, pathStep } from './motion';
import { board } from './trucks';
import { PED_SPEED } from './tuning';
import { SCHOOL_REACH } from './school';

export const PUPILS_PER_SCHOOL = 8;
export const SCHOOL_IN_HOUR = 7;
export const SCHOOL_OUT_HOUR = 15;

export interface Pupil extends Mover {
  /** Their home's anchor tile (it keeps how they look). */
  homeTile: number;
  going: 'school' | 'home';
}

/** Each school's anchor and door (the walkable tile nearest it). */
function schools(map: GameMap): { x: number; y: number; door: { x: number; y: number } }[] {
  const seen = new Set<number>();
  const out: { x: number; y: number; door: { x: number; y: number } }[] = [];
  for (let t = 0; t < map.built.length; t++) {
    if (map.built[t] !== BuiltKind.School || seen.has(map.parcel[t]!)) continue;
    seen.add(map.parcel[t]!);
    const x = t % map.width;
    const y = (t - x) / map.width;
    const door = nearestWalkable(map, x, y);
    if (door) out.push({ x, y, door });
  }
  return out;
}

/** Set the hour's walk off, once: to school in the morning, home in the afternoon. */
export function schoolRun(state: AmbientState, map: GameMap, hour: number | undefined): void {
  if (hour === undefined || hour === state.schoolRunHour) return;
  state.schoolRunHour = hour;
  if (hour !== SCHOOL_IN_HOUR && hour !== SCHOOL_OUT_HOUR) return;
  const toSchool = hour === SCHOOL_IN_HOUR;
  const pupils = (state.pupils ??= []);
  for (const s of schools(map)) {
    const homes = (state.households ?? [])
      .filter((h) => (state.occupancy.get(map.idx(h.x, h.y)) ?? 0) > 0 && Math.max(Math.abs(h.x - s.x), Math.abs(h.y - s.y)) <= SCHOOL_REACH)
      .sort((a, b) => Math.abs(a.x - s.x) + Math.abs(a.y - s.y) - (Math.abs(b.x - s.x) + Math.abs(b.y - s.y)) || map.idx(a.x, a.y) - map.idx(b.x, b.y))
      .slice(0, PUPILS_PER_SCHOOL);
    for (const h of homes) {
      const door = nearestWalkable(map, h.x, h.y);
      if (!door) continue;
      const [from, to] = toSchool ? [door, s.door] : [s.door, door];
      const path = walkPath(map, from.x, from.y, to.x, to.y);
      const p: Pupil = { x: from.x, y: from.y, dir: 0, tx: from.x, ty: from.y, homeTile: map.idx(h.x, h.y), going: toSchool ? 'school' : 'home' };
      if (path && board(p, path, map)) pupils.push(p);
    }
  }
}

/** Walk the children a substep; those arrived are gone. */
export function stepPupils(state: AmbientState, map: GameMap): void {
  const pupils = state.pupils;
  if (!pupils || pupils.length === 0) return;
  state.pupils = pupils.filter((p) => advanceMover(p, PED_SPEED, map, (x, y) => pathStep(map, p, x, y)));
}
