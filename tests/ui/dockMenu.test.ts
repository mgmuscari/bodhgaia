// Maddy 2026-10-13: "Eco and civic overlays are annoying to toggle through, consider menus" / "Overlays should be
// easier to deactivate" — a menu per overlay button, and "closing a menu or changing category should now unselect
// the building tool or infoview". The dock's one selection model: which menu is open, the tool, the overlay.
import { describe, expect, it } from 'vitest';
import { closeAll, pickMode, pickTool, pickView, toggleCategory, toggleOverlay, viewRows, type DockState } from '../../src/ui/dockMenu';

// a tool's category: street → transit, house → residential; inspect/bulldoze are modes (none)
const catOf = (tool: string | null) => (tool === 'street' ? 'transit' : tool === 'house' ? 'residential' : null);
const none: DockState = { menu: null, tool: null, overlay: null };

describe('the build categories', () => {
  it('opening a category opens its menu; picking a tool keeps the menu open', () => {
    const s = pickTool(toggleCategory(none, 'transit', catOf), 'street');
    expect(s).toEqual({ menu: { kind: 'category', id: 'transit' }, tool: 'street', overlay: null });
  });
  it('closing the menu puts the tool down', () => {
    const s = toggleCategory(pickTool(toggleCategory(none, 'transit', catOf), 'street'), 'transit', catOf);
    expect(s).toEqual(none);
  });
  it('changing category puts the tool down', () => {
    const s = toggleCategory(pickTool(toggleCategory(none, 'transit', catOf), 'street'), 'residential', catOf);
    expect(s).toEqual({ menu: { kind: 'category', id: 'residential' }, tool: null, overlay: null });
  });
  // Maddy 2026-10-13: "when you select a building category menu, it should deselect bulldoze/inspect"
  it('opening a category puts bulldoze or inspect down', () => {
    expect(toggleCategory({ ...none, tool: 'bulldoze' }, 'transit', catOf).tool).toBeNull();
    expect(toggleCategory({ ...none, tool: 'inspect' }, 'residential', catOf).tool).toBeNull();
  });
});

describe('the overlay menus', () => {
  it('an overlay with several views opens a menu and shows its first view at once', () => {
    const s = toggleOverlay(none, 'eco', catOf);
    expect(s.menu).toEqual({ kind: 'overlay', id: 'eco' });
    expect(s.overlay).toEqual({ kind: 'eco', view: 'soil' });
    expect(pickView(s, 'eco', 'fauna').overlay).toEqual({ kind: 'eco', view: 'fauna' });
  });
  it('closing its menu turns the overlay off', () => {
    const s = toggleOverlay(pickView(toggleOverlay(none, 'eco', catOf), 'eco', 'fauna'), 'eco', catOf);
    expect(s).toEqual(none);
  });
  it('changing category turns the overlay off — to another overlay, or to a build category', () => {
    const eco = toggleOverlay(none, 'eco', catOf);
    expect(toggleOverlay(eco, 'civic', catOf)).toEqual({ menu: { kind: 'overlay', id: 'civic' }, tool: null, overlay: { kind: 'civic', view: 'health' } });
    expect(toggleCategory(eco, 'transit', catOf)).toEqual({ menu: { kind: 'category', id: 'transit' }, tool: null, overlay: null });
  });
  it('opening an overlay menu puts a building tool down', () => {
    const building = pickTool(toggleCategory(none, 'transit', catOf), 'street');
    expect(toggleOverlay(building, 'civic', catOf).tool).toBeNull();
  });
  it('an overlay with one view has no menu: its button turns it on and off, closing any open menu', () => {
    const building = pickTool(toggleCategory(none, 'transit', catOf), 'street');
    const on = toggleOverlay(building, 'redline', catOf);
    expect(on).toEqual({ menu: null, tool: null, overlay: { kind: 'redline', view: 'grade' } });
    expect(toggleOverlay(on, 'redline', catOf)).toEqual(none);
  });
  it('a menu lists the views by name, the shown one marked', () => {
    const rows = viewRows('eco', { kind: 'eco', view: 'flora' });
    expect(rows.map((r) => r.label)).toContain('Air pollution');
    expect(rows.find((r) => r.selected)?.view).toBe('flora');
    expect(rows.filter((r) => r.selected)).toHaveLength(1);
  });
});

// Maddy 2026-10-13: "selecting bulldoze/inspect [should] deselect other active building tools".
describe('the modes (inspect, bulldoze)', () => {
  it('picking one puts the building tool down and closes its category menu', () => {
    const s = pickMode(pickTool(toggleCategory(none, 'transit', catOf), 'street'), 'bulldoze', catOf);
    expect(s).toEqual({ menu: null, tool: 'bulldoze', overlay: null });
  });
  it('an overlay (and its menu) stays — inspecting what an overlay shows is the point', () => {
    const eco = toggleOverlay(none, 'eco', catOf);
    const s = pickMode(eco, 'inspect', catOf);
    expect(s).toEqual({ menu: eco.menu, tool: 'inspect', overlay: eco.overlay });
  });
});

describe('Escape / a right click / a long press', () => {
  it('clears everything: the menu, the tool and the overlay', () => {
    expect(closeAll()).toEqual(none);
  });
});
