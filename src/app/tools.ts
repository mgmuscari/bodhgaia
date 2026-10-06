// App shell: the tool controller. Owns the dock's selection state — the picked tool (null = none) and which
// category flyout is open — mounts the toolbar over it, previews / applies the selected tool on the map, and
// keeps the sim-gated dock sync. A "line tool" (transport build 5..9 or transport convert) paints a dragged
// line; everything else is point-apply (src/ui/lineTools.ts reads the ToolDef's kind).
//
// Sim-cadence gating (Y5): the heavy availableTools / branchColumns derivations + signature compares run at
// most ONCE per frame, and only when a sim tick has moved state — the loop calls syncDock. Discrete events
// (select / hotkey / placement / an effort change) refresh directly and snapshot the signatures so the next
// gated check is a no-op. prevToolIds is SEEDED from the initial rows (Y7) so the first diff is empty → no
// spurious unlock flash on load.

import { TECH_TREE } from '../tech/tree';
import type { TechState } from '../tech/state';
import { availableTools, previewTool, applyTool, toolDef, type ToolDef, type ToolId, type ToolWorld, type Wallet } from '../tools/tools';
import { isLineTool } from '../ui/lineTools';
import { isRepairTool } from '../ui/repairTools';
import { toolbarRows, refreshSignature, addedIds } from '../ui/toolbarContent';
import { buildToolMenu, type ToolCategory } from '../ui/toolMenuContent';
import { branchColumns, panelSignature } from '../ui/techContent';
import type { ToolbarDeps, ToolbarHandle } from '../ui/toolbar';
import type { MetaButton } from '../ui/dockContent';
import type { PreviewTile } from '../ui/renderer';
import type { InputHandlers } from '../ui/input';

export interface ToolsDeps {
  world: ToolWorld;
  tech: TechState;
  /** The treasury the fabric is bought from (the economy's wallet; the menu prices against its funds). */
  wallet: Wallet;
  renderer: { setPreview(tiles: readonly PreviewTile[] | null): void; artImage(key: string): CanvasImageSource | undefined };
  /** The built layer changed → rebuild the cached base. */
  markDirty: () => void;
  /** Only the preview / selection changed → repaint (the preview lives in the composite, not the base). */
  markPreviewDirty: () => void;
  /** Mount the dock (`mountToolbar(document.body, …)` in the browser). */
  mount: (deps: ToolbarDeps) => ToolbarHandle;
  /** The dock's map/panel buttons: their active flags, and where a click goes. */
  meta: { buttons: () => MetaButton[]; onMeta: (id: MetaButton['id']) => void };
  /** The tech window — mounted AFTER the dock (DOM order), so read at call time. */
  techPanel: () => { isOpen(): boolean; refresh(): void; refreshHeader(): void };
  /** The inspect readout for the status line, from the pure tile readout `info`. */
  inspect: (info: string, tx: number, ty: number) => string;
  /** A placement / bulldoze succeeded: re-derive what reads the built layer (the grid, the smog sources). */
  placed: () => void;
  /** A repair-classified placement succeeded at its anchor tile (the tools→civic crossing). */
  repaired: (tx: number, ty: number) => void;
}

export interface ToolController {
  readonly toolbar: ToolbarHandle;
  selected(): ToolId | null;
  hasTool(): boolean;
  isLineTool(): boolean;
  /** The I / X hotkeys (input.ts): select inspect / bulldoze, anything else deselects. */
  hotkey(action: string): void;
  previewAt(tx: number, ty: number): void;
  applyAt(tx: number, ty: number): void;
  clearHover(): void;
  /** The map pointer's tool handlers (attachInput's, less the camera's onChange). */
  readonly input: Omit<InputHandlers, 'onChange'>;
  /** Effort moved outside a placement (a practice begun or granted, a loan): refresh + snapshot both signatures. */
  afterEffortChange(): void;
  /** The sim-gated sync: re-derive the dock rows and refresh / flash ONLY on a real change (+ the open tech panel). */
  syncDock(): void;
}

export function createToolController(deps: ToolsDeps): ToolController {
  const { world, tech, wallet, renderer } = deps;
  let selectedToolId: ToolId | null = null;
  // the open flyout; the picked tool stays selected with the flyout left open
  let openCategory: ToolCategory | null = null;

  const rows = () => toolbarRows(availableTools(tech), selectedToolId, tech.effort);
  const initRows = rows();
  let lastToolSig = refreshSignature(initRows);
  let prevToolIds: string[] = initRows.map((r) => r.id);
  let lastPanelSig = panelSignature(branchColumns(TECH_TREE, tech));
  const snapshotDock = (): void => {
    lastToolSig = refreshSignature(rows());
  };
  const snapshotPanel = (): void => {
    lastPanelSig = panelSignature(branchColumns(TECH_TREE, tech));
  };

  // a selection change: the prior preview and inspect readout are stale; preview-only repaint
  const select = (id: ToolId | null): void => {
    selectedToolId = id;
    renderer.setPreview(null);
    toolbar.setStatus(null);
    deps.markPreviewDirty();
    toolbar.refresh();
    snapshotDock(); // selection moved the signature → keep the sim-gated check a no-op
  };

  const toolbar = deps.mount({
    getMenu: () => buildToolMenu(availableTools(tech), selectedToolId, tech.effort, openCategory, wallet.funds),
    onSelect: (id) => select(id as ToolId),
    onToggleCategory: (id) => {
      openCategory = openCategory === id ? null : id;
      toolbar.refresh();
    },
    getMetaButtons: () => deps.meta.buttons(),
    onMeta: (id) => {
      deps.meta.onMeta(id);
      toolbar.refreshMeta();
    },
    art: (key) => renderer.artImage(key),
  });

  const selectedDef = (): ToolDef | undefined => (selectedToolId === null ? undefined : toolDef(selectedToolId));

  const previewAt = (tx: number, ty: number): void => {
    const def = selectedDef();
    if (!def) return;
    const p = previewTool(world, tech, def, tx, ty, wallet);
    renderer.setPreview([{ x: tx, y: ty, valid: p.valid }]);
    deps.markPreviewDirty(); // hover tile-change: preview only, never a base rebuild
  };

  const applyAt = (tx: number, ty: number): void => {
    const def = selectedDef();
    if (!def) return;
    const r = applyTool(world, tech, def, tx, ty, wallet);
    // Inspect is free + non-mutating: its readout goes to the dock status line.
    if (def.id === 'inspect') {
      toolbar.setStatus(deps.inspect(r.info ?? '', tx, ty));
      return;
    }
    if (!r.ok) return;
    deps.placed();
    deps.markDirty(); // mutated the built/parcel layer → rebuild the cached base
    // Effort changed → dock affordability + (if open) tech-panel affordability, snapshotted (the discrete path)
    toolbar.refresh();
    snapshotDock();
    const techPanel = deps.techPanel();
    if (techPanel.isOpen()) {
      techPanel.refresh();
      snapshotPanel();
    }
    previewAt(tx, ty); // re-tint the just-touched tile
    // Repair forwarding: a repair-classified placement credits the anchor tile's neighborhood (bulldoze is
    // excluded by isRepairTool; multi-tile builds credit the anchor).
    if (isRepairTool(def)) deps.repaired(tx, ty);
  };

  const hasTool = (): boolean => selectedToolId !== null;
  const lineTool = (): boolean => {
    const def = selectedDef();
    return def !== undefined && isLineTool(def);
  };
  const hotkey = (action: string): void =>
    select(action === 'inspect' ? 'inspect' : action === 'bulldoze' ? 'bulldoze' : null);
  const clearHover = (): void => {
    renderer.setPreview(null);
    deps.markPreviewDirty(); // cleared the preview only — no base change
  };

  return {
    toolbar,
    selected: () => selectedToolId,
    hasTool,
    isLineTool: lineTool,
    hotkey,
    previewAt,
    applyAt,
    clearHover,
    input: { hasTool, isLineTool: lineTool, applyAt, hover: previewAt, clearHover, onHotkey: hotkey },
    afterEffortChange: () => {
      toolbar.refresh();
      snapshotDock();
      snapshotPanel();
    },
    syncDock: () => {
      const r = rows();
      const sig = refreshSignature(r);
      if (sig !== lastToolSig) {
        toolbar.refresh();
        lastToolSig = sig;
      }
      const ids = r.map((row) => row.id);
      if (addedIds(prevToolIds, ids).length > 0) {
        toolbar.flash();
        prevToolIds = ids;
      }
      const techPanel = deps.techPanel();
      if (techPanel.isOpen()) {
        techPanel.refreshHeader();
        const psig = panelSignature(branchColumns(TECH_TREE, tech));
        if (psig !== lastPanelSig) {
          techPanel.refresh();
          lastPanelSig = psig;
        }
      }
    },
  };
}
