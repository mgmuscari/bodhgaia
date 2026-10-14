// The screen layout (PURE): the chrome FRAMES the map rather than floating over it (Maddy 2026-10-06: "the menu
// bars can permanently obscure parts of the playable area"). A full-width top bar (the city's readout), the tool
// palette docked down the left beneath it (on a phone in portrait: along the bottom, under the status line), a
// full-width status line along the bottom — and the map pane is exactly the rectangle left between them, so the camera can bring every tile into view. The sizes are published as CSS
// variables (layoutVars) so the stylesheet and the canvases agree.

/** The tool palette's width, docked down the left edge. */
export const SIDEBAR_W = 112;
/** The top bar's height (the full-width city readout). */
export const TOPBAR_H = 44;
/** Below this window width (a phone) the readout wraps onto rows… */
export const NARROW_W = 760;
/** …in a taller bar, so they keep the news ticker's size (Maddy 2026-10-08: two 12-px rows in the slim bar were
 *  "very tiny"). At that size a 390-px phone takes three 24-px rows (measured), inside the 10-px frame. */
export const TOPBAR_H_NARROW = 92;

/** The top bar's height for a window `innerW` CSS px wide. */
export function topbarH(innerW: number): number {
  return innerW <= NARROW_W ? TOPBAR_H_NARROW : TOPBAR_H;
}
/** The status line's height (inspect readouts, legend captions), full width along the bottom — always present, so
 *  the map pane never resizes when a message comes and goes. */
export const STATUS_H = 40;

/** On a phone the palette docks along the BOTTOM, under the status line (Maddy 2026-10-14: "on mobile, moving the
 *  menus to the bottom of the screen and keeping the game window above makes more sense"): two rows of 44-px buttons
 *  — the tools, then the panels and overlays, each scrolling sideways if it overflows — in the 12-px panel frame. */
export const DOCK_H_NARROW = 2 * 44 + 2 * 12;

/** Is the palette docked along the bottom (a phone in portrait) rather than down the left? */
export function dockAtBottom(innerW: number): boolean {
  return innerW <= NARROW_W;
}
/** The palette's width down the left (none when it docks along the bottom). */
export function sidebarW(innerW: number): number {
  return dockAtBottom(innerW) ? 0 : SIDEBAR_W;
}
/** The bottom dock's height (none when the palette docks down the left). */
export function dockH(innerW: number): number {
  return dockAtBottom(innerW) ? DOCK_H_NARROW : 0;
}

export interface PaneRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The map pane inside a window of innerW × innerH CSS px. */
export function mapPane(innerW: number, innerH: number): PaneRect {
  return {
    left: sidebarW(innerW),
    top: topbarH(innerW),
    width: Math.max(1, innerW - sidebarW(innerW)),
    height: Math.max(1, innerH - topbarH(innerW) - STATUS_H - dockH(innerW)),
  };
}

/** Where a dock menu (a category's tools, an overlay's views) opens on a phone: upward from its button's left edge,
 *  its foot on the status line above the dock, held 4 px inside the screen's sides. */
export function dockMenuAt(anchorLeft: number, menuW: number, menuH: number, innerW: number, innerH: number): { left: number; top: number } {
  const left = Math.max(4, Math.min(anchorLeft, innerW - menuW - 4));
  const top = Math.max(0, innerH - STATUS_H - dockH(innerW) - menuH);
  return { left, top };
}

/** The chrome sizes as CSS custom properties, for :root. */
export function layoutVars(innerW = Infinity): Record<string, string> {
  return {
    '--sidebar-w': `${sidebarW(innerW)}px`,
    '--topbar-h': `${topbarH(innerW)}px`,
    '--status-h': `${STATUS_H}px`,
    '--dock-h': `${dockH(innerW)}px`,
    '--bottom-h': `${STATUS_H + dockH(innerW)}px`,
  };
}

/** The most device pixels per CSS pixel the canvases render at on a touch screen: pixel art gains nothing past 2×,
 *  and a 3× phone drew 2.25× the pixels for none (Maddy 2026-10-08: "this game heats up phones"). */
export const TOUCH_MAX_SCALE = 2;

/** The canvases' render scale for a display of `devicePixelRatio`: its own, capped on a touch screen. */
export function renderScale(devicePixelRatio: number, touch: boolean): number {
  const d = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return touch ? Math.min(d, TOUCH_MAX_SCALE) : d;
}
