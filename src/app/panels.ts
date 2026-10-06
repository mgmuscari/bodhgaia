// App shell: the panel registry. Every toggled window (Budget, Tech, Restoration, Saves, Settings, Help) returns
// the one PanelHandle (ui/panelHandle.ts); this maps id → handle so the key dispatch, the dock's onMeta and the
// dock's active flags all read ONE table — a panel opened by its key and by its button is the same call.
//
// The handles attach after the dock mounts (DOM order is stacking order for equal z-index), so the registry
// reports every panel closed until then — the dock reads its flags at its own mount.

import type { PanelHandle } from '../ui/panelHandle';

export const PANEL_IDS = ['budget', 'tech', 'restore', 'saves', 'settings', 'help'] as const;
export type PanelId = (typeof PANEL_IDS)[number];

export function isPanelId(id: string): id is PanelId {
  return (PANEL_IDS as readonly string[]).includes(id);
}

export interface PanelRegistry {
  /** The mounted handle (throws before attach). */
  get(id: PanelId): PanelHandle;
  isOpen(id: PanelId): boolean;
  toggle(id: PanelId): boolean;
  /** Each panel's open state, keyed as the dock's metaButtons wants it. */
  openFlags(): Record<PanelId, boolean>;
  attach(handles: Record<PanelId, PanelHandle>): void;
}

export function createPanelRegistry(): PanelRegistry {
  let handles: Record<PanelId, PanelHandle> | null = null;
  const get = (id: PanelId): PanelHandle => {
    if (!handles) throw new Error(`panel '${id}' read before the panels mounted`);
    return handles[id];
  };
  const isOpen = (id: PanelId): boolean => handles?.[id].isOpen() ?? false;
  return {
    get,
    isOpen,
    toggle: (id) => get(id).toggle(),
    openFlags: () => Object.fromEntries(PANEL_IDS.map((id) => [id, isOpen(id)])) as Record<PanelId, boolean>,
    attach: (h) => {
      handles = h;
    },
  };
}

/**
 * A readout that trends each reading against the previous one: `read(true)` takes a fresh reading compared to
 * nothing (a panel just opened — no stale arrows), `read(false)` compares to the reading before it.
 */
export function trendReader<S>(sample: () => S, lines: (cur: S, prev: S | null) => string[]): (fresh: boolean) => string[] {
  let prev: S | null = null;
  return (fresh) => {
    const cur = sample();
    const out = lines(cur, fresh ? null : prev);
    prev = cur;
    return out;
  };
}
