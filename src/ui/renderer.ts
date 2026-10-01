// Canvas2D pixel-art renderer. A thin DOM shell over the pure engine model: it draws the Super skin's
// code-painted tiles (snesTileset.ts, materialized by tilesetLoader.ts) for the visible tile range with
// nearest-neighbour scaling, then the pixel-art agents on the same art-pixel grid. All view math lives
// in Camera, all map/fabric logic in the engine, every decoration decision in decoration.ts; this file
// only draws.

import { GameMap, Water, LandCover } from '../engine/map';
import { BuiltKind, isTransportKind, transportMask, isRoadKind, deckMask, roadDividerMask, roadCurbMask, railCrossingMask, depaveAsphalt, rampMarkingMask, freewayMedianAxis, freewayAxis, freewayLaneBoundaryMask, freewayCenterLaneAxis, freewayCrossing } from '../engine/fabric';
import type { WorldState } from '../worldgen/pipeline';
import { Camera, BASE_TILE } from './camera';
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
import { wideRoadAt, curbPoleAt, innerCornerMask, roadPaintKind, crosswalkMask, encampmentLayout } from './decoration';
import { isPowerConsumer } from '../growth/power';
import { dirVector, carPose, pedPose, ambientAlpha } from './ambientContent';
import { AGENT_TINTS, SMOG_SIZES, heading8, personKey } from './snesAgents';
import { castHeadlights, type Body } from './headlights';
import type { HeadlightBeam } from './gpuRenderer';
import { CAR_LENGTH, CAR_WIDTH } from './ambientContent';
import type { AmbientState } from './ambientContent';
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

/** Wash level 1..3 (0 = none) for a 0..255 field — the dithered @wash/* overlays step, never fade. */
function washLevel(v: number): number {
  return v >= 170 ? 3 : v >= 90 ? 2 : v > 0 ? 1 : 0;
}
const GARBAGE_WEAR = 150; // wear at/above which a worn empty tile shows discarded junk
const ENCAMPMENT_WEAR = 225; // wear at/above which the heaviest-worn empty tile shows an encampment tent

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
    this.sprites = new Map([...ns('@sprite/'), ...ns('@wear/'), ...ns('@wash/')]);
    this.lazyImages = skin.lazy ?? null;
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

  /**
   * Draw the cached BASE pass — terrain + built + power-line decoration + ecology
   * overlay — into the offscreen base canvas. Explicitly NOT the preview (which is
   * cursor-following and would defeat the cache on every hover) and NOT the sprites.
   * Uses the exact transform/smoothing setup the legacy render used so the base is
   * pixel-identical to today's terrain+built+overlay layer (CRITIC-YP2 / YP5).
   */
  private drawBase(world: WorldState, camera: Camera, ambient?: AmbientState): void {
    const { map, parcels } = world;
    const ctx = this.baseCtx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false; // base ctx scales BASE_TILE→ts; off = crisp
    ctx.fillStyle = '#14121f';
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    const ts = camera.tileSize;
    const range = camera.visibleTileRange();
    this.emissiveBuildings.length = 0; // re-collected this pass (refreshed on every base rebuild)
    this.unpoweredFootprints.length = 0; // likewise
    // A street-furniture overlay at a tile.
    const ink = (key: string, dx: number, dy: number): void => {
      const img = this.roadInk.get(key);
      if (img) ctx.drawImage(img, 0, 0, BASE_TILE, BASE_TILE, dx, dy, ts, ts);
    };
    // Power poles (props), drawn AFTER the tile loop so no later tile paints over one.
    const poles: { x: number; y: number; axis: 'h' | 'v' | 'nw' }[] = [];
    for (let ty = range.y0; ty <= range.y1; ty++) {
      for (let tx = range.x0; tx <= range.x1; tx++) {
        const i = map.idx(tx, ty);
        const { dx, dy } = camera.tileOrigin(tx, ty); // seam-free integer origin

        const tkind = kindOf(map, i);
        const terrainKey = `${tkind}-${bandOf(map.elevation[i]!)}`;
        const terrain = this.atlas.get(pickVariantKey(terrainKey, tx, ty, this.tileVariants)) ?? this.atlas.get(terrainKey)!;
        const isWater = tkind === 'ocean' || tkind === 'lake' || tkind === 'river';
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
          // an at-grade road crossing a freeway is a junction box: clear paint, no lanes / median over it
          const crossing = isT && freewayCrossing(map, tx, ty);
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
          const wide = wideRoadAt(map, tx, ty);
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
            if (clAxis !== null) ink(`@road/turn/${clAxis}`, dx, dy);

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
          if (!isT && pid !== 0) {
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
      for (const [tile, wear] of ambient.wear) {
        const wx = tile % mapW2;
        const wy = (tile - wx) / mapW2;
        const { sx, sy } = camera.worldToScreen(wx, wy);
        if (sx < -ts || sx > this.cssWidth + ts || sy < -ts || sy > this.cssHeight + ts) continue;
        const tileHash = Math.imul(((wx * 73856093) ^ (wy * 19349663)) >>> 0, 0x9e3779b1) >>> 0;
        {
          // beaten earth in three depths (no translucent wash over the pixel art)
          const level = wear >= 200 ? 3 : wear >= 120 ? 2 : wear >= 50 ? 1 : 0;
          const o = camera.tileOrigin(wx, wy);
          const img = level > 0 ? this.sprites.get(`@wear/${level}`) : undefined;
          if (img) ctx.drawImage(img, 0, 0, BASE_TILE, BASE_TILE, o.dx, o.dy, ts, ts);
          if (camera.zoom >= 2 && skinTents.length > 0 && wear >= GARBAGE_WEAR) {
            const nJunk = wear >= (GARBAGE_WEAR + ENCAMPMENT_WEAR) / 2 ? 2 : 1;
            const nTents = wear >= ENCAMPMENT_WEAR ? Math.min(3, 1 + Math.floor((wear - ENCAMPMENT_WEAR) / 12)) : 0;
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

    // Parked cars are no longer painted into the static base — they are the trip-cars that
    // parked (cars=trips, lots=storage), drawn dynamically in drawSprites from ambient.cars.
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
    this.composite(world, camera, ambient); // ambient → drawBase bakes wear/junk/tents under the agents
    this.drawSprites(world, camera, ambient);
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

    // (Desire-path WEAR + its JUNK/TENTS are now baked into the cached BASE in drawBase — ground level,
    // under the moving agents — so they no longer draw over pedestrians here.)

    // Water pollution: runoff murks the coastal water green-brown in dithered steps as it accumulates.
    for (const [tile, poll] of ambient.waterPollution) {
      const wx = tile % mapW;
      const wy = (tile - wx) / mapW;
      const { dx, dy } = camera.tileOrigin(wx, wy);
      if (dx < -ts || dx > w + ts || dy < -ts || dy > h + ts) continue;
      const level = washLevel(poll);
      const murk = level > 0 ? this.sprites.get(`@wash/water/${level}/${surfaceVariantIndex(wx, wy, 3)}`) : undefined;
      if (murk) ctx.drawImage(murk, 0, 0, BASE_TILE, BASE_TILE, dx, dy, ts, ts);
    }

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
    const nightT = performance.now() / 1000;
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
    for (const c of ambient.cars) {
      const pose = carPose(c, alpha);
      const { sx, sy } = camera.worldToScreen(pose.x, pose.y);
      if (!onScreen(sx, sy)) continue;
      const tint = (((c.tint ?? 0) % AGENT_TINTS) + AGENT_TINTS) % AGENT_TINTS;
      const img = this.sprites.get(`@sprite/car/${tint}/${heading8(pose.hx, pose.hy)}`);
      if (img) this.drawArt(ctx, img, pose.x, pose.y, camera);
      addBody(pose.x, pose.y, pose.hx, pose.hy, CAR_LENGTH, CAR_WIDTH, c.parked ? 0 : night, img);
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
    for (const c of ambient.cruisers) {
      const pose = carPose(c, alpha);
      const { sx, sy } = camera.worldToScreen(pose.x, pose.y);
      if (!onScreen(sx, sy)) continue;
      const img = this.sprites.get(`@sprite/cop/${heading8(pose.hx, pose.hy)}/${copPhase}`);
      if (img) this.drawArt(ctx, img, pose.x, pose.y, camera);
      addBody(pose.x, pose.y, pose.hx, pose.hy, CAR_LENGTH, CAR_WIDTH, Math.max(night, 0.5), img);
    }

    // Trains: a snake of cars riding the rails (Maddy: rails need trains). Each cell is drawn in the
    // 8-way frame of the LOCAL track direction (toward the car ahead); the head is the locomotive
    // (interpolated for smooth motion).
    for (const tr of ambient.trains) {
      for (let c = tr.cells.length - 1; c >= 0; c--) {
        // position: the head rides its interpolated (hx,hy); the rest sit on their tile centres.
        let cx: number;
        let cy: number;
        if (c === 0) {
          cx = tr.hx;
          cy = tr.hy;
        } else {
          const idx = tr.cells[c]!;
          cx = idx % mapW;
          cy = (idx - (cx)) / mapW;
        }
        const { sx, sy } = camera.worldToScreen(cx + 0.5, cy + 0.5);
        if (!onScreen(sx, sy)) continue;
        // heading: toward the car AHEAD (cell c-1) so each car aligns with the track; the head uses
        // its committed dir. The car ahead of cell 1 is the head at its interpolated (hx,hy).
        let hx: number;
        let hy: number;
        if (c === 0) {
          const v = dirVector(tr.dir);
          hx = v.dx;
          hy = v.dy;
        } else {
          const ahead = tr.cells[c - 1]!;
          const ax = c - 1 === 0 ? tr.hx : ahead % mapW;
          const ay = c - 1 === 0 ? tr.hy : (ahead - (ahead % mapW)) / mapW;
          hx = ax - cx;
          hy = ay - cy;
        }
        const img = this.sprites.get(`@sprite/train/${c === 0 ? 'loco' : 'car'}/${heading8(hx, hy)}`);
        if (img) this.drawArt(ctx, img, cx + 0.5, cy + 0.5, camera);
      }
    }

    // Citizens on foot and on bikes. On a STREET a ped hugs the kerb (sidewalk); crossing open ground (a
    // demand path) it stays centred. The person is FIXED per citizen (a stable hash of its identity —
    // skin tone + shirt), with a two-frame walk while it moves. (Drivers are CARS, drawn above.)
    for (const p of ambient.peds) {
      if (p.phase === 'inside' || p.phase === 'driving') continue; // inside a building, or riding its car
      const pose = pedPose(p, onRoadAt, alpha);
      const { sx, sy } = camera.worldToScreen(pose.x, pose.y);
      if (!onScreen(sx, sy)) continue;
      const seed = (p.homeTile ?? p.carId ?? Math.round(p.x) * 131 + Math.round(p.y)) >>> 0;
      const moving = p.tx !== p.x || p.ty !== p.y;
      const frame = moving ? Math.floor(performance.now() / 220 + (seed & 7)) % 2 : 0; // a two-step walk
      const bike = (p.mode ?? TravelMode.Walk) === TravelMode.Bike;
      const img = this.sprites.get(personKey(bike ? 'bike' : 'ped', seed, frame));
      if (img) this.drawArt(ctx, img, pose.x, pose.y, camera);
      addBody(pose.x, pose.y, pose.hx, pose.hy, 0.16, 0.16, 0, img);
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
      ctx.globalAlpha = 1;
    }

    // GPU mode: light the sprite layer to MATCH the ground — the same day/night dim + night cool the shader
    // applies (lighting.ts mirrors it), source-atop over the sprite pixels so transparent gaps stay clear.
    // Uniform across the view: the ground's only spatial light is building contact shadow, which sprites
    // standing in the street don't take.
    if (this.gpuMode) {
      const dark = 1 - dayNightBrightness(performance.now() / 1000);
      if (dark > 0.004) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = `rgba(6, 9, 22, ${dark.toFixed(3)})`; // cool dark
        ctx.fillRect(0, 0, this.base.width, this.base.height);
        ctx.restore();
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
      for (const c of ambient.cars) {
        if (c.parked) continue; // a parked car is OFF
        const pose = carPose(c, alpha);
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
