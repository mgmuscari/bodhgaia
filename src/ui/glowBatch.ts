// GPU emissive GLOW (additive light pools cast onto the ground: headlights, cruiser bars, lit windows and
// power-plant beacons), plus the light-point extraction that finds where a skin's emission maps are lit.
//
// IO module (WebGL/DOM) — not on the pure-ui allowlist.

import { ART_PX, ART_GRID_GLSL } from './artGrid';

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`sprite shader: ${gl.getShaderInfoLog(s)}`);
  return s;
}

// ── Glow pass: emissive lights cast a soft ADDITIVE pool onto surrounding tiles (Maddy: "car
//    headlights illuminating road in front"; emissive lights casting glow). Each source is a colored
//    radial falloff quad, blended ONE,ONE over the scene so it brightens the ground + sprites around it.
export const GLOW_FLOATS = 12; // pos(2) fwd(2) len(1) halfwidth(1) color(3) intensity(1) cut(1) [+1 pad]

/** Glow vertex stage: a cone (headlights) or radial (bars, beacons, windows) quad per light source. */
export function buildGlowVertex(): string {
  return `#version 300 es
layout(location=0) in vec2 a_corner;     // unit quad [-1,1]
layout(location=1) in vec2 a_pos;        // world cell (cone origin / radial center)
layout(location=2) in vec2 a_fwd;        // forward unit (travel dir); ignored when a_len==0
layout(location=3) in float a_len;       // cone forward length in cells (0 = radial)
layout(location=4) in float a_halfwidth; // cone half-width at the tip / radial radius
layout(location=5) in vec3 a_color;
layout(location=6) in float a_intensity;
layout(location=7) in float a_cut;       // a cone stops here (where its headlight hit something)
uniform vec2 u_origin; uniform vec2 u_view;
const float ART_PX = ${ART_PX.toFixed(1)};
out vec2 v_world; out vec3 v_color; out float v_int;
flat out vec2 v_pos; flat out vec2 v_fwd; flat out float v_len; flat out float v_hw; flat out float v_cut;
void main(){
  // the source sits on the art grid, like the sprite casting it (renderer.drawArt rounds to art pixels);
  // the quad grows by an art pixel so the per-art-pixel falloff is never clipped mid-pixel
  vec2 pos = round(a_pos * ART_PX) / ART_PX;
  float grow = 1.0 / ART_PX;
  vec2 world;
  if (a_len > 0.0) {
    vec2 side = vec2(-a_fwd.y, a_fwd.x);
    float t = (a_corner.y + 1.0) * 0.5;            // 0 at the car .. 1 at the cone tip
    float w = mix(a_halfwidth * 0.22, a_halfwidth, t);
    world = pos + a_fwd * (t * (a_len + grow) - grow * 0.5) + side * (a_corner.x * (w + grow));
  } else {
    world = pos + a_corner * (a_halfwidth + grow);
  }
  vec2 ndc = ((world - u_origin)/u_view)*2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  v_world = world; v_color = a_color; v_int = a_intensity;
  v_pos = pos; v_fwd = a_fwd; v_len = a_len; v_hw = a_halfwidth; v_cut = a_cut;
}`;
}

/** Glow fragment stage: the falloff from the TRUE geometry (lateral distance from the cone centerline —
 *  symmetric, unlike an interpolated corner attribute), evaluated once per art pixel. */
export function buildGlowFragment(): string {
  return `#version 300 es
precision highp float;
in vec2 v_world; in vec3 v_color; in float v_int;
flat in vec2 v_pos; flat in vec2 v_fwd; flat in float v_len; flat in float v_hw; flat in float v_cut;
out vec4 fragColor;
${ART_GRID_GLSL}
void main(){
  vec2 rel = artPixel(v_world) - v_pos; // one light value per art pixel
  float fall;
  if (v_len > 0.0) {
    float fd = dot(rel, v_fwd);                       // distance ahead along travel
    float t = fd / v_len;
    if (t < 0.0 || t > 1.0 || fd > v_cut) discard;      // stopped by what the beam hit
    vec2 side = vec2(-v_fwd.y, v_fwd.x);
    float hw = mix(v_hw * 0.22, v_hw, t);
    float lf = dot(rel, side) / hw;                   // lateral fraction from the centerline (symmetric)
    fall = (1.0 - clamp(abs(lf), 0.0, 1.0)) * smoothstep(1.0, 0.0, t);
  } else {
    float d = length(rel) / max(v_hw, 1e-4);
    fall = smoothstep(1.0, 0.0, d); fall *= fall;
  }
  fragColor = vec4(v_color * v_int * fall, 1.0);
}`;
}

export class GlowBatch {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private quad: WebGLBuffer;
  private inst: WebGLBuffer;
  private cap = 0;
  private readonly u: Record<string, WebGLUniformLocation | null> = {};

  constructor(private readonly gl: WebGL2RenderingContext) {
    // Two glow shapes: a forward CONE (headlights — cast ahead along travel, narrow at the car, widening
    // and fading with distance) when a_len>0, else a RADIAL falloff (cruiser/beacon) using a_halfwidth.
    // The falloff is computed in the fragment from the TRUE world geometry (lateral distance from the
    // cone's actual centerline), NOT from an interpolated corner attribute — a trapezoid drawn as two
    // triangles interpolates a corner attribute asymmetrically across the centerline (one side brighter
    // than the other — Maddy). Measuring lateral offset from the centerline per-pixel is symmetric.
    const vs = buildGlowVertex();
    const fs = buildGlowFragment();
    const program = gl.createProgram()!;
    const v = compile(gl, gl.VERTEX_SHADER, vs);
    const f = compile(gl, gl.FRAGMENT_SHADER, fs);
    gl.attachShader(program, v); gl.attachShader(program, f); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`glow link: ${gl.getProgramInfoLog(program)}`);
    gl.deleteShader(v); gl.deleteShader(f);
    this.program = program;
    for (const n of ['u_origin', 'u_view']) this.u[n] = gl.getUniformLocation(program, n);
    this.vao = gl.createVertexArray()!;
    this.quad = gl.createBuffer()!;
    this.inst = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    const stride = GLOW_FLOATS * 4;
    const ptr = (loc: number, size: number, off: number): void => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4); gl.vertexAttribDivisor(loc, 1); };
    ptr(1, 2, 0); ptr(2, 2, 2); ptr(3, 1, 4); ptr(4, 1, 5); ptr(5, 3, 6); ptr(6, 1, 9); ptr(7, 1, 10);
    gl.bindVertexArray(null);
  }

  render(data: Float32Array, count: number, origin: readonly [number, number], view: readonly [number, number]): void {
    if (count <= 0) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    if (count > this.cap) { this.cap = Math.ceil(count * 1.5); gl.bufferData(gl.ARRAY_BUFFER, this.cap * GLOW_FLOATS * 4, gl.DYNAMIC_DRAW); }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, count * GLOW_FLOATS));
    gl.uniform2f(this.u.u_origin!, origin[0], origin[1]);
    gl.uniform2f(this.u.u_view!, view[0], view[1]);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.quad);
    gl.deleteBuffer(this.inst);
  }
}

/** A bright emissive point in a light map, in sprite-LOCAL offset space (ox,oy ∈ [-0.5,0.5] from the
 *  sprite/footprint center; oy<0 = toward the FRONT/top) with its colour. */
export interface LightPoint { ox: number; oy: number; r: number; g: number; b: number; }

/** Extract the bright emissive points from a light map so glow can be cast from the ACTUAL lit pixels
 *  (headlights, windows, beacons) rather than the tile center (Maddy). Downsamples to `grid`², keeps the
 *  brightest cells above `threshold` with non-max suppression (so two headlights → two points). */
export function extractLightPoints(img: CanvasImageSource, grid = 8, threshold = 0.32, maxPts = 4): LightPoint[] {
  try {
    const c = document.createElement('canvas');
    c.width = grid; c.height = grid;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, grid, grid);
    const d = ctx.getImageData(0, 0, grid, grid).data;
    const cells: { i: number; j: number; b: number; r: number; g: number; bl: number }[] = [];
    for (let j = 0; j < grid; j++) {
      for (let i = 0; i < grid; i++) {
        const o = (j * grid + i) * 4;
        const a = d[o + 3]! / 255;
        const bright = (Math.max(d[o]!, d[o + 1]!, d[o + 2]!) / 255) * a;
        if (bright >= threshold) cells.push({ i, j, b: bright, r: d[o]!, g: d[o + 1]!, bl: d[o + 2]! });
      }
    }
    cells.sort((p, q) => q.b - p.b);
    const pts: LightPoint[] = [];
    const taken: { i: number; j: number }[] = [];
    for (const cell of cells) {
      if (pts.length >= maxPts) break;
      if (taken.some((t) => Math.abs(t.i - cell.i) <= 1 && Math.abs(t.j - cell.j) <= 1)) continue; // non-max suppress
      taken.push({ i: cell.i, j: cell.j });
      pts.push({ ox: (cell.i + 0.5) / grid - 0.5, oy: (cell.j + 0.5) / grid - 0.5, r: cell.r / 255, g: cell.g / 255, b: cell.bl / 255 });
    }
    return pts;
  } catch {
    return [];
  }
}
