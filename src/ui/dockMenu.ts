// The dock's one selection model (PURE — no DOM, no transcendental Math; on the pure-ui allowlist): which menu is
// open — a build category's tools, or an overlay's views — the picked tool, and the shown overlay. Maddy 2026-10-13:
// a menu per overlay button, and "closing a menu or changing category should now unselect the building tool or
// infoview". So: closing a category's menu or opening another puts a building tool down; closing an overlay's menu
// or opening another turns its overlay off. Bulldoze and inspect (the modes) replace a building tool and close its
// category's menu; opening a category puts a mode down. An overlay with a single view has no menu: its button turns
// it on and off. Escape, a right click or a long press clears all three. The overlay KEYS (E, C, …) still cycle
// through the registry's cycleComposite.

import type { ToolCategory } from './toolMenuContent';
import { OVERLAYS, type CompositeState, type OverlayKind } from './overlayRegistry';

export type DockMenu = { kind: 'category'; id: ToolCategory } | { kind: 'overlay'; id: OverlayKind } | null;

export interface DockState {
  menu: DockMenu;
  tool: string | null;
  overlay: CompositeState;
}

/** A tool's build category, or null for a mode (inspect, bulldoze) or no tool. */
export type CategoryOf = (tool: string | null) => ToolCategory | null;

/** Whether an overlay's button opens a menu of views (more than one) or simply toggles. */
export function hasViewMenu(kind: OverlayKind): boolean {
  return OVERLAYS[kind].views.length > 1;
}

/** Close whatever menu is open: a category's takes its building tool down, an overlay's its overlay off. */
function closeMenu(s: DockState, catOf: CategoryOf): DockState {
  if (s.menu === null) return s;
  if (s.menu.kind === 'category') return { menu: null, tool: catOf(s.tool) === null ? s.tool : null, overlay: s.overlay };
  return { menu: null, tool: s.tool, overlay: null };
}

/** A build category's button: close its menu if open, else open it (closing any other). */
export function toggleCategory(s: DockState, id: ToolCategory, catOf: CategoryOf): DockState {
  const wasOpen = s.menu?.kind === 'category' && s.menu.id === id;
  const closed = closeMenu(s, catOf);
  // opening a building category puts bulldoze or inspect down too (Maddy 2026-10-13)
  return wasOpen ? closed : { ...closed, tool: null, menu: { kind: 'category', id } };
}

/** An overlay's button: a menu of its views (showing the first at once), or — one view — on/off. Either way the
 *  open menu closes and a building tool is put down. */
export function toggleOverlay(s: DockState, kind: OverlayKind, catOf: CategoryOf): DockState {
  const wasOpen = s.menu?.kind === 'overlay' && s.menu.id === kind;
  const wasOn = s.overlay?.kind === kind;
  const closed = closeMenu(s, catOf);
  const tool = catOf(closed.tool) === null ? closed.tool : null;
  if (wasOpen) return { ...closed, tool };
  const first = { kind, view: OVERLAYS[kind].views[0]! };
  if (!hasViewMenu(kind)) return { menu: null, tool, overlay: wasOn ? null : first };
  return { menu: { kind: 'overlay', id: kind }, tool, overlay: wasOn ? s.overlay : first };
}

/** A tool picked from a category's menu: the menu stays open. */
export function pickTool(s: DockState, tool: string | null): DockState {
  return { ...s, tool };
}

/** A mode picked (inspect, bulldoze): it replaces any building tool, and an open category's menu closes (Maddy
 *  2026-10-13). An overlay and its menu stay — inspecting what an overlay shows is the point. */
export function pickMode(s: DockState, tool: string, catOf: CategoryOf): DockState {
  const base = s.menu?.kind === 'category' ? closeMenu(s, catOf) : s;
  return { ...base, tool };
}

/** A view picked from an overlay's menu. */
export function pickView(s: DockState, kind: OverlayKind, view: string): DockState {
  return { ...s, overlay: { kind, view } };
}

/** Escape / a right click / a long press: no menu, no tool, no overlay. */
export function closeAll(): DockState {
  return { menu: null, tool: null, overlay: null };
}

/** One entry of an overlay's menu. */
export interface ViewRow {
  view: string;
  label: string;
  selected: boolean;
}

/** An overlay's menu: its views by their legend titles, the shown one marked. */
export function viewRows(kind: OverlayKind, overlay: CompositeState): ViewRow[] {
  const e = OVERLAYS[kind];
  return e.views.map((view) => ({ view, label: e.legend(view).title, selected: overlay?.kind === kind && overlay.view === view }));
}
