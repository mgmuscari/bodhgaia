import { describe, it, expect } from 'vitest';
import { mapPane, layoutVars, SIDEBAR_W, TOPBAR_H, STATUS_H } from '../../src/ui/layout';

// Maddy 2026-10-06: "the top bar should just span the whole screen and the play map should be below it … the menu
// bars can permanently obscure parts of the playable area". The chrome FRAMES the map: a full-width top bar, the
// palette docked left beneath it, a full-width status line along the bottom — and the map gets exactly the rest.
describe('the map pane sits inside the chrome, never under it', () => {
  it('is the rectangle between the top bar, the palette and the status line', () => {
    expect(mapPane(1440, 900)).toEqual({ left: SIDEBAR_W, top: TOPBAR_H, width: 1440 - SIDEBAR_W, height: 900 - TOPBAR_H - STATUS_H });
  });

  it('never goes negative in a tiny window', () => {
    const p = mapPane(50, 40);
    expect(p.width).toBeGreaterThanOrEqual(1);
    expect(p.height).toBeGreaterThanOrEqual(1);
  });

  it('publishes the chrome sizes as CSS variables, so the stylesheet and the canvases agree', () => {
    expect(layoutVars()).toEqual({ '--sidebar-w': `${SIDEBAR_W}px`, '--topbar-h': `${TOPBAR_H}px`, '--status-h': `${STATUS_H}px` });
  });
});
