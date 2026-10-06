// Live-layer POLICE: cruisers out of the precincts, the scatter/chase ghost cadence, hunting and
// patrol steps that avoid community refuges (safe zones), and the arrest odds that track the redline
// grade, and the arrest sweep that lays police violence and trauma where it lands. Cut verbatim from
// ui/ambientContent.ts.

import type { GameMap } from '../engine/map';
import { BuiltKind } from '../engine/fabric';
import type { Rng } from '../engine/rng';
import { layField } from '../citizens/field';
import {
  AMBUSH_LEAD,
  ARREST_CHANCE_MAX,
  ARREST_DRAIN,
  ARREST_RADIUS,
  ARREST_TRAUMA,
  CAR_SPEED,
  CHASE_LEN,
  CRUISER_CAP,
  CRUISER_LIFE,
  HUNT_RADIUS,
  POLICE_VIOLENCE_LAY,
  POLICE_VIOLENCE_MAX,
  REFUGE_KINDS,
  SAFE_RADIUS,
  SCATTER_LEN,
  SHY_RADIUS,
} from './tuning';
import { DIR_DX, DIR_DY } from './geometry';
import type { AmbientState, Mover, Ped } from './types';
import { advanceMover, blockedAhead } from './motion';
import { adjacentRoad, canDrive, carPassable } from './network';
import { abandonOwnedCar, depositHealth } from './agents';

/** The set of tiles within SAFE_RADIUS of any community-power building — refuge the cruisers avoid
 *  and never sweep. Built fresh from the map (sparse refuges); the player grows it by building. */
export function buildSafeZones(map: GameMap): Set<number> {
  const safe = new Set<number>();
  for (let i = 0; i < map.built.length; i++) {
    if (!REFUGE_KINDS.has(map.built[i]!)) continue;
    const cx = i % map.width;
    const cy = (i - cx) / map.width;
    for (let dy = -SAFE_RADIUS; dy <= SAFE_RADIUS; dy++) {
      for (let dx = -SAFE_RADIUS; dx <= SAFE_RADIUS; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (map.inBounds(nx, ny)) safe.add(map.idx(nx, ny));
      }
    }
  }
  return safe;
}

/** The fleet-wide police phase for a substep counter: 'scatter' (patrol, no hunting/arrests) or
 *  'chase' (hunt + arrest). Deterministic; the ghost cadence. */
export function policePhase(tick: number): 'scatter' | 'chase' {
  return tick % (SCATTER_LEN + CHASE_LEN) < SCATTER_LEN ? 'scatter' : 'chase';
}

/**
 * The per-sweep arrest probability for a cruiser standing on ground of this redline grade:
 * scales LINEARLY with the grade (0 at greenlined, ARREST_CHANCE_MAX at fully redlined), so the
 * over-policing pressure tracks the discrimination rather than switching on at a threshold.
 */
export function arrestChance(grade: number): number {
  const g = grade < 0 ? 0 : grade > 255 ? 255 : grade;
  return (g / 255) * ARREST_CHANCE_MAX;
}

/**
 * Spawn police cruisers out of the precincts (≈ one per 2x2 precinct, capped) until the patrol
 * count is met. Each spawns on a road beside a precinct and patrols from there. The precincts sit
 * in the redlined districts, so the patrols concentrate there — the over-policing made visible.
 * Renderer-side; reads the built layer, writes only state.cruisers.
 */
export function spawnCruisers(state: AmbientState, map: GameMap, rng: Rng): void {
  const precincts: number[] = [];
  for (let i = 0; i < map.built.length; i++) if (map.built[i] === BuiltKind.Precinct) precincts.push(i);
  if (precincts.length === 0) return;
  const target = Math.min(CRUISER_CAP, Math.ceil(precincts.length / 4)); // ≈ one per 2x2 precinct
  let guard = precincts.length;
  while (state.cruisers.length < target && guard-- > 0) {
    const pi = precincts[rng.nextInt(precincts.length)]!;
    const px = pi % map.width;
    const py = (pi - px) / map.width;
    const road = adjacentRoad(map, px, py);
    if (road < 0) continue;
    const rx = road % map.width;
    const ry = (road - rx) / map.width;
    // Spread personalities across the fleet (direct / ambush / shy) so the patrol reads varied.
    state.cruisers.push({
      x: rx, y: ry, dir: rng.nextInt(4), tx: rx, ty: ry, dwell: CRUISER_LIFE, recent: [],
      personality: state.cruisers.length % 3,
    });
  }
}

/** The nearest on-foot citizen to (x, y) within HUNT_RADIUS, or null. */
export function nearestPed(peds: readonly Ped[], x: number, y: number): Ped | null {
  let best = HUNT_RADIUS + 1;
  let found: Ped | null = null;
  for (const p of peds) {
    if (p.phase === 'inside' || p.phase === 'driving') continue; // not on the street
    const d = Math.abs(Math.round(p.x) - x) + Math.abs(Math.round(p.y) - y);
    if (d < best) {
      best = d;
      found = p;
    }
  }
  return found;
}

/**
 * The tile a cruiser aims for this step, by its ghost PERSONALITY (or null → patrol/seek grade):
 *   0 direct (Blinky)  — the citizen's tile;
 *   1 ambush (Pinky)   — AMBUSH_LEAD tiles AHEAD of the citizen's heading, to cut them off;
 *   2 shy (Clyde)      — the citizen's tile ONLY when within SHY_RADIUS, else null (it patrols).
 * Deterministic; reads the nearest on-foot citizen.
 */
export function huntTarget(c: Mover, peds: readonly Ped[]): { x: number; y: number } | null {
  const cx = Math.round(c.x);
  const cy = Math.round(c.y);
  const p = nearestPed(peds, cx, cy);
  if (!p) return null;
  const px = Math.round(p.x);
  const py = Math.round(p.y);
  const pers = c.personality ?? 0;
  if (pers === 1) return { x: px + DIR_DX[p.dir]! * AMBUSH_LEAD, y: py + DIR_DY[p.dir]! * AMBUSH_LEAD };
  if (pers === 2) return Math.abs(px - cx) + Math.abs(py - cy) <= SHY_RADIUS ? { x: px, y: py } : null;
  return { x: px, y: py };
}

/**
 * Deliberate cruiser patrol (replaces the old random wander): among the passable, non-reversing,
 * non-recent road neighbours, pick the one that (a) closes on the nearest on-foot citizen if one
 * is within HUNT_RADIUS — the cruiser HUNTS — else (b) climbs toward more redlined ground (higher
 * grade), so patrols seek the redlined streets instead of drifting into greenlined ones. A small
 * rng jitter breaks ties. Returns the reverse on a dead-end, or -1 when boxed in (caller despawns).
 * Deterministic in `rng`.
 */
export function nextPatrolStep(
  map: GameMap,
  x: number,
  y: number,
  fromDir: number,
  rng: Rng,
  recent: readonly number[] | undefined,
  target: { x: number; y: number } | null,
  safe?: ReadonlySet<number>,
): number {
  const options: number[] = [];
  let uTurn = -1;
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    // the same edge-aware rule every car obeys: one-way freeway lanes, limited access, no median
    // crossing (Maddy 2026-09-30: cruisers were cutting across opposing freeway lanes)
    if (!canDrive(map, x, y, nx, ny)) continue;
    if (safe?.has(map.idx(nx, ny))) continue; // community refuge — cruisers won't enter it
    if (d === fromDir) {
      uTurn = d;
      continue;
    }
    options.push(d);
  }
  if (options.length === 0) return uTurn; // dead-end: reverse, or -1 if truly isolated
  let pool = options;
  if (recent && recent.length > 0) {
    const fresh = options.filter((d) => !recent.includes(map.idx(x + DIR_DX[d]!, y + DIR_DY[d]!)));
    if (fresh.length === 0) return -1; // boxed in by its own path → despawn
    pool = fresh;
  }
  let bestDir = pool[0]!;
  let bestScore = -Infinity;
  for (const d of pool) {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    // Hunt: distance to the citizen dominates (×10). Else seek the redline grade. +jitter tiebreak.
    const score = target
      ? -(Math.abs(nx - target.x) + Math.abs(ny - target.y)) * 10 + rng.nextInt(3)
      : map.redline[map.idx(nx, ny)]! + rng.nextInt(3);
    if (score > bestScore) {
      bestScore = score;
      bestDir = d;
    }
  }
  return bestDir;
}

/**
 * Move every cruiser one substep: a DELIBERATE patrol (hunt nearby citizens, else seek redlined
 * streets — see nextPatrolStep), despawning if its road was bulldozed or it boxes itself in, and
 * counting down its patrol life so the fleet recirculates from the precincts. Renderer-side;
 * deterministic in `rng`.
 */
export function stepCruisers(state: AmbientState, map: GameMap, rng: Rng, safe?: ReadonlySet<number>, grid?: Map<number, Mover[]>): void {
  const chasing = policePhase(state.policeTick) === 'chase';
  const blocked = grid ? (mm: Mover): boolean => blockedAhead(grid, map.width, mm) : undefined;
  state.cruisers = state.cruisers.filter((c) => {
    if ((c.dwell ?? 0) <= 0) return false; // shift over → recycle (respawn tops up from the precinct)
    c.dwell! -= 1;
    if (!carPassable(map, Math.round(c.x), Math.round(c.y))) return false; // road gone
    // Chase → aim per the cruiser's ghost personality; scatter → no target, so it seeks redlined streets.
    const target = chasing ? huntTarget(c, state.peds) : null;
    return advanceMover(c, CAR_SPEED, map, (x, y, fromDir, recent) =>
      nextPatrolStep(map, x, y, fromDir, rng, recent, target, safe), blocked,
    );
  });
}

/**
 * Arrest sweep: each cruiser may seize the nearest on-foot citizen within ARREST_RADIUS — removing
 * them from the street AND draining a person from their household's occupancy — with a probability
 * that SCALES WITH the redline grade under the cruiser (arrestChance: 0 at greenlined, max at fully
 * redlined). For nothing: no cause, only the grade. The player ends it by defunding the precinct
 * (no precinct → no cruisers → no arrests). Renderer-side; deterministic in `rng`.
 */
export function stepArrests(state: AmbientState, map: GameMap, rng: Rng, safe?: ReadonlySet<number>): void {
  if (state.cruisers.length === 0 || state.peds.length === 0) return;
  for (const c of state.cruisers) {
    const cx = Math.round(c.x);
    const cy = Math.round(c.y);
    if (!map.inBounds(cx, cy)) continue;
    if (safe?.has(map.idx(cx, cy))) continue; // no arrests inside a community refuge
    // Arrest pressure scales with how redlined the ground is (0 at greenlined) — no threshold.
    if (!rng.chance(arrestChance(map.redline[map.idx(cx, cy)]!))) continue;
    // Nearest on-foot citizen within reach (riders/indoors aren't on the street).
    let victim = -1;
    let best = ARREST_RADIUS + 1;
    for (let i = 0; i < state.peds.length; i++) {
      const p = state.peds[i]!;
      if (p.phase === 'inside' || p.phase === 'driving') continue;
      const d = Math.abs(Math.round(p.x) - cx) + Math.abs(Math.round(p.y) - cy);
      if (d < best) {
        best = d;
        victim = i;
      }
    }
    if (victim < 0) continue;
    const taken = state.peds[victim]!;
    if (taken.homeTile !== undefined) {
      const cur = state.occupancy.get(taken.homeTile);
      if (cur !== undefined) state.occupancy.set(taken.homeTile, Math.max(0, cur - ARREST_DRAIN));
      depositHealth(state, taken.homeTile, -ARREST_TRAUMA); // the trauma craters the household's wellbeing
    }
    // The taken citizen is removed from the game, so their car is ABANDONED where they were seized —
    // a derelict dumped on an empty tile that rusts into ground pollution (not driven home).
    abandonOwnedCar(state, map, taken);
    // Stain the spot — the police-violence record (the anti-crime-map) builds where arrests fall.
    layField(state.policeViolence, map.idx(Math.round(taken.x), Math.round(taken.y)), POLICE_VIOLENCE_LAY, POLICE_VIOLENCE_MAX);
    state.peds.splice(victim, 1); // taken off the street, for nothing
  }
}
