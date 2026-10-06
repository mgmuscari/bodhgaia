import { describe, it, expect } from 'vitest';
import { createToolController, type ToolsDeps } from '../../src/app/tools';
import { GameMap } from '../../src/engine/map';
import { ParcelStore, BuiltKind, placeTransport } from '../../src/engine/fabric';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';
import { availableTools, type Wallet } from '../../src/tools/tools';
import { isRepairTool } from '../../src/ui/repairTools';
import type { ToolbarDeps, ToolbarHandle } from '../../src/ui/toolbar';
import type { MetaButton } from '../../src/ui/dockContent';

// The tool controller owns the dock's selection state (the picked tool, the open category flyout), mounts the
// toolbar over it, previews/applies the selected tool on the map, and keeps the sim-gated dock sync (Y5/Y7).

function setup(opts: { funds?: number; effort?: number } = {}) {
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
    refreshMeta: () => log.push('refreshMeta'),
    flash: () => log.push('flash'),
  };
  let techOpen = false;
  const previews: unknown[] = [];
  const deps: ToolsDeps = {
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
  };
  const tools = createToolController(deps);
  return { tools, deps, log, previews, wallet, tech, map, mount: () => mountDeps!, openTech: (o: boolean) => (techOpen = o) };
}

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
    expect(h.log).toEqual(['status:null', 'previewDirty', 'refresh']);
    expect(h.mount().getMenu().modes.find((m) => m.id === 'bulldoze')!.selected).toBe(true);
  });

  it('a category tile toggles its flyout', () => {
    const h = setup();
    const cat = h.mount().getMenu().categories[0]!.id;
    h.mount().onToggleCategory(cat);
    expect(h.mount().getMenu().open).toBe(cat);
    h.mount().onToggleCategory(cat);
    expect(h.mount().getMenu().open).toBeNull();
    expect(h.log).toEqual(['refresh', 'refresh']);
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
    expect(h.tools.isLineTool()).toBe(false);
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
    expect(h.map.built[h.map.idx(3, 2)]).toBe(0);
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
