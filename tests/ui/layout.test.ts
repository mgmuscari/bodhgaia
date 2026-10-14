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
    expect(layoutVars()).toEqual({
      '--sidebar-w': `${SIDEBAR_W}px`,
      '--topbar-h': `${TOPBAR_H}px`,
      '--status-h': `${STATUS_H}px`,
      '--dock-h': '0px', // a desktop docks the palette down the side
      '--bottom-h': `${STATUS_H}px`, // all the chrome below the map
    });
  });
});

// Maddy 2026-10-08: the phone top bar's two rows at 12 px were "very tiny… suggest making the bar taller on mobile".
import { TOPBAR_H_NARROW, NARROW_W, DOCK_H_NARROW, dockMenuAt } from '../../src/ui/layout';
describe('a taller top bar on a phone', () => {
  it('below the narrow width the bar is taller, and the map pane starts below it', () => {
    expect(TOPBAR_H_NARROW).toBeGreaterThan(TOPBAR_H);
    expect(mapPane(390, 844).top).toBe(TOPBAR_H_NARROW);
    expect(mapPane(390, 844).height).toBe(844 - TOPBAR_H_NARROW - STATUS_H - DOCK_H_NARROW);
    expect(layoutVars(390)['--topbar-h']).toBe(`${TOPBAR_H_NARROW}px`);
  });
  it('a desktop window keeps the slim bar', () => {
    expect(mapPane(NARROW_W + 1, 900).top).toBe(TOPBAR_H);
    expect(layoutVars(1440)['--topbar-h']).toBe(`${TOPBAR_H}px`);
    expect(layoutVars()['--topbar-h']).toBe(`${TOPBAR_H}px`);
  });
});

// …and the canvases render at 2× at most on a touch screen: pixel art gains nothing past it, and a 3× phone drew 2.25×
// the pixels for no visible gain (Maddy 2026-10-08: "this game heats up phones").
import { renderScale } from '../../src/ui/layout';
describe('render scale', () => {
  it('a touch screen renders at 2× at most; a desktop at its own scale', () => {
    expect(renderScale(3, true)).toBe(2);
    expect(renderScale(2, true)).toBe(2);
    expect(renderScale(1.5, true)).toBe(1.5);
    expect(renderScale(3, false)).toBe(3);
    expect(renderScale(0, false)).toBe(1); // no reading → 1
  });
});

// Maddy 2026-10-14: "on mobile, moving the menus to the bottom of the screen and keeping the game window above makes
// more sense from a layout perspective". A phone docks the palette along the bottom — two rows of 44-px buttons
// under the status line — and the map takes the full width above.
describe('a phone docks the palette along the bottom', () => {
  it('two rows of 44-px buttons in the panel frame', () => {
    expect(DOCK_H_NARROW).toBe(2 * 44 + 2 * 12);
  });
  it('the map pane spans the width, from the top bar down to the status line above the dock', () => {
    expect(mapPane(390, 844)).toEqual({ left: 0, top: TOPBAR_H_NARROW, width: 390, height: 844 - TOPBAR_H_NARROW - STATUS_H - DOCK_H_NARROW });
  });
  it('publishes no sidebar, the dock, and the chrome below the map', () => {
    expect(layoutVars(390)).toEqual({
      '--sidebar-w': '0px',
      '--topbar-h': `${TOPBAR_H_NARROW}px`,
      '--status-h': `${STATUS_H}px`,
      '--dock-h': `${DOCK_H_NARROW}px`,
      '--bottom-h': `${STATUS_H + DOCK_H_NARROW}px`,
    });
  });
  it('a landscape phone (wider than the narrow width) keeps the side palette', () => {
    expect(mapPane(844, 390).left).toBe(SIDEBAR_W);
    expect(layoutVars(844)['--dock-h']).toBe('0px');
  });
  it('a menu opens upward from its button, above the status line, held inside the screen', () => {
    const bottomH = STATUS_H + DOCK_H_NARROW;
    expect(dockMenuAt(100, 176, 120, 390, 844)).toEqual({ left: 100, top: 844 - bottomH - 120 });
    expect(dockMenuAt(330, 176, 120, 390, 844).left).toBe(390 - 176 - 4); // the right edge
    expect(dockMenuAt(-10, 176, 120, 390, 844).left).toBe(4); // the left edge
    expect(dockMenuAt(100, 176, 900, 390, 844).top).toBe(0); // taller than the room: from the top
  });
});
