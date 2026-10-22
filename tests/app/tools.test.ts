import type { CityMode } from '../../src/engine/mode';
import { describe, it, expect } from 'vitest';
import { createToolController, type ToolsDeps } from '../../src/app/tools';
import { GameMap } from '../../src/engine/map';
import { ParcelStore, BuiltKind, placeParcel, placeTransport } from '../../src/engine/fabric';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';
import { availableTools, type Wallet } from '../../src/tools/tools';
import { isRepairTool } from '../../src/ui/repairTools';
import type { ToolbarDeps, ToolbarHandle } from '../../src/ui/toolbar';
import type { MetaButton } from '../../src/ui/dockContent';
import type { CompositeState } from '../../src/ui/overlayRegistry';

// The tool controller owns the dock's selection state (the picked tool, the open category flyout), mounts the
// toolbar over it, previews/applies the selected tool on the map, and keeps the sim-gated dock sync (Y5/Y7).

function setup(opts: { funds?: number; effort?: number; mode?: CityMode } = {}) {
  const map = new GameMap(16, 8);
  const parcels = new ParcelStore();
  for (let x = 1; x <= 10; x++) placeTransport(map, x, 2, BuiltKind.RoadStreet);
  const world = { map, parcels };
  const tech = createTechState(TECH_TREE);
  tech.restore([], opts.effort ?? 1000);
  const wallet: Wallet = { funds: opts.funds ?? 100_000 };
  const log: string[] = [];
  let mountDeps: ToolbarDeps | null = null;
  const toolbar: ToolbarHandle = {
    refresh: () => log.push('refresh'),
    setStatus: (t) => log.push(`status:${t}`),
    setNews: () => log.push('news'),
    refreshMeta: () => log.push('refreshMeta'),
    flash: () => log.push('flash'),
  };
  let techOpen = false;
  const previews: unknown[] = [];
  let overlay: CompositeState = null;
  const deps: ToolsDeps = {
    overlays: {
      active: () => overlay,
      set: (o) => {
        overlay = o;
        log.push(`overlay:${o ? `${o.kind}/${o.view}` : 'off'}`);
      },
    },
    world,
    tech,
    wallet,
    renderer: { setPreview: (p) => previews.push(p), artImage: () => undefined },
    markDirty: () => log.push('dirty'),
    markPreviewDirty: () => log.push('previewDirty'),
    mount: (d) => {
      mountDeps = d;
      d.getMenu(); // the real toolbar renders at mount
      return toolbar;
    },
    meta: {
      buttons: (): MetaButton[] => [],
      onMeta: (id) => log.push(`meta:${id}`),
    },
    techPanel: () => ({
      isOpen: () => techOpen,
      refresh: () => log.push('tech.refresh'),
      refreshHeader: () => log.push('tech.header'),
    }),
    inspect: (info, tx, ty) => `${info} @${tx},${ty}`,
    placed: () => log.push('placed'),
    repaired: (tx, ty) => log.push(`repaired:${tx},${ty}`),
    mode: opts.mode,
  };
  const tools = createToolController(deps);
  return { tools, deps, log, previews, wallet, tech, map, mount: () => mountDeps!, openTech: (o: boolean) => (techOpen = o) };
}

describe('createToolController: the overlay menus (Maddy 2026-10-13)', () => {
  it('an overlay with several views opens its menu beside its button and shows the first view', () => {
    const h = setup();
    h.mount().onMeta?.('eco');
    expect(h.log).toContain('overlay:eco/soil');
    expect(h.log).not.toContain('meta:eco'); // the menus are the dock's, not the shell's cycle
    const vm = h.mount().getViewMenu?.();
    expect(vm?.kind).toBe('eco');
    expect(vm?.rows.find((r) => r.selected)?.view).toBe('soil');
    h.mount().onPickView?.('eco', 'fauna');
    expect(h.log).toContain('overlay:eco/fauna');
    h.mount().onMeta?.('eco'); // closing the menu turns it off
    expect(h.log).toContain('overlay:off');
    expect(h.mount().getViewMenu?.()).toBeNull();
  });

  it('opening an overlay puts a building tool down; a category closes the overlay menu and its overlay', () => {
    const h = setup();
    const cat = h.mount().getMenu().categories[0]!.id;
    h.mount().onToggleCategory(cat);
    h.mount().onSelect(h.mount().getMenu().rows[0]!.id);
    h.mount().onMeta?.('civic');
    expect(h.tools.selected()).toBeNull();
    h.mount().onToggleCategory(cat);
    expect(h.log.filter((l) => l.startsWith('overlay:')).at(-1)).toBe('overlay:off');
  });

  it('bulldoze/inspect put a building tool down; a building category puts them down (Maddy 2026-10-13)', () => {
    const h = setup();
    const cat = h.mount().getMenu().categories[0]!.id;
    h.mount().onToggleCategory(cat);
    h.mount().onSelect(h.mount().getMenu().rows[0]!.id);
    h.mount().onSelect('bulldoze'); // by button
    expect(h.tools.selected()).toBe('bulldoze');
    expect(h.mount().getMenu().open).toBeNull();
    expect(h.mount().getMenu().categories.some((c) => c.hasSelected)).toBe(false);
    h.mount().onToggleCategory(cat); // a building category
    expect(h.tools.selected()).toBeNull();
    h.mount().onSelect(h.mount().getMenu().rows[0]!.id);
    h.tools.hotkey('inspect'); // by key
    expect(h.tools.selected()).toBe('inspect');
    expect(h.mount().getMenu().open).toBeNull();
  });

  it('Escape (and a right click / long press) clears the tool, the menu and the overlay', () => {
    const h = setup();
    h.mount().onMeta?.('eco');
    h.tools.hotkey('deselect');
    expect(h.log).toContain('overlay:off');
    expect(h.mount().getViewMenu?.()).toBeNull();
  });
});

describe('createToolController: selection', () => {
  it('mounts the toolbar once, with nothing selected and no flyout open', () => {
    const h = setup();
    expect(h.tools.toolbar).toBeDefined();
    expect(h.tools.selected()).toBeNull();
    expect(h.tools.hasTool()).toBe(false);
    const menu = h.mount().getMenu();
    expect(menu.open).toBeNull();
    expect(menu.modes.some((m) => m.selected)).toBe(false);
  });

  it('a dock pick selects the tool, clears the preview and the stale status, and refreshes the dock', () => {
    const h = setup();
    h.mount().onSelect('bulldoze');
    expect(h.tools.selected()).toBe('bulldoze');
    expect(h.previews).toEqual([null]);
    expect(h.log).toEqual(['status:null', 'previewDirty', 'refresh', 'refreshMeta']);
    expect(h.mount().getMenu().modes.find((m) => m.id === 'bulldoze')!.selected).toBe(true);
  });

  it('a category tile toggles its flyout', () => {
    const h = setup();
    const cat = h.mount().getMenu().categories[0]!.id;
    h.mount().onToggleCategory(cat);
    expect(h.mount().getMenu().open).toBe(cat);
    h.mount().onToggleCategory(cat);
    expect(h.mount().getMenu().open).toBeNull();
    expect(h.log).toEqual(['refresh', 'refreshMeta', 'refresh', 'refreshMeta']);
  });

  // Maddy 2026-10-13: "closing a menu or changing category should now unselect the building tool or infoview"
  it('closing its menu or opening another category puts the selected tool down', () => {
    const h = setup();
    const menu = () => h.mount().getMenu();
    const [a, b] = menu().categories;
    h.mount().onToggleCategory(a!.id);
    const tool = menu().rows[0]!.id;
    h.mount().onSelect(tool);
    h.mount().onToggleCategory(a!.id); // close its own flyout
    expect(h.tools.selected()).toBeNull();
    h.mount().onToggleCategory(a!.id); // open it again, pick, then another category
    h.mount().onSelect(tool);
    h.mount().onToggleCategory(b!.id); // another category
    expect(menu().open).toBe(b!.id);
    expect(menu().categories.some((c) => c.hasSelected)).toBe(false); // nothing selected anywhere
  });

  it('prices the fabric from the wallet (read at menu time)', () => {
    const h = setup({ funds: 0 });
    const cat = h.mount().getMenu().categories.find((c) => c.id === 'transit')!.id;
    h.mount().onToggleCategory(cat);
    const before = h.mount().getMenu().rows.map((r) => r.affordable);
    h.wallet.funds = 1_000_000;
    const after = h.mount().getMenu().rows.map((r) => r.affordable);
    expect(before).not.toEqual(after);
  });

  it('the I / X hotkeys select inspect / bulldoze (anything else deselects)', () => {
    const h = setup();
    h.tools.hotkey('inspect');
    expect(h.tools.selected()).toBe('inspect');
    h.tools.hotkey('bulldoze');
    expect(h.tools.selected()).toBe('bulldoze');
    expect(h.tools.isLineTool()).toBe(true); // a bulldoze drag clears a straight run (Maddy 2026-10-07)
  });

  it('hands the map pointer the same handlers (hover previews, a click applies)', () => {
    const h = setup();
    const i = h.tools.input;
    expect([i.hasTool, i.isLineTool, i.applyAt, i.hover, i.clearHover, i.onHotkey]).toEqual([
      h.tools.hasTool,
      h.tools.isLineTool,
      h.tools.applyAt,
      h.tools.previewAt,
      h.tools.clearHover,
      h.tools.hotkey,
    ]);
  });

  it('meta clicks route to the shell, then the dock re-derives its meta row', () => {
    const h = setup();
    h.mount().onMeta!('life');
    expect(h.log).toEqual(['meta:life', 'refreshMeta']);
  });
});

describe('createToolController: preview / apply', () => {
  it('does nothing with no tool selected', () => {
    const h = setup();
    h.tools.previewAt(3, 2);
    h.tools.applyAt(3, 2);
    expect(h.previews).toEqual([]);
    expect(h.log).toEqual([]);
  });

  it('previews the hovered tile with the apply predicate (preview-only repaint)', () => {
    const h = setup();
    h.tools.hotkey('bulldoze');
    h.log.length = 0;
    h.previews.length = 0;
    h.tools.previewAt(3, 2);
    h.tools.previewAt(3, 6);
    expect(h.previews).toEqual([[{ x: 3, y: 2, valid: true }], [{ x: 3, y: 6, valid: false }]]);
    expect(h.log).toEqual(['previewDirty', 'previewDirty']);
  });

  // Maddy 2026-10-13: "Update building footprint preview" — the preview tinted only the tile under the cursor, even
  // for a 2×2 clinic or a 4×4 plant. It covers the building's whole footprint, all valid or all not.
  it('a building previews its whole footprint from the hovered tile', () => {
    const h = setup();
    h.mount().onSelect(`build-${BuiltKind.Clinic}`);
    h.previews.length = 0;
    h.tools.previewAt(3, 4); // open land below the street
    const tiles = h.previews.at(-1) as { x: number; y: number; valid: boolean }[];
    expect(tiles.map((t) => [t.x, t.y]).sort()).toEqual([[3, 4], [3, 5], [4, 4], [4, 5]]);
    expect(new Set(tiles.map((t) => t.valid)).size).toBe(1);
    h.tools.previewAt(3, 1); // over the street: refused, every tile red
    expect((h.previews.at(-1) as { valid: boolean }[]).every((t) => !t.valid)).toBe(true);
  });

  // Lane pairings (interdependence §9): placing a building lights what it would pair with, and names the pairing.
  it('the preview lights the buildings it would pair with, and names the pairing in the status line', () => {
    const h = setup();
    placeParcel(h.map, h.deps.world.parcels, { x: 6, y: 4, width: 2, height: 2, kind: BuiltKind.HealingCommons });
    h.mount().onSelect(`build-${BuiltKind.Clinic}`);
    h.previews.length = 0;
    h.log.length = 0;
    h.tools.previewAt(3, 4);
    const tiles = h.previews.at(-1) as { x: number; y: number; pair?: boolean }[];
    expect(tiles.some((t) => t.pair && t.x === 6 && t.y === 4)).toBe(true);
    expect(h.log.some((l) => l.startsWith('status:Pairs with the Healing Commons'))).toBe(true);
  });

  it('inspect writes its readout to the status line and mutates nothing', () => {
    const h = setup();
    h.tools.hotkey('inspect');
    h.log.length = 0;
    h.tools.applyAt(3, 2);
    expect(h.log).toEqual([expect.stringMatching(/^status:.* @3,2$/)]);
  });

  it('a successful placement re-derives the world, refreshes, snapshots and re-tints the tile', () => {
    const h = setup();
    h.tools.hotkey('bulldoze');
    h.log.length = 0;
    h.tools.applyAt(3, 2);
    expect(h.map.built[h.map.idx(3, 2)]).toBe(68); // a vacant lot (Maddy 2026-10-13)
    expect(h.log).toEqual(['placed', 'dirty', 'refresh', 'previewDirty']); // bulldoze is not a repair
    h.log.length = 0;
    h.openTech(true);
    h.tools.applyAt(4, 2);
    expect(h.log).toEqual(['placed', 'dirty', 'refresh', 'tech.refresh', 'previewDirty']);
    // the discrete-event path snapshots both signatures, so the next sim-gated sync is a no-op
    h.log.length = 0;
    h.tools.syncDock();
    expect(h.log).toEqual(['tech.header']);
  });

  it('a failed placement changes nothing', () => {
    const h = setup();
    h.tools.hotkey('bulldoze');
    h.log.length = 0;
    h.tools.applyAt(3, 6); // open land: nothing to bulldoze
    expect(h.log).toEqual([]);
  });

  it('a repair-classified placement credits its tile; other placements do not', () => {
    const h = setup();
    for (const n of TECH_TREE) h.tech.grant(n.id); // every practice → every tool on the palette
    const repair = availableTools(h.tech).find((t) => isRepairTool(t) && t.id.startsWith('build-'))!;
    expect(repair).toBeDefined();
    h.mount().onSelect(repair.id);
    h.log.length = 0;
    for (let y = 3; y < 8 && !h.log.includes('placed'); y++) for (let x = 0; x < 16 && !h.log.includes('placed'); x++) h.tools.applyAt(x, y);
    const at = h.log.findIndex((l) => l.startsWith('repaired:'));
    expect(at).toBeGreaterThan(h.log.indexOf('previewDirty')); // after the re-tint, as before the move
  });
});

describe('createToolController: the sim-gated dock sync', () => {
  it('is a no-op when nothing moved, and refreshes + flashes when a grant adds a tool', () => {
    const h = setup();
    h.tools.syncDock();
    expect(h.log).toEqual([]);
    const n0 = availableTools(h.tech).length;
    // grant practices in tree order (prereqs first) until one adds a tool
    for (const n of TECH_TREE) {
      h.tech.grant(n.id);
      if (availableTools(h.tech).length > n0) break;
    }
    expect(availableTools(h.tech).length).toBeGreaterThan(n0);
    h.tools.syncDock();
    expect(h.log).toEqual(['refresh', 'flash']);
    h.log.length = 0;
    h.tools.syncDock();
    expect(h.log).toEqual([]);
  });

  it('refreshes the open tech panel header each sync and fully only when its signature flips', () => {
    const h = setup();
    h.openTech(true);
    h.tools.syncDock();
    expect(h.log).toEqual(['tech.header']);
    h.log.length = 0;
    h.tech.grant(TECH_TREE[0]!.id);
    h.tools.syncDock();
    expect(h.log).toContain('tech.refresh');
  });

  it('afterEffortChange refreshes the dock and snapshots, so the next sync is quiet', () => {
    const h = setup({ effort: 12 });
    h.tech.spend(12); // effort dropped → affordability flips across the palette
    h.tools.afterEffortChange();
    expect(h.log).toEqual(['refresh']);
    h.log.length = 0;
    h.openTech(true);
    h.tools.syncDock();
    expect(h.log).toEqual(['tech.header']);
  });
});

// Difficulty (Maddy 2026-10-21): building costs more on hard, less on gentle — one price everywhere (menu, preview,
// the charge, a site's bill); standard is unchanged.
describe('createToolController: prices under the city mode', () => {
  const spentOnAStreet = (mode?: CityMode) => {
    const h = setup({ mode });
    h.mount().onSelect(`build-${BuiltKind.RoadStreet}`);
    const before = h.wallet.funds;
    h.tools.applyAt(5, 5);
    return before - h.wallet.funds;
  };
  it('hard costs more than standard, gentle less; standard is today\'s price', () => {
    const standard = spentOnAStreet();
    expect(standard).toBeGreaterThan(0);
    expect(spentOnAStreet({ difficulty: 'standard', sandbox: false })).toBe(standard);
    expect(spentOnAStreet({ difficulty: 'hard', sandbox: false })).toBeGreaterThan(standard);
    expect(spentOnAStreet({ difficulty: 'gentle', sandbox: false })).toBeLessThan(standard);
  });
});
