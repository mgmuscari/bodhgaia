// Industrial spills (docs/design/disasters.md): an old works leaks. Once an in-game hour each industrial works may
// spill — likelier the more decayed it is and the more redlined its ground, far less if its workers own it. A spill
// poisons the ground at the works and the water near it (a wastewater works catches half), and sends a toxic cloud
// downwind that smogs the air under it and kills a few of the people outdoors it passes over. Live layer: reads
// the world, writes only its own fields (never hashed).

import type { GameMap } from '../engine/map';
import type { Rng } from '../engine/rng';
import { BuiltKind, type ParcelStore } from '../engine/fabric';
import { ZoneType, zoneTypeOf } from '../engine/zone';
import { layField } from '../citizens/field';
import type { AmbientState, LivePractices } from './types';
import { residentDies } from './death';
import { diffuseField, driftField } from './fields/pollution';
import { decayField } from '../citizens/field';
import {
  CLOUD_DEATH_CHANCE,
  CLOUD_DEATH_MAX,
  CLOUD_RADIUS,
  CLOUD_SMOG,
  CLOUD_TOXIC,
  POLL_DIFFUSE_COEFF,
  TOXIC_DECAY,
  TOXIC_MAX,
  CLOUD_SPEED,
  CLOUD_SUBSTEPS,
  GROUND_POLL_MAX,
  POLL_MAX,
  SPILL_BASE,
  SPILL_GROUND,
  SPILL_GROUND_RING,
  SPILL_WATER,
  SPILL_WATER_RADIUS,
  WATER_POLL_MAX,
  WATER_TREAT_RADIUS,
} from './tuning';

/** The chance a building of `kind` at `condition` on ground of redline `grade` spills in an hour. 0 unless it is
 *  an industrial works. */
export function spillChance(kind: number, condition: number, grade: number, practices: Pick<LivePractices, 'spillRate'>): number {
  if (zoneTypeOf(kind) !== ZoneType.Industrial) return 0;
  const decay = 1 + 3 * (1 - Math.min(255, Math.max(0, condition)) / 255);
  const distress = 1 + Math.min(255, Math.max(0, grade)) / 255;
  return SPILL_BASE * decay * distress * practices.spillRate;
}

function treatedNear(map: GameMap, x: number, y: number): boolean {
  for (let dy = -WATER_TREAT_RADIUS; dy <= WATER_TREAT_RADIUS; dy++) {
    const span = WATER_TREAT_RADIUS - Math.abs(dy);
    for (let dx = -span; dx <= span; dx++) {
      if (map.inBounds(x + dx, y + dy) && map.built[map.idx(x + dx, y + dy)] === BuiltKind.WastewaterWorks) return true;
    }
  }
  return false;
}

/** A works spills: ground and water poisoned, a cloud sent downwind, the camera called. */
export function startSpill(state: AmbientState, map: GameMap, works: { x: number; y: number; width: number; height: number }): void {
  const { x, y, width: w, height: h } = works;
  for (let ty = y - SPILL_GROUND_RING; ty < y + h + SPILL_GROUND_RING; ty++) {
    for (let tx = x - SPILL_GROUND_RING; tx < x + w + SPILL_GROUND_RING; tx++) {
      if (map.inBounds(tx, ty) && map.water[map.idx(tx, ty)] === 0) layField(state.groundPollution, map.idx(tx, ty), SPILL_GROUND, GROUND_POLL_MAX);
    }
  }
  for (let ty = y - SPILL_WATER_RADIUS; ty < y + h + SPILL_WATER_RADIUS; ty++) {
    for (let tx = x - SPILL_WATER_RADIUS; tx < x + w + SPILL_WATER_RADIUS; tx++) {
      if (!map.inBounds(tx, ty) || map.water[map.idx(tx, ty)] === 0) continue;
      layField(state.waterPollution, map.idx(tx, ty), treatedNear(map, tx, ty) ? SPILL_WATER / 2 : SPILL_WATER, WATER_POLL_MAX);
    }
  }
  (state.clouds ??= []).push({ x: x + w / 2, y: y + h / 2, age: 0, touched: new WeakSet(), deaths: 0 });
  state.events?.push({ kind: 'spill', x, y, w, h });
}

/** Once per in-game hour, each industrial works may spill. Returns the parcels that did. No clock, no spills. */
export function drawSpills(state: AmbientState, world: { map: GameMap; parcels: ParcelStore }, rng: Rng, hour: number | undefined): number[] {
  if (hour === undefined || hour === state.spillHour) return [];
  state.spillHour = hour;
  const { map, parcels } = world;
  const out: number[] = [];
  for (const i of parcels.aliveIndices()) {
    const p = parcels.get(i);
    const chance = spillChance(p.kind, p.condition, map.redline[map.idx(p.x, p.y)]!, state.practices);
    if (chance > 0 && rng.next() < chance) {
      startSpill(state, map, p);
      out.push(i);
    }
  }
  return out;
}

/** One substep of every cloud: drift downwind, smog the air under it, harm the people outdoors under it. */
export function stepClouds(state: AmbientState, map: GameMap, rng: Rng): void {
  if (!state.clouds?.length) return;
  const r2 = CLOUD_RADIUS * CLOUD_RADIUS;
  const { dx, dy } = state.wind;
  const norm = dx !== 0 && dy !== 0 ? Math.SQRT1_2 : 1;
  for (const c of state.clouds) {
    c.age++;
    c.x += dx * norm * CLOUD_SPEED;
    c.y += dy * norm * CLOUD_SPEED;
    const fade = 1 - c.age / CLOUD_SUBSTEPS;
    for (let ty = Math.floor(c.y - CLOUD_RADIUS); ty <= Math.ceil(c.y + CLOUD_RADIUS); ty++) {
      for (let tx = Math.floor(c.x - CLOUD_RADIUS); tx <= Math.ceil(c.x + CLOUD_RADIUS); tx++) {
        if (!map.inBounds(tx, ty) || (tx + 0.5 - c.x) ** 2 + (ty + 0.5 - c.y) ** 2 > r2) continue;
        layField(state.pollution, map.idx(tx, ty), CLOUD_SMOG * fade, POLL_MAX);
        layField((state.toxic ??= new Map()), map.idx(tx, ty), CLOUD_TOXIC * fade, TOXIC_MAX);
      }
    }
    if (c.deaths >= CLOUD_DEATH_MAX) continue;
    const dead = new Set<object>();
    for (const p of state.peds) {
      if (p.phase === 'inside' || p.phase === 'driving' || c.touched.has(p)) continue;
      if ((p.x + 0.5 - c.x) ** 2 + (p.y + 0.5 - c.y) ** 2 > r2) continue;
      c.touched.add(p);
      if (c.deaths >= CLOUD_DEATH_MAX || rng.next() >= CLOUD_DEATH_CHANCE) continue;
      c.deaths++;
      dead.add(p);
      if (p.homeTile !== undefined) state.occupancy.set(p.homeTile, Math.max(0, (state.occupancy.get(p.homeTile) ?? 0) - 1));
      else if (state.unhoused >= 1) state.unhoused -= 1;
      residentDies(state, Math.floor(p.x), Math.floor(p.y));
    }
    if (dead.size > 0) state.peds = state.peds.filter((p) => !dead.has(p));
  }
  state.clouds = state.clouds.filter((c) => c.age < CLOUD_SUBSTEPS && map.inBounds(Math.floor(c.x), Math.floor(c.y)));
}

/** One substep of the toxic smog: on the wind's turns it drifts downwind and spreads (as smog does); every substep
 *  it clears a little. */
export function stepToxic(state: AmbientState, map: GameMap, windTurn: boolean): void {
  const toxic = state.toxic;
  if (!toxic || toxic.size === 0) return;
  if (windTurn) {
    driftField(toxic, state.wind, map, TOXIC_MAX);
    diffuseField(toxic, map, POLL_DIFFUSE_COEFF, TOXIC_MAX);
  }
  decayField(toxic, TOXIC_DECAY);
}
