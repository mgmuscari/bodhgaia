// Browser entry point. Generates a world from the URL seed, then drives a
// requestAnimationFrame render loop and a fixed-tick simulation loop. The sim
// step is the composite orchestrator simTick (effort → ecology → civic); this
// shell only reads its deps for rendering. All DOM access is guarded so this
// module stays safe to import headless under Vitest.

import { runPipeline } from './worldgen/pipeline';
import { terrainStage } from './worldgen/terrain';
import { mosesCenturyStage } from './worldgen/moses';
import { ecoSeedStage } from './worldgen/ecoseed';
import { BuiltKind } from './engine/fabric';
import { createRng } from './engine/rng';
import { cityName } from './engine/names';
import { FixedTickLoop } from './engine/loop';
import { Camera } from './ui/camera';
import { Renderer } from './ui/renderer';
import { SIDEBAR_W } from './ui/toolbar';
import { installUiTheme } from './ui/uiTheme';
import { GpuRenderer } from './ui/gpuRenderer';
import { SmogOverlay } from './ui/smogOverlay';
import { createAmbientState, stepAmbient, setParkingLots, setHouseholds, setPlantEmitters, seedDecay, applyLiveCaps } from './ui/ambientContent';
import { loadSettings, saveSettings } from './ui/settingsStore';
import { mountSettingsPanel } from './ui/settingsPanel';
import { materializeSkin } from './ui/tilesetLoader';
import { paintSnesSkin } from './ui/snesTileset';
import { footprintCellKey } from './ui/renderKey';

import { mountHelpPanel } from './ui/helpPanel';
import { clampSettings, type LiveCaps, type WorldSettings } from './ui/settings';
import { residentialCensus } from './citizens/census';
import { parkingLots, parkingStalls } from './ui/parkingContent';
import { attachInput } from './ui/input';
import { pulseLine } from './ui/pulseContent';
import { mountPulseDock } from './ui/pulseDock';
import { sampleRestoration, restorationLines, type RestorationSample } from './ui/restorationContent';
import { mountRestorationPanel } from './ui/restorationPanel';
import { sampleUnhoused, unhousedSuffix } from './ui/unhousedContent';
import { isRepairTool } from './ui/repairTools';
import { TECH_TREE } from './tech/tree';
import { createTechState } from './tech/state';
import { wellbeing } from './tech/effort';
import { branchColumns, effortLine, panelSignature } from './ui/techContent';
import { techLayout } from './ui/techLayout';
import { mountTechPanel } from './ui/techPanel';
import { resolveKey, overlayKindOf } from './ui/keyMap';
import { availableTools, previewTool, applyTool, toolDef, type ToolId } from './tools/tools';
import { practiceProject } from './economy/run';
import { mountBudgetPanel } from './ui/budgetPanel';
import { isLineTool } from './ui/lineTools';
import { toolbarRows, refreshSignature, addedIds } from './ui/toolbarContent';
import { buildToolMenu, type ToolCategory } from './ui/toolMenuContent';
import { mountToolbar } from './ui/toolbar';
import { metaButtons } from './ui/dockContent';
import { computeNeighborhoods } from './civic/neighborhoods';
import { createCivicState } from './civic/state';
import { simTick, type SimDeps } from './civic/compose';
import { stepRevival } from './growth/revival';
import { plantPollution } from './growth/power';
import { captureGame, restoreWorld, restoreTech, restoreCivic, restoreLive, type SaveV1 } from './save/snapshot';
import { CURRENT, writeSlot, readSlot, deleteSlot, listSlots, loadSlot, newCity, exportFile, importFile } from './save/store';
import { mountSavesPanel } from './ui/savesPanel';
import { setPixelFavicon, installDevHandle } from './app/devHandle';
import { mountOpeningFor } from './app/opening';
import { inspectReadout } from './ui/inspectContent';
import { createPowerController } from './app/power';
import { createOverlayController, mountOverlayLegend } from './app/overlays';
import { createEconomyController } from './app/economy';

const DEFAULT_SEED = 'bodhitropolis';
const SIM_TICK_MS = 100;

export function main(save: SaveV1 | null = null): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('missing #game canvas');
  installUiTheme(); // the pixel UI kit: palette variables, 9-slice frames, pixel font

  const params = new URLSearchParams(window.location.search);

  // a resumed game (save/store.ts: the CURRENT slot) brings its own seed and size
  const seed = save?.seed ?? params.get('seed') ?? DEFAULT_SEED;

  // Settings: live caps apply NOW (perf ceilings the agent layer reads); the world size feeds
  // worldgen at creation (a different size is a different seeded world — apply-on-restart). Persisted
  // in localStorage; defaults reproduce today's 128² medium-preset game byte-for-byte.
  let settings = loadSettings();
  applyLiveCaps(settings.live);
  const world = runPipeline(
    { seed, width: save?.width ?? settings.world.mapWidth, height: save?.height ?? settings.world.mapHeight },
    [terrainStage(), mosesCenturyStage(), ecoSeedStage()],
  );

  // Tech-tree state: communal effort accrues into it each sim tick (see below).
  // Save/load: the world is regenerated from the seed, then the saved layers and parcels overwrite it — before
  // anything below derives from it (the partition, the census, the power grid…).
  if (save) restoreWorld(world, save.world);
  const tech = createTechState(TECH_TREE);
  if (save) restoreTech(tech, save.tech);

  // Civic state: the neighborhood partition + per-neighborhood belonging/voice/
  // trust. simTick refreshes the partition and remaps the state on the civic
  // cadence; this shell reads `deps.partition` to resolve a repair's tile.
  const partition = computeNeighborhoods(world.map);
  const civic = createCivicState(partition);
  if (save) restoreCivic(civic, save.civic);
  // effortAccrual 'economy': communal effort is the economy's perishable stock (src/economy), not a counter
  const deps: SimDeps = { world, tech, civic, partition, seed, effortAccrual: 'economy' };

  // The latest sim tick, captured for the repair-forwarding hook (which fires
  // from pointer events, outside the sim loop).
  let currentTick = 0;

  // The opening overlay owns its own keydown and exposes no active-state; the
  // single composition root tracks whether it is up so the key table suppresses
  // every game key underneath it (init: up unless `?nointro=1`).
  let overlayActive = params.get('nointro') !== '1' && !save; // a resumed city skips the opening

  // the map pane sits right of the docked tool palette, never under it
  document.documentElement.style.setProperty('--sidebar-w', `${SIDEBAR_W}px`);
  let cssWidth = window.innerWidth - SIDEBAR_W;
  let cssHeight = window.innerHeight;
  const camera = new Camera({
    mapWidth: world.map.width,
    mapHeight: world.map.height,
    viewportWidth: cssWidth,
    viewportHeight: cssHeight,
    zoom: save?.camera.zoom ?? 2,
    x: save?.camera.x,
    y: save?.camera.y,
  });

  // The one aesthetic (Maddy 2026-09-30): the code-painted Super (16-bit) skin, materialized before the
  // first frame (eager tiles now, buildings + light maps on first draw).
  const skin = materializeSkin(paintSnesSkin());
  const renderer = new Renderer(canvas, skin);
  setPixelFavicon(skin.lazy?.get(footprintCellKey(BuiltKind.HouseSingle, 1, 1, 0, 0, 0)));
  renderer.resize(cssWidth, cssHeight, window.devicePixelRatio || 1);
  canvas.style.position = 'fixed'; // the map pane, ABOVE the GPU canvas (z-index 0)
  canvas.style.left = 'var(--sidebar-w)';
  canvas.style.top = '0';
  canvas.style.zIndex = '1';

  // GPU hybrid path: a WebGL2 canvas under the Canvas2D sprite/UI layer, driven by the live camera.
  // settings.renderer picks it (default 'gpu'); mountGpu falls back to the CPU path (returns false)
  // if WebGL2 is unavailable.
  let gpuRenderer: GpuRenderer | null = null;
  let smogOverlay: SmogOverlay | null = null;
  const mountGpu = (): boolean => {
    try {
      gpuRenderer = new GpuRenderer(world.map);
      gpuRenderer.mount();
      gpuRenderer.resize(cssWidth, cssHeight, window.devicePixelRatio || 1);
      // GPU smog overlay (z2, above the sprite canvas) — the atmospheric haze on top of everything.
      smogOverlay = new SmogOverlay(world.map.width, world.map.height);
      smogOverlay.mount();
      smogOverlay.resize(cssWidth, cssHeight, window.devicePixelRatio || 1);
      renderer.setGpuMode(true);
      return true;
    } catch (e) {
      console.warn('WebGL2 unavailable — staying on the CPU renderer:', e);
      gpuRenderer?.dispose();
      smogOverlay?.dispose();
      gpuRenderer = null;
      smogOverlay = null;
      return false;
    }
  };
  const unmountGpu = (): void => {
    gpuRenderer?.dispose();
    smogOverlay?.dispose();
    gpuRenderer = null;
    smogOverlay = null;
    renderer.setGpuMode(false);
  };
  if (settings.renderer === 'gpu') mountGpu();

  // Two named dirty chokepoints (CRITIC-YP2). markDirty invalidates the cached
  // renderer base (map/camera/overlay changed); markPreviewDirty only requests a
  // repaint (preview/selection changed — it lives in the per-frame composite, not
  // the base, so a hover never triggers an O(visible-tiles) base rebuild). Forward
  // rule: a base/camera/overlay change calls markDirty(); a preview/selection-only
  // change calls markPreviewDirty(); never a raw `dirty = true`.
  let dirty = true;
  const markDirty = (): void => {
    dirty = true;
    renderer.invalidateBase();
    gpuRenderer?.invalidate(); // re-pack the world grid for the GPU path (cheap dirty-rect upload)
  };
  const markPreviewDirty = (): void => {
    dirty = true;
  };

  // Ambient life (purely visual, read-only). A SEPARATE rng fork + a SEPARATE clock
  // so ambient timing can never perturb the sim: the sim's `last` is owned by the
  // sim path alone (its FixedTickLoop clamp owns catch-up), and `lastAmbient` is
  // owned by the ambient path (its own stepAmbient clamp owns catch-up). Default on
  // (PRD Q2); the [Life] toggle / L key flip it. ambientOn=false restores the exact
  // legacy dirty-driven render path.
  let ambientOn = true;
  const ambientRng = createRng(seed).fork('ambient');
  // Seed the ambient state (incl. the world's prevailing wind) from the ambient fork — a SEPARATE
  // fork so the wind draw never advances the per-frame ambient stream below.
  const ambientState = createAmbientState(createRng(seed).fork('ambient-wind'));
  // Revival/decay rng: a stable stream for the slow-cadence growth seam (densify
  // draws). Forked off the world seed, independent of the ambient + sim streams.
  const revivalRng = createRng(seed).fork('revival');
  let lastAmbient = performance.now();

  // The parking lots that STORE the moving cars: a trip-car parks in the nearest one on
  // arrival (cars=trips, lots=storage). Each lot publishes its centre + stall grid.
  // Recomputed at startup and on each civic tick so it tracks the built layer as the
  // player rezones lots.
  const refreshParkingLots = (): void => {
    setParkingLots(
      ambientState,
      parkingLots(world.map).map((lot) => ({
        cx: (lot.x0 + lot.x1) / 2,
        cy: (lot.y0 + lot.y1) / 2,
        x0: lot.x0,
        y0: lot.y0,
        x1: lot.x1,
        y1: lot.y1,
        stalls: parkingStalls(lot),
      })),
    );
  };
  refreshParkingLots();

  // The residential census the ambient layer spawns daily-itinerary citizens from. Recomputed
  // at startup and on each civic tick so it tracks homes as the city grows/decays.
  const refreshHouseholds = (): void => {
    setHouseholds(ambientState, residentialCensus(world.parcels));
  };
  refreshHouseholds();

  // Power grid (src/app/power.ts): solved now for the current in-game hour and published to the renderer;
  // re-solved on placement, the civic cadence, and each new in-game hour (frame loop).
  const power = createPowerController({
    map: world.map,
    parcels: world.parcels,
    publish: (anchors) => renderer.setPowerGrid(anchors),
  });

  // Dirty-plant smog: publish the air-pollution emitters from the built layer (each
  // coal/gas plant smogs its footprint + a 2-tile plume). Recomputed on placement;
  // the live pollution field (cars + plants) drags land value → occupancy → revival,
  // so dirty power poisons what it powers and renewables read clean.
  const PLUME_RADIUS = 2;
  const recomputePlantEmitters = (): void => {
    const emitters: { tile: number; amount: number }[] = [];
    for (const idx of world.parcels.aliveIndices()) {
      const p = world.parcels.get(idx);
      const amt = plantPollution(p.kind);
      if (amt <= 0) continue;
      for (let yy = -PLUME_RADIUS; yy < p.height + PLUME_RADIUS; yy++) {
        for (let xx = -PLUME_RADIUS; xx < p.width + PLUME_RADIUS; xx++) {
          const tx = p.x + xx;
          const ty = p.y + yy;
          if (world.map.inBounds(tx, ty)) emitters.push({ tile: world.map.idx(tx, ty), amount: amt });
        }
      }
    }
    setPlantEmitters(ambientState, emitters);
  };
  recomputePlantEmitters();

  // The city starts DECAYED: a century of car-culture has already trampled the urban ground
  // into desire paths and polluted the shorelines, before the player arrives to heal it.
  seedDecay(ambientState, world.map);
  if (save) restoreLive(ambientState, save.live); // the saved stocks over the seeded decay

  // Dev / live-pass hook (`window.bodhitropolis`) — DEV BUILDS ONLY (folded away in production). It reads the
  // reassigned power grid / GPU renderer through getters, never snapshots.
  if (import.meta.env.DEV) {
    installDevHandle({
      camera,
      world,
      ambient: ambientState,
      tech,
      power: power.grid,
      markDirty,
      gpu: { isOn: () => gpuRenderer !== null, mount: mountGpu, unmount: unmountGpu },
    });
  }

  // Opening challenge overlay. Computed from the same world, mounted over the
  // live map unless `?nointro=1`. The map input stays attached beneath; the
  // overlay captures pointer events until the player dismisses it (Begin /
  // Enter / Escape), after which the map is interactive.
  if (params.get('nointro') !== '1' && !save) {
    mountOpeningFor(world, seed, () => {
      overlayActive = false;
      markDirty();
    });
  }

  // ── The economy (src/app/economy.ts): funds, perishable effort, burnout, approval and rent, stepped every
  // in-game hour from the frame loop. The hour tells the shell what to refresh through `ui`; autosave is read
  // at call time (the Saves wiring below fills it in and blanks it on load / new city).
  let autosave = (): void => {};
  const economy = createEconomyController({
    map: world.map,
    parcels: world.parcels,
    tech,
    civic,
    sim: deps,
    live: ambientState,
    powerGrid: power.grid,
    initial: save?.econ ?? null,
    autosave: () => autosave(),
    ui: {
      practiceGranted: () => {
        toolbar.refresh();
        toolbar.flash();
        snapshotDock();
        snapshotPanel();
        techPanel.refresh();
      },
      hourRefreshed: (reliefNow) => {
        toolbar.refresh();
        techPanel.refresh(); // projects advanced (no-op while the panel is closed)
        budgetPanel.refresh();
        if (reliefNow) budgetPanel.open(); // the grant and its strings, shown as they arrive
      },
      pulse: () => pulseDock.set(`${economy.readout()}  ·  ${lastPulse}`),
    },
  });
  const wallet = economy.wallet;
  // The Budget window: tax sliders, the police line, the hourly ledger, and loans (Maddy 2026-10-01: "we need
  // taxes and loans, once you go negative you can't dig back out")
  const budgetPanel = mountBudgetPanel(document.body, {
    getView: () => economy.budgetView(),
    onTax: (cls, rate) => economy.setTax(cls, rate),
    onPolice: (perHour) => economy.setPolice(perHour),
    onBorrow: (amount) => {
      if (!economy.borrow(amount)) return;
      toolbar.refresh(); // the fabric may be affordable again
      pulseDock.set(`${economy.readout()}  ·  ${lastPulse}`);
    },
    onToggle: () => toolbar.refreshMeta(),
  });

  // Tech panel: right-docked, toggled by `T` (via the one key table below). Zero game imports — it
  // receives its content and the unlock action through deps.
  const techPanel = mountTechPanel(document.body, {
    getContent: () => ({ effort: effortLine(tech), layout: techLayout(TECH_TREE, tech) }),
    art: (key) => renderer.artImage(key),
    progress: (id) => economy.projectProgress(id),
    costLine: (id) => {
      const node = TECH_TREE.find((n) => n.id === id);
      if (!node) return '';
      const p = practiceProject(node);
      return `${p.effort} effort + $${p.funds.toLocaleString('en-US')} over ${Math.round(p.hours / 24 * 10) / 10} days`;
    },
    // Cheap per-tick header source (no branchColumns derive) for refreshHeader (Y5).
    getEffort: () => effortLine(tech),
    onUnlock: (id) => {
      // a practice is begun as a project (effort + funds over time); it unlocks when the work is done
      const ok = economy.beginPractice(id);
      if (ok) {
        // The panel re-renders itself (its delegated click listener). Refresh the
        // dock too — effort dropped (affordability) and an unlock may grant a new
        // tool — and snapshot both signatures so the next sim-gated check is a
        // no-op. The unlock FLASH still fires from the sim-gated addedIds path.
        toolbar.refresh();
        snapshotDock();
        snapshotPanel();
      }
      return ok;
    },
    // Y3: fired for the T key, the dock [Tech] button, AND any dismiss — keeps the
    // dock's [Tech] active-state in sync from ONE callback, off the rAF frame.
    onToggle: () => toolbar.refreshMeta(),
  });

  // Tool state: the selected tool id (null = none). A "line tool" (transport build
  // 5..9 or transport convert) paints a dragged line; everything else — building
  // build AND building convert (rezoning greens) — is point-apply. The predicate
  // lives in src/ui/lineTools.ts (pure, unit-tested); it reads the ToolDef's kind.
  let selectedToolId: ToolId | null = null;
  // Which category flyout is open in the dock (null = none). Toggled by clicking a
  // category tile; the picked tool stays selected with the flyout left open.
  let openCategory: ToolCategory | null = null;

  // The map overlays (src/app/overlays.ts): ONE active overlay, cycled by its key or dock button. Created
  // HERE — before the dock mount — because the dock's getMetaButtons reads it at mount and on every
  // refreshMeta. The colour key mounts further down (showLegend); its tint reads this context per apply.
  const overlays = createOverlayController({
    renderer,
    context: () => ({
      map: world.map,
      parcels: world.parcels,
      live: ambientState,
      poweredAnchors: power.grid().poweredAnchors,
      civic: deps.civic,
      tileToNeighborhood: deps.partition.tileToNeighborhood,
    }),
    showLegend: (legend) => showLegend(legend),
    setStatus: (text) => toolbar.setStatus(text),
    markDirty,
    refreshMeta: () => toolbar.refreshMeta(),
  });

  // Bottom tool dock: always on, derived from tech grants + selection + effort. The
  // meta row ([Tech][Eco][Civic]) mirrors the T/E/C keys: getMetaButtons derives
  // the active flags from the live panel/overlay state; onMeta routes a click to
  // the SAME closures the keys use (techPanel.toggle / overlays.cycle).
  // Panels the palette opens; mounted further down, so the palette reaches them through this holder
  // (reading their consts before they're declared would throw).
  type PanelHandle = { toggle(): boolean; visible(): boolean };
  const panels: { restore?: PanelHandle; settings?: PanelHandle; help?: PanelHandle; saves?: PanelHandle } = {};

  const toolbar = mountToolbar(document.body, {
    getMenu: () => buildToolMenu(availableTools(tech), selectedToolId, tech.effort, openCategory, economy.run().state.funds),
    onSelect: (id) => {
      selectedToolId = id as ToolId;
      renderer.setPreview(null);
      toolbar.setStatus(null); // a prior inspect readout is stale on tool change
      markPreviewDirty(); // selection-only: the preview lives in the composite
      toolbar.refresh();
      snapshotDock(); // selection moved the signature → keep the sim-gated check a no-op
    },
    onToggleCategory: (id) => {
      openCategory = openCategory === id ? null : id;
      toolbar.refresh();
    },
    getMetaButtons: () =>
      metaButtons(techPanel.isOpen(), overlays.active(), ambientOn, {
        restore: panels.restore?.visible() ?? false,
        settings: panels.settings?.visible() ?? false,
        help: panels.help?.visible() ?? false,
        budget: budgetPanel.visible(),
        saves: panels.saves?.visible() ?? false,
      }),
    onMeta: (id) => {
      if (id === 'tech') techPanel.toggle();
      else if (id === 'life') setAmbient(!ambientOn); // same toggle the L key calls
      else if (id === 'restore') panels.restore?.toggle();
      else if (id === 'settings') panels.settings?.toggle();
      else if (id === 'help') panels.help?.toggle();
      else if (id === 'budget') budgetPanel.toggle();
      else if (id === 'saves') panels.saves?.toggle();
      else overlays.cycle(id); // a map overlay — the SAME closure its letter key calls
      toolbar.refreshMeta();
    },
    art: (key) => renderer.artImage(key),
  });

  // Sim-cadence gating (Y5): the heavy availableTools / branchColumns derivations +
  // signature compares run at most ONCE per frame, and only when a sim tick has
  // moved state (simChanged) — NOT every rAF frame. Discrete events (select /
  // hotkey / unlock) refresh directly and snapshot the signature so the immediately
  // following gated check is a no-op. prevToolIds is SEEDED from the initial rows
  // (Y7) so the first diff is empty → no spurious unlock flash on load.
  const initRows = toolbarRows(availableTools(tech), selectedToolId, tech.effort);
  let lastToolSig = refreshSignature(initRows);
  let prevToolIds: string[] = initRows.map((r) => r.id);
  let lastPanelSig = panelSignature(branchColumns(TECH_TREE, tech));
  let simChanged = false;

  const snapshotDock = (): void => {
    lastToolSig = refreshSignature(toolbarRows(availableTools(tech), selectedToolId, tech.effort));
  };
  const snapshotPanel = (): void => {
    lastPanelSig = panelSignature(branchColumns(TECH_TREE, tech));
  };

  // The sim-gated sync (run once per frame when simChanged): re-derive the dock
  // rows + signature and refresh ONLY on a real change; flash the dock when a new
  // tool id appears (Y7); while the panel is open, cheaply refresh its header each
  // tick and fully refresh only when the panel signature flips (a status change).
  const syncDock = (): void => {
    const rows = toolbarRows(availableTools(tech), selectedToolId, tech.effort);
    const sig = refreshSignature(rows);
    if (sig !== lastToolSig) {
      toolbar.refresh();
      lastToolSig = sig;
    }
    const ids = rows.map((r) => r.id);
    if (addedIds(prevToolIds, ids).length > 0) {
      toolbar.flash();
      prevToolIds = ids;
    }
    if (techPanel.isOpen()) {
      techPanel.refreshHeader();
      const psig = panelSignature(branchColumns(TECH_TREE, tech));
      if (psig !== lastPanelSig) {
        techPanel.refresh();
        lastPanelSig = psig;
      }
    }
  };

  // Always-on wellbeing pulse dock: its OWN dedicated element (not the shared
  // toolbar status, which inspect/legend clobber), refreshed on the civic cadence
  // only to avoid per-tick flicker. The trend compares to the previous cadence.
  const pulseDock = mountPulseDock(document.body);
  let prevWellbeing: number | null = null;
  // Unhoused residents (first cut): displaced-population count appended to the pulse line, trended on
  // the civic cadence. Loop-coupled — decline raises it, healing/new housing lowers it.
  let prevUnhoused: number | null = null;
  let lastPulse = '';
  const pulseText = (wb: number): string => {
    // the unhoused: those the city's decline left without a home, plus households rent displaced
    const unhoused = sampleUnhoused(ambientState, world.map.width).unhoused + Math.round(economy.run().state.displaced);
    lastPulse = `${pulseLine(wb, prevWellbeing)}  ·  ${unhousedSuffix(unhoused, prevUnhoused)}`;
    prevUnhoused = unhoused;
    return `${economy.readout()}  ·  ${lastPulse}`;
  };
  const wellbeingNow = (): number =>
    wellbeing({ parcels: world.parcels, ecoMeans: deps.ecoMeans, civicMeans: deps.civicMeans });
  pulseDock.set(pulseText(wellbeingNow())); // initial: flat, no prior cadence

  // Restoration readout panel (G): "is my renewal helping?" — surveys the live metrics (land value,
  // population, building health, ecology, air/ground/water pollution) with improvement-oriented trend
  // arrows. Hidden by default; sampled on the civic cadence vs the previous sample only while shown.
  const restorationPanel = mountRestorationPanel(document.body);
  panels.restore = restorationPanel;
  let prevRestoration: RestorationSample | null = null;

  // Settings panel (',' key): live caps apply instantly via applyLiveCaps; world size persists for the
  // next load. Every change re-persists the whole settings blob so a reload restores it.
  const settingsPanel = mountSettingsPanel(document.body, {
    getSettings: () => settings,
    onLiveChange: (live: LiveCaps): void => {
      // clamp the merged blob so applied == persisted == shown (the input could be out of range)
      settings = clampSettings({ ...settings, live: { ...settings.live, ...live } });
      applyLiveCaps(settings.live);
      saveSettings(settings);
    },
    onWorldChange: (worldSettings: WorldSettings): void => {
      settings = clampSettings({ ...settings, world: { ...worldSettings } });
      saveSettings(settings); // takes effect on the next load (regenerate)
    },
    onRendererChange: (mode): void => {
      settings = clampSettings({ ...settings, renderer: mode });
      saveSettings(settings);
      if (mode === 'gpu') {
        if (!gpuRenderer) mountGpu();
      } else {
        unmountGpu();
      }
      markDirty();
    },
  });

  // Always-visible controls hint (bottom-left) → opens a full keybinding reference. Makes every key
  // (Settings included) discoverable; toggled by the hint, the ✕, or '?'/'h'.
  const helpPanel = mountHelpPanel(document.body);
  panels.help = helpPanel;
  panels.settings = settingsPanel;
  toolbar.refreshMeta();

  // The overlay colour key (top-left over the map), shown/hidden by the overlay controller.
  const showLegend = mountOverlayLegend(document.body);

  // The [Life] ambient toggle — one closure for the L key AND (Task 4) the dock
  // [Life] button. Flips ambientOn, resets ONLY the ambient clock when turning ON
  // (so the first dt after a dormant period is small — also clamp-guarded), repaints
  // via markDirty, and refreshes the dock meta active-state.
  const setAmbient = (on: boolean): void => {
    ambientOn = on;
    if (on) lastAmbient = performance.now();
    markDirty();
    toolbar.refreshMeta();
  };

  // a click on the top bar (funds and the rest) opens the Budget window (B, via the key table below)
  document.querySelector('.pulse-dock')?.addEventListener('click', () => budgetPanel.toggle());

  // ── Save/load (src/save): the city autosaves into the CURRENT slot and a reload resumes it. The Saves
  // window (S, or the palette's disk) saves into new slots, loads, exports and imports `.bodhi` files.
  const cityTitle = save?.name ?? cityName(createRng(seed).fork('city-name'));
  const captureNow = (): SaveV1 =>
    captureGame({
      seed,
      name: cityTitle,
      savedAt: Date.now(),
      world,
      tech,
      civic,
      econ: economy.run(),
      live: ambientState,
      tick: currentTick,
      camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
    });
  let saving = false;
  autosave = (): void => {
    if (saving) return; // one write at a time
    saving = true;
    writeSlot(CURRENT, captureNow())
      .catch((e: unknown) => console.warn('[save] autosave failed:', e))
      .finally(() => {
        saving = false;
      });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) autosave(); // leaving the tab (or closing it) keeps the city
  });
  window.addEventListener('pagehide', () => autosave());
  const savesPanel = mountSavesPanel(document.body, {
    list: listSlots,
    saveNew: async () => {
      const snap = captureNow();
      await writeSlot(`slot-${snap.savedAt}`, snap);
    },
    load: async (id) => {
      autosave = () => {}; // don't let a last autosave overwrite the slot being loaded
      await loadSlot(id);
    },
    remove: deleteSlot,
    exportSave: async (id) => {
      const snap = id ? await readSlot(id) : captureNow();
      if (snap) await exportFile(snap);
    },
    importFile: async (file) => {
      const snap = await importFile(file);
      await writeSlot(`slot-${Date.now()}`, { ...snap, savedAt: snap.savedAt || Date.now() });
    },
    newCity: async () => {
      autosave = () => {};
      await newCity();
    },
    onToggle: () => toolbar.refreshMeta(),
  });
  panels.saves = savesPanel;

  // ONE keydown listener for every game toggle, resolved through the pure key table (src/ui/keyMap.ts): it
  // never fires with Cmd/Ctrl/Alt held (browser shortcuts — Cmd+L, Cmd+R, Cmd+, … — pass through) nor under
  // the opening overlay, nor while typing in a text field (resolveKey reads `event.target`). Each action calls
  // the same closure its dock button does. preventDefault only on a match.
  window.addEventListener('keydown', (event) => {
    const action = resolveKey(event, overlayActive); // `event` carries its target → editable fields are skipped
    if (action === null) return;
    event.preventDefault();
    const overlay = overlayKindOf(action);
    if (overlay !== null) {
      overlays.cycle(overlay); // the same body the dock's overlay buttons call
      return;
    }
    switch (action) {
      case 'budget':
        budgetPanel.toggle();
        break;
      case 'saves':
        savesPanel.toggle();
        break;
      case 'life':
        setAmbient(!ambientOn);
        break;
      case 'restoration':
        // on open, show a fresh sample at once (flat — no spurious arrows from a stale prior); the civic
        // cadence then trends it
        if (restorationPanel.toggle()) {
          const sample = sampleRestoration(ambientState, world.map);
          restorationPanel.set(restorationLines(sample, null));
          prevRestoration = sample;
        }
        break;
      case 'settings':
        settingsPanel.toggle();
        break;
      case 'help':
        helpPanel.toggle();
        break;
      case 'tech':
        techPanel.toggle();
        break;
    }
  });

  const previewAt = (tx: number, ty: number): void => {
    if (selectedToolId === null) return;
    const def = toolDef(selectedToolId);
    if (!def) return;
    const p = previewTool(world, tech, def, tx, ty, wallet);
    renderer.setPreview([{ x: tx, y: ty, valid: p.valid }]);
    markPreviewDirty(); // hover tile-change: preview only, never a base rebuild
  };

  const applyAt = (tx: number, ty: number): void => {
    if (selectedToolId === null) return;
    const def = toolDef(selectedToolId);
    if (!def) return;
    const r = applyTool(world, tech, def, tx, ty, wallet);
    // Inspect is free + non-mutating: surface its readout to the dock status line
    // (PRD: a minimal console-free line in the dock) without the mutate-path churn.
    if (def.id === 'inspect') {
      // The pure readout NAMES the seeded tile; inspectReadout appends the LIVE samples the ambient layer
      // carries, the power status and the redline grade (src/ui/inspectContent.ts).
      toolbar.setStatus(inspectReadout(r.info ?? '', tx, ty, world, ambientState, power.grid().poweredAnchors));
      return;
    }
    if (r.ok) {
      power.recompute(); // built layer changed → re-derive the grid (a new plant lights its district)
      recomputePlantEmitters(); // a placed/bulldozed dirty plant changes the smog sources
      markDirty(); // mutated the built/parcel layer → rebuild the cached base
      // Effort changed → dock affordability + (if open) tech-panel affordability.
      // Refresh directly and snapshot both signatures so the next sim-gated check
      // is a no-op (the discrete-event path, per Y5).
      toolbar.refresh();
      snapshotDock();
      if (techPanel.isOpen()) {
        techPanel.refresh();
        snapshotPanel();
      }
      previewAt(tx, ty); // re-tint the just-touched tile
      // Repair forwarding (the sanctioned tools→civic crossing): a successful
      // repair-classified placement credits the anchor tile's neighborhood from
      // the LIVE partition. id 0 (no neighborhood) is a safe no-op; bulldoze is
      // excluded by isRepairTool. Multi-tile builds credit the anchor (tx, ty).
      if (isRepairTool(def)) {
        const nid = deps.partition.tileToNeighborhood[world.map.idx(tx, ty)] ?? 0;
        deps.civic.recordRepair(nid, currentTick);
      }
    }
  };

  attachInput(canvas, camera, {
    onChange: markDirty,
    hasTool: () => selectedToolId !== null,
    isLineTool: () => selectedToolId !== null && isLineTool(toolDef(selectedToolId)!),
    applyAt,
    hover: previewAt,
    clearHover: () => {
      renderer.setPreview(null);
      markPreviewDirty(); // cleared the preview only — no base change
    },
    onHotkey: (action) => {
      selectedToolId = action === 'inspect' ? 'inspect' : action === 'bulldoze' ? 'bulldoze' : null;
      renderer.setPreview(null);
      toolbar.setStatus(null);
      markPreviewDirty(); // selection/preview only — preview is in the composite
      toolbar.refresh();
      snapshotDock(); // selection moved the signature → keep the sim-gated check a no-op
    },
  });

  window.addEventListener('resize', () => {
    cssWidth = window.innerWidth - SIDEBAR_W;
    cssHeight = window.innerHeight;
    camera.setViewport(cssWidth, cssHeight);
    renderer.resize(cssWidth, cssHeight, window.devicePixelRatio || 1);
    gpuRenderer?.resize(cssWidth, cssHeight, window.devicePixelRatio || 1);
    smogOverlay?.resize(cssWidth, cssHeight, window.devicePixelRatio || 1);
    gpuRenderer?.invalidateBase(); // base canvas resized → re-upload it next frame
    markDirty();
  });

  // Tab visibility: on becoming visible, reset ONLY the ambient clock (so the
  // ambient dt doesn't jump) and request a repaint. The sim's `last` is deliberately
  // NOT reset — its FixedTickLoop catch-up (a long hidden gap clamped to maxFrameMs)
  // must run exactly as today, keeping sim output byte-identical whether ambient is
  // on or off (AC#7). The ambient clamp already makes a missed reset harmless, so
  // this handler is for smoothness, not safety.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    lastAmbient = performance.now();
    markDirty();
  });

  // Simulation loop: the composite orchestrator advances effort every tick and
  // ecology/civic on their cadences. Each tick sets simChanged so the next frame
  // re-derives the dock/panel signatures ONCE (~10Hz), not per rAF frame (Y5).
  // Overlays re-push on their source's tick; the pulse refreshes on the civic
  // cadence only.
  const sim = new FixedTickLoop(SIM_TICK_MS, (tick) => {
    currentTick = tick;
    const r = simTick(deps, tick);
    simChanged = true; // effort accrued / grants may have moved → re-sync next frame
    // NOTE: the sim no longer runs abstract O-D trips (compose.ts: trafficTicked is always false). The
    // agent layer IS the traffic: the CITIZENS (owned cars + walkers/cyclists/transit riders) lay the
    // live traffic density as they actually drive, and are persistent — they park and are walked to,
    // never popping out of existence at a destination.
    overlays.onSimTick(r); // the active overlay's source ticked → re-push it
    if (r.civicTicked) {
      const wb = wellbeingNow();
      pulseDock.set(pulseText(wb));
      prevWellbeing = wb;
      // Restoration readout: sample the live metrics on this cadence and trend vs the prior sample
      // (only while the panel is shown — no work when hidden).
      if (restorationPanel.visible()) {
        const sample = sampleRestoration(ambientState, world.map);
        restorationPanel.set(restorationLines(sample, prevRestoration));
        prevRestoration = sample;
      }
      // Revival/decay seam: sample the LIVE occupancy into the hashed stock — thriving
      // homes heal + densify (R1→R2→R3), struggling ones crumble toward a derelict
      // ruin (reversibly). Runs HERE on the slow civic cadence (sim side), never in
      // stepAmbient (which must leave the world hash untouched) and never in simTick
      // (the N=120 gate pins its stock byte-stable). markDirty only on a real change.
      // Re-derive the grid FIRST so revival reads the current power state, then run
      // the seam: a powered home heals/densifies by occupancy; an unpowered one is
      // hard-gated (no growth, slow decay) until the player restores power.
      const powerChanged = power.recompute();
      const revived = stepRevival(
        world,
        (tile) => ambientState.occupancy.get(tile),
        revivalRng,
        (tile) => power.grid().poweredAnchors.has(tile),
      );
      refreshParkingLots(); // the player may have rezoned a lot → refresh the storage set
      refreshHouseholds(); // homes may have grown/decayed → refresh who's out living their day
      if (revived > 0 || powerChanged) markDirty(); // stock/grid changed → rebuild base
    }
  }, { startTick: save?.tick ?? 0 }); // a resumed game keeps its clock (repair rings are stamped in ticks)
  let last = performance.now();
  let lastBaseRefresh = 0;
  const frame = (now: number): void => {
    // a new in-game hour: demand re-draws and the blackout may roll to another block
    if (power.maybeResolveHour(now)) markDirty();
    // the economy steps once per in-game hour (catching up a few if the tab was in the background)
    economy.advance(now);
    // Sim path is VERBATIM today's — two independent clocks (YP3): `last` drives the
    // sim (its FixedTickLoop clamp owns catch-up); never fold the ambient dt into it.
    sim.advance(now - last);
    last = now;
    // Wear/junk/tents are baked into the cached base (under the agents); refresh it on a slow cadence so
    // newly-worn ground + encampments appear even with a static camera (they evolve over many seconds).
    if (now - lastBaseRefresh > 2000) {
      lastBaseRefresh = now;
      renderer.invalidateBase();
    }
    if (ambientOn && !document.hidden) {
      // Continuous ambient path: step the ambient sim on its OWN clock (its Task-1
      // clamp owns catch-up), then composite + sprites. The base rebuilds inside
      // renderFrame iff invalidated, so this stays cheap.
      ambientState.walkable = tech.hasCapability('walkability'); // Walkable Streets: people walk farther
      stepAmbient(ambientState, world.map, ambientRng, now - lastAmbient);
      lastAmbient = now;
      renderer.renderFrame(world, camera, ambientState);
      dirty = false;
    } else if (dirty || gpuRenderer) {
      // Legacy ambient-OFF path: repaint only when something changed. With GPU on we still run the
      // composite (it produces/clears the base the GPU samples) each frame the base is dirty.
      if (dirty) renderer.render(world, camera);
      dirty = false;
    }
    // GPU hybrid: render the WebGL map EVERY frame (animates via u_time), AFTER the CPU base pass so
    // it samples the freshest baked tiles. The base re-uploads only when its version changed.
    gpuRenderer?.render(camera, cssWidth, cssHeight, now / 1000, renderer.baseCanvas(), renderer.baseVersion());
    // GPU glow: headlights, cruiser bars and lit windows cast onto the ground (the agents are pixel art above).
    if (gpuRenderer && ambientOn) gpuRenderer.renderAgents(ambientState, camera, cssWidth, cssHeight, now / 1000, renderer.emissiveBuildingList(), renderer.headlightBeams());
    // GPU smog overlay (z2, above sprites): the atmospheric haze, now on the GPU instead of CPU plumes.
    if (smogOverlay && ambientOn) smogOverlay.render(camera, cssWidth, cssHeight, now / 1000, ambientState.pollution, ambientState.wind);
    // Sim-gated (Y5): re-derive the dock/panel signatures + refresh on change ONLY
    // when a sim tick has run since the last sync — not every rAF frame.
    if (simChanged) {
      syncDock();
      simChanged = false;
    }
    window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);
}

// Boot: resume the game in progress (the CURRENT slot, kept by autosave) unless `?new` asks for a fresh city;
// an unreadable save is set aside with a warning rather than blocking the game.
if (typeof document !== 'undefined') {
  const fresh = new URLSearchParams(window.location.search).has('new');
  (fresh ? Promise.resolve(null) : readSlot(CURRENT))
    .catch((e: unknown) => {
      console.warn('[save] could not resume the city in progress:', e);
      return null;
    })
    .then((save) => main(save));
}
