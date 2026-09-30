// Pure render-key seam: the single source of truth for which atlas tile a built
// kind requests. `builtRenderKey` maps (kind, mask, pos, condTier) to a key
// string; `renderKeyspace` enumerates EVERY key the renderer can ever request.
// Both live here — DOM-free and on the architecture pure-ui allowlist — so the
// renderer's atlas can iterate one canonical key set (single source of truth) AND
// a headless test can assert builtRenderKey ⊆ renderKeyspace without a canvas.
//
// No transcendental Math, no DOM: just deterministic string construction.

import { BuiltKind, isRoadKind } from '../engine/fabric';

/** Footprint position of a building tile: center / edge / corner. */
export type FootprintPos = 'c' | 'e' | 'k';

const MASKS = 16; // 4-neighbour connection masks 0..15
const POSITIONS: readonly FootprintPos[] = ['c', 'e', 'k'];
const TIERS: readonly number[] = [0, 1]; // condition tiers: pristine(0) / derelict(1)

// Road-category kinds that read into the `road-{k}-{mask}` tile set: classic
// 1..3 PLUS QuietStreet(7), which renders as a road (hence ROAD_STYLES needs a [7]
// entry in the renderer, else makeRoadTile(7) throws). Rail / streetcar / elevated
// / bike / pedestrian each get their own prefixed mask set below.
const ROAD_RENDER_KINDS: readonly number[] = [
  BuiltKind.RoadStreet,
  BuiltKind.RoadAvenue,
  BuiltKind.RoadHighway,
  BuiltKind.QuietStreet,
  BuiltKind.RoadRamp, // a freeway ramp renders as a road (its own style); never widens
];

// Road kinds that can render as a continuous WIDE slab (a 2×2-block corridor):
// exactly the classic roads 1..3, because the wide flag originates from
// `wideRoadAt` which is `isRoadKind`-based (1..3). QuietStreet(7) is deliberately
// EXCLUDED — `render()` can never request a wide quiet-street key, so enumerating
// `road-7-{m}-w` would emit 16 painted-but-unreachable atlas tiles. Restricting the
// wide block to isRoadKind keeps the wide keyspace == exactly the keys render() can
// request: no dead keys, no blank-tile risk.
const WIDE_ROAD_KINDS: readonly number[] = ROAD_RENDER_KINDS.filter(isRoadKind);

// Non-road transport kinds → their key prefix, in a fixed enumeration order.
const TRANSPORT_PREFIX: ReadonlyArray<readonly [number, string]> = [
  [BuiltKind.Rail, 'rail'],
  [BuiltKind.Streetcar, 'streetcar'],
  [BuiltKind.ElevatedRail, 'elev'],
  [BuiltKind.BikePath, 'bike'],
  [BuiltKind.Promenade, 'ped'],
];
const PREFIX_OF = new Map<number, string>(TRANSPORT_PREFIX);

// Building kinds that render as footprint tiles: Moses-era 16..23 + tech 48..60
// + rezoning greens 61..62. Must match the renderer's BUILDING_STYLES key set exactly.
const BUILDING_RENDER_KINDS: readonly number[] = [
  BuiltKind.HouseSingle,
  BuiltKind.Apartments,
  BuiltKind.Projects,
  BuiltKind.CommercialStrip,
  BuiltKind.Offices,
  BuiltKind.Industrial,
  BuiltKind.ParkingLot,
  BuiltKind.Civic,
  BuiltKind.Precinct,
  BuiltKind.FireStation,
  BuiltKind.Clinic,
  BuiltKind.Library,
  BuiltKind.School,
  BuiltKind.CoalPlant,
  BuiltKind.GasPlant,
  BuiltKind.HydroPlant,
  BuiltKind.NuclearPlant,
  BuiltKind.WindTurbine,
  BuiltKind.SolarPlant,
  BuiltKind.FusionPlant,
  BuiltKind.Parklet,
  BuiltKind.CommunityGarden,
  BuiltKind.CompostHub,
  BuiltKind.VerticalFarm,
  BuiltKind.WastewaterWorks,
  BuiltKind.EnergyNode,
  BuiltKind.AINode,
  BuiltKind.ADU,
  BuiltKind.CoopHousing,
  BuiltKind.Commune,
  BuiltKind.Bazaar,
  BuiltKind.MakerSpace,
  BuiltKind.HealingCommons,
  BuiltKind.Park,
  BuiltKind.RewildedLand,
  // The road-diet planted median: a transport-slot tile that renders as a green strip (b-11-*),
  // not an autotiled road (transportCategory 11 = 0), so it keys through the building-style path.
  BuiltKind.PlantedMedian,
];

/**
 * The atlas key for a built tile. Transport kinds key on `mask` (pos/tier ignored):
 * road kinds 1..3 and QuietStreet(7) → `road-{kind}-{mask}`, the rest → their
 * prefix + mask (`rail-`/`streetcar-`/`elev-`/`bike-`/`ped-`). Buildings key on
 * footprint `pos` and condition `condTier` (mask ignored) → `b-{kind}-{pos}-{tier}`.
 * `pos` is REQUIRED — a building key cannot be formed without it. `wide` (a 2×2
 * road-slab flag) appends `-w` for the classic road kinds 1..3 ONLY; it is ignored
 * for QuietStreet(7), the other transport prefixes, and building kinds — none of
 * which ever widen. Defaults to false so every existing 4-arg call/key is unchanged.
 */
export function builtRenderKey(
  kind: number,
  mask: number,
  pos: FootprintPos,
  condTier: number,
  wide = false,
): string {
  if (ROAD_RENDER_KINDS.includes(kind)) {
    return `road-${kind}-${mask}${wide && isRoadKind(kind) ? '-w' : ''}`;
  }
  const prefix = PREFIX_OF.get(kind);
  if (prefix !== undefined) return `${prefix}-${mask}`;
  return `b-${kind}-${pos}-${condTier}`;
}

/**
 * The atlas key for ONE CELL of a segmented multi-tile building footprint — the
 * tileset-only addressing mode for art generated as a single W×H image and sliced
 * into per-cell PNGs (so a building's tiles read as one continuous picture with
 * seam continuity, not a corner/edge/center motif repeated). Keyed by footprint
 * size (w×h) and the cell's column/row within it, plus the condition tier, so
 * different sizes and tiers never collide: `b-{kind}-{w}x{h}-c{col}-r{row}-{tier}`.
 *
 * This key is NEVER painted procedurally and is deliberately NOT in renderKeyspace
 * — the procedural atlas can't form it, so a tile asks for it ONLY when a tileset
 * supplied it, and otherwise falls back to {@link builtRenderKey}'s pos/tier key.
 * Pure string construction (no DOM / no Math), like the rest of this seam.
 */
export function footprintCellKey(
  kind: number,
  width: number,
  height: number,
  col: number,
  row: number,
  condTier: number,
): string {
  return `b-${kind}-${width}x${height}-c${col}-r${row}-${condTier}`;
}

/**
 * The atlas key for variant `v` of a base tile: `${baseKey}#${v}`. Tileset surface textures can
 * ship as N tone-consistent VARIANTS (e.g. asphalt) so a tile-map picks per-tile and breaks the
 * "plaid" periodicity of one texture repeated everywhere. Used for both the surface-ingredient keys
 * (`@surface/road#0`) and the painted road tiles (`road-1-5#2`). The `#` never appears in a base
 * atlas key, so a variant key round-trips unambiguously. Pure string construction.
 */
export function variantKey(baseKey: string, variant: number): string {
  return `${baseKey}#${variant}`;
}

/**
 * Which surface variant tile (x, y) uses, in [0, count) — a direction-NEUTRAL spread hash of the
 * tile position (adjacent tiles hash far apart, mirroring tieHash), so cycling N variants breaks the
 * repeated-texture "plaid" without banding or any rng. Deterministic; integer ops only
 * (allowlist-safe — no transcendental Math). count ≤ 1 ⇒ always 0.
 */
export function surfaceVariantIndex(x: number, y: number, count: number): number {
  if (count <= 1) return 0;
  let h = Math.imul((x | 0) ^ 0x9e3779b1, 0x85ebca6b);
  h = Math.imul(h ^ ((y | 0) + 0x27d4eb2f), 0x165667b1);
  h ^= h >>> 15;
  return (h >>> 0) % count;
}

/** A dihedral (square-symmetry) tile transform: `rot` quarter-turns in [0,4) plus a mirror. */
export interface DihedralTransform {
  rot: number;
  flip: boolean;
}

/**
 * The dihedral transform tile (x, y) uses to break the repeated-texture "plaid" of a baked,
 * ISOTROPIC terrain tile (grass/meadow/bare/forest/water — NOT river, which is directional). A
 * direction-neutral spread hash (mirroring {@link surfaceVariantIndex}, so adjacent tiles land far
 * apart) yields all 8 states: 2 bits rotation + 1 bit mirror. Deterministic, integer ops only
 * (allowlist-safe). The renderer applies it only under an active tileset, so the procedural path
 * stays byte-identical.
 */
export function terrainTileTransform(x: number, y: number): DihedralTransform {
  let h = Math.imul((x | 0) ^ 0x9e3779b1, 0x85ebca6b);
  h = Math.imul(h ^ ((y | 0) + 0x27d4eb2f), 0xc2b2ae35);
  h ^= h >>> 13;
  return { rot: (h >>> 0) & 3, flip: ((h >>> 3) & 1) === 1 };
}

/** A continuous per-tile texture transform: `rot` in turns [0,1), `scale` ≥ √2 so any rotation still
 *  covers the tile when clipped to its bounds. */
export interface TileStochastic {
  rot: number;
  scale: number;
}

/**
 * Stochastic per-tile transform for HYBRIDIZING a baked texture with itself across cells — a random
 * rotation + scale (deterministic by tile), drawn clipped to the tile, so the same baked water tile
 * never reads twice the same way (kills the plaid). Scale stays in [√2, …] so a rotated tile always
 * covers its clipped square (no empty corners). Integer hashing only (allowlist-safe); the caller
 * turns `rot` into radians.
 */
export function waterTileTransform(x: number, y: number): TileStochastic {
  let h = Math.imul((x | 0) ^ 0x9e3779b1, 0x85ebca6b);
  h = Math.imul(h ^ ((y | 0) + 0x27d4eb2f), 0xc2b2ae35);
  h ^= h >>> 13;
  const rot = (h >>> 0) / 4294967296; // 0..1 turns
  const scale = 1.42 + (((h >>> 8) & 0xff) / 255) * 0.32; // 1.42..1.74 (≥ √2)
  return { rot, scale };
}

/**
 * The exhaustive, deterministic enumeration of every key {@link builtRenderKey}
 * can return. Order is stable (road kinds × masks, then each transport prefix ×
 * masks, then building kinds × positions × tiers) and free of duplicates. The
 * renderer's atlas iterates this list so the painted key set and the requested key
 * set have one source of truth.
 */
export function renderKeyspace(): readonly string[] {
  const keys: string[] = [];
  for (const k of ROAD_RENDER_KINDS) {
    for (let m = 0; m < MASKS; m++) keys.push(`road-${k}-${m}`);
  }
  // Wide-body slab variants, appended right after the plain road block so order
  // stays stable and duplicate-free. Only kinds 1..3 (WIDE_ROAD_KINDS) — render()
  // can never request road-7-*-w, so enumerating them would be dead keyspace.
  for (const k of WIDE_ROAD_KINDS) {
    for (let m = 0; m < MASKS; m++) keys.push(`road-${k}-${m}-w`);
  }
  for (const [, prefix] of TRANSPORT_PREFIX) {
    for (let m = 0; m < MASKS; m++) keys.push(`${prefix}-${m}`);
  }
  for (const k of BUILDING_RENDER_KINDS) {
    for (const pos of POSITIONS) {
      for (const tier of TIERS) keys.push(`b-${k}-${pos}-${tier}`);
    }
  }
  return keys;
}

/**
 * Per base key, how many interchangeable tiles a skin supplies: the base plus a contiguous run of
 * `${base}#1..#n` variants. Keys without variants are omitted (plain lookup). A gap stops the run, so
 * a pick can never land on a missing tile.
 */
export function variantCounts(keys: Iterable<string>): Map<string, number> {
  const all = new Set(keys);
  const counts = new Map<string, number>();
  for (const key of all) {
    if (key.includes('#') || !all.has(`${key}#1`)) continue;
    let n = 1;
    while (all.has(`${key}#${n}`)) n++;
    counts.set(key, n);
  }
  return counts;
}

/**
 * The tile to draw for `base` at (x, y): the base or one of its variants, chosen by the
 * direction-neutral position hash (so a field of one terrain stops repeating on a 16-px grid).
 */
export function pickVariantKey(base: string, x: number, y: number, counts: ReadonlyMap<string, number>): string {
  const n = counts.get(base);
  if (n === undefined) return base;
  const v = surfaceVariantIndex(x, y, n);
  return v === 0 ? base : variantKey(base, v);
}

/** Blob-mask bits: sides N/E/S/W, then corners NE/SE/SW/NW. */
export const BLOB = { N: 1, E: 2, S: 4, W: 8, NE: 16, SE: 32, SW: 64, NW: 128 } as const;

/** Which of the 8 neighbours match the edge predicate (e.g. "is land" for a water cell's shore). */
export interface Neighbours {
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
  ne: boolean;
  se: boolean;
  sw: boolean;
  nw: boolean;
}

/**
 * The normalized 8-neighbour edge mask of a cell for terrain edge overlays (shorelines, canopy
 * overhang). A corner counts only when BOTH of its sides are clear — a lone diagonal contact — because
 * a side edge already covers its own corners. That folds the 256 raw neighbourhoods into the 47
 * {@link BLOB_MASKS} a skin paints. Pure integer ops.
 */
export function blobMask(nb: Neighbours): number {
  let m = (nb.n ? BLOB.N : 0) | (nb.e ? BLOB.E : 0) | (nb.s ? BLOB.S : 0) | (nb.w ? BLOB.W : 0);
  if (nb.ne && !nb.n && !nb.e) m |= BLOB.NE;
  if (nb.se && !nb.s && !nb.e) m |= BLOB.SE;
  if (nb.sw && !nb.s && !nb.w) m |= BLOB.SW;
  if (nb.nw && !nb.n && !nb.w) m |= BLOB.NW;
  return m;
}

/** Every normalized blob mask (47, including 0 = no edge), ascending. */
export const BLOB_MASKS: readonly number[] = (() => {
  const out = new Set<number>();
  for (let raw = 0; raw < 256; raw++) {
    out.add(
      blobMask({
        n: (raw & 1) !== 0,
        e: (raw & 2) !== 0,
        s: (raw & 4) !== 0,
        w: (raw & 8) !== 0,
        ne: (raw & 16) !== 0,
        se: (raw & 32) !== 0,
        sw: (raw & 64) !== 0,
        nw: (raw & 128) !== 0,
      }),
    );
  }
  return [...out].sort((a, b) => a - b);
})();

/**
 * Reserved key namespace for terrain EDGE overlays: a transparent tile drawn over a cell's terrain,
 * keyed by an edge `family` (`shore` — water meeting land; `canopy` — forest spilling onto open land)
 * and the cell's normalized blob mask (renderKey.blobMask). Soft edges instead of square steps.
 */
export function edgeKey(family: string, mask: number): string {
  return `@edge/${family}/${mask}`;
}

/**
 * Key of a skin-supplied EMISSION map for a whole building footprint (kind, w×h tiles, condition tier):
 * the lit pixels (windows, furnaces) the renderer overlays additively at night and casts glow from.
 * `${key}/blink` is the blinking-beacon layer; `#v` suffixes follow the building's art variant.
 */
export function emissionKey(kind: number, width: number, height: number, condTier: number): string {
  return `@emit/b-${kind}-${width}x${height}-${condTier}`;
}

/** The variant index a picked key carries (`…#3` → 3), or 0 for a base key. */
export function variantIndexOf(key: string): number {
  const i = key.lastIndexOf('#');
  return i < 0 ? 0 : Number(key.slice(i + 1)) || 0;
}
