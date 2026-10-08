// GOLDEN determinism test for the live agent layer.
//
// The live layer (cars, peds, cruisers, trains, birds + the live field Maps) is NOT covered by the
// world hash, so a silent reordering of rng draws, cadence passes or iteration order during the
// src/live/* split would pass nearly every other test. This pins a digest of the full live state
// after a fixed run on a fixed seeded world. The host wiring mirrors main.ts (separate
// 'ambient-wind' / 'ambient' forks, parking lots, households, plant emitters, seedDecay).
//
// If this digest changes, the change altered live behaviour. A pure refactor must leave it
// byte-identical; a deliberate behaviour change re-pins it in its own commit, saying why.
import { describe, it, expect } from 'vitest';
import { createRng } from '../../src/engine/rng';
import { BuiltKind, placeTransport } from '../../src/engine/fabric';
import { runPipeline } from '../../src/worldgen/pipeline';
import { terrainStage } from '../../src/worldgen/terrain';
import { mosesCenturyStage } from '../../src/worldgen/moses';
import { ecoSeedStage } from '../../src/worldgen/ecoseed';
import { residentialCensus } from '../../src/citizens/census';
import { parkingLots, parkingStalls } from '../../src/ui/parkingContent';
import { plantPollution } from '../../src/growth/power';
import {
  createAmbientState,
  setParkingLots,
  setHouseholds,
  setPlantEmitters,
  type AmbientState,
} from '../../src/live/types';
import { stepAmbient } from '../../src/live/step';
import { seedDecay } from '../../src/live/fields/pollution';

// Seed chosen for coverage: at 48² it yields cars, ~125 peds, police (arrests → police violence), trains on
// the hand-laid rail, and flocks. Re-chosen 2026-10-07 ('d' → 'r'): on 4×8 blocks 'd' drew no cars at all.
const SEED = 'r';
const SIZE = 48;
const FRAMES = 60;
const FRAME_MS = 1000; // = AMBIENT_MAX_FRAME_MS → 20 substeps per frame, 1,200 substeps total

/** Build the world and run the live layer exactly as main.ts wires it (minus save/tech). */
function runGolden(): AmbientState {
  const world = runPipeline({ seed: SEED, width: SIZE, height: SIZE }, [
    terrainStage(),
    mosesCenturyStage(),
    ecoSeedStage(),
  ]);
  // The Moses century demolishes every rail, so lay a rail line by hand (two rows, wherever the
  // tile accepts it) — otherwise the train code would go unexercised.
  for (const y of [3, SIZE - 4]) {
    for (let x = 0; x < SIZE; x++) placeTransport(world.map, x, y, BuiltKind.Rail);
  }
  const ambientRng = createRng(SEED).fork('ambient');
  const state = createAmbientState(createRng(SEED).fork('ambient-wind'));
  setParkingLots(
    state,
    parkingLots(world.map).map((lot) => ({
      cx: (lot.x0 + lot.x1) / 2,
      cy: (lot.y0 + lot.y1) / 2,
      x0: lot.x0,
      y0: lot.y0,
      x1: lot.x1,
      y1: lot.y1,
      stalls: parkingStalls(lot),
    })),
  );
  setHouseholds(state, residentialCensus(world.parcels));
  const PLUME_RADIUS = 2;
  const emitters: { tile: number; amount: number }[] = [];
  for (const idx of world.parcels.aliveIndices()) {
    const p = world.parcels.get(idx);
    const amt = plantPollution(p.kind);
    if (amt <= 0) continue;
    for (let yy = -PLUME_RADIUS; yy < p.height + PLUME_RADIUS; yy++) {
      for (let xx = -PLUME_RADIUS; xx < p.width + PLUME_RADIUS; xx++) {
        const tx = p.x + xx;
        const ty = p.y + yy;
        if (world.map.inBounds(tx, ty)) emitters.push({ tile: world.map.idx(tx, ty), amount: amt });
      }
    }
  }
  setPlantEmitters(state, emitters);
  seedDecay(state, world.map);
  for (let f = 0; f < FRAMES; f++) stepAmbient(state, world.map, ambientRng, FRAME_MS);
  return state;
}

/** Canonical serialisation: numbers rounded to 1e-6, Map/Set entries sorted, object keys sorted,
 *  undefined dropped. Covers every mover field (positions, dirs, legs, phases…) and every field Map. */
function canon(v: unknown): string {
  if (v === undefined) return 'u';
  if (v === null) return 'null';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : (Math.round(v * 1e6) / 1e6).toString();
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'T' : 'F';
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v instanceof Map) {
    const ents = [...v.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return `M{${ents.map(([k, x]) => `${canon(k)}:${canon(x)}`).join(',')}}`;
  }
  if (v instanceof Set) {
    const vals = [...v.values()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `S{${vals.map(canon).join(',')}}`;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${k}:${canon(o[k])}`).join(',')}}`;
  }
  throw new Error(`canon: unsupported ${typeof v}`);
}

/** FNV-1a 32-bit over the canonical string, as 8 hex digits. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function digest(state: AmbientState): string {
  const counts = [
    `cars=${state.cars.length}`,
    `peds=${state.peds.length}`,
    `cruisers=${state.cruisers.length}`,
    `trains=${state.trains.length}`,
    `flocks=${state.birds.length}`,
  ].join(' ');
  return `${counts} #${fnv1a(canon(state))}`;
}

describe('live layer golden determinism', () => {
  const first = digest(runGolden());

  it('is deterministic: two identical runs give the identical digest', () => {
    expect(digest(runGolden())).toBe(first);
  });

  it('matches the pinned digest (a pure refactor must leave this byte-identical)', () => {
    expect(first).toBe('cars=6 peds=124 cruisers=4 trains=4 flocks=8 #1709e37a');
  });
});

