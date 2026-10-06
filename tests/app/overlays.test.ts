import { describe, it, expect } from 'vitest';
import { createOverlayController } from '../../src/app/overlays';
import { OVERLAYS, type OverlayContext } from '../../src/ui/overlayRegistry';
import type { OverlayLegend } from '../../src/ui/overlayLegend';
import { GameMap } from '../../src/engine/map';
import { ParcelStore } from '../../src/engine/fabric';

// The overlay controller owns the single active overlay: the key/dock cycle, the renderer's base + live
// overlay, the dock status caption and the colour key, and the sim-cadence re-push. Headless: the legend
// widget and renderer arrive as deps.
function setup() {
  const map = new GameMap(4, 2);
  let contexts = 0;
  const ctx = (): OverlayContext => {
    contexts++;
    return {
      map,
      parcels: new ParcelStore(),
      live: { pollution: new Map(), groundPollution: new Map(), waterPollution: new Map(), coverage: new Set() },
      poweredAnchors: new Set(),
      civic: { count: () => 0, getValues: () => ({ belonging: 0, voice: 0, trust: 0 }) },
      tileToNeighborhood: new Uint16Array(8),
    };
  };
  const log = {
    base: [] as (object | null)[],
    live: [] as (string | null)[],
    status: [] as (string | null)[],
    legend: [] as (OverlayLegend | null)[],
    dirty: 0,
    meta: 0,
  };
  const overlays = createOverlayController({
    renderer: { setOverlay: (s) => log.base.push(s), setLiveOverlay: (k) => log.live.push(k) },
    context: ctx,
    showLegend: (l) => log.legend.push(l),
    setStatus: (t) => log.status.push(t),
    markDirty: () => log.dirty++,
    refreshMeta: () => log.meta++,
  });
  return { overlays, log, contexts: () => contexts };
}

describe('createOverlayController', () => {
  it('starts off', () => {
    const { overlays, log } = setup();
    expect(overlays.active()).toBeNull();
    expect(log.base).toEqual([]);
  });

  it('cycles a kind through its views and off, surfacing caption + key each step', () => {
    const { overlays, log } = setup();
    const seen: (string | null)[] = [];
    for (let n = 0; n <= OVERLAYS.civic.views.length; n++) {
      overlays.cycle('civic');
      seen.push(overlays.active()?.view ?? null);
    }
    expect(seen).toEqual(['belonging', 'voice', 'trust', null]);
    expect(log.status).toEqual([...OVERLAYS.civic.views.map((v) => OVERLAYS.civic.legendLine(v)), null]);
    expect(log.legend).toEqual([...OVERLAYS.civic.views.map((v) => OVERLAYS.civic.legend(v)), null]);
    expect(log.base.slice(0, 3).every((s) => s !== null)).toBe(true);
    expect(log.base[3]).toBeNull(); // off → the plain map
    expect(log.live).toEqual([null, null, null, null]);
    expect(log.dirty).toBe(4);
    expect(log.meta).toBe(4);
  });

  it('police is a live overlay: no base source, the renderer draws it per frame', () => {
    const { overlays, log } = setup();
    overlays.cycle('police');
    expect(log.live).toEqual(['police']);
    expect(log.base).toEqual([null]);
    overlays.cycle('eco'); // exclusivity: replaces police, clears the live flag
    expect(overlays.active()).toEqual({ kind: 'eco', view: 'soil' });
    expect(log.live).toEqual(['police', null]);
    expect(log.base[1]).not.toBeNull();
  });

  it('re-pushes on its source tick only: eco rebuilds for biodiversity, repaints for the rest', () => {
    const { overlays, log, contexts } = setup();
    overlays.onSimTick({ ecoTicked: true, civicTicked: true }); // off → nothing
    expect(log.dirty).toBe(0);
    overlays.cycle('eco'); // soil
    const c0 = contexts();
    const d0 = log.dirty;
    overlays.onSimTick({ ecoTicked: false, civicTicked: true }); // wrong cadence
    expect(log.dirty).toBe(d0);
    overlays.onSimTick({ ecoTicked: true, civicTicked: false }); // soil: repaint only
    expect(log.dirty).toBe(d0 + 1);
    expect(contexts()).toBe(c0);
    for (let n = 0; n < 3; n++) overlays.cycle('eco'); // → biodiversity
    expect(overlays.active()?.view).toBe('biodiversity');
    const c1 = contexts();
    overlays.onSimTick({ ecoTicked: true, civicTicked: false });
    expect(contexts()).toBe(c1 + 1); // rebuilt
  });

  it('civic and power rebuild on the civic tick; static single-view kinds never re-push', () => {
    const { overlays, log, contexts } = setup();
    overlays.cycle('civic');
    const c0 = contexts();
    overlays.onSimTick({ ecoTicked: true, civicTicked: true });
    expect(contexts()).toBe(c0 + 1);
    // the power map follows the re-solved grid (it used to freeze at the grid it was opened with)
    overlays.cycle('power');
    const p0 = contexts();
    overlays.onSimTick({ ecoTicked: true, civicTicked: true });
    expect(contexts()).toBe(p0 + 1);
    overlays.cycle('redline');
    const d0 = log.dirty;
    overlays.onSimTick({ ecoTicked: true, civicTicked: true });
    expect(log.dirty).toBe(d0);
  });
});
