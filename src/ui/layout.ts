// The screen layout (PURE): the chrome FRAMES the map rather than floating over it (Maddy 2026-10-06: "the menu
// bars can permanently obscure parts of the playable area"). A full-width top bar (the city's readout), the tool
// palette docked down the left beneath it, a full-width status line along the bottom — and the map pane is exactly
// the rectangle left between them, so the camera can bring every tile into view. The sizes are published as CSS
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

/** On a phone in portrait (≤ NARROW_W) the palette is a row along the bottom instead (Maddy 2026-10-21: the side
 *  palette took a third of the width, and menus opened over the map): a row of 44-px buttons in an 8-px frame, scrolled
 *  sideways. The status line sits above it, so the tools are at the thumb. */
export const DOCK_H = 60;

/** The side palette's width for a window `innerW` CSS px wide — none on a phone in portrait. */
export function sidebarW(innerW: number): number {
  return innerW <= NARROW_W ? 0 : SIDEBAR_W;
}
/** The bottom dock's height — only on a phone in portrait. */
export function dockH(innerW: number): number {
  return innerW <= NARROW_W ? DOCK_H : 0;
}

/** Where a menu `width` px wide opens over its button at `anchorLeft` on a screen `vw` px wide: level with the button,
 *  pulled back inside an 8-px margin at either edge (Maddy 2026-10-21: menus stretched off the side of the screen). */
export function flyoutLeft(anchorLeft: number, width: number, vw: number): number {
  const m = 8;
  return Math.max(m, Math.min(anchorLeft, vw - width - m));
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

/** The chrome sizes as CSS custom properties, for :root. */
export function layoutVars(innerW = Infinity): Record<string, string> {
  return {
    '--sidebar-w': `${sidebarW(innerW)}px`,
    '--topbar-h': `${topbarH(innerW)}px`,
    '--status-h': `${STATUS_H}px`,
    '--dock-h': `${dockH(innerW)}px`,
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
