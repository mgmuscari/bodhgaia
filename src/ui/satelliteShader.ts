// GPU lighting pass — WebGL2 (the name is historical: it began as the satellite skin's shader). A single
// fragment pass samples the CPU-baked pixel-art base as albedo and the packed world (GridTextureBridge →
// u_data) for per-cell building height, and adds only LIGHT and the water's lap: the day/night sun arc, short
// raymarched contact shadows, the building light baked with the base (windows by night, furnaces always), and
// water tiles shifting a couple of art pixels in a checker (the flood's rhythm). Nothing else is animated here.
//
// Not allowlisted as pure-UI: it holds the WebGL2 program. The GLSL *source builders* below are pure
// (no GL/DOM) so the CPU↔GPU enum contract is unit-testable; the GL class is browser-only.
import { SatType } from './satelliteFormat';
import { ART_GRID_GLSL } from './artGrid';
import { GridTextureBridge } from './gridTextureBridge';

/** How far (tiles) a building's shadow reaches across the ground — short contact shadows (Maddy
 *  2026-09-30: the long dawn/dusk shadows read far too long for the buildings). */
export const SHADOW_REACH = 1.0;

/** `#define SAT_<NAME> <value>` for every SatType — keeps the GLSL switch in sync with the TS enum. */
export function glslDefines(): string {
  return [
    ...Object.entries(SatType).map(([name, value]) => `#define SAT_${name.toUpperCase()} ${value}`),
    `#define SHADOW_REACH ${SHADOW_REACH.toFixed(3)}`,
  ].join('\n');
}

/** Fullscreen-triangle vertex stage (no attributes; gl_VertexID drives it). v_uv spans 0..1. */
export function buildVertexSource(): string {
  return `#version 300 es
out vec2 v_uv;
const vec2 VERTS[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
  vec2 p = VERTS[gl_VertexID];
  v_uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); // flip Y so cell (0,0) is top-left
  gl_Position = vec4(p, 0.0, 1.0);
}`;
}

/** The procedural-synthesis + raymarched-shadow fragment stage. */
export function buildFragmentSource(): string {
  return `#version 300 es
precision highp float;
${glslDefines()}

uniform sampler2D u_data; // packed world: R=type G=height/band/class B=adjacency A=free (always 0)
uniform sampler2D u_base; // the CPU-rendered base (terrain+buildings+roads+all markings) — the albedo
uniform sampler2D u_emitN; // building light baked with the base: lit windows (on at night)…
uniform sampler2D u_emitA; // …and power plants' furnaces (always on)
uniform float u_night;     // 0 day … 1 night: how much the windows show
uniform float u_emitOn;    // 1 when the emission layers are uploaded for this view
uniform vec2 u_grid;      // data-texture size in cells (for sampling normalization)
uniform vec2 u_origin;    // top-left visible world cell (camera pan)
uniform vec2 u_view;      // visible window size in cells (camera zoom)
uniform float u_time;     // seconds, for the day/night sun arc
uniform vec2 u_sun;       // sun direction in tile space (shadows trace toward it)
uniform float u_shadow;   // shadow strength 0..1
uniform float u_dayspeed; // >0 slowly rotates the sun (day/night sweep); 0 = fixed

in vec2 v_uv;
out vec4 fragColor;

${ART_GRID_GLSL}
const float WATER_LAP_S = 0.7;  // the flood's wave rhythm
const float WATER_LAP_PX = 2.0; // art pixels the crests lap
vec4 cell(vec2 c) { return texture(u_data, (c + 0.5) / u_grid); }
void main() {
  vec2 g = u_origin + v_uv * u_view; // screen UV → world cell space (camera pan/zoom)
  if (g.x < 0.0 || g.y < 0.0 || g.x >= u_grid.x || g.y >= u_grid.y) {
    fragColor = vec4(0.04, 0.05, 0.06, 1.0); // letterbox backdrop outside the world
    return;
  }
  // ALBEDO = the CPU-baked per-cell pixel art (terrain + building + lines/markings/props already
  // composited by the CPU base pass), unanimated — the GPU adds only light: day/night and shadows.
  vec3 col = texture(u_base, v_uv).rgb;
  vec2 ga = artPixel(g); // light is evaluated once per ART pixel, never across one
  int type = int(cell(floor(ga)).r * 255.0 + 0.5); // this cell's kind (roofs take no cast shadow)
  // Water laps (Maddy 2026-10-08: the water tiles animated the way the flood is): per tile in a checker, every
  // WATER_LAP_S the art alternates with itself shifted WATER_LAP_PX art pixels, so the wave crests lap back and
  // forth — taken only where the shifted pixel is water too, so a shore never smears into the bay.
  if (type == SAT_WATER) {
    vec2 wc = floor(ga);
    if (mod(floor(u_time / WATER_LAP_S) + wc.x + wc.y, 2.0) > 0.5) {
      vec2 lap = vec2(WATER_LAP_PX / ART_PX, 0.0);
      // a whole number of base texels (device pixels): at a fractional display scale 2 art px is not one, and a
      // part-texel shift smeared the water as it lapped (Maddy 2026-10-08)
      vec2 baseTexels = vec2(textureSize(u_base, 0));
      vec2 shift = floor(lap / u_view * baseTexels + 0.5) / baseTexels;
      if (int(cell(floor(ga + lap)).r * 255.0 + 0.5) == SAT_WATER) col = texture(u_base, v_uv + shift).rgb;
    }
  }

  // Day/night: the sun ARCS east→west across the sky (NOT a full orbit around the map — that read as
  // flat-earth, Maddy). Altitude = sin(day): >0 daytime, <0 night. Azimuth sweeps via cos(day), with a
  // fixed downward bias so shadows fall consistently. Shadows lengthen at dawn/dusk + vanish at night;
  // the scene dims + cools toward night. With dayspeed 0 the sun is a fixed mid-morning (no cycle).
  vec2 sun = u_sun;
  float shadowStrength = u_shadow;
  float shadowLen = 1.0;
  float alt = 1.0;
  if (u_dayspeed > 0.0) {
    float day = u_time * u_dayspeed;
    alt = sin(day);
    float dayAmt = clamp(alt, 0.0, 1.0);
    sun = vec2(cos(day), -0.55);                 // azimuth arcs E↔W; downward bias
    shadowStrength = u_shadow * dayAmt;          // soft → none at night
    shadowLen = mix(0.6, 1.0, 1.0 - dayAmt);     // a little longer when the sun is low — never past a tile
  }
  // Soft CONTACT shadows: march a few sub-tile steps toward the sun from THIS art pixel (not its cell), at
  // most SHADOW_REACH tiles; the nearest building found darkens it by a falloff that fades to nothing
  // at the reach, scaled by the building's height — a short, diffuse gradient on the lee side. Roofs
  // are skipped (the art carries its own drop shadows).
  float shadow = 1.0;
  bool onBuilding = type >= SAT_RESIDENTIAL && type <= SAT_POWER;
  if (!onBuilding) {
    vec2 stepv = normalize(sun);
    for (int i = 1; i <= 6; i++) {
      float d = float(i) / 6.0 * SHADOW_REACH * shadowLen;
      vec2 sc = floor(ga + stepv * d);
      if (sc.x < 0.0 || sc.y < 0.0 || sc.x >= u_grid.x || sc.y >= u_grid.y) break;
      vec4 nd = cell(sc);
      int nt = int(nd.r * 255.0 + 0.5);
      if (nt >= SAT_RESIDENTIAL && nt <= SAT_POWER) {
        float tall = clamp(nd.g * 255.0 / 96.0, 0.35, 1.0);
        float fall = 1.0 - smoothstep(0.0, SHADOW_REACH * shadowLen, d);
        shadow = 1.0 - shadowStrength * tall * fall;
        break;
      }
    }
  }
  col *= shadow;
  if (u_dayspeed > 0.0) {
    col *= mix(0.45, 1.0, smoothstep(-0.2, 0.3, alt));          // dusk/night dim
    col = mix(col, col * vec3(0.72, 0.8, 1.06), clamp(-alt, 0.0, 1.0) * 0.6); // cool blue at night
  }

  // Building light (Maddy 2026-10-08: building lights on the GPU): the windows and furnaces baked with the base,
  // added AFTER the night's dimming, so a lit window glows on a dark street
  if (u_emitOn > 0.5) {
    vec4 en = texture(u_emitN, v_uv);
    vec4 ea = texture(u_emitA, v_uv);
    col += en.rgb * en.a * u_night + ea.rgb * ea.a;
  }
  fragColor = vec4(col, 1.0);
}`;
}

// ── WebGL2 program ───────────────────────────────────────────────────────────

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`satellite shader compile failed: ${log}`);
  }
  return sh;
}

/** Owns the WebGL2 program, the empty VAO (gl_VertexID), and the RGBA8 data texture. */
export class SatelliteShader {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly tex: WebGLTexture;
  private readonly baseTex: WebGLTexture;
  /** A second albedo for a second viewport (the CCTV inset) — its own camera, its own baked base. */
  private readonly insetBaseTex: WebGLTexture;
  private readonly emitNTex: WebGLTexture;
  private readonly emitATex: WebGLTexture;
  private readonly uNight: WebGLUniformLocation | null;
  private readonly uEmitOn: WebGLUniformLocation | null;
  private emitReady = false;
  private readonly uGrid: WebGLUniformLocation | null;
  private readonly uOrigin: WebGLUniformLocation | null;
  private readonly uView: WebGLUniformLocation | null;
  private readonly uTime: WebGLUniformLocation | null;
  private readonly uSun: WebGLUniformLocation | null;
  private readonly uShadow: WebGLUniformLocation | null;
  private readonly uDayspeed: WebGLUniformLocation | null;
  private gridW = 0;
  private gridH = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const program = gl.createProgram()!;
    const vs = compile(gl, gl.VERTEX_SHADER, buildVertexSource());
    const fs = compile(gl, gl.FRAGMENT_SHADER, buildFragmentSource());
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`satellite shader link failed: ${gl.getProgramInfoLog(program)}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.program = program;
    this.vao = gl.createVertexArray()!;
    this.tex = gl.createTexture()!;
    this.baseTex = gl.createTexture()!;
    this.insetBaseTex = gl.createTexture()!;
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'u_data'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'u_base'), 1); // the CPU base albedo on texture unit 1
    gl.uniform1i(gl.getUniformLocation(program, 'u_emitN'), 2); // building light: windows (unit 2)…
    gl.uniform1i(gl.getUniformLocation(program, 'u_emitA'), 3); // …and furnaces (unit 3)
    this.emitNTex = gl.createTexture()!;
    this.emitATex = gl.createTexture()!;
    this.uNight = gl.getUniformLocation(program, 'u_night');
    this.uEmitOn = gl.getUniformLocation(program, 'u_emitOn');
    this.uGrid = gl.getUniformLocation(program, 'u_grid');
    this.uOrigin = gl.getUniformLocation(program, 'u_origin');
    this.uView = gl.getUniformLocation(program, 'u_view');
    this.uTime = gl.getUniformLocation(program, 'u_time');
    this.uSun = gl.getUniformLocation(program, 'u_sun');
    this.uShadow = gl.getUniformLocation(program, 'u_shadow');
    this.uDayspeed = gl.getUniformLocation(program, 'u_dayspeed');
  }

  /** (Re)upload the entire packed grid as the data texture. Sizes the texture on first call. */
  uploadFull(bridge: GridTextureBridge): void {
    const gl = this.gl;
    this.gridW = bridge.width;
    this.gridH = bridge.height;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, bridge.width, bridge.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bridge.data);
    bridge.consumeDirty();
  }

  /** Upload only the bridge's dirty sub-rectangle via texSubImage2D (UNPACK_* offsets into the full buffer). */
  uploadDirty(bridge: GridTextureBridge): void {
    const rect = bridge.consumeDirty();
    if (!rect) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, bridge.width);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, rect.x);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, rect.y);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, rect.x, rect.y, rect.w, rect.h, gl.RGBA, gl.UNSIGNED_BYTE, bridge.data);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  }

  /** Upload the CPU base canvas (the baked per-cell tiles) as the albedo texture (unit 1). Call only
   *  when the base changed (camera move / built edit) — not every frame. Canvas row 0 (top) → texture
   *  row 0, matching v_uv.y=0=top (no Y-flip). NEAREST: the base is the screen's own pixels, and the water's lap
   *  shifts it by whole texels — a blend would only smear the art. */
  uploadBase(src: TexImageSource, slot: 'main' | 'inset' = 'main'): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, slot === 'inset' ? this.insetBaseTex : this.baseTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }

  /** Upload the building light baked with the base (Renderer.emissionLayers): windows and furnaces, each the base's
   *  size. NEAREST — every lit window is a whole art pixel. */
  uploadEmission(night: TexImageSource, always: TexImageSource): void {
    const gl = this.gl;
    for (const [unit, tex, src] of [[gl.TEXTURE2, this.emitNTex, night], [gl.TEXTURE3, this.emitATex, always]] as const) {
      gl.activeTexture(unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    }
    this.emitReady = true;
  }

  /** Re-upload just these rects of the CPU base (a live-mark patch): the same texture, sub-images in place. */
  uploadBaseRects(src: TexImageSource, rects: readonly { x: number; y: number; w: number; h: number }[]): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.baseTex);
    for (const r of rects) {
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, r.x);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, r.y);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, r.w, r.h, gl.RGBA, gl.UNSIGNED_BYTE, src);
    }
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  }

  /**
   * Draw the full-screen pass: sample the CPU base albedo (unit 1) and light it — day/night, contact shadows, the
   * water's lap, the building light (units 2–3). `origin`/`view` are the visible world window in cells (camera pan/zoom);
   * both default to the full grid. `sun` need not be normalized.
   */
  render(opts: {
    time: number;
    sun: readonly [number, number];
    shadow?: number;
    origin?: readonly [number, number];
    view?: readonly [number, number];
    dayspeed?: number;
    /** Which baked base to sample: the main view's (default) or the CCTV inset's. */
    slot?: 'main' | 'inset';
    /** 0 day … 1 night: how much the lit windows show (main view only). */
    night?: number;
  }): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, opts.slot === 'inset' ? this.insetBaseTex : this.baseTex);
    if (this.uGrid) gl.uniform2f(this.uGrid, this.gridW, this.gridH);
    if (this.uOrigin) gl.uniform2f(this.uOrigin, opts.origin?.[0] ?? 0, opts.origin?.[1] ?? 0);
    if (this.uView) gl.uniform2f(this.uView, opts.view?.[0] ?? this.gridW, opts.view?.[1] ?? this.gridH);
    if (this.uTime) gl.uniform1f(this.uTime, opts.time);
    if (this.uSun) gl.uniform2f(this.uSun, opts.sun[0], opts.sun[1]);
    if (this.uShadow) gl.uniform1f(this.uShadow, opts.shadow ?? 0.45);
    if (this.uDayspeed) gl.uniform1f(this.uDayspeed, opts.dayspeed ?? 0);
    const emit = this.emitReady && opts.slot !== 'inset'; // the inset draws its own windows on the CPU
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.emitNTex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.emitATex);
    if (this.uEmitOn) gl.uniform1f(this.uEmitOn, emit ? 1 : 0);
    if (this.uNight) gl.uniform1f(this.uNight, opts.night ?? 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.tex);
    gl.deleteTexture(this.baseTex);
    gl.deleteTexture(this.insetBaseTex);
    gl.deleteTexture(this.emitNTex);
    gl.deleteTexture(this.emitATex);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}
