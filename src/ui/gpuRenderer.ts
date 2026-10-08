// GPU render path: a WebGL2 canvas stacked UNDER the Canvas2D sprite/UI canvas. It lights the CPU-baked
// pixel-art base (SatelliteShader: day/night + contact shadows) and casts the emissive glow (headlights,
// cruiser bars, lit windows), driven by the LIVE camera so it pans/zooms with the game. The Canvas2D
// layer goes transparent (renderer.setGpuMode) and draws the agents/decorations/UI on top. The CPU path
// stays the no-WebGL fallback.
//
// IO module (touches WebGL/DOM) — not on the pure-ui allowlist.
import { GridTextureBridge } from './gridTextureBridge';
import { SatelliteShader } from './satelliteShader';
import { GlowBatch, GLOW_FLOATS, extractLightPoints } from './glowBatch';
import type { LightPoint } from './glowBatch';
import { BEAM_REACH, type Beam } from './headlights';
import { DAYSPEED, dayNightBrightness } from './lighting';
import { carPose, ambientAlpha } from '../live/poses';
import { sharedFramePoses, type Posed } from './framePoses';
import type { AmbientState, Mover } from '../live/types';
import type { GameMap } from '../engine/map';
import type { Camera } from './camera';

/** A light-bearing building footprint (world coords) with the skin's emission maps — the renderer collects
 *  these; the glow pass casts a faint window/beacon glow from each lit pixel. */
export type EmissiveBuilding = { x: number; y: number; w: number; h: number; kind: number; lit?: CanvasImageSource; blink?: CanvasImageSource };
/** A cast headlight (headlights.ts) with its strength (night for cars, more for a cruiser). */
export type HeadlightBeam = Beam & { mul: number };

const SUN: readonly [number, number] = [0.65, 0.78]; // sun direction in tile space (shadows trace toward it)
/** Peak building-shadow darkening (0..1) — faint, so shadows read as soft contact shade. */
export const SHADOW_STRENGTH = 0.22;

/** The live world→shader view: the visible window in world cells (matches the Canvas2D camera). */
export function cameraToShaderView(
  camera: Camera,
  cssWidth: number,
  cssHeight: number,
): { origin: [number, number]; view: [number, number] } {
  const ts = camera.tileSize;
  const o = camera.worldToScreen(0, 0); // screen px of world tile (0,0)
  return { origin: [-o.sx / ts, -o.sy / ts], view: [cssWidth / ts, cssHeight / ts] };
}

export class GpuRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private shader: SatelliteShader | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private lastBaseVersion = -1;
  private lastPatchVersion = -1;
  private lastInsetVersion = -1;
  private readonly bridge: GridTextureBridge;
  private glow: GlowBatch | null = null;
  private glowData = new Float32Array(0);
  // Light points extracted from SKIN emission maps, cached per image (the maps are shared per variant).
  private skinPoints = new WeakMap<object, LightPoint[]>();

  private pointsOf(img: CanvasImageSource | undefined): LightPoint[] {
    if (!img) return [];
    let pts = this.skinPoints.get(img);
    if (!pts) {
      pts = extractLightPoints(img, 8, 0.26, 8);
      this.skinPoints.set(img, pts);
    }
    return pts;
  }

  constructor(private readonly map: GameMap) {
    this.bridge = new GridTextureBridge(map.width, map.height);
    this.bridge.repackAll(map);
  }

  /** Create the WebGL2 canvas UNDER everything (z-index 0) and compile the shader. Throws if WebGL2
   *  is unavailable so the caller can fall back to the CPU path. */
  mount(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.id = 'gpu-base';
    canvas.style.cssText =
      'position:fixed;top:var(--topbar-h);left:var(--sidebar-w);width:calc(100% - var(--sidebar-w));height:calc(100% - var(--topbar-h) - var(--status-h));display:block;pointer-events:none;z-index:0;'; // the map pane, right of the tool palette — a canvas needs an explicit CSS size, or it displays at its (DPR-scaled) buffer size
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 unavailable');
    document.body.prepend(canvas);
    this.canvas = canvas;
    this.gl = gl;
    this.shader = new SatelliteShader(gl);
    this.shader.uploadFull(this.bridge);
    this.glow = new GlowBatch(gl);
    return canvas;
  }

  /** Cast the agents' and buildings' light onto the ground (AFTER render()). The agents themselves are
   *  pixel art on the Canvas2D layer above. */
  renderAgents(
    ambient: AmbientState,
    camera: Camera,
    cssWidth: number,
    cssHeight: number,
    timeSec: number,
    buildings: readonly EmissiveBuilding[] = [],
    beams: readonly HeadlightBeam[] = [],
  ): void {
    const gl = this.gl;
    if (!gl) return;
    const night = Math.min(1, Math.max(0, (0.8 - dayNightBrightness(timeSec)) / 0.3));
    const { origin, view } = cameraToShaderView(camera, cssWidth, cssHeight);
    this.renderGlow(ambient, origin, view, timeSec, night, buildings, beams);
    gl.disable(gl.BLEND); // leave blend OFF so the next frame's opaque base pass isn't additive
  }

  /** Emissive GLOW: soft additive light cast onto the surrounding tiles (Maddy: "car headlights
   *  illuminating road in front" as a forward CONE; windows/hazard blinkies cast faint glows too).
   *  Headlights = forward cones cut where they hit (headlights.ts), splashing a wall they stop at;
   *  cruiser bars flash red/blue (radial); building windows a faint
   *  warm pool (night), power plants a faint warm glow + a blinking red beacon glow. Additive (ONE,ONE). */
  private renderGlow(ambient: AmbientState, origin: readonly [number, number], view: readonly [number, number], timeSec: number, night: number, buildings: readonly EmissiveBuilding[], beams: readonly HeadlightBeam[]): void {
    const alpha = ambientAlpha(ambient); // interpolate agents between 50 ms substeps
    const gl = this.gl;
    if (!gl || !this.glow) return;
    let g = this.glowData;
    let n = 0;
    // pos(2) fwd(2) len(1) halfwidth(1) color(3) intensity(1) cut(1); the buffer grows to fit (a lit
    // building adds one pool per lit window)
    const cone = (x: number, y: number, fx: number, fy: number, len: number, hw: number, r: number, gr: number, b: number, inten: number, cut = len): void => {
      const o = n * GLOW_FLOATS;
      if (o + GLOW_FLOATS > g.length) {
        const bigger = new Float32Array(Math.max(64, g.length * 2) + GLOW_FLOATS);
        bigger.set(g);
        g = this.glowData = bigger;
      }
      g[o] = x; g[o + 1] = y; g[o + 2] = fx; g[o + 3] = fy; g[o + 4] = len; g[o + 5] = hw;
      g[o + 6] = r; g[o + 7] = gr; g[o + 8] = b; g[o + 9] = inten; g[o + 10] = cut;
      n++;
    };
    const radial = (x: number, y: number, radius: number, r: number, gr: number, b: number, inten: number): void => cone(x, y, 0, 0, 0, radius, r, gr, b, inten);
    // Headlights: each lamp's warm cone, cut where its ray stopped; a lamp that stops at a wall splashes
    // a small pool on it. (The vehicle or person a beam stops at is lit on the sprite layer.)
    for (const b of beams) {
      cone(b.x, b.y, b.fx, b.fy, BEAM_REACH, 0.22, 1.0, 0.92, 0.74, 0.12 * b.mul, b.cut);
      if (b.hit === 'wall') radial(b.x + b.fx * b.cut, b.y + b.fy * b.cut, 0.3, 1.0, 0.92, 0.74, 0.2 * b.mul);
    }
    // Taillights: a red pool behind every moving car and cruiser.
    const tail = (x: number, y: number, hx: number, hy: number, mul: number): void =>
      radial(x - hx * 0.24, y - hy * 0.24, 0.4, 1.0, 0.18, 0.12, 0.16 * mul);
    // The sprite pass's poses for this frame (every mover near the view — a glow from further out can't
    // reach it); posed here only if this pass runs on its own.
    const fp = sharedFramePoses(ambient, alpha);
    const posed = (list: readonly Mover[]): Posed[] => list.map((m) => ({ m, pose: carPose(m, alpha) }));
    if (night > 0.02) {
      for (const { m: c, pose } of fp ? fp.cars : posed(ambient.cars)) {
        if (c.parked) continue;
        tail(pose.x, pose.y, pose.hx, pose.hy, night);
      }
    }
    // Cruisers: a flashing red/blue roof-bar pool (emergency), day and night.
    const blue = Math.floor(timeSec * 1000 / 180) % 2 === 0;
    for (const { pose } of fp ? fp.cruisers : posed(ambient.cruisers)) {
      tail(pose.x, pose.y, pose.hx, pose.hy, Math.max(night, 0.5));
      if (blue) radial(pose.x, pose.y, 0.75, 0.3, 0.45, 1.0, 0.5);
      else radial(pose.x, pose.y, 0.75, 1.0, 0.25, 0.2, 0.5);
    }
    // Fire: a flickering orange firelight over every burning building, day and night; a fire truck's flashing red.
    for (const b of ambient.burning ?? []) {
      const fl = 0.8 + 0.2 * Math.sin(timeSec * 11 + b.x * 1.7 + b.y);
      radial(b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w, b.h) * 0.9 + 1.2, 1.0, 0.5, 0.15, 0.45 * fl);
    }
    // Fire trucks: taillights, and a red/white flashing pool in step with the cruisers', day and night.
    for (const { pose } of posed(ambient.trucks ?? [])) {
      tail(pose.x, pose.y, pose.hx, pose.hy, Math.max(night, 0.5));
      if (blue) radial(pose.x, pose.y, 0.75, 1.0, 0.25, 0.2, 0.5);
      else radial(pose.x, pose.y, 0.75, 1.0, 0.95, 0.9, 0.35);
    }
    // Buildings: RADIAL glow from the light map's actual lit pixels (windows / beacons), not the center.
    for (const bld of buildings) {
      const span = Math.max(bld.w, bld.h);
      const isPower = bld.kind >= 24 && bld.kind <= 30;
      const pts = bld.lit || bld.blink ? { lights: this.pointsOf(bld.lit), blink: this.pointsOf(bld.blink) } : undefined;
      const at = (p: LightPoint): [number, number] => [bld.x + (0.5 + p.ox) * bld.w, bld.y + (0.5 + p.oy) * bld.h];
      if (pts && (isPower || night > 0.02)) {
        for (const p of pts.lights) {
          const [wx, wy] = at(p);
          radial(wx, wy, 0.9, p.r, p.g, p.b, (isPower ? 0.12 : night * 0.16)); // window / furnace glow
        }
      }
      if (pts && isPower) { // blinking red beacon glow, per-building phase
        const hash = (((bld.x * 73856093) ^ (bld.y * 19349663)) >>> 0);
        const period = 420 + (hash % 6) * 90;
        if ((timeSec * 1000 + (hash % period)) % period < period * 0.45) {
          for (const p of pts.blink) { const [wx, wy] = at(p); radial(wx, wy, 1.0, p.r, p.g, p.b, 0.32); }
        }
      } else if (!pts && night > 0.02 && !isPower) {
        radial(bld.x + bld.w / 2, bld.y + bld.h / 2, span * 0.6, 1.0, 0.86, 0.62, night * 0.1); // fallback center glow
      }
    }
    if (n === 0) return;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // additive → glow brightens the ground/sprites around the source
    this.glow.render(g, n, origin, view);
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    if (!this.canvas || !this.gl) return;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Re-pack the world grid (call on a built-layer change / markDirty). The upload happens lazily in
   *  render() via the bridge's dirty-rect; animation needs no repack (it's driven by u_time). */
  invalidate(): void {
    this.bridge.repackAll(this.map);
  }

  render(
    camera: Camera,
    cssWidth: number,
    cssHeight: number,
    timeSec: number,
    base: TexImageSource,
    baseVersion: number,
    patch?: { version: number; rects: readonly { x: number; y: number; w: number; h: number }[] },
  ): void {
    if (!this.shader || !this.gl) return;
    this.shader.uploadDirty(this.bridge);
    // Re-upload the CPU base (the baked per-cell tiles) as the albedo ONLY when it changed (camera
    // move / built edit) — not every frame. The animation runs on the GPU via u_time over this base.
    // A live-mark patch (worn ground, encampments, murk) re-uploads just the rects it re-drew.
    if (baseVersion !== this.lastBaseVersion) {
      this.shader.uploadBase(base);
      this.lastBaseVersion = baseVersion;
      if (patch) this.lastPatchVersion = patch.version;
    } else if (patch && patch.version !== this.lastPatchVersion) {
      this.shader.uploadBaseRects(base, patch.rects);
      this.lastPatchVersion = patch.version;
    }
    this.gl.clearColor(0.078, 0.071, 0.122, 1); // #14121f — matches the Canvas2D base bg out-of-map
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    const { origin, view } = cameraToShaderView(camera, cssWidth, cssHeight);
    this.shader.render({ time: timeSec, sun: SUN, shadow: SHADOW_STRENGTH, origin, view, dayspeed: DAYSPEED });
  }

  /** The CCTV inset: a second viewport drawn into `rect` (device px, GL bottom-left origin) of this canvas, AFTER
   *  the main render + glow — its own camera, its own baked base (the inset's sprite-only 2D renderer bakes it),
   *  and its own light. Scissored, so the main view is untouched outside the rect. */
  renderInset(
    rect: { x: number; y: number; w: number; h: number },
    camera: Camera,
    cssWidth: number,
    cssHeight: number,
    timeSec: number,
    base: TexImageSource,
    baseVersion: number,
    ambient: AmbientState,
    buildings: readonly EmissiveBuilding[] = [],
    beams: readonly HeadlightBeam[] = [],
  ): void {
    const gl = this.gl;
    if (!this.shader || !gl || !this.canvas) return;
    if (baseVersion !== this.lastInsetVersion) {
      this.shader.uploadBase(base, 'inset');
      this.lastInsetVersion = baseVersion;
    }
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(rect.x, rect.y, rect.w, rect.h);
    gl.viewport(rect.x, rect.y, rect.w, rect.h);
    gl.clearColor(0.078, 0.071, 0.122, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const { origin, view } = cameraToShaderView(camera, cssWidth, cssHeight);
    this.shader.render({ time: timeSec, sun: SUN, shadow: SHADOW_STRENGTH, origin, view, dayspeed: DAYSPEED, slot: 'inset' });
    const night = Math.min(1, Math.max(0, (0.8 - dayNightBrightness(timeSec)) / 0.3));
    this.renderGlow(ambient, origin, view, timeSec, night, buildings, beams);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Force a base re-upload on the next render (e.g. after a resize changes the base canvas size). */
  invalidateBase(): void {
    this.lastBaseVersion = -1;
  }


  dispose(): void {
    this.shader?.dispose();
    this.glow?.dispose();
    this.canvas?.remove();
    this.shader = null;
    this.glow = null;
    this.gl = null;
    this.canvas = null;
  }
}
