// App shell: the map view — the camera, the Canvas2D renderer (the code-painted Super skin), the optional GPU
// hybrid (a WebGL2 map canvas under it + the smog overlay above it), the map-pane size, and the two dirty
// chokepoints every other controller repaints through.
//
// Two named dirty chokepoints (CRITIC-YP2). markDirty invalidates the cached renderer base (map/camera/overlay
// changed); markPreviewDirty only requests a repaint (preview/selection changed — it lives in the per-frame
// composite, not the base, so a hover never triggers an O(visible-tiles) base rebuild). Forward rule: a
// base/camera/overlay change calls markDirty(); a preview/selection-only change calls markPreviewDirty().

import type { GameMap } from '../engine/map';
import { BuiltKind } from '../engine/fabric';
import { Camera } from '../ui/camera';
import { Renderer } from '../ui/renderer';
import { GpuRenderer } from '../ui/gpuRenderer';
import { SmogOverlay } from '../ui/smogOverlay';
import { mapPane, layoutVars } from '../ui/layout';
import { materializeSkin } from '../ui/tilesetLoader';
import { paintSnesSkin } from '../ui/snesTileset';
import { footprintCellKey } from '../ui/renderKey';
import type { RendererMode } from '../ui/settings';
import { setPixelFavicon } from './devHandle';

export interface ViewDeps {
  canvas: HTMLCanvasElement;
  map: GameMap;
  /** A resumed game's camera (else the default zoom, centred). */
  camera?: { x?: number; y?: number; zoom?: number };
  /** settings.renderer: 'gpu' mounts the WebGL2 hybrid (falling back to the CPU path if it is unavailable). */
  mode: RendererMode;
}

export interface View {
  readonly camera: Camera;
  readonly renderer: Renderer;
  /** The GPU map / smog overlay, or null on the CPU path (they are re-created on a renderer switch). */
  gpu(): GpuRenderer | null;
  smog(): SmogOverlay | null;
  /** The map pane, in CSS px (the window less the docked palette). */
  width(): number;
  height(): number;
  markDirty(): void;
  markPreviewDirty(): void;
  /** Whether a repaint was requested since the last `clean()`. */
  isDirty(): boolean;
  clean(): void;
  mountGpu(): boolean;
  unmountGpu(): void;
  /** The Settings renderer switch. */
  setMode(mode: RendererMode): void;
  /** The window resized: the pane, the camera viewport and every canvas follow. */
  resize(): void;
}

export function createView(deps: ViewDeps): View {
  const { canvas, map } = deps;
  const dpr = (): number => window.devicePixelRatio || 1;
  // the map pane sits right of the docked tool palette, never under it
  // the map pane sits inside the chrome (top bar, palette, status line) — never under it
  for (const [k, v] of Object.entries(layoutVars())) document.documentElement.style.setProperty(k, v);
  let cssWidth = mapPane(window.innerWidth, window.innerHeight).width;
  let cssHeight = mapPane(window.innerWidth, window.innerHeight).height;
  const camera = new Camera({
    mapWidth: map.width,
    mapHeight: map.height,
    viewportWidth: cssWidth,
    viewportHeight: cssHeight,
    zoom: deps.camera?.zoom ?? 2,
    x: deps.camera?.x,
    y: deps.camera?.y,
  });

  // The one aesthetic (Maddy 2026-09-30): the code-painted Super (16-bit) skin, materialized before the
  // first frame (eager tiles now, buildings + light maps on first draw).
  const skin = materializeSkin(paintSnesSkin());
  const renderer = new Renderer(canvas, skin);
  setPixelFavicon(skin.lazy?.get(footprintCellKey(BuiltKind.HouseSingle, 1, 1, 0, 0, 0)));
  renderer.resize(cssWidth, cssHeight, dpr());
  canvas.style.position = 'fixed'; // the map pane, ABOVE the GPU canvas (z-index 0)
  canvas.style.left = 'var(--sidebar-w)';
  canvas.style.top = 'var(--topbar-h)';
  canvas.style.zIndex = '1';

  // GPU hybrid path: a WebGL2 canvas under the Canvas2D sprite/UI layer, driven by the live camera.
  // mountGpu falls back to the CPU path (returns false) if WebGL2 is unavailable.
  let gpuRenderer: GpuRenderer | null = null;
  let smogOverlay: SmogOverlay | null = null;
  const mountGpu = (): boolean => {
    try {
      gpuRenderer = new GpuRenderer(map);
      gpuRenderer.mount();
      gpuRenderer.resize(cssWidth, cssHeight, dpr());
      // GPU smog overlay (z2, above the sprite canvas) — the atmospheric haze on top of everything.
      smogOverlay = new SmogOverlay(map.width, map.height);
      smogOverlay.mount();
      smogOverlay.resize(cssWidth, cssHeight, dpr());
      renderer.setGpuMode(true);
      return true;
    } catch (e) {
      console.warn('WebGL2 unavailable — staying on the CPU renderer:', e);
      gpuRenderer?.dispose();
      smogOverlay?.dispose();
      gpuRenderer = null;
      smogOverlay = null;
      return false;
    }
  };
  const unmountGpu = (): void => {
    gpuRenderer?.dispose();
    smogOverlay?.dispose();
    gpuRenderer = null;
    smogOverlay = null;
    renderer.setGpuMode(false);
  };
  if (deps.mode === 'gpu') mountGpu();

  let dirty = true;
  const markDirty = (): void => {
    dirty = true;
    renderer.invalidateBase();
    gpuRenderer?.invalidate(); // re-pack the world grid for the GPU path (cheap dirty-rect upload)
  };

  return {
    camera,
    renderer,
    gpu: () => gpuRenderer,
    smog: () => smogOverlay,
    width: () => cssWidth,
    height: () => cssHeight,
    markDirty,
    markPreviewDirty: () => {
      dirty = true;
    },
    isDirty: () => dirty,
    clean: () => {
      dirty = false;
    },
    mountGpu,
    unmountGpu,
    setMode: (mode) => {
      if (mode === 'gpu') {
        if (!gpuRenderer) mountGpu();
      } else {
        unmountGpu();
      }
      markDirty();
    },
    resize: () => {
      cssWidth = mapPane(window.innerWidth, window.innerHeight).width;
      cssHeight = mapPane(window.innerWidth, window.innerHeight).height;
      camera.setViewport(cssWidth, cssHeight);
      renderer.resize(cssWidth, cssHeight, dpr());
      gpuRenderer?.resize(cssWidth, cssHeight, dpr());
      smogOverlay?.resize(cssWidth, cssHeight, dpr());
      gpuRenderer?.invalidateBase(); // base canvas resized → re-upload it next frame
      markDirty();
    },
  };
}
