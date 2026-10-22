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
    expect(layoutVars()).toEqual({ '--sidebar-w': `${SIDEBAR_W}px`, '--topbar-h': `${TOPBAR_H}px`, '--status-h': `${STATUS_H}px`, '--dock-h': '0px' });
  });
});

// Maddy 2026-10-08: the phone top bar's two rows at 12 px were "very tiny… suggest making the bar taller on mobile".
import { TOPBAR_H_NARROW, NARROW_W } from '../../src/ui/layout';
describe('a taller top bar on a phone', () => {
  it('below the narrow width the bar is taller, and the map pane starts below it', () => {
    expect(TOPBAR_H_NARROW).toBeGreaterThan(TOPBAR_H);
    expect(mapPane(390, 844).top).toBe(TOPBAR_H_NARROW);
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

// Maddy 2026-10-21: on a phone "menus overlapping the playable area… consider moving the menubar to horizontal
// placement at the bottom on mobile". In portrait the palette is a row along the bottom, under the status line, and
// the map takes the full width; a landscape phone (wider than NARROW_W) keeps the side palette.
import { DOCK_H, flyoutLeft } from '../../src/ui/layout';
describe('a phone: the palette docks along the bottom', () => {
  it('the map spans the full width, between the top bar and the status line over the dock', () => {
    expect(mapPane(390, 844)).toEqual({ left: 0, top: TOPBAR_H_NARROW, width: 390, height: 844 - TOPBAR_H_NARROW - STATUS_H - DOCK_H });
    expect(layoutVars(390)).toMatchObject({ '--sidebar-w': '0px', '--dock-h': `${DOCK_H}px` });
  });
  it('the dock holds a row of 44-px buttons in its frame', () => {
    expect(DOCK_H).toBeGreaterThanOrEqual(44 + 2 * 8);
  });
  it('a landscape phone keeps the side palette', () => {
    expect(mapPane(844, 390).left).toBe(SIDEBAR_W);
    expect(layoutVars(844)['--dock-h']).toBe('0px');
  });
  it('a menu opens over its button, but never past either edge of the screen', () => {
    expect(flyoutLeft(100, 200, 390)).toBe(100);
    expect(flyoutLeft(300, 200, 390)).toBe(390 - 200 - 8); // pulled back in from the right
    expect(flyoutLeft(-20, 200, 390)).toBe(8);
    expect(flyoutLeft(10, 500, 390)).toBe(8); // wider than the screen: pinned left (CSS caps its width)
  });
});
