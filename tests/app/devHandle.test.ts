import { describe, it, expect, afterEach } from 'vitest';
import { installDevHandle, type DevHandleDeps } from '../../src/app/devHandle';
import type { PowerGrid } from '../../src/growth/power';

// The hook must read main's REASSIGNED state (power grid, GPU renderer) through getters at call time —
// a captured snapshot would go stale the first time main re-solves the grid or toggles the GPU.
describe('installDevHandle (dev builds)', () => {
  const g = globalThis as unknown as { window?: Record<string, unknown> };
  afterEach(() => {
    delete g.window;
  });

  it('exposes live getters and drives the GPU toggle through the deps', () => {
    g.window = {};
    let grid = { capacity: 1 } as unknown as PowerGrid;
    let gpuOn = false;
    let dirty = 0;
    const centered: unknown[] = [];
    const deps = {
      camera: { centerOn: (...a: unknown[]) => centered.push(a) },
      world: {},
      ambient: {},
      tech: {},
      power: () => grid,
      markDirty: () => dirty++,
      gpu: {
        isOn: () => gpuOn,
        mount: () => (gpuOn = true),
        unmount: () => {
          gpuOn = false;
        },
      },
    } as unknown as DevHandleDeps;
    installDevHandle(deps);
    const h = g.window.bodhitropolis as {
      power: () => PowerGrid;
      gpuOn: () => boolean;
      toggleGpu: () => boolean;
      zoomTo: (x: number, y: number, z?: number) => void;
    };

    grid = { capacity: 2 } as unknown as PowerGrid; // main re-solves the grid
    expect(h.power().capacity).toBe(2);

    expect(h.gpuOn()).toBe(false);
    expect(h.toggleGpu()).toBe(true);
    expect(h.gpuOn()).toBe(true);
    expect(h.toggleGpu()).toBe(false);
    expect(h.gpuOn()).toBe(false);
    expect(dirty).toBe(2);

    h.zoomTo(10, 20, 3);
    expect(centered).toEqual([[10, 20, 3]]);
    expect(dirty).toBe(3);
  });
});
