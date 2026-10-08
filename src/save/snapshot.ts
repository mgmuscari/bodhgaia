// Save/load (Maddy 2026-10-02): the game as a versioned, JSON-safe document. PURE — no DOM, no storage (the
// browser store is save/store.ts). What is saved is the game's STOCKS: the world (every map layer and the
// parcel columns, tombstones included), the tech tree, civic values, the economy run, and the live layer's
// slow stocks (occupancy and what residents expect, wear, road decay, pollution, building health). Everything
// DERIVED is recomputed from those on load — the neighbourhood partition, households, land value, coverage,
// traffic, the power grid — and the agents (cars, walkers, trains) respawn from the city (Maddy's choice).
// The rng streams are not saved: a loaded game re-forks them, so play after a load is not a replay.
//
// The format is versioned. parseSave refuses anything that isn't a save or is newer than this build; an older
// version is lifted through MIGRATIONS (one step per version) before use.

import type { GameMap } from '../engine/map';
import type { ParcelColumns, ParcelStore } from '../engine/fabric';
import type { TechState } from '../tech/state';
import type { CivicState } from '../civic/state';
import type { EconomyRun } from '../economy/run';
import type { AmbientState } from '../live/types';

export const SAVE_FORMAT = 'bodhitropolis-save';
export const SAVE_VERSION = 2;

/** The map layers a save carries, by GameMap field name (all of them: they are the world). v1 also carried
 *  'traffic' — an always-zero legacy layer, retired in v2 (MIGRATIONS[1] drops it). */
const LAYERS = [
  'elevation',
  'water',
  'moisture',
  'landCover',
  'built',
  'deck',
  'parcel',
  'soilHealth',
  'floraVitality',
  'faunaPresence',
  'redline',
] as const;
type LayerName = (typeof LAYERS)[number];

/** The live layer's STOCKS (Maps keyed by tile) — everything else in the live layer is derived or transient. */
export const LIVE_MAPS = ['occupancy', 'occExpect', 'wear', 'roadDecay', 'waterPollution', 'groundPollution', 'pollution', 'buildingHealth'] as const;
type LiveMapName = (typeof LIVE_MAPS)[number];

export interface SaveV1 {
  format: typeof SAVE_FORMAT;
  version: number;
  /** ms since epoch, stamped by the caller (pure code has no clock). */
  savedAt: number;
  /** The city's name, for the slot list. */
  name: string;
  seed: string;
  width: number;
  height: number;
  /** The sim tick (civic repair rings are stamped in ticks). */
  tick: number;
  camera: { x: number; y: number; zoom: number };
  world: { layers: Record<LayerName, string>; parcels: ParcelColumns };
  tech: { unlocked: string[]; effort: number };
  civic: Array<{ belonging: number; voice: number; trust: number; ring: number[] }>;
  econ: EconomyRun;
  /** `unhoused`/`freshHomes` arrived 2026-10-07 (rehoming.md); an older save derives the pool on restore. */
  live: { maps: Record<LiveMapName, Array<[number, number]>>; occPasses: number; unhoused?: number; freshHomes?: number[] };
}

/** Everything the save reads, as the running game holds it. */
export interface GameParts {
  seed: string;
  name?: string;
  savedAt?: number;
  world: { map: GameMap; parcels: ParcelStore };
  tech: TechState;
  civic: CivicState;
  econ: EconomyRun;
  live: AmbientState;
  tick: number;
  camera: { x: number; y: number; zoom: number };
}

// ── base64 (pure: no btoa/atob, which are DOM globals) ──────────────────────────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Map<string, number>([...B64].map((ch, i) => [ch, i]));

export function encodeBytes(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '=';
    out += i + 2 < bytes.length ? B64[n & 63]! : '=';
  }
  return out;
}

export function decodeBytes(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const v = (k: number): number => {
      const ch = clean[i + k];
      if (ch === undefined) return 0;
      const n = B64_INDEX.get(ch);
      if (n === undefined) throw new Error('save: corrupt layer data');
      return n;
    };
    const n = (v(0) << 18) | (v(1) << 12) | (v(2) << 6) | v(3);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

const bytesOf = (a: ArrayBufferView): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

// ── capture ───────────────────────────────────────────────────────────────────────────────────────────────

export function captureGame(p: GameParts): SaveV1 {
  const map = p.world.map;
  const layers = {} as Record<LayerName, string>;
  for (const name of LAYERS) layers[name] = encodeBytes(bytesOf(map[name]));
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt: p.savedAt ?? 0,
    name: p.name ?? p.seed,
    seed: p.seed,
    width: map.width,
    height: map.height,
    tick: p.tick,
    camera: { ...p.camera },
    world: { layers, parcels: p.world.parcels.exportColumns() },
    tech: { unlocked: [...p.tech.unlocked].sort(), effort: p.tech.effort },
    civic: p.civic.exportCells(),
    econ: JSON.parse(JSON.stringify(p.econ)) as EconomyRun,
    live: captureLive(p.live),
  };
}

// ── parse (validate + migrate) ───────────────────────────────────────────────────────────────────────────

/** One lift per version: MIGRATIONS[v] turns a version-v save into version v+1. */
const MIGRATIONS: Record<number, (s: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 → v2: GameMap's `traffic` layer is retired (nothing wrote it since the O-D generator went; it was
  // always zero — traffic is agent-driven in the live layer). Drop it; every other layer is unchanged.
  1: (s) => {
    const world = s.world as { layers?: Record<string, string> } | undefined;
    if (!world?.layers) return s;
    const { traffic: _dropped, ...layers } = world.layers;
    return { ...s, world: { ...world, layers } };
  },
};

export function parseSave(text: string): SaveV1 {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('not a Bodhitropolis save (unreadable)');
  }
  if (typeof raw !== 'object' || raw === null || (raw as { format?: unknown }).format !== SAVE_FORMAT) {
    throw new Error('not a Bodhitropolis save');
  }
  let s = raw as Record<string, unknown>;
  let v = Number(s.version);
  if (!Number.isInteger(v) || v < 1) throw new Error('not a Bodhitropolis save (no version)');
  if (v > SAVE_VERSION) throw new Error(`this save is from a newer version of the game (v${v}; this build reads v${SAVE_VERSION})`);
  while (v < SAVE_VERSION) {
    const lift = MIGRATIONS[v];
    if (!lift) throw new Error(`no migration from save v${v}`);
    s = { ...lift(s), version: v + 1 };
    v++;
  }
  return s as unknown as SaveV1;
}

// ── restore (onto freshly constructed parts) ─────────────────────────────────────────────────────────────

/** Overwrite a freshly generated world (same seed and size) with the saved layers and parcels. */
export function restoreWorld(world: { map: GameMap; parcels: ParcelStore }, saved: SaveV1['world']): void {
  const map = world.map;
  for (const name of LAYERS) {
    const dst = bytesOf(map[name]);
    const src = decodeBytes(saved.layers[name]);
    if (src.length !== dst.length) throw new Error(`save: layer ${name} is the wrong size`);
    dst.set(src);
  }
  world.parcels.importColumns(saved.parcels);
}

export function restoreTech(tech: TechState, saved: SaveV1['tech']): void {
  tech.restore(saved.unlocked, saved.effort);
}

export function restoreCivic(civic: CivicState, saved: SaveV1['civic']): void {
  civic.importCells(saved);
}

/** The live stocks a save keeps (agents respawn; derived fields recompute). */
export function captureLive(live: AmbientState): SaveV1['live'] {
  const maps = {} as Record<LiveMapName, Array<[number, number]>>;
  for (const name of LIVE_MAPS) maps[name] = [...live[name].entries()];
  return { maps, occPasses: live.occPasses, unhoused: live.unhoused, freshHomes: [...(live.freshHomes ?? [])] };
}

/** Put the saved live stocks back; derived fields recompute on their own cadences, agents respawn. A save from
 *  before the unhoused were a stock derives the pool from its emptied homes, plus `legacyDisplaced` (the old
 *  economy's rent-displacement count, which was shown on top of them). `mapWidth` keys occupancy (y·width + x). */
export function restoreLive(live: AmbientState, saved: SaveV1['live'], mapWidth: number, legacyDisplaced = 0): void {
  for (const name of LIVE_MAPS) live[name] = new Map(saved.maps[name] ?? []);
  live.occPasses = saved.occPasses;
  live.freshHomes = new Set(saved.freshHomes ?? []);
  if (saved.unhoused !== undefined) {
    live.unhoused = saved.unhoused;
    return;
  }
  let pool = legacyDisplaced;
  for (const h of live.households ?? []) {
    const occ = live.occupancy.get(h.y * mapWidth + h.x);
    if (occ !== undefined && occ < h.count) pool += h.count - occ;
  }
  live.unhoused = pool;
}
