// GPU smog overlay (part 2 of the hybrid shader — Maddy: "move other effects layers to GPU, especially
// smog, and layer appropriate layers ON TOP of sprites"). A transparent WebGL2 canvas stacked ABOVE the
// Canvas2D sprite/UI canvas (z-index 2 > #game z-index 1 > #gpu-base z-index 0), so the haze drifts over
// buildings AND sprites — the atmospheric layer the CPU drew last in drawSprites, now on the GPU.
//
// It samples the live air-pollution field (uploaded as an RG8 texture from ambient.pollution and a spill's toxic
// smog) and paints pixel-art clouds where the air is bad (buildSmogFragment). Replaces the per-tile CPU smog-sprite draw in
// GPU mode (that path is gated off in the renderer); the CPU path remains the no-WebGL fallback.
//
// IO module (WebGL/DOM) — not on the pure-ui allowlist.
import { buildVertexSource } from './satelliteShader';
import { cameraToShaderView } from './gpuRenderer';
import { ART_GRID_GLSL, artBuffer, type ArtBuffer } from './artGrid';
import type { Camera } from './camera';
import { dayNightBrightness } from './lighting';
import { gameSec } from './gameTime';
import { C } from './snesPalette';
import type { RGB } from './pixelArt';

/** The haze's light: the ground's day/night brightness, never quite black (a haze still catches the street lights). */
const nightLight = (): number => Math.max(0.3, dayNightBrightness(gameSec()));

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`smog shader: ${gl.getShaderInfoLog(s)}`);
  return s;
}

/** Opacity steps of the haze — thin, then thick where the air is worse — and of a spill's toxic cloud. The canvas
 *  is drawn without blending (each pixel written once over a cleared canvas), so these are the opacities seen. */
export const SMOG_ALPHAS = [0.3, 0.46] as const;
export const TOXIC_ALPHAS = [0.62, 0.82] as const;

const glslRgb = (c: RGB): string => `vec3(${c.map((v) => (v / 255).toFixed(4)).join(', ')})`;

/** Fragment: smog and toxic clouds as pixel art (Maddy 2026-10-08). At each art pixel a low-octave noise shape,
 *  drifting a whole art pixel at a time with the wind, is cut by a threshold the pollution there lowers — dirtier
 *  air, more cloud. Inside, the tone is picked like the sprites' (lit from above, shadowed below — by whether the
 *  art pixel above or below is still cloud) from the shared palette, and the opacity is one of two steps. No
 *  colour or opacity is ever blended: hard-edged shapes, three tones. */
export function buildSmogFragment(): string {
  return `#version 300 es
precision highp float;
uniform sampler2D u_poll; // R = air pollution, G = a spill's toxic smog, 0..1 at world cell
uniform vec2 u_grid;      // pollution texture size in cells
uniform vec2 u_origin;    // top-left visible world cell
uniform vec2 u_view;      // visible window size in cells
uniform float u_time;     // seconds
uniform vec2 u_wind;      // prevailing wind (cells/sec-ish direction)
uniform float u_light;    // the day/night light (1 at noon) — haze darkens at night like the ground under it
in vec2 v_uv;
out vec4 fragColor;
${ART_GRID_GLSL}
const vec3 SMOG_HI = ${glslRgb(C.slateHi)};
const vec3 SMOG_MID = ${glslRgb(C.slate)};
const vec3 SMOG_LO = ${glslRgb(C.slateLo)};
const vec3 TOX_HI = ${glslRgb(C.meadowHi)};
const vec3 TOX_MID = ${glslRgb(C.meadow)};
const vec3 TOX_LO = ${glslRgb(C.grassMid)};
float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float lerp(float a,float b,float t){return a+(b-a)*t;}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);
  return lerp(lerp(hash21(i),hash21(i+vec2(1,0)),u.x),lerp(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),u.x),u.y);}
// three octaves only: round, puffy shapes, not single-pixel speckle
float puff(vec2 p){return 0.57*vnoise(p)+0.29*vnoise(p*2.03)+0.14*vnoise(p*4.01);}
vec2 drift;
// pollution at an art pixel, sampled slightly UPWIND so a plume streams downwind from its source
vec2 airAt(vec2 cell){return texture(u_poll, (cell - u_wind * 0.6 + 0.5) / u_grid).rg;}
// how thick the smog (x) and the toxic cloud (y) are at an art pixel: 0 = clear, 1 = thin, 2 = thick
vec2 cloudAt(vec2 cell){
  vec2 air = airAt(cell);
  float sd = clamp((air.r - 0.16) / 0.84, 0.0, 1.0);
  float td = clamp((air.g - 0.04) / 0.35, 0.0, 1.0);
  vec2 q = (cell - drift) * 0.7;
  float s = sd > 0.0 && puff(q) > 0.74 - 0.42 * sd ? (sd > 0.55 ? 2.0 : 1.0) : 0.0;
  float t = td > 0.0 && puff(q * 1.1 + vec2(37.0, 11.0)) > 0.66 - 0.5 * td ? (td > 0.5 ? 2.0 : 1.0) : 0.0;
  return vec2(s, t);
}
void main(){
  drift = floor(u_wind * u_time * 0.6 * ART_PX) / ART_PX;
  vec2 cell = artPixel(u_origin + v_uv * u_view);
  // clean air leaves at once: the cloud noise runs only where there is smog (most of the map, most of the time)
  vec2 air = airAt(cell);
  if (air.r <= 0.16 && air.g <= 0.04) { fragColor = vec4(0.0); return; }
  vec2 here = cloudAt(cell);
  if (here.x == 0.0 && here.y == 0.0) { fragColor = vec4(0.0); return; }
  vec2 up = cloudAt(cell - vec2(0.0, 1.0 / ART_PX));
  vec2 down = cloudAt(cell + vec2(0.0, 1.0 / ART_PX));
  vec3 col;
  float a;
  if (here.y > 0.0) {
    col = up.y == 0.0 ? TOX_HI : down.y == 0.0 ? TOX_LO : TOX_MID;
    a = here.y > 1.0 ? ${TOXIC_ALPHAS[1].toFixed(3)} : ${TOXIC_ALPHAS[0].toFixed(3)};
  } else {
    col = up.x == 0.0 ? SMOG_HI : down.x == 0.0 ? SMOG_LO : SMOG_MID;
    a = here.x > 1.0 ? ${SMOG_ALPHAS[1].toFixed(3)} : ${SMOG_ALPHAS[0].toFixed(3)};
  }
  fragColor = vec4(col * u_light, a);
}`;
}

/** The haze and a spill's smog show only past these field values (the fragment's thresholds, 0..255). */
const SMOG_FROM = 0.16 * 255;
const TOXIC_FROM = 0.04 * 255;

/** Whether any tile's air is dirty enough to draw — when none is, the pass is skipped (the performance pass, Maddy
 *  2026-10-08: the smog was the GPU's costliest pass even over a clear sky). */
export function smogShows(pollution: ReadonlyMap<number, number>, toxic?: ReadonlyMap<number, number>): boolean {
  for (const v of pollution.values()) if (v > SMOG_FROM) return true;
  for (const v of toxic?.values() ?? []) if (v > TOXIC_FROM) return true;
  return false;
}

export class SmogOverlay {
  private gl: WebGL2RenderingContext | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private pollTex: WebGLTexture | null = null;
  private readonly buf: Uint8Array;
  private u: Record<string, WebGLUniformLocation | null> = {};
  /** No smog anywhere: the canvas has been cleared and the pass is skipped until there is some. */
  private clear = false;

  constructor(private readonly mapW: number, private readonly mapH: number) {
    this.buf = new Uint8Array(mapW * mapH * 2); // RG: smog, toxic smog
  }

  /** Create the transparent WebGL2 canvas ABOVE the sprite canvas (z-index 2). Throws if no WebGL2. */
  mount(): void {
    const canvas = document.createElement('canvas');
    canvas.id = 'gpu-smog';
    // one pixel per ART pixel, stretched (sharp) from the map pane's top-left — artBuffer (the performance pass)
    canvas.style.cssText = 'position:fixed;top:var(--topbar-h);left:var(--sidebar-w);display:block;pointer-events:none;z-index:2;image-rendering:pixelated;';
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    document.body.appendChild(canvas);
    this.canvas = canvas;
    this.gl = gl;
    const program = gl.createProgram()!;
    const vs = compile(gl, gl.VERTEX_SHADER, buildVertexSource());
    const fs = compile(gl, gl.FRAGMENT_SHADER, buildSmogFragment());
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`smog link: ${gl.getProgramInfoLog(program)}`);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.program = program;
    this.vao = gl.createVertexArray();
    this.pollTex = gl.createTexture();
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'u_poll'), 0);
    for (const n of ['u_grid', 'u_origin', 'u_view', 'u_time', 'u_wind', 'u_light']) this.u[n] = gl.getUniformLocation(program, n);
    gl.disable(gl.BLEND); // one write per pixel over a cleared canvas: the opacity drawn is the opacity seen
    // R8 pollution texture (LINEAR so the haze gradients smoothly across tiles).
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.pollTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); // RG rows of any width
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, this.mapW, this.mapH, 0, gl.RG, gl.UNSIGNED_BYTE, this.buf);
  }

  /** The pane resized: the buffer follows on the next render (artBuffer — it moves with the zoom too). */
  resize(_cssWidth: number, _cssHeight: number, _dpr: number): void {}

  /** Size the canvas to this view's art-pixel buffer (only when it changed) and return its mapping. */
  private fit(camera: Camera, cssWidth: number, cssHeight: number): ArtBuffer {
    const b = artBuffer(camera, cssWidth, cssHeight);
    const c = this.canvas!;
    if (c.width !== b.w || c.height !== b.h) {
      c.width = b.w;
      c.height = b.h;
      this.clear = false; // a resized canvas starts transparent; re-evaluate
    }
    const cw = `${b.cssW}px`;
    const ch = `${b.cssH}px`;
    if (c.style.width !== cw) c.style.width = cw;
    if (c.style.height !== ch) c.style.height = ch;
    this.gl!.viewport(0, 0, b.w, b.h);
    return b;
  }

  /** Upload the live pollution field + draw the haze for this frame. */
  render(
    camera: Camera,
    cssWidth: number,
    cssHeight: number,
    timeSec: number,
    pollution: ReadonlyMap<number, number>,
    wind: { dx: number; dy: number },
    toxic?: ReadonlyMap<number, number>,
  ): void {
    const gl = this.gl;
    if (!gl || !this.program) return;
    const fitted = this.fit(camera, cssWidth, cssHeight);
    if (!smogShows(pollution, toxic)) {
      if (!this.clear) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        this.clear = true;
      }
      return;
    }
    this.clear = false;
    // Rebuild the smog texture from the live fields (16k cells → cheap): smog in R, a spill's toxic smog in G.
    this.buf.fill(0);
    const n = this.mapW * this.mapH;
    for (const [tile, amt] of pollution) {
      if (tile >= 0 && tile < n) this.buf[tile * 2] = amt > 255 ? 255 : amt < 0 ? 0 : amt;
    }
    for (const [tile, amt] of toxic ?? []) {
      if (tile >= 0 && tile < n) this.buf[tile * 2 + 1] = amt > 255 ? 255 : amt < 0 ? 0 : amt;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.pollTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.mapW, this.mapH, gl.RG, gl.UNSIGNED_BYTE, this.buf);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    const { origin, view } = fitted;
    gl.uniform2f(this.u.u_grid!, this.mapW, this.mapH);
    gl.uniform2f(this.u.u_origin!, origin[0], origin[1]);
    gl.uniform2f(this.u.u_view!, view[0], view[1]);
    gl.uniform1f(this.u.u_time!, timeSec);
    gl.uniform2f(this.u.u_wind!, wind.dx, wind.dy);
    gl.uniform1f(this.u.u_light!, nightLight());
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** The CCTV inset's haze: redraw the smog in `rect` (device px, GL bottom-left origin) through the inset's
   *  camera, reusing the pollution texture the main render() just uploaded. Call right after render(). */
  renderInset(
    rect: { x: number; y: number; w: number; h: number },
    camera: Camera,
    cssWidth: number,
    cssHeight: number,
    timeSec: number,
    wind: { dx: number; dy: number },
  ): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.canvas) return;
    if (this.clear) return; // no smog to show in the inset either
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(rect.x, rect.y, rect.w, rect.h);
    gl.viewport(rect.x, rect.y, rect.w, rect.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.pollTex);
    const { origin, view } = cameraToShaderView(camera, cssWidth, cssHeight);
    gl.uniform2f(this.u.u_grid!, this.mapW, this.mapH);
    gl.uniform2f(this.u.u_origin!, origin[0], origin[1]);
    gl.uniform2f(this.u.u_view!, view[0], view[1]);
    gl.uniform1f(this.u.u_time!, timeSec);
    gl.uniform2f(this.u.u_wind!, wind.dx, wind.dy);
    gl.uniform1f(this.u.u_light!, nightLight());
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      if (this.pollTex) gl.deleteTexture(this.pollTex);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.program) gl.deleteProgram(this.program);
    }
    this.canvas?.remove();
    this.gl = null;
    this.canvas = null;
    this.program = null;
  }
}
