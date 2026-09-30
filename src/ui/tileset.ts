// Tileset registry + manifest (PURE — no DOM, no transcendental Math → pure-ui allowlist).
//
// A tileset is an OPTIONAL skin over the procedural atlas (docs/art/asset-generation.md §0.5):
// it supplies committed PNGs for SOME atlas keys; every key it omits falls back to the procedural
// painter in renderer.buildAtlas(). `procedural` supplies nothing — the permanent, first-class
// default. This module is the single source of truth for
//   (a) which tilesets exist  → the settings dropdown reads tilesetMetas();
//   (b) which atlas keys each tileset's PNGs fill → the async loader (tilesetLoader.ts) reads
//       def.assets and maps each loaded image onto its `keys`.
// No IO here — fetching/decoding lives in tilesetLoader.ts (which is not allowlisted).

import { builtRenderKey, variantKey, type FootprintPos } from './renderKey';
import { SATELLITE_BAKED } from './satelliteManifest';
import type { Pixels } from './pixelArt';
import { paintSnesTileset } from './snesTileset';

/** The permanent default tileset id — pure procedural painters, never removed. */
export const PROCEDURAL = 'procedural';

/** One PNG → the exact atlas keys it fills. A file that fails to load falls back per-key. */
export interface TilesetAsset {
  /** Path under public/tilesets/<id>/ — e.g. 'terrain/grass.png'. */
  file: string;
  /** The atlas keys this single image is assigned to (terrain bands, building pos/tier, …). */
  keys: readonly string[];
}

/**
 * How the renderer treats a skin — the per-skin half of what used to be one `hasTileset` boolean.
 * Photographic skins (satellite) want anti-plaid rotation, ambient motion and faint labels; pixel art
 * wants none of that (a rotated pixel tile is a broken tile) and carries type in its own drawing.
 */
export interface RenderProfile {
  /** Parcel legibility glyphs (R1/C2/PD…): bold (procedural), faint (photo skins), off (art carries type). */
  glyphs: 'bold' | 'faint' | 'off';
  /** Per-tile random rotation/mirror of terrain + water tiles (anti-plaid for photographic textures). */
  stochasticTerrain: boolean;
  /** CPU ambient motion over the skin: water slosh, grass sheen, drifting cloud shadows. */
  ambientMotion: boolean;
  /** Darken avenues/freeways over a single shared asphalt surface. */
  roadClassShade: boolean;
  /** Canopy sprites dotted over green-amenity parcels. */
  flora: boolean;
  /** Draw the baked agent/prop sprites (cars, peds, tents, junk, smog) instead of procedural marks. */
  agentSprites: boolean;
  /** GPU renderer's photographic life over the base (water warp/swell, sheen, glints, clouds). Off for
   *  pixel art, which it smears; day/night and building shadows apply to every skin regardless. */
  shaderLife: boolean;
  /** Live status marks (unpowered, building health): flat squares, or the skin's `@icon/*` pixel icons. */
  marks: 'flat' | 'icons';
  /** Translucent per-tile data washes over the map (land value on zones, smog on roads). Pixel art
   *  keeps its colours; the same signals stay in the overlays and Inspect. */
  tileWashes: boolean;
}

/** The procedural look: no skin effects, bold labels. Also the renderer's profile when no skin loaded. */
export const PROCEDURAL_PROFILE: RenderProfile = {
  glyphs: 'bold',
  stochasticTerrain: false,
  ambientMotion: false,
  roadClassShade: false,
  flora: false,
  agentSprites: false,
  shaderLife: true,
  marks: 'flat',
  tileWashes: true,
};

export interface TilesetDef {
  id: string;
  /** Settings-dropdown label. */
  label: string;
  /** One-line blurb shown under the select. */
  description: string;
  /** The committed PNGs and the keys they fill. `procedural` → [] (pure painters). */
  assets: readonly TilesetAsset[];
  /** A code-painted skin: atlas key → pixel buffer, materialized by the loader (no PNGs, no bake). */
  paint?: () => ReadonlyMap<string, Pixels>;
  /** How the renderer treats this skin. */
  profile: RenderProfile;
}

/** A lightweight view of a def for the settings UI (no asset list). */
export interface TilesetMeta {
  id: string;
  label: string;
  description: string;
}

// Terrain kinds + band count — mirrors renderer.ts PALETTE / BANDS. A single terrain PNG
// per kind is reused across all elevation bands (band shading is a procedural concern that a
// tileset doesn't re-skin by default).
const TERRAIN_BANDS = 4;
const POSITIONS: readonly FootprintPos[] = ['c', 'e', 'k'];
const TIERS: readonly number[] = [0, 1];

/** The elevation-band atlas keys a single terrain PNG fills (`grass` → grass-0..grass-3). */
export function terrainKeys(kind: string): string[] {
  const keys: string[] = [];
  for (let b = 0; b < TERRAIN_BANDS; b++) keys.push(`${kind}-${b}`);
  return keys;
}

/**
 * The footprint-position × condition-tier atlas keys a single (whole-building) PNG fills,
 * built through the canonical {@link builtRenderKey} so the key grammar never drifts. Pass
 * `tier` to scope to one condition (so pristine vs. derelict art can be supplied separately);
 * omit it to fill both tiers with the same image.
 */
export function buildingKeys(kind: number, tier?: number): string[] {
  const tiers = tier === undefined ? TIERS : [tier];
  const keys: string[] = [];
  for (const pos of POSITIONS) {
    for (const t of tiers) keys.push(builtRenderKey(kind, 0, pos, t));
  }
  return keys;
}

/**
 * Reserved key namespace for SURFACE textures (e.g. road asphalt) — a tileset supplies the base
 * pavement texture and the renderer paints the connection-mask lane markings OVER it procedurally
 * (so one tileable texture skins all 16 autotile variants, instead of 16 generated tiles). A
 * surface is an INGREDIENT, not a full-tile override: the `@` prefix can never collide with a real
 * atlas key (those start with a letter), so the renderer treats `@surface/*` entries specially and
 * never blits them as tiles. Role examples: `road` (all road kinds), `road-2` (avenue-specific).
 */
export function surfaceKey(role: string): string {
  return `@surface/${role}`;
}

/**
 * Reserved key namespace for skin-drawn status ICONS (`unpowered`, `thriving`, `suffering`) — badges
 * the renderer draws over buildings when a profile asks for `marks: 'icons'`. Like `@surface/*`, the
 * `@` prefix keeps them out of the tile atlas; they are never blitted as tiles.
 */
export function iconKey(name: string): string {
  return `@icon/${name}`;
}

export { edgeKey } from './renderKey';

// ── The satellite tileset ──────────────────────────────────────────────────────────────────
// Google-Maps-inspired top-down patchwork (see docs/art/satellite-tileset.md): a slightly
// cartoonish, black-outlined, the classic city-builder-2000-era look with Oakland, CA architectural cues —
// generated via ComfyUI, committed as PNG. `assets` lists ONLY committed files: a partial
// tileset is valid (omitted keys fall back to the procedural painter), and the list grows as
// art lands. Keep it == files actually present in public/tilesets/satellite/ so selecting it
// never triggers stray 404s.
const SATELLITE_ASSETS: readonly TilesetAsset[] = [
  // Road asphalt SURFACE — three tone-consistent variants, cycled per-tile by a position hash so
  // the texture doesn't tile into a visible "plaid" (Maddy 2026-06-19). The renderer paints the
  // connection-mask lane markings over them; roads deliberately stay surface+procedural rather than
  // per-mask diffusion (docs/art/satellite-tileset.md §5.5).
  { file: 'surfaces/asphalt-0.png', keys: [variantKey(surfaceKey('road'), 0)] },
  { file: 'surfaces/asphalt-1.png', keys: [variantKey(surfaceKey('road'), 1)] },
  { file: 'surfaces/asphalt-2.png', keys: [variantKey(surfaceKey('road'), 2)] },
  // Per-key terrain + building tiles baked through the Z-Image Tile-ControlNet pipeline
  // (auto-generated list; regenerate with `node tools/tileset/manifest.mjs`).
  ...SATELLITE_BAKED,
];

export const TILESET_DEFS: readonly TilesetDef[] = [
  {
    id: PROCEDURAL,
    label: 'Procedural (default)',
    description: 'The hand-painted Canvas2D look — always available, never removed.',
    assets: [],
    profile: PROCEDURAL_PROFILE,
  },
  {
    id: 'satellite',
    label: 'Satellite (Oakland)',
    description: 'Top-down Google-Maps-style patchwork, Oakland architectural cues.',
    assets: SATELLITE_ASSETS,
    profile: {
      glyphs: 'faint',
      stochasticTerrain: true,
      ambientMotion: true,
      roadClassShade: true,
      flora: true,
      agentSprites: true,
      shaderLife: true,
      marks: 'flat',
      tileWashes: true,
    },
  },
  {
    id: 'snes',
    label: 'Super (16-bit)',
    description: 'Code-painted pixel art in the spirit of the classic city-builder on the Super Famicom.',
    assets: [],
    paint: paintSnesTileset,
    profile: {
      glyphs: 'off',
      stochasticTerrain: false,
      ambientMotion: false,
      roadClassShade: false,
      flora: false,
      agentSprites: true,
      shaderLife: false,
      marks: 'icons',
      tileWashes: false,
    },
  },
];

/** The def for `id`, or the procedural default for an unknown id (graceful — renders procedural). */
export function tilesetDef(id: string): TilesetDef {
  return TILESET_DEFS.find((d) => d.id === id) ?? TILESET_DEFS[0]!;
}

/** Every def as a {id,label,description} meta for the settings dropdown (assets omitted). */
export function tilesetMetas(): TilesetMeta[] {
  return TILESET_DEFS.map((d) => ({ id: d.id, label: d.label, description: d.description }));
}
