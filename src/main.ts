// Browser entry point. Generates a world from the URL seed, then drives a
// requestAnimationFrame render loop and a fixed-tick simulation loop. The sim
// step is the composite orchestrator simTick (effort → ecology → civic); this
// shell only reads its deps for rendering. All DOM access is guarded so this
// module stays safe to import headless under Vitest.

import { runPipeline } from './worldgen/pipeline';
import { terrainStage } from './worldgen/terrain';
import { mosesCenturyStage } from './worldgen/moses';
import { ecoSeedStage } from './worldgen/ecoseed';
import { createRng } from './engine/rng';
import { cityName } from './engine/names';
import { installUiTheme } from './ui/uiTheme';
import { loadSettings, saveSettings } from './ui/settingsStore';

import { clampSettings, type LiveCaps, type WorldSettings } from './ui/settings';
import { attachInput } from './ui/input';
import { mountPulseDock } from './ui/pulseDock';
import { sampleRestoration } from './ui/restorationContent';
import { sampleUnhoused } from './ui/unhousedContent';
import { TECH_TREE } from './tech/tree';
import { createTechState } from './tech/state';
import { wellbeing } from './tech/effort';
import { installKeys } from './app/keys';
import { createToolController } from './app/tools';
import { mountToolbar } from './ui/toolbar';
import { metaButtons } from './ui/dockContent';
import { computeNeighborhoods } from './civic/neighborhoods';
import { createCivicState } from './civic/state';
import type { SimDeps } from './civic/compose';
import { restoreWorld, restoreTech, restoreCivic, type SaveV1 } from './save/snapshot';
import { CURRENT, readSlot } from './save/store';
import { mountSavesPanel } from './ui/savesPanel';
import { installDevHandle } from './app/devHandle';
import { mountOpeningFor } from './app/opening';
import { inspectReadout } from './ui/inspectContent';
import { createPowerController } from './app/power';
import { createOverlayController, mountOverlayLegend } from './app/overlays';
import { createEconomyController } from './app/economy';
import { createSaves } from './app/saves';
import { createPanelRegistry, createPulse, isPanelId, mountPanels } from './app/panels';
import { createLive } from './app/live';
import { createView } from './app/view';
import { createSimTick, createFrame } from './app/loop';

const DEFAULT_SEED = 'bodhitropolis';

export function main(save: SaveV1 | null = null): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('missing #game canvas');
  installUiTheme(); // the pixel UI kit: palette variables, 9-slice frames, pixel font

  const params = new URLSearchParams(window.location.search);

  // a resumed game (save/store.ts: the CURRENT slot) brings its own seed and size
  const seed = save?.seed ?? params.get('seed') ?? DEFAULT_SEED;

  // Settings: the live caps apply when the live layer is set up (perf ceilings the agent layer reads); the world
  // size feeds worldgen at creation (a different size is a different seeded world — apply-on-restart).
  // Persisted in localStorage; defaults reproduce today's 128² medium-preset game byte-for-byte.
  let settings = loadSettings();
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

  // The opening overlay owns its own keydown and exposes no active-state; the
  // single composition root tracks whether it is up so the key table suppresses
  // every game key underneath it (init: up unless `?nointro=1`).
  let overlayActive = params.get('nointro') !== '1' && !save; // a resumed city skips the opening

  // The map view (src/app/view.ts): the camera, the Canvas2D renderer, the optional GPU hybrid (settings.renderer
  // picks it; it falls back to the CPU path without WebGL2), the pane size and the two dirty chokepoints.
  const view = createView({ canvas, map: world.map, camera: save?.camera, mode: settings.renderer });
  const { camera, renderer, markDirty, markPreviewDirty } = view;

  // The live layer (src/app/live.ts): ambient life, purely visual and read-only over the world — its own rng
  // forks and its own clock, so it can never perturb the sim. It publishes the parking lots, households and
  // dirty-plant emitters it reads, seeds the decay a century left (a save's stocks go over it), and applies
  // the live caps. On by default (PRD Q2); the [Life] toggle / L key flip `live.on`.
  const live = createLive({
    seed,
    map: world.map,
    parcels: world.parcels,
    caps: settings.live,
    saved: save?.live ?? null,
    walkable: () => tech.hasCapability('walkability'), // Walkable Streets: people walk farther
  });

  // Power grid (src/app/power.ts): solved now for the current in-game hour and published to the renderer;
  // re-solved on placement, the civic cadence, and each new in-game hour (frame loop).
  const power = createPowerController({
    map: world.map,
    parcels: world.parcels,
    publish: (anchors) => renderer.setPowerGrid(anchors),
  });


  // Dev / live-pass hook (`window.bodhitropolis`) — DEV BUILDS ONLY (folded away in production). It reads the
  // reassigned power grid / GPU renderer through getters, never snapshots.
  if (import.meta.env.DEV) {
    installDevHandle({
      camera,
      world,
      ambient: live.state,
      tech,
      power: power.grid,
      markDirty,
      gpu: { isOn: () => view.gpu() !== null, mount: view.mountGpu, unmount: view.unmountGpu },
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
  // at call time (the Saves wiring is mounted below; it blanks autosave on load / new city).
  const economy = createEconomyController({
    map: world.map,
    parcels: world.parcels,
    tech,
    civic,
    sim: deps,
    live: live.state,
    powerGrid: power.grid,
    initial: save?.econ ?? null,
    autosave: () => saves.autosave(),
    ui: {
      practiceGranted: () => {
        tools.afterEffortChange();
        toolbar.flash();
        panels.get('tech').refresh();
      },
      hourRefreshed: (reliefNow) => {
        toolbar.refresh();
        panels.get('tech').refresh(); // projects advanced (no-op while the panel is closed)
        panels.get('budget').refresh();
        if (reliefNow) panels.get('budget').open(); // the grant and its strings, shown as they arrive
      },
      pulse: () => pulse.refresh(),
    },
  });

  // The map overlays (src/app/overlays.ts): ONE active overlay, cycled by its key or dock button. Created
  // HERE — before the dock mount — because the dock's getMetaButtons reads it at mount and on every
  // refreshMeta. The colour key mounts further down (showLegend); its tint reads this context per apply.
  const overlays = createOverlayController({
    renderer,
    context: () => ({
      map: world.map,
      parcels: world.parcels,
      live: live.state,
      poweredAnchors: power.grid().poweredAnchors,
      civic: deps.civic,
      tileToNeighborhood: deps.partition.tileToNeighborhood,
    }),
    showLegend: (legend) => showLegend(legend),
    setStatus: (text) => toolbar.setStatus(text),
    markDirty,
    refreshMeta: () => toolbar.refreshMeta(),
  });

  // The panel registry (src/app/panels.ts): ONE {id → handle} table the key dispatch, the dock's onMeta and
  // the dock's active flags all read. The handles attach once every panel is mounted (below); until then the
  // registry reports them all closed — the dock reads its flags at its own mount.
  const panels = createPanelRegistry();

  // The tool controller (src/app/tools.ts): the picked tool + open flyout, the bottom dock over them (always on,
  // derived from tech grants + selection + funds/effort), preview/apply on the map, and the sim-gated dock sync.
  // The dock's meta row mirrors the keys: its active flags come from the live panel/overlay state, and a click
  // routes to the SAME closures the keys use.
  const tools = createToolController({
    world,
    tech,
    wallet: economy.wallet,
    renderer,
    markDirty,
    markPreviewDirty,
    mount: (d) => mountToolbar(document.body, d),
    meta: {
      buttons: () => metaButtons(panels.isOpen('tech'), overlays.active(), live.on, panels.openFlags()),
      onMeta: (id) => {
        if (id === 'life') setAmbient(!live.on); // same toggle the L key calls
        else if (isPanelId(id)) panels.toggle(id); // the same registry call its key makes
        else overlays.cycle(id); // a map overlay — the SAME closure its letter key calls
      },
    },
    techPanel: () => mounted.tech,
    // the pure readout NAMES the tile; inspectReadout appends the live samples, power status and redline grade
    inspect: (info, tx, ty) => inspectReadout(info, tx, ty, world, live.state, power.grid().poweredAnchors),
    placed: () => {
      power.recompute(); // built layer changed → re-derive the grid (a new plant lights its district)
      live.recomputePlantEmitters(); // a placed/bulldozed dirty plant changes the smog sources
    },
    // credit the anchor tile's neighborhood from the LIVE partition (id 0 = none: a safe no-op)
    repaired: (tx, ty) => deps.civic.recordRepair(deps.partition.tileToNeighborhood[world.map.idx(tx, ty)] ?? 0, sim.tick()),
  });
  const toolbar = tools.toolbar;

  // The always-on top bar (src/app/panels.ts): the economy readout · wellbeing · the unhoused — its OWN element
  // (not the shared toolbar status, which inspect/legend clobber). The civic cadence re-samples and trends it
  // (no per-tick flicker); the economy's hour and a loan rewrite its readout. A click opens the Budget window.
  const pulseDock = mountPulseDock(document.body, { onClick: () => panels.toggle('budget') });
  const pulse = createPulse({
    set: (line) => pulseDock.set(line),
    readout: () => economy.readout(),
    wellbeing: () => wellbeing({ parcels: world.parcels, ecoMeans: deps.ecoMeans, civicMeans: deps.civicMeans }),
    // the city's decline left them without a home, or rent displaced them (loop-coupled: healing lowers it)
    unhoused: () => sampleUnhoused(live.state, world.map.width).unhoused + Math.round(economy.run().state.displaced),
  });

  // The windows (src/app/panels.ts) — Budget, Tech, Restoration, Settings, Help — mounted after the dock and the
  // top bar (DOM order is stacking order). Saves is mounted by its wiring below; the registry attaches them all.
  const mounted = mountPanels({
    container: document.body,
    economy,
    tech,
    art: (key) => renderer.artImage(key),
    sampleRestoration: () => sampleRestoration(live.state, world.map),
    // Settings: live caps apply instantly (live.applyCaps); world size persists for the next load. Every
    // change re-persists the whole settings blob so a reload restores it.
    settings: {
      getSettings: () => settings,
      onLiveChange: (caps: LiveCaps): void => {
        // clamp the merged blob so applied == persisted == shown (the input could be out of range)
        settings = clampSettings({ ...settings, live: { ...settings.live, ...caps } });
        live.applyCaps(settings.live);
        saveSettings(settings);
      },
      onWorldChange: (worldSettings: WorldSettings): void => {
        settings = clampSettings({ ...settings, world: { ...worldSettings } });
        saveSettings(settings); // takes effect on the next load (regenerate)
      },
      onRendererChange: (mode): void => {
        settings = clampSettings({ ...settings, renderer: mode });
        saveSettings(settings);
        view.setMode(mode);
      },
    },
    onBorrowed: () => {
      toolbar.refresh(); // the fabric may be affordable again
      pulse.refresh();
    },
    // effort dropped (affordability) and an unlock may grant a new tool: refresh + snapshot both signatures
    onPracticeBegun: () => tools.afterEffortChange(),
    // fired for the key, the dock button AND any dismiss — the dock's active flags follow from ONE callback
    onToggle: () => toolbar.refreshMeta(),
  });

  // The overlay colour key (top-left over the map), shown/hidden by the overlay controller.
  const showLegend = mountOverlayLegend(document.body);

  // The [Life] ambient toggle — one closure for the L key AND the dock [Life] button. Flips live.on (turning
  // it ON resets ONLY the ambient clock, so the first dt after a dormant period is small — also clamp-guarded),
  // repaints via markDirty, and refreshes the dock meta active-state.
  const setAmbient = (on: boolean): void => {
    live.on = on;
    markDirty();
    toolbar.refreshMeta();
  };

  // ── Save/load (src/app/saves.ts): the city autosaves into the CURRENT slot (hourly via the economy, and on
  // tab-hide / pagehide) and a reload resumes it; the Saves window (S, or the palette's disk) backs the slots.
  const cityTitle = save?.name ?? cityName(createRng(seed).fork('city-name'));
  const saves = createSaves({
    parts: () => ({
      seed,
      name: cityTitle,
      world,
      tech,
      civic,
      econ: economy.run(),
      live: live.state,
      tick: sim.tick(),
      camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
    }),
    lifecycle: { document, window },
    mountPanel: (actions) => mountSavesPanel(document.body, actions),
    onToggle: () => toolbar.refreshMeta(),
  });
  panels.attach({ ...mounted, saves });
  toolbar.refreshMeta();

  // The key dispatch (src/app/keys.ts): one keydown listener, gated by the pure key table; each key calls
  // the same closure its dock button does.
  installKeys({
    target: window,
    openingUp: () => overlayActive,
    cycleOverlay: (kind) => overlays.cycle(kind),
    toggleLife: () => setAmbient(!live.on),
    togglePanel: (id) => panels.toggle(id),
  });

  attachInput(canvas, camera, {
    onChange: markDirty,
    hasTool: tools.hasTool,
    isLineTool: tools.isLineTool,
    applyAt: tools.applyAt,
    hover: tools.previewAt,
    clearHover: tools.clearHover,
    onHotkey: tools.hotkey,
  });

  window.addEventListener('resize', view.resize);

  // Tab visibility: on becoming visible, reset ONLY the ambient clock (so the
  // ambient dt doesn't jump) and request a repaint. The sim's `last` is deliberately
  // NOT reset — its FixedTickLoop catch-up (a long hidden gap clamped to maxFrameMs)
  // must run exactly as today, keeping sim output byte-identical whether ambient is
  // on or off (AC#7). The ambient clamp already makes a missed reset harmless, so
  // this handler is for smoothness, not safety.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    live.resetClock();
    markDirty();
  });

  // The two clocks (src/app/loop.ts): the fixed-tick sim (simTick + the civic-cadence seams) and the rAF frame.
  const sim = createSimTick({
    sim: deps,
    startTick: save?.tick ?? 0, // a resumed game keeps its clock (repair rings are stamped in ticks)
    power,
    live,
    overlays,
    pulse,
    restore: () => mounted.restore,
    markDirty,
  });
  const frame = createFrame({
    start: performance.now(),
    power,
    economy,
    sim,
    view,
    live,
    world,
    hidden: () => document.hidden,
    syncDock: tools.syncDock,
  });
  const loop = (now: number): void => {
    frame(now);
    window.requestAnimationFrame(loop);
  };
  window.requestAnimationFrame(loop);
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
