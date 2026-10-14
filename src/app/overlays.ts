// App shell: the map-overlay controller. ONE active overlay (eco | civic | redline | police | coverage |
// power), cycled by its key or dock button through the same `cycle`; every per-kind detail (views, tints,
// captions, colour keys, refresh cadence) is looked up in the overlay registry (src/ui/overlayRegistry.ts).
// Create it BEFORE the toolbar mounts: the dock reads `active()` at mount and on every refreshMeta.

import type { OverlaySource } from '../ui/renderer';
import type { OverlayLegend } from '../ui/overlayLegend';
import {
  OVERLAYS,
  cycleComposite,
  type CompositeState,
  type OverlayContext,
  type OverlayKind,
} from '../ui/overlayRegistry';

export interface OverlayControllerDeps {
  renderer: { setOverlay(source: OverlaySource | null): void; setLiveOverlay(kind: string | null): void };
  /** The world data a tint reads, gathered fresh at each (re)apply (the partition and grid get replaced). */
  context: () => OverlayContext;
  /** Show (or hide with null) the visible colour key — mountOverlayLegend's setter. */
  showLegend: (legend: OverlayLegend | null) => void;
  /** The dock status line (the overlay's one-line caption). */
  setStatus: (text: string | null) => void;
  /** Invalidate the cached render base (the overlay tint lives in it). */
  markDirty: () => void;
  /** Re-derive the dock's meta buttons (their active state mirrors the overlay). */
  refreshMeta: () => void;
}

export interface OverlayController {
  /** The active overlay (kind + view), or null. */
  active(): CompositeState;
  /** A press of `kind`'s key / dock button: next view of that kind, off past the last, or switch kind. */
  cycle(kind: OverlayKind): void;
  /** Show exactly this overlay (or none) — the dock's menus (ui/dockMenu.ts). */
  set(state: CompositeState): void;
  /** After a sim tick: re-push the active overlay if its source ticked. */
  onSimTick(r: { ecoTicked: boolean; civicTicked: boolean }): void;
}

export function createOverlayController(deps: OverlayControllerDeps): OverlayController {
  let active: CompositeState = null;

  const apply = (): void => {
    // A live overlay (police) is drawn per frame from its field, not baked into the cached base.
    const entry = active && OVERLAYS[active.kind];
    deps.renderer.setLiveOverlay(entry?.live ?? null);
    const source = active && entry?.source ? entry.source(active.view, deps.context()) : null;
    deps.renderer.setOverlay(source);
    // the key follows the source: a stretched view names the range it spans, re-derived each tick
    deps.showLegend(active && entry ? entry.legend(active.view, source?.range) : null);
  };

  const set = (state: CompositeState): void => {
    active = state;
    apply();
    const entry = active && OVERLAYS[active.kind];
    deps.setStatus(active && entry ? entry.legendLine(active.view) : null);
    deps.markDirty();
    deps.refreshMeta();
  };

  return {
    active: () => active,
    cycle: (kind) => set(cycleComposite(active, kind)),
    set,
    onSimTick: (r) => {
      // rebuild a derived source (biodiversity, the civic partition + values), then repaint the base
      const refresh = active && OVERLAYS[active.kind].refresh;
      if (!active || !refresh || !(refresh.on === 'eco' ? r.ecoTicked : r.civicTicked)) return;
      if (refresh.rederive(active.view)) apply();
      deps.markDirty();
    },
  };
}

/** The visible colour KEY (a swatch + label per ramp endpoint / band), bottom-left of the MAP pane — right of the
 *  docked palette, never over it (styled in index.html with the pixel UI kit). */
export function mountOverlayLegend(
  parent: HTMLElement,
  /** A status badge's art, for a stop that names one (the building-status key). */
  iconImage?: (name: string) => CanvasImageSource | undefined,
): (legend: OverlayLegend | null) => void {
  const el = document.createElement('div');
  el.className = 'overlay-legend';
  el.hidden = true;
  parent.appendChild(el);
  return (legend) => {
    el.textContent = '';
    if (!legend) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const title = document.createElement('div');
    title.textContent = legend.title;
    title.className = 'overlay-legend__title';
    el.appendChild(title);
    for (const stop of legend.stops) {
      const row = document.createElement('div');
      const art = stop.icon ? iconImage?.(stop.icon) : undefined;
      if (art) {
        // the badge itself, 3× and crisp (drawn, never read back — Safari scrambles canvas readback)
        const c = document.createElement('canvas');
        c.width = 24;
        c.height = 24;
        c.style.cssText = 'width:24px;height:24px;flex:none;image-rendering:pixelated;';
        const g = c.getContext('2d');
        if (g) {
          g.imageSmoothingEnabled = false;
          g.drawImage(art, 0, 0, 24, 24);
        }
        row.style.cssText = 'display:flex;align-items:center;gap:6px;';
        const lbl = document.createElement('span');
        lbl.textContent = stop.label;
        row.append(c, lbl);
        el.appendChild(row);
        continue;
      }
      const sw = document.createElement('span');
      sw.style.cssText = `display:inline-block;width:12px;height:12px;margin-right:6px;vertical-align:middle;background:rgb(${stop.color[0]},${stop.color[1]},${stop.color[2]});`;
      const lbl = document.createElement('span');
      lbl.textContent = stop.label;
      row.append(sw, lbl);
      el.appendChild(row);
    }
  };
}
