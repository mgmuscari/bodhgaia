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

export interface PaneRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The map pane inside a window of innerW × innerH CSS px. */
export function mapPane(innerW: number, innerH: number): PaneRect {
  return {
    left: SIDEBAR_W,
    top: topbarH(innerW),
    width: Math.max(1, innerW - SIDEBAR_W),
    height: Math.max(1, innerH - topbarH(innerW) - STATUS_H),
  };
}

/** The chrome sizes as CSS custom properties, for :root. */
export function layoutVars(innerW = Infinity): Record<string, string> {
  return { '--sidebar-w': `${SIDEBAR_W}px`, '--topbar-h': `${topbarH(innerW)}px`, '--status-h': `${STATUS_H}px` };
}
