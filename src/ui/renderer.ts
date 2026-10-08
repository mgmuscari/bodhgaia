// Canvas2D pixel-art renderer. A thin DOM shell over the pure engine model: it draws the Super skin's
// code-painted tiles (snesTileset.ts, materialized by tilesetLoader.ts) for the visible tile range with
// nearest-neighbour scaling, then the pixel-art agents on the same art-pixel grid. All view math lives
// in Camera, all map/fabric logic in the engine, every decoration decision in decoration.ts; this file
// only draws.

import { GameMap, Water, LandCover } from '../engine/map';
import { BuiltKind, isBuildingKind, isTransportKind, transportMask, isRoadKind, deckMask, roadDividerMask, roadCurbMask, railCrossingMask, depaveAsphalt, rampMarkingMask, freewayMedianAxis, freewayAxis, freewayLaneBoundaryMask, freewayCenterLaneAxis, freewayCrossing } from '../engine/fabric';
import type { WorldState } from '../worldgen/pipeline';
import { Camera, BASE_TILE } from './camera';
import { C } from './snesPalette';
import { FLAG_COLOURS, FLAG_STRING, prayerFlagPixels } from './prayerFlags';
import { DIR_DX, DIR_DY } from '../live/geometry';
import {
  builtRenderKey,
  footprintCellKey,
  variantCounts,
  pickVariantKey,
  blobMask,
  edgeKey,
  emissionKey,
  variantIndexOf,
  surfaceVariantIndex,
  type FootprintPos,
} from './renderKey';
import { iconKey } from './tileset';
import type { SkinImages, LazyImages } from './tilesetLoader';
import { wideRoadAt, curbPoleAt, innerCornerMask, roadPaintKind, crosswalkMask, encampmentLayout, junctionBox, stopBarMask, signalCorners, endCapMask } from './decoration';
import { isPowerConsumer } from '../growth/power';
import { ambientAlpha, movingPose, trainPoses } from '../live/poses';
import { computeFramePoses, shareFramePoses, viewRect } from './framePoses';
import { litBodyKeys, drainInIdle, type IdleDeadlineLike } from './litWarmup';
import { AGENT_TINTS, FIRE_FRAMES, SMOG_SIZES, heading8, personKey } from './snesAgents';
import { castHeadlights, type Body } from './headlights';
import type { HeadlightBeam } from './gpuRenderer';
import { CAR_LENGTH, CAR_WIDTH, LANE } from '../live/geometry';
import { ENCAMPMENT_WEAR, FALL_SUBSTEPS } from '../live/tuning';
import { gameSec } from './gameTime';
import type { AmbientState } from '../live/types';
import { dayNightBrightness } from './lighting';
import { OVERLAY_DIM } from './overlayLegend';

/** Precomputed CSS for the sparse-overlay scrim (see OverlaySource.dimBase). */
const OVERLAY_DIM_CSS = `rgba(${OVERLAY_DIM[0]}, ${OVERLAY_DIM[1]}, ${OVERLAY_DIM[2]}, ${OVERLAY_DIM[3]})`;
import { policeViolenceTint } from './policeViolenceOverlayContent';
import { TravelMode } from '../citizens/modes';

/** A previewed tile for the hover/drag overlay: world coords + validity tint. */
export interface PreviewTile {
  x: number;
  y: number;
  valid: boolean;
}

/**
 * An ecology heatmap source: given a tile index, the translucent RGBA tint to lay
 * over it (or null to leave it untinted). The closure reads the LIVE ecology layer
 * (or a precomputed biodiversity field) so it auto-reflects each ecology tick.
 */
export interface OverlaySource {
  tint(i: number): readonly [number, number, number, number] | null;
  /** When true, every tile the tint leaves un-highlighted (null) is dimmed with OVERLAY_DIM, so a
   *  SPARSE overlay's few strong highlights pop against a darkened map instead of washing out. */
  dimBase?: boolean;
}

// Connection-mask bits (must match engine transportMask): N=1, E=2, S=4, W=8.
const N = 1;
const E = 2;
const S = 4;
const W = 8;

/** Unit vector of 8-way direction `d` (0 = N, clockwise) — the inverse of snesAgents.heading8. */
function dirVector8(d: number): [number, number] {
  const D = Math.SQRT1_2;
  return ([[0, -1], [D, -D], [1, 0], [D, D], [0, 1], [-D, D], [-1, 0], [-D, -D]] as const)[d & 7] as [number, number];
}

/** The gatherings that hang prayer flags. */
const FESTIVE: ReadonlySet<string> = new Set(['block-party', 'craft-fair', 'festival', 'parade']);

/** The palette's foam, for the flood's waterline. */
const FOAM_CSS = `rgb(${C.foam[0]}, ${C.foam[1]}, ${C.foam[2]})`;

/** The centre of the burning footprint nearest (x, y) — where a spraying truck aims. */
function nearestBurning(burning: readonly { x: number; y: number; w: number; h: number }[], x: number, y: number): { x: number; y: number } | null {
  let goal: { x: number; y: number } | null = null;
  let best = Infinity;
  for (const b of burning) {
    const gx = b.x + b.w / 2;
    const gy = b.y + b.h / 2;
    const d = (gx - x) ** 2 + (gy - y) ** 2;
    if (d < best) {
      best = d;
      goal = { x: gx, y: gy };
    }
  }
  return goal;
}

/** Water pollution smoothed over a tile's 3×3 WATER neighbourhood, so murk shades across a bay or a pond
 *  instead of sitting as a hard square on the one tile the runoff landed on. */
function murkAt(map: GameMap, poll: ReadonlyMap<number, number>, x: number, y: number): number {
  let sum = 0;
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!map.inBounds(x + dx, y + dy)) continue;
      const j = map.idx(x + dx, y + dy);
      if (map.water[j] === 0) continue;
      sum += poll.get(j) ?? 0;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

/** Wash level 1..3 (0 = none) for a 0..255 field — the dithered @wash/* overlays step, never fade. */
function washLevel(v: number): number {
  return v >= 170 ? 3 : v >= 90 ? 2 : v > 0 ? 1 : 0;
}
const GARBAGE_WEAR = 150; // wear at/above which a worn empty tile shows discarded junk

/** What a tile's desire-path wear bakes into the base: beaten earth in three depths, then junk, then tents. */
function wearMarks(wear: number): { level: number; nJunk: number; nTents: number } {
  return {
    level: wear >= 200 ? 3 : wear >= 120 ? 2 : wear >= 50 ? 1 : 0,
    nJunk: wear >= (GARBAGE_WEAR + ENCAMPMENT_WEAR) / 2 ? 2 : 1,
    nTents: wear >= ENCAMPMENT_WEAR ? Math.min(3, 1 + Math.floor((wear - ENCAMPMENT_WEAR) / 12)) : 0,
  };
}

/** A signature of exactly what wearMarks draws on a tile (0 = nothing), with or without the encampment layer. */
function wearSig(wear: number, encampments: boolean): number {
  const m = wearMarks(wear);
  if (!encampments || wear < GARBAGE_WEAR) return m.level;
  return m.level | (m.nJunk << 2) | (m.nTents << 4) | 64;
}

/** A device-pixel rect of the base canvas (a patched tile, for the GPU's sub-upload). */
export interface BaseRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Tiles inclusive, like Camera.visibleTileRange. */
interface TileBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const BASE_BG = '#14121f';

const BANDS = 4; // elevation bands per terrain kind

// Atlas values are any drawable (the skin's materialized canvases).
type AtlasImage = CanvasImageSource;

/** The atlas for a skin with an on-demand source: a miss on one of the source's keys materializes that
 *  tile (once — the source memoizes) and keeps it. `has` answers for lazy keys without painting. */
class LazyAtlas extends Map<string, AtlasImage> {
  constructor(
    entries: Iterable<readonly [string, AtlasImage]>,
    private readonly lazy: LazyImages,
  ) {
    super(entries);
  }
  override get(key: string): AtlasImage | undefined {
    const hit = super.get(key);
    if (hit !== undefined || !this.lazy.keys.has(key)) return hit;
    const img = this.lazy.get(key);
    if (img) super.set(key, img);
    return img;
  }
  override has(key: string): boolean {
    return super.has(key) || this.lazy.keys.has(key);
  }
}

/** The drawable tile atlas: the skin's eager tiles (minus its `@`-namespaced overlays/sprites, which are
 *  never blitted as tiles), backed by its on-demand source when it has one. */
function buildAtlas(skin: SkinImages): Map<string, AtlasImage> {
  const atlas = new Map<string, AtlasImage>();
  for (const [key, img] of skin) if (!key.startsWith('@')) atlas.set(key, img);
  return skin.lazy ? new LazyAtlas(atlas, skin.lazy) : atlas;
}

function kindOf(map: GameMap, i: number): string {
  switch (map.water[i]) {
    case Water.Ocean:
      return 'ocean';
    case Water.Lake:
      return 'lake';
    case Water.River:
      return 'river';
  }
  switch (map.landCover[i]) {
    case LandCover.Forest:
      return 'forest';
    case LandCover.Grass:
      return 'grass';
    case LandCover.Meadow:
      return 'meadow';
    default:
      return 'bare';
  }
}

function bandOf(elevation: number): number {
  return Math.min(BANDS - 1, Math.max(0, Math.floor(elevation * BANDS)));
}

/**
 * Footprint position of tile (x, y) within its parcel, derived from the map's
 * parcel layer alone (no ParcelStore object churn): a 4-neighbour with a
 * different parcel id is a footprint border. 0 borders = center ('c'), 1 = edge
 * ('e'), 2+ = corner ('k').
 */
function footprintPos(map: GameMap, x: number, y: number, pid: number): FootprintPos {
  const sameParcel = (nx: number, ny: number): boolean =>
    map.inBounds(nx, ny) && map.parcel[map.idx(nx, ny)] === pid;
  let borders = 0;
  if (!sameParcel(x - 1, y)) borders++;
  if (!sameParcel(x + 1, y)) borders++;
  if (!sameParcel(x, y - 1)) borders++;
  if (!sameParcel(x, y + 1)) borders++;
  return borders === 0 ? 'c' : borders === 1 ? 'e' : 'k';
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly atlas: Map<string, AtlasImage>;
  // Per base key, how many hash-cycled variants the skin painted (`grass-1` → 4, `road-1-5` → 3). A tile
  // picks one by position hash so a field or a street stops repeating on the tile grid.
  private readonly tileVariants: ReadonlyMap<string, number>;
  // Status icons (`@icon/unpowered`, `@icon/thriving`, `@icon/suffering`).
  private readonly icons: Map<string, AtlasImage>;
  // Terrain edge overlays (`@edge/shore/<mask>`, `@edge/canopy/<mask>`, `@edge/coast/<mask>`).
  private readonly edges: Map<string, AtlasImage>;
  // Unpowered parcel footprints (WORLD coords) from the last base pass — drawn per frame as a blinking
  // icon when the skin supplies one (the base is cached, so a blink can't live there).
  private unpoweredFootprints: { x: number; y: number; w: number }[] = [];
  // GPU mode: the WebGL hybrid path renders the MAP underneath (day/night, building shadows), so the
  // Canvas2D base goes transparent. Sprites/decorations/UI still draw on top. The CPU path stays the
  // no-WebGL fallback. (Hybrid shader, Maddy 2026-06-20.)
  private gpuMode = false;
  private baseTexVersion = 0; // bumped each base rebuild so the GPU path knows to re-upload the base texture
  // Cached base pass (terrain + built + overlay) on an offscreen canvas. Rebuilt
  // ONLY when invalidated (map/camera/overlay change), then blitted 1:1 onto the
  // visible canvas each frame. The hover preview and the ambient sprites live in
  // the per-frame composite, NOT the base — so a per-tile hover is a cheap blit,
  // not an O(visible-tiles) rebuild (CRITIC-YP2).
  private readonly base: HTMLCanvasElement;
  private readonly baseCtx: CanvasRenderingContext2D;
  private baseDirty = true;
  private dpr = 1;
  private hole: { x: number; y: number; w: number; h: number } | null = null;
  private cssWidth = 0;
  private cssHeight = 0;
  private preview: readonly PreviewTile[] | null = null;
  private overlay: OverlaySource | null = null;
  // A LIVE field overlay drawn per-frame in drawSprites (fresh every frame, unlike the cached-base
  // `overlay`). 'police' tints ambient.policeViolence — the Police Violence map. null = off.
  private liveOverlay: string | null = null;
  // Anchor tiles of POWERED consumer parcels (the live power grid). A consumer not
  // in this set draws an "unpowered" pip. null = grid unknown (no marks).
  private powered: Set<number> | null = null;
  // Light-bearing building footprints (WORLD coords) collected during drawBase, redrawn each frame in
  // drawSprites: an emission map (e.g. coal aviation beacons) overlaid additively over the footprint,
  // blinking + evading shading (the building twin of the cruiser's emissive bar).
  // `lit`/`blink` are the skin's emission maps (@emit/…) for that footprint, tier and art variant.
  private emissiveBuildings: {
    x: number; y: number; w: number; h: number; kind: number; lit?: AtlasImage; blink?: AtlasImage;
  }[] = [];
  // Street-furniture overlays (@road/*: curbs, barriers, stop lines, lanes, median, poles) on the art grid.
  private readonly roadInk: Map<string, AtlasImage>;
  // Native pixel-art sprites (@sprite/*) and worn-ground overlays (@wear/*), drawn at exactly one art
  // pixel per tile pixel (ts / BASE_TILE).
  private readonly sprites: Map<string, AtlasImage>;
  // Building emission maps (@emit/*), eager or materialized on first use from the lazy source.
  private readonly skinEmission: Map<string, AtlasImage>;
  private readonly lazyImages: LazyImages | null;
  // This frame's cast headlights (headlights.ts), for the GPU glow pass, and the lit-silhouette cache:
  // per sprite image, per 8-way light direction, the warm near-half of its pixels.
  private beams: HeadlightBeam[] = [];
  private murkSig = 0; // signature of the water-pollution levels the cached base was drawn with
  // The live marks the cached base was baked with — wear/junk/tents per tile (wearSig) and murk per water tile —
  // so the slow refresh (refreshLiveMarks) re-draws only the tiles whose mark changed, each clipped to its own
  // rect, instead of the whole base; `patchRects` are the device rects the last refresh re-drew (GPU sub-upload).
  private readonly bakedMarks = new Map<number, number>();
  private readonly bakedMurk = new Map<number, number>();
  private marksDue = false;
  private patchVersion = 0;
  private patchRects: BaseRect[] = [];
  private readonly litCache = new WeakMap<object, (HTMLCanvasElement | null)[]>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    skin: SkinImages,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.baseCtx = this.base.getContext('2d')!;
    const ns = (prefix: string): Map<string, AtlasImage> => new Map([...skin].filter(([k]) => k.startsWith(prefix)));
    this.atlas = buildAtlas(skin);
    this.tileVariants = variantCounts([...skin.keys(), ...(skin.lazy?.keys ?? [])]);
    this.icons = ns('@icon/');
    this.edges = ns('@edge/');
    this.roadInk = ns('@road/');
    this.skinEmission = ns('@emit/');
    this.sprites = new Map([...ns('@sprite/'), ...ns('@wear/'), ...ns('@wash/'), ...ns('@ui/')]);
    this.lazyImages = skin.lazy ?? null;
    if (typeof window !== 'undefined') this.warmLitSilhouettes();
  }

  /** Pre-build every lit silhouette a headlight can need (each lit-body sprite × 8 light directions) in
   *  idle time after load, so night falling doesn't stall frames on getImageData readbacks; anything not
   *  yet warm is still built lazily on first use. */
  private warmLitSilhouettes(): void {
    const jobs = litBodyKeys(this.sprites.keys()).flatMap((key) => {
      const img = this.sprites.get(key)!;
      return [0, 1, 2, 3, 4, 5, 6, 7].map((dir) => (): void => void this.litSilhouette(img, dir));
    });
    const ric = window.requestIdleCallback?.bind(window);
    drainInIdle(jobs, (cb) => {
      if (ric) ric(cb, { timeout: 1000 });
      else setTimeout(() => {
        const end = performance.now() + 4; // no idle callbacks (older Safari): a short slice per timer tick
        cb({ timeRemaining: (): number => end - performance.now() } satisfies IdleDeadlineLike);
      }, 50);
    });
  }

  /** Toggle the GPU hybrid path: when on, the Canvas2D base goes transparent (the WebGL layer below
   *  shows through); sprites, decorations, overlays + UI still draw on top. */
  setGpuMode(on: boolean): void {
    this.gpuMode = on;
    this.invalidateBase();
  }

  /** Draw a native pixel-art sprite centred on world point (wx, wy), at exactly one art pixel per tile
   *  pixel, its top-left snapped to the same art-pixel grid the tiles are drawn on (no half-pixel smear). */
  private drawArt(ctx: CanvasRenderingContext2D, img: AtlasImage, wx: number, wy: number, camera: Camera): void {
    const w = (img as HTMLCanvasElement).width;
    const h = (img as HTMLCanvasElement).height;
    const ax = Math.round(wx * BASE_TILE - w / 2); // art-pixel coordinates of the top-left
    const ay = Math.round(wy * BASE_TILE - h / 2);
    const tx = Math.floor(ax / BASE_TILE);
    const ty = Math.floor(ay / BASE_TILE);
    const o = camera.tileOrigin(tx, ty);
    const ps = camera.tileSize / BASE_TILE;
    ctx.drawImage(img, o.dx + (ax - tx * BASE_TILE) * ps, o.dy + (ay - ty * BASE_TILE) * ps, w * ps, h * ps);
  }

  /** A skin light map by key — eager, or materialized on first use from the lazy source. */
  private emissionImage(key: string): AtlasImage | undefined {
    return this.skinEmission.get(key) ?? (this.lazyImages?.keys.has(key) ? this.lazyImages.get(key) : undefined);
  }

  /** The offscreen CPU base canvas (terrain + buildings + roads + all line/divider/marking rules) —
   *  the GPU path uploads this as its albedo texture and jeuje's it with dynamics. Backing-store sized. */
  baseCanvas(): HTMLCanvasElement {
    return this.base;
  }

  /** Light-bearing building footprints collected during the last base build (world coords) — the GPU
   *  glow pass casts a faint window/beacon glow from each (Maddy: windows/blinkies cast glow too). */
  emissiveBuildingList(): readonly { x: number; y: number; w: number; h: number; kind: number; lit?: AtlasImage; blink?: AtlasImage }[] {
    return this.emissiveBuildings;
  }

  /** The image for an art key — a UI icon or sprite, else a tile (painting it on first use). */
  artImage(key: string): AtlasImage | undefined {
    return this.sprites.get(key) ?? this.atlas.get(key);
  }

  /** This frame's headlight rays — cut where they hit — for the GPU glow pass. */
  headlightBeams(): readonly HeadlightBeam[] {
    return this.beams;
  }

  /** The warm RIM of a sprite lit by light travelling along 8-way direction `dir`: the opaque pixels within
   *  two art pixels of its edge facing the lamp (the face the beam actually strikes), in one colour, for
   *  an additive pass. Cached per image + dir. */
  private litSilhouette(img: AtlasImage, dir: number): HTMLCanvasElement | null {
    let byDir = this.litCache.get(img as object);
    if (!byDir) {
      byDir = new Array(8).fill(undefined);
      this.litCache.set(img as object, byDir);
    }
    const hit = byDir[dir];
    if (hit !== undefined) return hit;
    const src = img as HTMLCanvasElement;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const cx = c.getContext('2d');
    if (!cx) return (byDir[dir] = null);
    cx.drawImage(src, 0, 0);
    const id = cx.getImageData(0, 0, c.width, c.height);
    const v = dirVector8(dir); // the light's travel direction; the lamp is back along it
    const solid = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < c.width && y < c.height && id.data[(y * c.width + x) * 4 + 3]! > 0;
    const rim: boolean[] = [];
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        // lit if a step or two back toward the lamp leaves the sprite — the struck face
        rim.push(solid(x, y) && (!solid(Math.round(x - v[0]), Math.round(y - v[1])) || !solid(Math.round(x - 2 * v[0]), Math.round(y - 2 * v[1]))));
      }
    }
    rim.forEach((on, k) => id.data.set(on ? [248, 216, 88, 255] : [0, 0, 0, 0], k * 4)); // C.flower, warm
    cx.putImageData(id, 0, 0);
    return (byDir[dir] = c);
  }

  /** Increments each time the base is rebuilt — the GPU path re-uploads the base texture only when this
   *  changes (camera move / built-layer edit), not every frame. */
  baseVersion(): number {
    return this.baseTexVersion;
  }


  /** Set (or clear) the hover/drag preview tiles drawn as translucent tints. */
  setPreview(tiles: readonly PreviewTile[] | null): void {
    this.preview = tiles;
  }

  /** Set (or clear) the ecology heatmap overlay drawn under the preview. */
  setOverlay(source: OverlaySource | null): void {
    this.overlay = source;
  }

  /** Set (or clear) the per-frame live-field overlay ('police' → the Police Violence map). Drawn
   *  fresh each frame from the ambient field, so it tracks a continuously-changing field. */
  setLiveOverlay(kind: string | null): void {
    this.liveOverlay = kind;
  }

  /** Publish the live power grid (powered consumer anchor tiles). Unpowered consumers
   *  get a red pip. The host calls invalidateBase after this so the marks redraw. */
  setPowerGrid(poweredAnchors: Set<number> | null): void {
    this.powered = poweredAnchors;
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.dpr = dpr;
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    // The offscreen base must track the same backing-store size/DPR so the
    // identity 1:1 blit lands at the exact device pixels (no rescale/blur).
    this.base.width = Math.round(cssWidth * dpr);
    this.base.height = Math.round(cssHeight * dpr);
    this.baseDirty = true; // the resized base canvas is cleared → must redraw
  }

  /** Mark the cached base pass stale (map/camera/overlay changed). */
  invalidateBase(): void {
    this.baseDirty = true;
  }

  /** The slow-cadence refresh of the live marks baked into the base (wear, junk, tents, murk): the next
   *  renderFrame patches just the tiles whose mark changed. A base overlay may read live fields, so with one up
   *  this stays a full rebuild. */
  refreshLiveMarks(): void {
    if (this.overlay) this.baseDirty = true;
    else this.marksDue = true;
  }

  /** The base rects the last live-mark patch re-drew; `version` moves with each patch (the GPU path re-uploads
   *  just these when the full baseVersion has not moved). */
  basePatch(): { version: number; rects: readonly BaseRect[] } {
    return { version: this.patchVersion, rects: this.patchRects };
  }

  /**
   * Draw the cached BASE pass — terrain + built + power-line decoration + ecology
   * overlay — into the offscreen base canvas. Explicitly NOT the preview (which is
   * cursor-following and would defeat the cache on every hover) and NOT the sprites.
   * Uses the exact transform/smoothing setup the legacy render used so the base is
   * pixel-identical to today's terrain+built+overlay layer (CRITIC-YP2 / YP5).
   */
  private drawBase(world: WorldState, camera: Camera, ambient?: AmbientState): void {
    const ctx = this.baseCtx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false; // base ctx scales BASE_TILE→ts; off = crisp
    ctx.fillStyle = BASE_BG;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    this.emissiveBuildings.length = 0; // re-collected this pass (refreshed on every base rebuild)
    this.unpoweredFootprints.length = 0; // likewise
    this.bakedMarks.clear(); // re-recorded this pass
    this.bakedMurk.clear();
    this.paintTiles(world, camera, ambient, camera.visibleTileRange(), null);
  }

  /**
   * The base's draw passes over the tiles of `range` — the tile loop, then the wear/junk/tents, then the poles
   * and signals — in the one order both a full rebuild and a patch use. A FULL pass (`near` null) also collects
   * the per-frame lists (lights, unpowered pips) and records the baked live marks; a PATCH (under a clip to one
   * tile) replays only the draws of the tiles `near` it (the clipped tile ±1, which covers every overhang — a
   * deck's lift, its shadow, an encampment) and records nothing.
   */
  private paintTiles(world: WorldState, camera: Camera, ambient: AmbientState | undefined, range: TileBox, near: TileBox | null): void {
    const { map, parcels } = world;
    const ctx = this.baseCtx;
    const full = near === null;
    const ts = camera.tileSize;
    // A street-furniture overlay at a tile.
    const ink = (key: string, dx: number, dy: number): void => {
      const img = this.roadInk.get(key);
      if (img) ctx.drawImage(img, 0, 0, BASE_TILE, BASE_TILE, dx, dy, ts, ts);
    };
    // Power poles (props), drawn AFTER the tile loop so no later tile paints over one.
    const poles: { x: number; y: number; axis: 'h' | 'v' | 'nw' }[] = [];
    // Traffic signals on stroad corners, drawn after the tile loop too (they reach over neighbouring lanes).
    const signals: { x: number; y: number; corners: number }[] = [];
    for (let ty = range.y0; ty <= range.y1; ty++) {
      for (let tx = range.x0; tx <= range.x1; tx++) {
        const i = map.idx(tx, ty);
        const { dx, dy } = camera.tileOrigin(tx, ty); // seam-free integer origin

        const tkind = kindOf(map, i);
        const terrainKey = `${tkind}-${bandOf(map.elevation[i]!)}`;
        const isWater = tkind === 'ocean' || tkind === 'lake' || tkind === 'river';
        const picked = pickVariantKey(terrainKey, tx, ty, this.tileVariants);
        // polluted water is the same tile palette-swapped toward murk (snesTileset murkTiles), by level
        const murk = isWater && ambient ? washLevel(murkAt(map, ambient.waterPollution, tx, ty)) : 0;
        if (full && murk > 0) this.bakedMurk.set(i, murk);
        const terrain =
          (murk > 0 ? this.atlas.get(`${picked}~m${murk}`) : undefined) ?? this.atlas.get(picked) ?? this.atlas.get(terrainKey)!;
        ctx.drawImage(terrain, 0, 0, BASE_TILE, BASE_TILE, dx, dy, ts, ts);

        // ASPHALT GROUND: redlined OPEN ground reads as paved-over disinvestment (env-justice arc);
        // the player DE-PAVES it back to living ground by greening/rewilding nearby (depaveAsphalt
        // fades it near greens). Cached in the base (redline is static; greens invalidate on build).
        // Drawn over open terrain only (built tiles cover their own ground).
        // (not under forest canopy: woods read as woods, the paved-over ground is the open land around them)
        // only heavily redlined ground shows mats at all, so most open land reads green
        const grade = tkind === 'forest' ? 0 : depaveAsphalt(map, tx, ty);
        const pave = grade >= 230 ? 3 : grade >= 190 ? 2 : grade >= 150 ? 1 : 0;
        const paved = pave > 0 ? this.sprites.get(`@wash/asphalt/${pave}/${surfaceVariantIndex(tx, ty, 3)}`) : undefined;
        if (paved) ctx.drawImage(paved, 0, 0, BASE_TILE, BASE_TILE, dx, dy, ts, ts);

        const built = map.built[i]!;

        // TERRAIN EDGES: a shoreline on water beside land, and forest canopy spilling onto open, unbuilt
        // land — soft edges instead of square steps. Drawn over the terrain, under anything built.
        // Out-of-map neighbours count as "same", so no edge there.
        {
          const nb = (dx: number, dy: number, test: (k: string) => boolean): boolean =>
            map.inBounds(tx + dx, ty + dy) && test(kindOf(map, map.idx(tx + dx, ty + dy)));
          const around = (test: (k: string) => boolean): number =>
            blobMask({
              n: nb(0, -1, test), e: nb(1, 0, test), s: nb(0, 1, test), w: nb(-1, 0, test),
              ne: nb(1, -1, test), se: nb(1, 1, test), sw: nb(-1, 1, test), nw: nb(-1, -1, test),
            });
          const waterK = (k: string): boolean => k === 'ocean' || k === 'lake' || k === 'river';
          const draw = (family: string, m: number): void => {
            const edge = m !== 0 ? this.edges.get(edgeKey(family, m)) : undefined;
            if (edge) ctx.drawImage(edge, 0, 0, BASE_TILE, BASE_TILE, dx, dy, ts, ts);
          };
          if (isWater) draw('shore', around((k) => !waterK(k)));
          else {
            if (built === 0 && tkind !== 'forest') draw('canopy', around((k) => k === 'forest'));
            draw('coast', around(waterK)); // convex land corners cut back to water (diagonal coasts)
          }
        }

        if (built !== 0) {
          // The kind-dispatch is a single pure call (renderKey.ts); transport keys
          // on the connection mask, buildings on footprint position + condition tier.
          const isT = isTransportKind(built);
          // A freeway center turn lane (a street through the freeway middle) draws its base markings
          // ALONG travel, not toward the flanking freeway lanes (which would be orthogonal to travel).
          const clAxis = isT ? freewayCenterLaneAxis(map, tx, ty) : null;
          // A ramp uses its FREEWAY-axis marking mask (not the full 4-way connection) so its dashed
          // line runs straight through the freeway instead of crossing the surface street it links.
          // the class this road tile is PAINTED as (a connector at a highway bend wears highway paint)
          const paintKind = isT ? roadPaintKind(map, tx, ty) : built;
          // a junction box — roads crossing, of any width (a street across a freeway, avenues meeting, a freeway
          // meeting a freeway: decoration.junctionBox) — is clear asphalt: no lanes, seams or median over it
          // an end cap (a wide road's stub past a junction, leading nowhere) is plain asphalt too, with a barrier
          const capped = isT ? endCapMask(map, tx, ty) : 0;
          const crossing = isT && (freewayCrossing(map, tx, ty) || junctionBox(map, tx, ty) || capped !== 0);
          const mask = crossing
            ? N | E | S | W
            : built === BuiltKind.RoadRamp && paintKind === BuiltKind.RoadRamp
              ? rampMarkingMask(map, tx, ty)
              : clAxis !== null
                ? clAxis === 'v'
                  ? N | S // travels N-S → centerline N-S, not the orthogonal E-W highway connections
                  : E | W
                : isT
                  ? transportMask(map, tx, ty)
                  : 0;
          const pid = isT ? 0 : map.parcel[i]!;
          const tier = isT ? 0 : parcels.conditionAt(pid - 1) < 128 ? 1 : 0;
          const pos: FootprintPos = isT ? 'c' : footprintPos(map, tx, ty, pid);
          // wideRoadAt is predicate-guarded (false for any non-road tile), so this
          // only ever flips the slab variant on for a 2-/3-row road corridor.
          const wide = !crossing && wideRoadAt(map, tx, ty);
          // road tiles are keyed by the class they're PAINTED as (a street linking highway runs at a bend
          // wears highway paint — decoration.roadPaintKind); everything else by its own kind. A tile picks
          // one of its painted variants by position hash (anti-plaid).
          let builtKey = pickVariantKey(builtRenderKey(paintKind, mask, pos, tier, wide), tx, ty, this.tileVariants);
          if (!isT && pid !== 0) {
            // a building is one W×H drawing sliced per cell; its variant is picked by the parcel ANCHOR so
            // every cell of one footprint agrees
            const fp = parcels.get(pid - 1);
            const cellKey = footprintCellKey(built, fp.width, fp.height, tx - fp.x, ty - fp.y, tier);
            if (this.atlas.has(cellKey)) builtKey = pickVariantKey(cellKey, fp.x, fp.y, this.tileVariants);
          }
          const builtTile = this.atlas.get(builtKey);
          if (builtTile) ctx.drawImage(builtTile, 0, 0, BASE_TILE, BASE_TILE, dx, dy, ts, ts);
          // LEVEL CROSSING: where a road crosses an at-grade rail/tram tile, the road's asphalt band runs
          // ACROSS the track with the rails showing through it; the white stop lines go on top, after.
          const xMask = isT ? railCrossingMask(map, tx, ty) : 0;
          if (xMask & (N | S)) ink('@road/xband/v', dx, dy); // road runs N–S
          if (xMask & (E | W)) ink('@road/xband/h', dx, dy); // road runs E–W
          // Limited-access DIVIDER: a concrete barrier on each edge where a freeway abuts a surface
          // road (a frontage avenue) — you physically can't cross there, only at a ramp. Per-tile
          // (depends on neighbour kinds), drawn OVER the road like the power poles, not an atlas key.
          // Structural/mechanical, so always on.
          if (isT) {
            // minRun 3: only barrier a SUSTAINED freeway/frontage stretch (>2 tiles). A 1-tile
            // freeway↔street contact is a crossing / onramp, not a frontage — no barrier there.
            const div = roadDividerMask(map, tx, ty, 3);
            if (div !== 0) ink(`@road/divider/${div}`, dx, dy);

            // CURB / sidewalk / gutter: on each edge where a surface road meets non-road (a parcel
            // or open land), a light sidewalk strip with a dark gutter line on its road-facing side.
            // Turns the "field of asphalt" into a street with edges. Per-tile (neighbour-dependent).
            const curb = roadCurbMask(map, tx, ty);
            const corners = innerCornerMask(map, tx, ty);
            if (corners !== 0) ink(`@road/curbCorner/${corners}`, dx, dy); // block corners the curbs miss
            const zebras = crosswalkMask(map, tx, ty);
            if (zebras !== 0) ink(`@road/zebra/${zebras}`, dx, dy); // crossings on the approaches to a junction
            if (capped !== 0) ink(`@road/endcap/${capped}`, dx, dy); // the barrier across a stub's dead end
            // stroad junctions: a stop bar and a lane arrow on each lane entering the box; signals on its corners
            const bars = stopBarMask(map, tx, ty);
            for (const e of [N, E, S, W]) {
              if (bars & e) {
                ink(`@road/stop/${e}`, dx, dy);
                ink(`@road/arrow/${e}`, dx, dy);
              }
            }
            const sig = signalCorners(map, tx, ty);
            if (sig !== 0) signals.push({ x: tx, y: ty, corners: sig });
            if (curb !== 0) ink(`@road/curb/${curb}`, dx, dy);

            // Level-crossing PAINT: the white stop line a road has at a rail/tram crossing, on each
            // road-approach edge (the asphalt band + rails are already laid below/in the rail tile).
            if (xMask !== 0) ink(`@road/xing/${xMask}`, dx, dy);

            // Freeway lane markings — ONLY on a WIDE (multi-lane) freeway (a 1-wide highway keeps its
            // own double-yellow). Two parts, neither doubled (Maddy 2026-06-19): (1) a dashed gold
            // CENTERLINE down each lane (hidden under the median on the spine, so it shows on the
            // outer lanes); (2) one line per INTER-LANE boundary, drawn ONCE per seam — the E/S side
            // only, since the neighbour's W/N edge is the same seam.
            if (built === BuiltKind.RoadHighway && wide && !crossing) {
              const fAxis = freewayAxis(map, tx, ty);
              if (fAxis !== null) {
                ink(`@road/flane/${fAxis}`, dx, dy);
                const edges = freewayLaneBoundaryMask(map, tx, ty) & (E | S);
                if (edges) ink(`@road/flaneEdge/${edges}`, dx, dy);
              }
            }

            // Freeway CENTER LANE (two-way left-turn / "suicide" lane): a surface street running
            // through the freeway middle. Draw the classic yellow solid-OUTER + dashed-INNER markings
            // on the flanking edges (the boundary with the freeway lanes). clAxis computed above.
            if (clAxis !== null && !crossing) ink(`@road/turn/${clAxis}`, dx, dy);

            // Freeway MEDIAN: a jersey barrier down the centre spine tile of the 3-wide corridor,
            // running lengthwise (separates the opposing carriageways). Per-tile; opens at ramps.
            const medianAxis = crossing ? null : freewayMedianAxis(map, tx, ty);
            if (medianAxis !== null) ink(`@road/median/${medianAxis}`, dx, dy);
          }

          // Elevated deck (overpass): drawn LIFTED above the road below with a drop shadow, so it
          // reads as grade-separated. Keys through the same atlas tiles as at-grade elev/promenade
          // (deckMask over the deck layer), so no new keyspace.
          const deck = map.deck[i]!;
          if (deck !== 0) {
            const deckTile = this.atlas.get(builtRenderKey(deck, deckMask(map, tx, ty), 'c', 0));
            if (deckTile) {
              // lift and shadow offset in whole art pixels, the shadow a half-tone dither
              const ps = ts / BASE_TILE;
              const shade = this.sprites.get('@wash/shadow');
              if (shade) ctx.drawImage(shade, 0, 0, BASE_TILE, BASE_TILE, dx + 2 * ps, dy + 2 * ps, ts, ts);
              ctx.drawImage(deckTile, 0, 0, BASE_TILE, BASE_TILE, dx, dy - 3 * ps, ts, ts);
            }
          }

          // Curb-side power pole props (decoration.curbPoleAt owns every placement decision).
          const pa = curbPoleAt(map, tx, ty);
          if (pa) poles.push({ x: tx, y: ty, axis: pa });

          // Collect this parcel's power state and lights; the decision is pure (isPowerConsumer).
          if (full && !isT && pid !== 0) {
            const pp = parcels.get(pid - 1);
            if (tx === pp.x && ty === pp.y) {
              const unpowered =
                this.powered !== null && isPowerConsumer(pp.kind) && !this.powered.has(i);
              if (unpowered) this.unpoweredFootprints.push({ x: tx, y: ty, w: pp.width });
              // Light-bearing building? Collect its footprint (world coords) for the per-frame emissive
              // overlay (drawSprites), with the skin's map for THIS footprint, tier and art variant (read
              // off the picked key). No power, no lights — an unpowered building stays dark at night.
              if (!unpowered) {
                const v = variantIndexOf(builtKey);
                const base = emissionKey(pp.kind, pp.width, pp.height, tier);
                const sfx = v === 0 ? '' : `#${v}`;
                const lit = this.emissionImage(base + sfx);
                const blink = this.emissionImage(`${base}/blink${sfx}`);
                if (lit || blink) this.emissiveBuildings.push({ x: pp.x, y: pp.y, w: pp.width, h: pp.height, kind: pp.kind, lit, blink });
              }
            }
          }
        }

        // Ecology heatmap: a translucent tint over every visible tile (built or
        // not). Part of the base — overlay changes call invalidateBase (Task 3).
        // A SPARSE overlay (dimBase) scrims every un-highlighted tile so its few
        // strong highlights read as a layer view instead of washing into terrain.
        if (this.overlay) {
          const t = this.overlay.tint(i);
          if (t) {
            ctx.fillStyle = `rgba(${t[0]}, ${t[1]}, ${t[2]}, ${t[3]})`;
            ctx.fillRect(dx, dy, ts, ts);
          } else if (this.overlay.dimBase) {
            ctx.fillStyle = OVERLAY_DIM_CSS;
            ctx.fillRect(dx, dy, ts, ts);
          }
        }
      }
    }

    // Desire-path WEAR + the static JUNK/TENTS it accrues — GROUND level, baked into the cached base so
    // it sits UNDER the moving agents (Maddy: tents/junk are static, go under agents). Brown tint by
    // wear; discarded junk from GARBAGE_WEAR up; encampment tents from ENCAMPMENT_WEAR up — junk + tents
    // COEXIST, and a heavily-worn tile grows MULTIPLE tents (a tent houses more than one unhoused person).
    if (ambient) {
      // pixel-art encampments (tents + junk + beaten earth), at the art-pixel scale
      const skinTents = [0, 1, 2].map((i) => this.sprites.get(`@sprite/tent/${i}`)).filter((x): x is AtlasImage => !!x);
      const skinJunk = [0, 1, 2, 3].map((i) => this.sprites.get(`@sprite/junk/${i}`)).filter((x): x is AtlasImage => !!x);
      const ps = ts / BASE_TILE; // one art pixel
      const mapW2 = world.map.width;
      const encampments = camera.zoom >= 2 && skinTents.length > 0;
      for (const [tile, wear] of ambient.wear) {
        const wx = tile % mapW2;
        const wy = (tile - wx) / mapW2;
        if (near && (wx < near.x0 || wx > near.x1 || wy < near.y0 || wy > near.y1)) continue;
        if (!this.wearShown(camera, wx, wy)) continue;
        if (full) {
          const sig = wearSig(wear, encampments);
          if (sig !== 0) this.bakedMarks.set(tile, sig);
        }
        const tileHash = Math.imul(((wx * 73856093) ^ (wy * 19349663)) >>> 0, 0x9e3779b1) >>> 0;
        {
          // beaten earth in three depths (no translucent wash over the pixel art)
          const { level, nJunk, nTents } = wearMarks(wear);
          const o = camera.tileOrigin(wx, wy);
          const img = level > 0 ? this.sprites.get(`@wear/${level}`) : undefined;
          if (img) ctx.drawImage(img, 0, 0, BASE_TILE, BASE_TILE, o.dx, o.dy, ts, ts);
          if (encampments && wear >= GARBAGE_WEAR) {
            const pick = (set: AtlasImage[], k: number): AtlasImage =>
              set[(Math.imul((tileHash ^ Math.imul(k + 1, 0x85ebca6b)) >>> 0, 0xc2b2ae35) >>> 16) % set.length]!;
            const items = [
              ...Array.from({ length: nTents }, (_, k) => pick(skinTents, k)),
              ...Array.from({ length: skinJunk.length > 0 ? nJunk : 0 }, (_, k) => pick(skinJunk, k + 7)),
            ];
            const sizes = items.map((img) => ({ w: (img as HTMLCanvasElement).width, h: (img as HTMLCanvasElement).height }));
            encampmentLayout(tileHash, sizes).forEach((spot, k) => {
              const sz = sizes[k]!;
              ctx.drawImage(items[k]!, o.dx + spot.x * ps, o.dy + spot.y * ps, sz.w * ps, sz.h * ps);
            });
          }
        }
      }
    }

    // Power poles — after the whole tile loop.
    for (const pl of poles) {
      const o = camera.tileOrigin(pl.x, pl.y);
      ink(`@road/pole/${pl.axis}`, o.dx, o.dy);
    }
    for (const sg of signals) {
      const o = camera.tileOrigin(sg.x, sg.y);
      for (const c of [1, 2, 4, 8]) if (sg.corners & c) ink(`@road/signal/${c}`, o.dx, o.dy);
    }

    // Parked cars are no longer painted into the static base — they are the trip-cars that
    // parked (cars=trips, lots=storage), drawn dynamically in drawSprites from ambient.cars.
  }

  /** The wear pass's cull: a worn tile on (or within a tile of) the screen. */
  private wearShown(camera: Camera, wx: number, wy: number): boolean {
    const ts = camera.tileSize;
    const { sx, sy } = camera.worldToScreen(wx, wy);
    return !(sx < -ts || sx > this.cssWidth + ts || sy < -ts || sy > this.cssHeight + ts);
  }

  /** Compare the live marks with what the base was baked with and re-draw only the tiles that changed (or
   *  rebuild it all when the change is wide). */
  private patchLiveMarks(world: WorldState, camera: Camera, ambient: AmbientState): void {
    const { map } = world;
    const dirty = new Set<number>();
    const encampments = camera.zoom >= 2 && [0, 1, 2].some((k) => this.sprites.has(`@sprite/tent/${k}`));
    const marks = new Map<number, number>();
    for (const [tile, wear] of ambient.wear) {
      const wx = tile % map.width;
      if (!this.wearShown(camera, wx, (tile - wx) / map.width)) continue;
      const sig = wearSig(wear, encampments);
      if (sig !== 0) marks.set(tile, sig);
      if (sig !== (this.bakedMarks.get(tile) ?? 0)) dirty.add(tile);
    }
    for (const tile of this.bakedMarks.keys()) if (!marks.has(tile)) dirty.add(tile);
    // murk is a 3×3 water average, so a neighbour's runoff can move a tile's level with no entry changing its own
    const range = camera.visibleTileRange();
    const murk = new Map<number, number>();
    const consider = (j: number): void => {
      if (murk.has(j)) return;
      const x = j % map.width;
      const y = (j - x) / map.width;
      if (x < range.x0 || x > range.x1 || y < range.y0 || y > range.y1) return;
      const k = kindOf(map, j);
      if (k !== 'ocean' && k !== 'lake' && k !== 'river') return;
      const level = washLevel(murkAt(map, ambient.waterPollution, x, y));
      murk.set(j, level);
      if (level !== (this.bakedMurk.get(j) ?? 0)) dirty.add(j);
    };
    for (const tile of ambient.waterPollution.keys()) {
      const x = tile % map.width;
      const y = (tile - x) / map.width;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (map.inBounds(x + dx, y + dy)) consider(map.idx(x + dx, y + dy));
    }
    for (const tile of this.bakedMurk.keys()) consider(tile);
    if (dirty.size === 0) return;
    const visible = (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1);
    if (dirty.size > Math.max(16, visible / 4)) {
      this.baseDirty = true; // a wide change: one full rebuild is cheaper than many patches
      return;
    }
    this.patchRects = [];
    this.patchVersion++;
    for (const tile of [...dirty].sort((a, b) => a - b)) {
      const tx = tile % map.width;
      this.patchTile(world, camera, ambient, range, tx, (tile - tx) / map.width);
      const sig = marks.get(tile);
      if (sig !== undefined) this.bakedMarks.set(tile, sig);
      else this.bakedMarks.delete(tile);
      const level = murk.get(tile);
      if (level !== undefined) {
        if (level > 0) this.bakedMurk.set(tile, level);
        else this.bakedMurk.delete(tile);
      }
    }
  }

  /** Re-draw one tile of the base exactly as a full rebuild would: clip to its device rect, lay the
   *  background, and replay every draw of the tiles around it in the full pass's order. */
  private patchTile(world: WorldState, camera: Camera, ambient: AmbientState, range: TileBox, tx: number, ty: number): void {
    const dpr = this.dpr;
    const a = camera.tileOrigin(tx, ty);
    const b = camera.tileOrigin(tx + 1, ty + 1);
    const x0 = Math.max(0, Math.floor(a.dx * dpr));
    const y0 = Math.max(0, Math.floor(a.dy * dpr));
    const x1 = Math.min(this.base.width, Math.floor(b.dx * dpr));
    const y1 = Math.min(this.base.height, Math.floor(b.dy * dpr));
    if (x1 <= x0 || y1 <= y0) return; // off the canvas
    const ctx = this.baseCtx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.clip();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = BASE_BG;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    const near = { x0: tx - 1, y0: ty - 1, x1: tx + 1, y1: ty + 1 };
    const box = { x0: Math.max(range.x0, near.x0), y0: Math.max(range.y0, near.y0), x1: Math.min(range.x1, near.x1), y1: Math.min(range.y1, near.y1) };
    this.paintTiles(world, camera, ambient, box, near);
    ctx.restore();
    this.patchRects.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }

  /**
   * Shared per-frame work for BOTH entry points, in three explicit steps:
   *  1. if the base is dirty, rebuild it (drawBase) and clear the flag;
   *  2. IDENTITY-blit the base onto the visible canvas 1:1 (same backing-store dims
   *     → no rescale; smoothing off → no re-smooth);
   *  3. draw the preview on top under the DPR transform (it lives in the composite
   *     now, NOT the base — so a hover never invalidates the base).
   */
  private composite(world: WorldState, camera: Camera, ambient?: AmbientState): void {
    // The CPU base (terrain + buildings + roads + ALL the line/divider/marking rules) is rendered the
    // SAME in both modes — Maddy: "draw the base layer with CPU and jeuje it up by the shader." In GPU
    // mode the shader samples this base canvas as its albedo and adds the dynamics (water/shadows/
    // day-night/grass/clouds); the visible Canvas2D is cleared transparent so the shader shows through.
    if (this.baseDirty) {
      this.drawBase(world, camera, ambient);
      this.baseDirty = false;
      this.baseTexVersion++; // signals the GPU path to re-upload the base texture
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (this.gpuMode) {
      ctx.clearRect(0, 0, this.base.width, this.base.height); // visible transparent; GPU draws the base
    } else {
      // Identity blit: base is backing-store sized, so drawImage(base, 0, 0) is 1:1.
      ctx.drawImage(this.base, 0, 0);
    }

    // Preview overlay (composite, not base): translucent green/red tile tints, drawn
    // at the DPR transform in CSS-space coords so they read on top of the base blit.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.preview) {
      const ts = camera.tileSize;
      for (const t of this.preview) {
        const { sx, sy } = camera.worldToScreen(t.x, t.y);
        ctx.fillStyle = t.valid ? 'rgba(96, 200, 128, 0.40)' : 'rgba(220, 86, 86, 0.40)';
        ctx.fillRect(Math.floor(sx), Math.floor(sy), ts, ts);
      }
    }
  }

  /**
   * The legacy / ambient-OFF path: composite only (base-blit + preview, NO sprites)
   * — output-identical to today's single-pass render (terrain + built + overlay +
   * preview), now cache-optimized so a preview-only repaint is a cheap blit.
   */
  render(world: WorldState, camera: Camera): void {
    this.composite(world, camera);
  }

  /**
   * The ambient-ON path: the same composite (base-blit + preview) THEN the ambient
   * sprites on top, culled to the viewport — the O(visible sprites) draw.
   */
  renderFrame(world: WorldState, camera: Camera, ambient: AmbientState): void {
    // murky water lives in the cached base: rebuild it when any tile crosses a pollution level
    let sig = 0;
    for (const [tile, poll] of ambient.waterPollution) sig ^= Math.imul(tile * 4 + washLevel(poll) + 1, 0x9e3779b1); // order-free
    if (sig !== this.murkSig) {
      this.murkSig = sig;
      this.baseDirty = true;
    }
    if (this.marksDue) {
      this.marksDue = false;
      if (!this.baseDirty) this.patchLiveMarks(world, camera, ambient);
    }
    this.composite(world, camera, ambient); // ambient → drawBase bakes wear/junk/tents under the agents
    this.drawSprites(world, camera, ambient);
    if (this.hole) {
      // the CCTV inset is drawn by the GPU in this corner of the map: keep this view's sprites out of it
      const h = this.hole;
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(Math.floor(h.x * this.dpr), Math.floor(h.y * this.dpr), Math.ceil(h.w * this.dpr), Math.ceil(h.h * this.dpr));
    }
  }

  /** A rect (CSS px, this canvas's space) to leave clear of this view — the GPU CCTV inset; null for none. */
  setHole(rect: { x: number; y: number; w: number; h: number } | null): void {
    this.hole = rect;
  }

  /** Draw the ambient sprites (cars / pedestrians / bird flocks) + the live building-health
   *  glow at the DPR transform, culled to the viewport. Cosmetic shell — live-pass tuned. */
  private drawSprites(world: WorldState, camera: Camera, ambient: AmbientState): void {
    const alpha = ambientAlpha(ambient); // interpolate agents between 50 ms substeps
    const onRoadAt = (x: number, y: number): boolean => world.map.inBounds(x, y) && isRoadKind(world.map.built[world.map.idx(x, y)]!);
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const ts = camera.tileSize;
    const w = this.cssWidth;
    const h = this.cssHeight;
    const onScreen = (sx: number, sy: number): boolean =>
      sx > -ts && sx < w + ts && sy > -ts && sy < h + ts;

    const mapW = world.map.width;
    // Each mover near the view is posed ONCE this frame (culled on its raw position first); the GPU glow
    // pass reuses the same poses (framePoses.ts).
    const cam = camera.screenToWorld(0, 0);
    const poses = computeFramePoses(ambient, viewRect(cam.wx, cam.wy, ts, w, h, 1), alpha, onRoadAt);
    shareFramePoses(ambient, poses);

    // (Desire-path WEAR + its JUNK/TENTS are now baked into the cached BASE in drawBase — ground level,
    // under the moving agents — so they no longer draw over pedestrians here.)

    // Building health + power, as pixel icons at the tile pixel scale: a heart / raincloud badge in the
    // top-left of a clearly thriving / suffering home (the visible output of the citizen-transit-health
    // loop), and the blinking lightning bolt top-right of every unpowered footprint. Live per-frame, so
    // they live here, not in the cached base.
    const iconScale = ts / BASE_TILE;
    const thriving = this.icons.get(iconKey('thriving'));
    const suffering = this.icons.get(iconKey('suffering'));
    const bolt = this.icons.get(iconKey('unpowered'));
    if (bolt && performance.now() % 1000 < 620) {
      const bs = 8 * iconScale;
      for (const f of this.unpoweredFootprints) {
        const { dx, dy } = camera.tileOrigin(f.x + f.w, f.y);
        if (!onScreen(dx, dy)) continue;
        ctx.drawImage(bolt, dx - bs, dy - iconScale, bs, bs);
      }
    }
    for (const [tile, health] of ambient.buildingHealth) {
      const hx = tile % mapW;
      const hy = (tile - hx) / mapW;
      // icons flag EXCEPTIONS, not every home: a heart for a standout (health ≥ 9, ~1 in 10 on a fresh
      // city), a raincloud a little earlier (≤ −6) since suffering is the actionable case
      if (health >= 0 ? health < 9 : health > -6) continue;
      const badge = health >= 0 ? thriving : suffering;
      const { dx, dy } = camera.tileOrigin(hx, hy);
      if (!badge || !onScreen(dx, dy)) continue;
      ctx.drawImage(badge, dx - iconScale, dy - iconScale, 8 * iconScale, 8 * iconScale);
    }

    // Cars carry their own colour (c.tint), the same moving and parked, in the 8-way heading frame
    // nearest their heading. carPose: a moving car rides its lane (right of heading) smoothly round turns
    // (moverPose); a parked one sits on its stall, a kerb-parked one parallel to the kerb.
    // Every vehicle and person on screen is also a BODY headlights can stop at (headlights.ts); the
    // sprite each one drew is kept so a body a beam hits can be lit.
    const nightT = gameSec();
    const night = Math.min(1, Math.max(0, (0.8 - dayNightBrightness(nightT)) / 0.3));
    const bodies: Body[] = [];
    const bodyArt: { img: AtlasImage; x: number; y: number }[] = [];
    const bodyMul: number[] = [];
    const addBody = (x: number, y: number, hx: number, hy: number, len: number, wid: number, mul: number, img: AtlasImage | undefined): void => {
      if (!img) return;
      bodies.push({ x, y, hx, hy, len, wid, lights: mul > 0.02 });
      bodyArt.push({ img, x, y });
      bodyMul.push(mul);
    };
    // Flood water (disasters.md): the river's murky tile over every flooded tile that isn't a building — ground,
    // roads, yards and greens go under; buildings stand in it. On the tile grid, under the vehicles and people,
    // two variants alternating for the wave.
    if (ambient.flooded?.size) {
      const wave = Math.floor(performance.now() / 700) & 1;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.85;
      const fl = ambient.flooded;
      const m = world.map;
      // trees and buildings stand in the water: it shows round them, not over them
      const standsIn = (t: number): boolean => isBuildingKind(m.built[t]!) || (m.built[t] === BuiltKind.None && m.landCover[t] === LandCover.Forest);
      const ap = ts / BASE_TILE; // one art pixel
      for (const t of fl) {
        if (standsIn(t)) continue;
        const fx = t % mapW;
        const fy = (t - fx) / mapW;
        const { dx, dy } = camera.tileOrigin(fx, fy);
        if (!onScreen(dx + ts / 2, dy + ts / 2)) continue;
        const img = this.sprites.get(`@sprite/flood/${((fx + fy) & 1) ^ wave}`);
        if (img) ctx.drawImage(img, dx, dy, ts, ts);
        // the waterline: a broken foam edge, one art pixel, where the water meets dry ground
        ctx.fillStyle = FOAM_CSS;
        for (let d = 0; d < 4; d++) {
          const nx = fx + DIR_DX[d]!;
          const ny = fy + DIR_DY[d]!;
          if (!m.inBounds(nx, ny)) continue;
          const n = m.idx(nx, ny);
          if (fl.has(n) || m.water[n] !== 0) continue;
          for (let k = 0; k < BASE_TILE; k++) {
            if (((t * 31 + d * 7 + k * 13 + wave * 5) & 7) < 3) continue; // broken, shifting with the wave
            const ex = d === 1 ? dx + ts - ap : d === 3 ? dx : dx + k * ap;
            const ey = d === 2 ? dy + ts - ap : d === 0 ? dy : dy + k * ap;
            ctx.fillRect(ex, ey, ap, ap);
          }
        }
      }
      ctx.restore();
    }

    // A craft fair's stalls (community-events.md): set out on the ground round the bazaar, under the people.
    for (const g of ambient.gatherings ?? []) {
      if (g.kind !== 'craft-fair') continue;
      const spots: [number, number][] = [
        [g.site.x + 0.5, g.site.y + 0.55],
        [g.site.x + g.site.w - 0.5, g.site.y + 0.55],
        [g.site.x + 0.5, g.site.y + g.site.h - 0.45],
        [g.site.x + g.site.w - 0.5, g.site.y + g.site.h - 0.45],
      ];
      spots.forEach(([sx, sy], k) => {
        const img = this.sprites.get(`@sprite/stall/${(g.id + k) % 3}`);
        if (img) this.drawArt(ctx, img, sx, sy, camera);
      });
    }

    // A wreck (live/accidents.ts) sits spun a frame round, glass on the road beside it, hazards flashing.
    const hazardOn = Math.floor(performance.now() / 400) % 2 === 0;
    for (const { m: c, pose } of poses.cars) {
      const { sx, sy } = camera.worldToScreen(pose.x, pose.y);
      if (!onScreen(sx, sy)) continue;
      const tint = (((c.tint ?? 0) % AGENT_TINTS) + AGENT_TINTS) % AGENT_TINTS;
      const frame = (heading8(pose.hx, pose.hy) + (c.wreck !== undefined ? 1 : 0)) % 8;
      const img = this.sprites.get(`@sprite/car/${tint}/${frame}`);
      if (img) this.drawArt(ctx, img, pose.x, pose.y, camera);
      if (c.wreck !== undefined) {
        const debris = this.sprites.get('@sprite/debris');
        if (debris) this.drawArt(ctx, debris, pose.x + pose.hx * 0.35, pose.y + pose.hy * 0.35 + 0.15, camera);
        if (hazardOn) {
          const lights = this.sprites.get(`@sprite/car-light/${frame}`);
          if (lights) this.drawArt(ctx, lights, pose.x, pose.y, camera);
        }
      }
      addBody(pose.x, pose.y, pose.hx, pose.hy, CAR_LENGTH, CAR_WIDTH, c.parked || c.wreck !== undefined ? 0 : night, img);
    }
    // (Smog is drawn LAST — the top layer, above cars/peds — see end of drawSprites.)

    // Police Violence map (toggled, P): a blood-red stain on every tile where the state has done
    // harm (arrests), drawn per-frame from the live field so it tracks arrests + decay. The inverse
    // of a crime map — concentrated in the redlined districts the cruisers hunt.
    if (this.liveOverlay === 'police') {
      for (const [tile, v] of ambient.policeViolence) {
        const vx = tile % mapW;
        const vy = (tile - vx) / mapW;
        const { sx, sy } = camera.worldToScreen(vx, vy);
        if (sx < -ts || sx > w + ts || sy < -ts || sy > h + ts) continue;
        const t = policeViolenceTint(v);
        ctx.globalAlpha = t[3];
        ctx.fillStyle = `rgb(${t[0]},${t[1]},${t[2]})`;
        ctx.fillRect(Math.floor(sx), Math.floor(sy), Math.ceil(ts), Math.ceil(ts));
      }
      ctx.globalAlpha = 1;
    }

    // Police cruisers: a black-and-white car whose roof bar flashes red/blue (two sprite phases); the GPU
    // glow pass casts the flashing pool onto the street around it.
    const copPhase = Math.floor(performance.now() / 180) % 2;
    for (const { pose } of poses.cruisers) {
      const { sx, sy } = camera.worldToScreen(pose.x, pose.y);
      if (!onScreen(sx, sy)) continue;
      const img = this.sprites.get(`@sprite/cop/${heading8(pose.hx, pose.hy)}/${copPhase}`);
      if (img) this.drawArt(ctx, img, pose.x, pose.y, camera);
      addBody(pose.x, pose.y, pose.hx, pose.hy, CAR_LENGTH, CAR_WIDTH, Math.max(night, 0.5), img);
    }

    // Fire trucks (disasters.md): movers like any vehicle — posed in their lane, interpolated, in the 8-way frame
    // nearest their heading — red with a light bar flashing red/white in step with the cruisers', their lamps a
    // body headlights can stop at. Spraying, a jet of droplets arcs from the truck onto the fire.
    const trucks = (ambient.trucks ?? []).map((m) => ({ m, pose: movingPose(m, LANE, alpha) }));
    for (const { m: tr, pose } of trucks) {
      const { sx, sy } = camera.worldToScreen(pose.x, pose.y);
      if (!onScreen(sx, sy)) continue;
      const img = this.sprites.get(`@sprite/firetruck/${heading8(pose.hx, pose.hy)}/${copPhase}`);
      if (img) this.drawArt(ctx, img, pose.x, pose.y, camera);
      addBody(pose.x, pose.y, pose.hx, pose.hy, CAR_LENGTH, CAR_WIDTH, Math.max(night, 0.5), img);
      if (tr.call !== 'spraying') continue;
      const goal = nearestBurning(ambient.burning ?? [], pose.x, pose.y);
      const drop = this.sprites.get('@sprite/drop');
      if (!goal || !drop) continue;
      const flow = (performance.now() / 600) % 1;
      for (let k = 0; k < 10; k++) {
        const u = (k / 10 + flow) % 1; // droplets stream along the jet
        const wx = pose.x + (goal.x - pose.x) * u;
        const wy = pose.y + (goal.y - pose.y) * u - 0.9 * 4 * u * (1 - u); // a parabola, peaking a tile up
        this.drawArt(ctx, drop, wx, wy, camera);
      }
    }

    // Trains: every car is a Mover on the shared mover path (trainPoses), interpolated between substeps
    // like cars, rounding a bend in quarter arcs one car after another; each in its 8-way frame.
    for (const tr of ambient.trains) {
      trainPoses(tr, mapW, alpha).forEach((q, k) => {
        const { sx, sy } = camera.worldToScreen(q.x, q.y);
        if (!onScreen(sx, sy)) return;
        const img = this.sprites.get(`@sprite/train/${k === 0 ? 'loco' : 'car'}/${heading8(q.hx, q.hy)}`);
        if (img) this.drawArt(ctx, img, q.x, q.y, camera);
        addBody(q.x, q.y, q.hx, q.hy, 0.8, 0.4, 0, img); // a passing train stops a headlight too
      });
    }

    // Citizens on foot and on bikes. On a STREET a ped hugs the kerb (sidewalk); crossing open ground (a
    // demand path) it stays centred. The person is FIXED per citizen (a stable hash of its identity —
    // skin tone + shirt), with a two-frame walk while it moves. (Drivers are CARS, drawn above.)
    // protesters (and those rising up) carry placards above their heads
    const marching = new Set((ambient.gatherings ?? []).filter((g) => g.kind === 'protest' || g.kind === 'uprising').map((g) => g.id));
    for (const { m: p, pose } of poses.peds) { // (not those inside a building, or riding their car)
      const { sx, sy } = camera.worldToScreen(pose.x, pose.y);
      if (!onScreen(sx, sy)) continue;
      const seed = (p.homeTile ?? p.carId ?? Math.round(p.x) * 131 + Math.round(p.y)) >>> 0;
      const moving = p.tx !== p.x || p.ty !== p.y;
      const frame = moving ? Math.floor(performance.now() / 220 + (seed & 7)) % 2 : 0; // a two-step walk
      const bike = (p.mode ?? TravelMode.Walk) === TravelMode.Bike;
      const img = this.sprites.get(personKey(bike ? 'bike' : 'ped', seed, frame));
      if (img) this.drawArt(ctx, img, pose.x, pose.y, camera);
      if (p.gather && marching.has(p.gather.id)) {
        const sign = this.sprites.get(`@sprite/placard/${seed & 1}`);
        if (sign) this.drawArt(ctx, sign, pose.x + 0.06, pose.y - 0.22, camera);
      }
      addBody(pose.x, pose.y, pose.hx, pose.hy, 0.16, 0.16, 0, img);
    }
    // The fallen and the street memorials (bodhgaia-opening.md §2): someone who has died lies on the ground
    // where they fell, quietly fading; then a candle and flowers stay on that spot for a while.
    const psx = camera.tileSize / BASE_TILE;
    for (const f of ambient.fallen ?? []) {
      const { sx, sy } = camera.worldToScreen(f.x + 0.5, f.y + 0.5);
      if (!onScreen(sx, sy)) continue;
      const img = this.sprites.get(personKey('ped', (f.x * 131 + f.y) >>> 0, 0));
      if (!img) continue;
      const w = (img as HTMLCanvasElement).width * psx;
      const h = (img as HTMLCanvasElement).height * psx;
      ctx.save();
      ctx.globalAlpha = 1 - Math.max(0, f.t / FALL_SUBSTEPS - 0.6) / 0.4; // fades over the last stretch
      ctx.translate(sx, sy + h * 0.2);
      ctx.rotate(Math.PI / 2); // lying down
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
    const flicker = Math.floor(performance.now() / 180);
    for (const m of ambient.memorials ?? []) {
      const o = camera.tileOrigin(m.x, m.y);
      if (!onScreen(o.dx + psx * 8, o.dy + psx * 8)) continue;
      const px = (x: number, y: number, c: string): void => {
        ctx.fillStyle = c;
        ctx.fillRect(o.dx + x * psx, o.dy + y * psx, psx, psx);
      };
      // flowers laid at the foot of a candle
      for (const [x, y, c] of [[5, 11, '#f8d858'], [6, 12, '#e86048'], [10, 11, '#f8f8e8'], [11, 12, '#c060c0'], [8, 13, '#e86048']] as const) {
        px(x, y, c);
        px(x, y + 1, '#407838');
      }
      for (let y = 8; y <= 11; y++) px(8, y, '#f0e0b8'); // the candle
      px(8, 7, (flicker + m.x + m.y) % 3 === 0 ? '#f8f8c0' : '#f8c040'); // its flame
      px(8, 6, '#f89830');
    }

    // Headlights: cast every lamp until it hits a body or a wall (GPU glow draws the cut cones).
    const cast = castHeadlights(world.map, bodies);
    this.beams = cast.beams.map((b) => ({ ...b, mul: bodyMul[b.source]! }));

    // Bird flocks: little gulls flapping out of phase. Centre on the tile (+0.5) for the same grid
    // convention as cars/peds (boids spawn clustered on the tile corner).
    const flap = performance.now() / 160;
    ambient.birds.forEach((f, fi) => {
      f.birds.forEach((b, bi) => {
        const { sx, sy } = camera.worldToScreen(b.x + 0.5, b.y + 0.5);
        if (!onScreen(sx, sy)) return;
        const img = this.sprites.get(`@sprite/bird/${Math.floor(flap + fi * 3 + bi) % 2}`);
        if (img) this.drawArt(ctx, img, b.x + 0.5, b.y + 0.5, camera);
      });
    });

    // Prayer flags over festive gatherings (community-events.md): single art pixels from the palette — strings along
    // both kerbs of the place and one across it, a pole at each end, fluttering. Overhead, so above the people.
    if (ambient.gatherings?.length) {
      const ap = camera.tileSize / BASE_TILE;
      const frame = Math.floor(performance.now() / 500) % 2;
      const dot = (x: number, y: number, c: readonly number[]): void => {
        const { sx, sy } = camera.worldToScreen(x / BASE_TILE, y / BASE_TILE);
        if (sx < -ap || sy < -ap || sx > w || sy > h) return;
        ctx.fillStyle = `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
        ctx.fillRect(Math.round(sx), Math.round(sy), Math.ceil(ap), Math.ceil(ap));
      };
      for (const g of ambient.gatherings) {
        if (!FESTIVE.has(g.kind)) continue;
        const X0 = g.site.x * BASE_TILE;
        const Y0 = g.site.y * BASE_TILE;
        const X1 = (g.site.x + g.site.w) * BASE_TILE - 1;
        const Y1 = (g.site.y + g.site.h) * BASE_TILE - 1;
        // round a building (a fair, a festival): strung along the edges of the ground round it, never over the roof;
        // a street (a party, a parade): along the place's long axis, or across it at each tile down a street
        const round = g.kind === 'festival' || g.kind === 'craft-fair';
        const strings: [number, number, number, number][] = round
          ? [[X0 + 3, Y0 + 4, X1 - 3, Y0 + 4], [X0 + 3, Y1 - 7, X1 - 3, Y1 - 7], [X0 + 3, Y0 + 4, X0 + 3, Y1 - 7], [X1 - 3, Y0 + 4, X1 - 3, Y1 - 7]]
          : g.site.w >= g.site.h
            ? [[X0, Y0 + 1, X1, Y0 + 1], [X0, Y1 - 4, X1, Y1 - 4], [X0, Y0 + 1, X1, Y1 - 4]]
            : Array.from({ length: g.site.h }, (_, k) => [X0 - 2, Y0 + k * BASE_TILE + 3, X1 + 2, Y0 + k * BASE_TILE + 3] as [number, number, number, number]);
        for (const [ax, ay, bx, by] of strings) {
          for (const [px, py] of [[ax, ay], [bx, by]]) for (let k = 0; k < 4; k++) dot(px!, py! - k, FLAG_STRING); // poles
          for (const p of prayerFlagPixels(ax, ay, bx, by, frame)) dot(p.x, p.y, p.kind === 'flag' ? FLAG_COLOURS[p.colour]! : FLAG_STRING);
        }
      }
    }

    // Smog plumes — TOP layer (above cars/peds, Maddy): translucent puffs over polluted tiles, streaming
    // downwind along the prevailing wind (loop + triangle fade so they don't pop), billowing as they go.
    // Pixel puffs on the art grid. In GPU mode the smog is a WebGL overlay above the sprites (smogOverlay).
    if (!this.gpuMode) {
      const drift = performance.now() / 1000;
      for (const [tile, amt] of ambient.pollution) {
        if (amt < 40) continue; // only real plumes, not faint road haze
        const px = tile % mapW;
        const py = (tile - px) / mapW;
        const phase = (drift * 0.35 + (tile % 13) * 0.11) % 1; // 0..1 loop, per-tile phase offset
        const distance = phase * 3.0; // tiles carried downwind this cycle
        const wx = px + 0.5 + ambient.wind.dx * distance;
        const wy = py + 0.5 + ambient.wind.dy * distance;
        const { sx, sy } = camera.worldToScreen(wx, wy);
        if (!onScreen(sx, sy)) continue;
        // billow by stepping up the pixel sizes (never scaling the art), heavier smog starts bigger
        const size = Math.min(SMOG_SIZES - 1, Math.floor(phase * SMOG_SIZES + amt / 200));
        const env = phase < 0.5 ? phase * 2 : (1 - phase) * 2; // fade in then out (0 at both loop ends)
        ctx.globalAlpha = Math.min(0.45, (amt / 255) * 0.6) * env;
        const img = this.sprites.get(`@sprite/smog/${size}/${tile & 1}`);
        if (img) this.drawArt(ctx, img, wx, wy, camera);
      }
      // a spill's toxic smog: the same streaming puffs, greenish-yellow and denser
      for (const [tile, amt] of ambient.toxic ?? []) {
        if (amt < 16) continue;
        const px = tile % mapW;
        const py = (tile - px) / mapW;
        const phase = (drift * 0.35 + (tile % 13) * 0.11) % 1;
        const wx = px + 0.5 + ambient.wind.dx * phase * 3.0;
        const wy = py + 0.5 + ambient.wind.dy * phase * 3.0;
        const { sx, sy } = camera.worldToScreen(wx, wy);
        if (!onScreen(sx, sy)) continue;
        const size = Math.min(SMOG_SIZES - 1, Math.floor(phase * SMOG_SIZES + amt / 120));
        const env = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
        ctx.globalAlpha = Math.min(0.8, (amt / 255) * 1.1) * env;
        const img = this.sprites.get(`@sprite/toxic/${size}/${tile & 1}`);
        if (img) this.drawArt(ctx, img, wx, wy, camera);
      }
      ctx.globalAlpha = 1;
    }

    // Rain (app/weather.ts): while a storm lasts the sky greys a little and streaks fall across the view — sprites
    // on the art grid, each drop on its own phase, leaning with the wind; a heavy storm's are longer and thicker.
    // Drawn before the lighting pass, so night dims the rain with everything else.
    if (ambient.rain) {
      const heavy = ambient.rain.heavy;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = heavy ? 'rgba(40, 52, 72, 0.24)' : 'rgba(40, 52, 72, 0.14)';
      ctx.fillRect(0, 0, this.base.width, this.base.height);
      ctx.restore();
      const img = this.sprites.get(`@sprite/rain/${heavy ? 1 : 0}`);
      if (img) {
        const t = performance.now() / 1000;
        const count = Math.round(((w * h) / (ts * ts)) * (heavy ? 2.2 : 0.9));
        const fall = h * (heavy ? 1.6 : 1.2); // screens per second
        ctx.globalAlpha = heavy ? 0.75 : 0.6;
        for (let i = 0; i < count; i++) {
          const a = Math.imul(i + 1, 0x9e3779b1) >>> 0;
          const b = Math.imul(a ^ (a >>> 15), 0x85ebca6b) >>> 0;
          const y = ((b % 1000) / 1000) * (h + ts) + t * fall;
          const sy = (y % (h + ts)) - ts;
          const sx = ((a % 1000) / 1000) * w + ambient.wind.dx * (sy / h) * ts;
          const at = camera.screenToWorld(sx, sy);
          this.drawArt(ctx, img, at.wx, at.wy, camera);
        }
        ctx.globalAlpha = 1;
      }
    }

    // GPU mode: light the sprite layer to MATCH the ground — the same day/night dim + night cool the shader
    // applies (lighting.ts mirrors it), source-atop over the sprite pixels so transparent gaps stay clear.
    // Uniform across the view: the ground's only spatial light is building contact shadow, which sprites
    // standing in the street don't take.
    if (this.gpuMode) {
      const dark = 1 - dayNightBrightness(gameSec());
      if (dark > 0.004) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = `rgba(6, 9, 22, ${dark.toFixed(3)})`; // cool dark
        ctx.fillRect(0, 0, this.base.width, this.base.height);
        ctx.restore();
      }
    }

    // CPU mode (the fallback, and the CCTV inset) has no lighting shader: darken the whole frame with the same
    // day/night curve so the night reads as night there too (headlights are drawn after, so they still shine).
    if (!this.gpuMode) {
      const dark = 1 - dayNightBrightness(gameSec());
      if (dark > 0.004) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = `rgba(6, 9, 22, ${(dark * 1.1).toFixed(3)})`;
        ctx.fillRect(0, 0, this.base.width, this.base.height);
        ctx.restore();
      }
    }

    // The opening's night walker — drawn AFTER the night pass (like the headlights) so the dark doesn't swallow
    // one small figure: a pool of lamplight follows them, and they walk in it (a two-step walk).
    if (ambient.wanderer) {
      const w = ambient.wanderer;
      const c = camera.worldToScreen(w.x + 0.5, w.y + 0.5);
      const r = camera.tileSize * 2;
      const glow = ctx.createRadialGradient(c.sx, c.sy, 0, c.sx, c.sy, r);
      glow.addColorStop(0, 'rgba(255, 214, 140, 0.42)');
      glow.addColorStop(0.5, 'rgba(255, 214, 140, 0.16)');
      glow.addColorStop(1, 'rgba(255, 214, 140, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(c.sx - r, c.sy - r, 2 * r, 2 * r);
      const img = this.sprites.get(personKey('ped', w.seed >>> 0, Math.floor(performance.now() / 260) % 2));
      if (img) this.drawArt(ctx, img, w.x + 0.5, w.y + 0.5, camera);
    }

    // Flames (disasters.md): pixel flame frames on every tile of a burning building, drawn AFTER the lighting pass
    // like the other light sources — fire isn't dimmed by night (the GPU glow casts its light on the ground). Each
    // tile flickers on its own phase. Its smoke is smog: the fire lays it into the field the overlay draws.
    if (ambient.burning?.length) {
      const tick = Math.floor(performance.now() / 110);
      for (const b of ambient.burning) {
        for (let dy = 0; dy < b.h; dy++) {
          for (let dx = 0; dx < b.w; dx++) {
            const { sx, sy } = camera.worldToScreen(b.x + dx + 0.5, b.y + dy + 0.5);
            if (!onScreen(sx, sy)) continue;
            const f = (tick + (((b.x + dx) * 7 + (b.y + dy) * 13) & 3)) % FIRE_FRAMES;
            const img = this.sprites.get(`@sprite/fire/${f}`);
            if (img) this.drawArt(ctx, img, b.x + dx + 0.5, b.y + dy + 0.4, camera);
          }
        }
      }
    }

    // Vehicle headlights/taillights — NIGHT-GATED (off at midday, ramping on at dusk) and evading shading
    // (drawn here, after the sprite lighting pass), on the art grid with the car body.
    // What a headlight hits is lit on the side facing the lamp — additive, after the lighting pass so it
    // evades the night dim, on the art grid with the sprite it lights.
    if (cast.lit.size > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const [i, l] of cast.lit) {
        const art = bodyArt[i]!;
        const glow = this.litSilhouette(art.img, heading8(l.fx, l.fy));
        if (!glow) continue;
        ctx.globalAlpha = Math.min(0.7, 0.25 + l.light * bodyMul[l.source]! * 0.5);
        this.drawArt(ctx, glow, art.x, art.y, camera);
      }
      ctx.restore();
    }
    if (night > 0.02) {
      // pixel-art headlights + taillights, additive at night, on the art grid with the car body
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = night;
      for (const { m: c, pose } of poses.cars) {
        if (c.parked || c.wreck !== undefined) continue; // a parked car is OFF; a wreck's hazards flash (above)
        const img = this.sprites.get(`@sprite/car-light/${heading8(pose.hx, pose.hy)}`);
        if (img) this.drawArt(ctx, img, pose.x, pose.y, camera);
      }
      for (const { pose } of trucks) {
        const img = this.sprites.get(`@sprite/car-light/${heading8(pose.hx, pose.hy)}`);
        if (img) this.drawArt(ctx, img, pose.x, pose.y, camera);
      }
      ctx.restore();
    }
    // Light-bearing BUILDINGS (collected in drawBase): overlay the emission map additively over the
    // whole footprint, evading shading. Two layers — the STATIC glow (furnace/windows) draws steady;
    // the BLINK layer (red aviation/hazard beacons) draws only on the on-phase, so the glow no longer
    // flickers WITH the hazard lights (Maddy: the glow should be static, only the beacons blink).
    if (this.emissiveBuildings.length > 0) {
      const now = performance.now();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.imageSmoothingEnabled = false;
      for (const b of this.emissiveBuildings) {
        // on the tile grid the building itself was drawn on, so each lit window lands on its art pixel
        const { dx: sx, dy: sy } = camera.tileOrigin(b.x, b.y);
        const w = b.w * ts;
        const h = b.h * ts;
        if (!onScreen(sx + w / 2, sy + h / 2)) continue;
        // Power plants (24–30) run 24/7 → glow always on; everything else is lit WINDOWS → night-gated.
        const isPower = b.kind >= 24 && b.kind <= 30;
        const a = isPower ? 1 : night;
        const stat = b.lit;
        if (stat && a > 0.02) {
          ctx.globalAlpha = a;
          ctx.drawImage(stat, sx, sy, w, h);
        }
        // Hazard beacons blink on a PER-BUILDING phase + period (hashed from its anchor), so beacons
        // across the map don't pulse in unison (Maddy: global blink reads fake). Always-on (aviation).
        const blinkImg = b.blink;
        if (blinkImg) {
          const hash = (((b.x * 73856093) ^ (b.y * 19349663)) >>> 0);
          const period = 420 + (hash % 6) * 90; // 420..870 ms, varies per building
          if ((now + (hash % period)) % period < period * 0.45) {
            ctx.globalAlpha = 1;
            ctx.drawImage(blinkImg, sx, sy, w, h);
          }
        }
      }
      ctx.restore();
    }
  }
}
