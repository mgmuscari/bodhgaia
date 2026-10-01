// GPU render path (Increment 1 of the hybrid shader): a WebGL2 canvas stacked UNDER the Canvas2D
// sprite/UI canvas. It renders the MAP via the SatelliteShader (procedural pass for now; baked-tile
// albedo is Increment 2), driven by the LIVE camera so it pans/zooms with the game. The Canvas2D
// layer goes transparent (renderer.setGpuMode) and draws only sprites/decorations/UI on top. The CPU
// path stays the no-WebGL fallback. Animations (water/grass/clouds/shadows) run on the GPU here, so
// the per-frame CPU water cost (Maddy's perf hit over large seas) goes away when GPU mode is on.
//
// IO module (touches WebGL/DOM) — not on the pure-ui allowlist.
import { GridTextureBridge } from './gridTextureBridge';
import { SatelliteShader } from './satelliteShader';
import { GlowBatch, GLOW_FLOATS, extractLightPoints } from './glowBatch';
import type { LightPoint } from './glowBatch';
import { DAYSPEED, dayNightBrightness } from './lighting';
import { carPose, ambientAlpha } from './ambientContent';
import type { AmbientState } from './ambientContent';
import type { GameMap } from '../engine/map';
import type { Camera } from './camera';

/** A light-bearing building footprint (world coords) with the skin's emission maps — the renderer collects
 *  these; the glow pass casts a faint window/beacon glow from each lit pixel. */
export type EmissiveBuilding = { x: number; y: number; w: number; h: number; kind: number; lit?: CanvasImageSource; blink?: CanvasImageSource };

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
      'position:fixed;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:0;';
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
  ): void {
    const gl = this.gl;
    if (!gl) return;
    const night = Math.min(1, Math.max(0, (0.8 - dayNightBrightness(timeSec)) / 0.3));
    const { origin, view } = cameraToShaderView(camera, cssWidth, cssHeight);
    this.renderGlow(ambient, origin, view, timeSec, night, buildings);
    gl.disable(gl.BLEND); // leave blend OFF so the next frame's opaque base pass isn't additive
  }

  /** Emissive GLOW: soft additive light cast onto the surrounding tiles (Maddy: "car headlights
   *  illuminating road in front" as a forward CONE; windows/hazard blinkies cast faint glows too).
   *  Headlights = forward cone (night); cruiser bars flash red/blue (radial); building windows a faint
   *  warm pool (night), power plants a faint warm glow + a blinking red beacon glow. Additive (ONE,ONE). */
  private renderGlow(ambient: AmbientState, origin: readonly [number, number], view: readonly [number, number], timeSec: number, night: number, buildings: readonly EmissiveBuilding[]): void {
    const alpha = ambientAlpha(ambient); // interpolate agents between 50 ms substeps
    const gl = this.gl;
    if (!gl || !this.glow) return;
    const cap = ambient.cars.length + ambient.cruisers.length + buildings.length * 2;
    if (this.glowData.length < cap * GLOW_FLOATS) this.glowData = new Float32Array(cap * GLOW_FLOATS);
    const g = this.glowData;
    let n = 0;
    // pos(2) fwd(2) len(1) halfwidth(1) color(3) intensity(1)
    const cone = (x: number, y: number, fx: number, fy: number, len: number, hw: number, r: number, gr: number, b: number, inten: number): void => {
      const o = n * GLOW_FLOATS;
      g[o] = x; g[o + 1] = y; g[o + 2] = fx; g[o + 3] = fy; g[o + 4] = len; g[o + 5] = hw;
      g[o + 6] = r; g[o + 7] = gr; g[o + 8] = b; g[o + 9] = inten;
      n++;
    };
    const radial = (x: number, y: number, radius: number, r: number, gr: number, b: number, inten: number): void => cone(x, y, 0, 0, 0, radius, r, gr, b, inten);
    // A MOVER's lights, SPRITE-RELATIVE: two warm CONES cast forward from the front headlights along the
    // travel direction, + a red taillight pool at the rear. `cx,cy` is the sprite centre (lane-offset
    // included), `fwd` the travel unit, `side` its perpendicular. `mul` scales intensity (cruiser flash).
    const carGlow = (cx: number, cy: number, fwd: { dx: number; dy: number }, mul: number): void => {
      const sx = -fwd.dy;
      const sy = fwd.dx; // perpendicular (the car's lateral axis)
      const fxC = cx + fwd.dx * 0.18;
      const fyC = cy + fwd.dy * 0.18; // front bumper
      cone(fxC + sx * 0.11, fyC + sy * 0.11, fwd.dx, fwd.dy, 1.7, 0.22, 1.0, 0.92, 0.74, 0.12 * mul);
      cone(fxC - sx * 0.11, fyC - sy * 0.11, fwd.dx, fwd.dy, 1.7, 0.22, 1.0, 0.92, 0.74, 0.12 * mul);
      radial(cx - fwd.dx * 0.24, cy - fwd.dy * 0.24, 0.4, 1.0, 0.18, 0.12, 0.16 * mul); // red taillight at the rear
    };
    if (night > 0.02) {
      for (const c of ambient.cars) {
        if (c.parked) continue;
        const pose = carPose(c, alpha);
        carGlow(pose.x, pose.y, { dx: pose.hx, dy: pose.hy }, night);
      }
    }
    // Cruisers: headlights + taillight always, PLUS a flashing red/blue roof-bar pool (emergency).
    const blue = Math.floor(timeSec * 1000 / 180) % 2 === 0;
    for (const c of ambient.cruisers) {
      const pose = carPose(c, alpha);
      const cx = pose.x;
      const cy = pose.y;
      carGlow(cx, cy, { dx: pose.hx, dy: pose.hy }, Math.max(night, 0.5));
      if (blue) radial(cx, cy, 0.75, 0.3, 0.45, 1.0, 0.5);
      else radial(cx, cy, 0.75, 1.0, 0.25, 0.2, 0.5);
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
    shaderLife = true,
  ): void {
    if (!this.shader || !this.gl) return;
    this.shader.uploadDirty(this.bridge);
    // Re-upload the CPU base (the baked per-cell tiles) as the albedo ONLY when it changed (camera
    // move / built edit) — not every frame. The animation runs on the GPU via u_time over this base.
    if (baseVersion !== this.lastBaseVersion) {
      this.shader.uploadBase(base);
      this.lastBaseVersion = baseVersion;
    }
    this.gl.clearColor(0.078, 0.071, 0.122, 1); // #14121f — matches the Canvas2D base bg out-of-map
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    const { origin, view } = cameraToShaderView(camera, cssWidth, cssHeight);
    this.shader.render({ time: timeSec, sun: SUN, shadow: SHADOW_STRENGTH, origin, view, dayspeed: DAYSPEED, motion: shaderLife ? 1 : 0 });
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
