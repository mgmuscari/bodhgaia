// App shell: the tab favicon and the DEV-only `window.bodhgaia` live-pass hook (DOM allowed).
// The hook reads mutable app state (the power grid, the GPU renderer) through GETTERS passed in by
// main.ts, never through captured snapshots — main reassigns those, and a handle must see the current one.

import type { Camera } from '../ui/camera';
import type { WorldState } from '../worldgen/pipeline';
import type { AmbientState } from '../live/types';
import type { TechState } from '../tech/state';
import type { PowerGrid } from '../growth/power';

/** The tab icon is one of the game's own painted tiles (a house), scaled up nearest-neighbour. */
export function setPixelFavicon(tile: CanvasImageSource | undefined): void {
  if (!tile) return;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tile, 0, 0, 32, 32);
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.head.appendChild(document.createElement('link'));
  link.rel = 'icon';
  link.href = c.toDataURL('image/png');
}

export interface DevHandleDeps {
  camera: Camera;
  world: WorldState;
  ambient: AmbientState;
  tech: TechState;
  /** The current power grid (main re-solves it every in-game hour). */
  power: () => PowerGrid;
  /** Invalidate the cached render base (camera/map changed). */
  markDirty: () => void;
  /** The GPU renderer controls: whether it is mounted, mount (false on no WebGL2), unmount. */
  gpu: { isOn: () => boolean; mount: () => boolean; unmount: () => void };
}

/**
 * Dev / live-pass affordance: a small global to drive the camera and inspect live state from outside the
 * input layer (e.g. screenshot tooling that needs to focus a location). `zoomTo` mirrors the input path —
 * move the camera, then markDirty so the cached base rebuilds at the new view. `camera`/`world`/`ambient`
 * are exposed read handles (the running app's actual objects) so a live pass need not rebuild the world
 * in-page. DEV BUILDS ONLY: call it under `import.meta.env.DEV` (Vite folds that to false in production,
 * so the call — and its handles on live state — is stripped from the shipped bundle); it also no-ops there.
 */
export function installDevHandle(deps: DevHandleDeps): void {
  if (!import.meta.env.DEV) return;
  const { camera, world, ambient, tech, power, markDirty, gpu } = deps;
  (window as unknown as Record<string, unknown>).bodhgaia = {
    zoomTo: (wx: number, wy: number, zoom?: number): void => {
      camera.centerOn(wx, wy, zoom);
      markDirty();
    },
    toggleGpu: (): boolean => {
      if (gpu.isOn()) {
        gpu.unmount();
        markDirty();
        return false;
      }
      const ok = gpu.mount();
      markDirty();
      return ok;
    },
    gpuOn: (): boolean => gpu.isOn(),
    camera,
    world,
    ambient,
    tech,
    power,
  };
}
