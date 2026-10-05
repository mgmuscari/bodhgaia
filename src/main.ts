// Browser entry point. Generates a world from the URL seed, then drives a
// requestAnimationFrame render loop and a fixed-tick simulation loop. The sim
// step is the composite orchestrator simTick (effort → ecology → civic); this
// shell only reads its deps for rendering. All DOM access is guarded so this
// module stays safe to import headless under Vitest.

import { runPipeline } from './worldgen/pipeline';
import { terrainStage } from './worldgen/terrain';
import { mosesCenturyStage } from './worldgen/moses';
import { ecoSeedStage } from './worldgen/ecoseed';
import { parseChronicle } from './worldgen/chronicle';
import { buildReport } from './worldgen/report';
import { gradeLetter } from './worldgen/redline';
import { ecologyReport } from './ecology/report';
import { biodiversityField } from './ecology/biodiversity';
import { Water } from './engine/map';
import { isRoadKind, BuiltKind } from './engine/fabric';
import { createRng } from './engine/rng';
import { cityName } from './engine/names';
import { FixedTickLoop } from './engine/loop';
import { Camera } from './ui/camera';
import { Renderer } from './ui/renderer';
import { SIDEBAR_W } from './ui/toolbar';
import { installUiTheme } from './ui/uiTheme';
import { GpuRenderer } from './ui/gpuRenderer';
import { SmogOverlay } from './ui/smogOverlay';
import { createAmbientState, stepAmbient, setParkingLots, setHouseholds, setPlantEmitters, seedDecay, liveInspectLine, applyLiveCaps } from './ui/ambientContent';
import { loadSettings, saveSettings } from './ui/settingsStore';
import { mountSettingsPanel } from './ui/settingsPanel';
import { materializeSkin } from './ui/tilesetLoader';
import { paintSnesSkin } from './ui/snesTileset';
import { footprintCellKey } from './ui/renderKey';

/** The tab icon is one of the game's own painted tiles (a house), scaled up nearest-neighbour. */
function setPixelFavicon(tile: CanvasImageSource | undefined): void {
  if (!tile) return;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tile, 0, 0, 32, 32);
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.head.appendChild(document.createElement('link'));
  link.rel = 'icon';
  link.href = c.toDataURL('image/png');
}
import { mountHelpPanel } from './ui/helpPanel';
import { clampSettings, type LiveCaps, type WorldSettings } from './ui/settings';
import { residentialCensus } from './citizens/census';
import { parkingLots, parkingStalls } from './ui/parkingContent';
import { attachInput } from './ui/input';
import { statLines, eraHeadline, challengeText, ecologyStatLine } from './ui/openingContent';
import { overlayTint, legendLine, ecoLegend, type OverlayView } from './ui/ecoOverlayContent';
import {
  civicOverlayTint,
  civicLegendLine,
  civicLegend,
  cycleComposite,
  compositeKeyFor,
  type CompositeState,
  type CivicOverlayView,
  type OverlayKind,
} from './ui/civicOverlayContent';
import { redlineOverlayTint, redlineLegendLine, redlineLegend } from './ui/redlineOverlayContent';
import { policeLegendLine, policeLegend } from './ui/policeViolenceOverlayContent';
import { coverageTint, coverageLegendLine, coverageLegend } from './ui/coverageOverlayContent';
import { powerTint, powerLegendLine, powerLegend } from './ui/powerOverlayContent';
import type { OverlayLegend } from './ui/overlayLegend';
import { pulseLine } from './ui/pulseContent';
import { mountPulseDock } from './ui/pulseDock';
import { sampleRestoration, restorationLines, type RestorationSample } from './ui/restorationContent';
import { mountRestorationPanel } from './ui/restorationPanel';
import { sampleUnhoused, unhousedSuffix } from './ui/unhousedContent';
import { isRepairTool } from './ui/repairTools';
import { mountOpening, type OpeningContent } from './ui/opening';
import { TECH_TREE } from './tech/tree';
import { createTechState } from './tech/state';
import { wellbeing } from './tech/effort';
import { branchColumns, effortLine, panelSignature } from './ui/techContent';
import { techLayout } from './ui/techLayout';
import { mountTechPanel } from './ui/techPanel';
import { availableTools, previewTool, applyTool, toolDef, type ToolId, type Wallet } from './tools/tools';
import { createEconomy, effortCapacity, loanOffer, takeLoan, ECON, type CityReading } from './economy/model';
import { readCity } from './economy/readings';
import { economyHour, practiceProject, DEFAULT_LEVERS, type EconomyRun } from './economy/run';
import { projectProgress } from './economy/projects';
import { economyLine } from './ui/economyContent';
import { budgetView } from './ui/budgetContent';
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
import { computePowerGrid, plantOutput, isPowerConsumer, plantPollution } from './growth/power';
import { gameClock } from './ui/lighting';
import { TRUST_FLOOR } from './civic/dynamics';
import { captureGame, restoreWorld, restoreTech, restoreCivic, restoreLive, type SaveV1 } from './save/snapshot';
import { CURRENT, writeSlot, readSlot, deleteSlot, listSlots, loadSlot, newCity, exportFile, importFile } from './save/store';
import { mountSavesPanel } from './ui/savesPanel';

const DEFAULT_SEED = 'bodhitropolis';
const SIM_TICK_MS = 100;
/** Autosave every this many in-game hours (and whenever the tab is hidden or closed). */
const AUTOSAVE_HOURS = 6;

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

  // ?shader boots the FULL game with the GPU hybrid path on (the WebGL map under the live Canvas2D
  // sprites/UI, driven by the real camera) — so it zooms/pans and shows agents, unlike the bare
  // ?shaderdemo mount. Safe to open in a scratch tab. (Will become a settings toggle.)
  const gpuParam = params.has('shader');

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
  // single composition root tracks whether it is up so the tech panel can
  // suppress its `T` toggle underneath it (init: up unless `?nointro=1`).
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

  // GPU hybrid path (Increment 1): a WebGL2 canvas under the Canvas2D sprite/UI layer, driven by the
  // live camera. mountGpu falls back to CPU (returns false) if WebGL2 is unavailable. The CPU path
  // stays the default + fallback. Toggled via ?shader now (settings toggle next).
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
  if (gpuParam || settings.renderer === 'gpu') mountGpu();

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

  // Power grid: a live DERIVED field (flood-fill from plants over the built layer,
  // capacity vs demand → which consumers are powered). Recomputed on placement + the
  // civic cadence; published to the renderer (unpowered consumers get a red pip) and
  // read by inspect. Derived from the hashed built layer → never hashed itself.
  let powerGrid = computePowerGrid(world.map, world.parcels, gameClock(performance.now() / 1000));
  let powerSig = `${powerGrid.capacity}/${powerGrid.demand}/${powerGrid.poweredAnchors.size}`;
  // The grid is solved for the current in-game hour (time-varying demand + rolling blackouts), and
  // re-solved every in-game hour from the frame loop below.
  let powerSlot = gameClock(performance.now() / 1000).slot;
  const recomputePower = (): boolean => {
    const clock = gameClock(performance.now() / 1000);
    powerSlot = clock.slot;
    powerGrid = computePowerGrid(world.map, world.parcels, clock);
    renderer.setPowerGrid(powerGrid.poweredAnchors);
    const sig = `${powerGrid.capacity}/${powerGrid.demand}/${powerGrid.poweredAnchors.size}`;
    const changed = sig !== powerSig;
    powerSig = sig;
    return changed;
  };
  renderer.setPowerGrid(powerGrid.poweredAnchors);

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

  // Dev / live-pass affordance: a small global to drive the camera and inspect live
  // state from outside the input layer (e.g. screenshot tooling that needs to focus a
  // location). `zoomTo` mirrors the input path — move the camera, then markDirty so
  // the cached base rebuilds at the new view. `camera`/`world`/`ambient` are exposed
  // read handles (the running app's actual objects) so a live pass need not rebuild
  // the world in-page.
  (window as unknown as Record<string, unknown>).bodhitropolis = {
    zoomTo: (wx: number, wy: number, zoom?: number): void => {
      camera.centerOn(wx, wy, zoom);
      markDirty();
    },
    toggleGpu: (): boolean => {
      if (gpuRenderer) {
        unmountGpu();
        markDirty();
        return false;
      }
      const ok = mountGpu();
      markDirty();
      return ok;
    },
    gpuOn: (): boolean => gpuRenderer !== null,
    camera,
    world,
    ambient: ambientState,
    tech,
    power: () => powerGrid,
  };

  // Opening challenge overlay. Computed from the same world, mounted over the
  // live map unless `?nointro=1`. The map input stays attached beneath; the
  // overlay captures pointer events until the player dismisses it (Begin /
  // Enter / Escape), after which the map is interactive.
  if (params.get('nointro') !== '1' && !save) {
    const name = cityName(createRng(seed).fork('city-name'));
    const chronicle = parseChronicle(world.log);
    const report = buildReport(world);
    // The eco-seed wound's DISPLAY half: surface it as a real opening stat line,
    // omitted (null) on the degenerate all-water / no-highway path.
    const ecoLine = ecologyStatLine(ecologyReport(world));
    const content: OpeningContent = {
      name,
      eras: chronicle.entries.map(eraHeadline),
      stats: ecoLine !== null ? [...statLines(report), ecoLine] : statLines(report),
      challenge: challengeText(name, report, chronicle),
    };
    mountOpening(document.body, content, () => {
      overlayActive = false;
      markDirty();
    });
  }

  // ── The economy (src/economy, docs/design/economy-system-dynamics.md): funds, perishable effort, burnout,
  // approval and rent, stepped every in-game hour. Goodwill is the city's civic trust (one trust stock): the
  // economy reads it and applies its hourly shocks back. Practices are projects that take time; the fabric
  // is bought with funds through the wallet, the commons with effort.
  const wellbeing01 = (): number =>
    Math.min(1, wellbeing({ parcels: world.parcels, ecoMeans: deps.ecoMeans, civicMeans: deps.civicMeans }) / 200);
  const readNow = (harms: CityReading['harms']): CityReading =>
    readCity({
      map: world.map,
      parcels: world.parcels,
      occupancyAt: (t) => ambientState.occupancy.get(t),
      landValueAt: (t) => ambientState.landValue.get(t),
      wellbeing: wellbeing01(),
      extraInfra: (tech.hasCapability('circles') ? 2 : 0) + (tech.hasCapability('participatory-budgeting') ? 2 : 0),
      harms,
      repairs: 0, // civic trust already earns repairs itself
    });
  let econ: EconomyRun = save?.econ ?? { state: createEconomy(20_000), projects: [], levers: DEFAULT_LEVERS };
  let econCapacity = 0;
  let econPrimed = save !== null;
  // autosave is filled in once the Saves wiring is mounted (below); the economy hour calls it
  let autosave = (): void => {}; // the opening reserve is set on the first hour with live occupancy to read
  let econFundsPerHour = 0;
  let lastCity: CityReading | null = null; // the last hour's reading (the Budget window projects from it)
  const cityForBudget = (): CityReading => lastCity ?? readNow({ blackouts: 0, policeViolence: 0, takings: 0 });
  const leversNow = () => ({ ...econ.levers, spendEffort: 0, spendFunds: 0 });
  // The Budget window: tax sliders, the police line, the hourly ledger, and loans (Maddy 2026-10-01: "we need
  // taxes and loans, once you go negative you can't dig back out")
  const budgetPanel = mountBudgetPanel(document.body, {
    getView: () => budgetView(econ.state, cityForBudget(), leversNow()),
    onTax: (cls, rate) => {
      econ = { ...econ, levers: { ...econ.levers, tax: { ...econ.levers.tax, [cls]: rate } } };
    },
    onPolice: (perHour) => {
      econ = { ...econ, levers: { ...econ.levers, police: perHour } };
    },
    onBorrow: (amount) => {
      const next = takeLoan(econ.state, loanOffer(econ.state, cityForBudget(), leversNow()), amount);
      if (!next) return;
      econ = { ...econ, state: next };
      toolbar.refresh(); // the fabric may be affordable again
      pulseDock.set(`${economyReadout()}  ·  ${lastPulse}`);
    },
    onToggle: () => toolbar.refreshMeta(),
  });
  let econSlot = gameClock(performance.now() / 1000).slot;
  const violenceTotal = (): number => {
    let sum = 0;
    for (const v of ambientState.policeViolence.values()) sum += v;
    return sum;
  };
  let prevViolence = violenceTotal();
  const wallet: Wallet = {
    get funds() {
      return econ.state.funds;
    },
    set funds(v: number) {
      econ = { ...econ, state: { ...econ.state, funds: v } };
    },
  };
  const economyReadout = (): string =>
    economyLine({
      funds: econ.state.funds,
      fundsPerHour: econFundsPerHour,
      effort: tech.effort,
      capacity: econCapacity,
      approval: econ.state.approval,
      goodwill: econ.state.goodwill,
      burnout: econ.state.burnout,
    });
  const runEconomyHour = (): void => {
    // harms this hour: the share of powered consumers in blackout, and fresh police violence
    let consumers = 0;
    for (const i of world.parcels.aliveIndices()) if (isPowerConsumer(world.parcels.get(i).kind)) consumers++;
    const dark = Math.max(0, consumers - powerGrid.poweredAnchors.size);
    const violence = violenceTotal();
    // blackout severity: a city entirely in the dark weighs 2 blackout-hours on trust each hour
    const harms = { blackouts: consumers > 0 ? (dark / consumers) * 2 : 0, policeViolence: Math.max(0, violence - prevViolence) / 50, takings: 0 };
    prevViolence = violence;
    const city = readNow(harms);
    lastCity = city;
    econCapacity = effortCapacity(city);
    if (!econPrimed && econCapacity > 0) {
      econPrimed = true;
      tech.effort = Math.floor(econCapacity * 0.5); // the city opens half-rested
    }
    // goodwill IS civic trust (0..255 → 0..100); effort absorbs what tools spent since the last hour
    const trust = deps.civicMeans ? (deps.civicMeans.trust / 255) * 100 : econ.state.goodwill;
    econ = { ...econ, state: { ...econ.state, goodwill: trust, effort: tech.effort } };
    const before = econ.state.funds;
    const hadRelief = econ.state.reliefTaken;
    const r = economyHour(econ, city);
    econ = r.run;
    const reliefNow = econ.state.reliefTaken && !hadRelief;
    // the grant is a one-off, not the hour's flow
    econFundsPerHour = econ.state.funds - before - (reliefNow ? ECON.reliefDays * 24 * city.upkeep : 0);
    tech.effort = Math.floor(econ.state.effort);
    // the hour's goodwill shock lands on every neighbourhood's trust
    if (econ.state.shock !== 0) {
      for (let id = 1; id <= civic.count(); id++) {
        const v = civic.getValues(id); // neighbourhood ids are 1-based
        civic.setValues(id, { ...v, trust: Math.max(TRUST_FLOOR, Math.min(255, v.trust + econ.state.shock * 2.55)) });
      }
    }
    for (const done of r.completed) {
      const practice = (done.payload as { practice?: string } | null)?.practice;
      if (practice && tech.grant(practice)) {
        toolbar.refresh();
        toolbar.flash();
        snapshotDock();
        snapshotPanel();
        techPanel.refresh();
      }
    }
    toolbar.refresh();
    techPanel.refresh(); // projects advanced (no-op while the panel is closed)
    budgetPanel.refresh();
    if (reliefNow) budgetPanel.open(); // the grant and its strings, shown as they arrive
    if (econ.state.tick % AUTOSAVE_HOURS === 0) autosave();
    pulseDock.set(`${economyReadout()}  ·  ${lastPulse}`);
  };

  // Tech panel: right-docked, toggled by `T`. Zero game imports — it receives its
  // content and the unlock action through deps. The `T` gate is suppressed while
  // the opening overlay is up (isOverlayActive), so it never toggles beneath it.
  const techPanel = mountTechPanel(document.body, {
    getContent: () => ({ effort: effortLine(tech), layout: techLayout(TECH_TREE, tech) }),
    art: (key) => renderer.artImage(key),
    progress: (id) => {
      const p = econ.projects.find((q) => q.id === id);
      return p ? projectProgress(p) : undefined;
    },
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
      const r = tech.canUnlock(id);
      const node = TECH_TREE.find((n) => n.id === id);
      const ok = !!node && (r.ok || r.reason === 'effort') && !econ.projects.some((p) => p.id === id);
      if (ok) econ = { ...econ, projects: [...econ.projects, practiceProject(node!)] };
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
    isOverlayActive: () => overlayActive,
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

  // The single composite overlay (eco | civic | null). Declared HERE — before the
  // dock mount — because the dock's getMetaButtons reads it at mount time and on
  // every refreshMeta. applyOverlay / cycleOverlay below own the transitions.
  let activeOverlay: CompositeState = null;

  // Bottom tool dock: always on, derived from tech grants + selection + effort. The
  // meta row ([Tech][Eco][Civic]) mirrors the T/E/C keys: getMetaButtons derives
  // the active flags from the live panel/overlay state; onMeta routes a click to
  // the SAME closures the keys use (techPanel.toggle / cycleOverlay).
  // Panels the palette opens; mounted further down, so the palette reaches them through this holder
  // (reading their consts before they're declared would throw).
  type PanelHandle = { toggle(): boolean; visible(): boolean };
  const panels: { restore?: PanelHandle; settings?: PanelHandle; help?: PanelHandle; saves?: PanelHandle } = {};

  const toolbar = mountToolbar(document.body, {
    getMenu: () => buildToolMenu(availableTools(tech), selectedToolId, tech.effort, openCategory, econ.state.funds),
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
      metaButtons(techPanel.isOpen(), activeOverlay && { kind: activeOverlay.kind }, ambientOn, {
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
      else cycleOverlay(id); // a map overlay — the SAME closure its letter key calls
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
    const unhoused = sampleUnhoused(ambientState, world.map.width).unhoused + Math.round(econ.state.displaced);
    lastPulse = `${pulseLine(wb, prevWellbeing)}  ·  ${unhousedSuffix(unhoused, prevUnhoused)}`;
    prevUnhoused = unhoused;
    return `${economyReadout()}  ·  ${lastPulse}`;
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

  // Composite heatmap overlay: a SINGLE active overlay (eco or civic, never both),
  // cycled by E (off → soil → flora → fauna → biodiversity → off) and C (off →
  // belonging → voice → trust → off). Pressing the other key replaces the active
  // overlay (exclusivity). Eco soil/flora/fauna read the LIVE layers; biodiversity
  // and every civic view are recomputed/re-pushed when their source ticks. Water
  // tiles are not tinted (eco lives on land); civic tiles with no neighborhood
  // (id 0) are not tinted.
  // Visible colour KEY for the active overlay — a swatch per ramp endpoint / band with its label,
  // so the eco/civic/redline/police maps are legible at a glance (not just a one-line caption).
  const legendEl = document.createElement('div');
  legendEl.className = 'overlay-legend';
  legendEl.hidden = true;
  legendEl.style.cssText =
    'position:fixed;left:12px;top:12px;z-index:50;background:rgba(20,22,30,0.82);color:#e8e6e0;' +
    'font:12px monospace;padding:6px 9px;border-radius:6px;pointer-events:none;line-height:1.5;';
  document.body.appendChild(legendEl);
  const updateLegend = (legend: OverlayLegend | null): void => {
    if (!legend) {
      legendEl.hidden = true;
      legendEl.textContent = '';
      return;
    }
    legendEl.hidden = false;
    legendEl.textContent = '';
    const title = document.createElement('div');
    title.textContent = legend.title;
    title.style.cssText = 'font-weight:bold;margin-bottom:3px;';
    legendEl.appendChild(title);
    for (const stop of legend.stops) {
      const row = document.createElement('div');
      const sw = document.createElement('span');
      sw.style.cssText = `display:inline-block;width:12px;height:12px;margin-right:6px;vertical-align:middle;background:rgb(${stop.color[0]},${stop.color[1]},${stop.color[2]});`;
      const lbl = document.createElement('span');
      lbl.textContent = stop.label;
      row.append(sw, lbl);
      legendEl.appendChild(row);
    }
  };

  const overlayWater = world.map.water;
  const applyOverlay = (): void => {
    // Police violence is a LIVE field, drawn per-frame (not in the cached base) so it tracks
    // arrests + decay; every other kind clears that flag and uses the base overlay source.
    renderer.setLiveOverlay(activeOverlay?.kind === 'police' ? 'police' : null);
    if (activeOverlay === null || activeOverlay.kind === 'police') {
      renderer.setOverlay(null);
      return;
    }
    if (activeOverlay.kind === 'coverage') {
      // Tint each developed plot tile by whether a fire/health station is in reach (served/under);
      // dim the rest so the served/under-served plots read as a layer view, not faint specks.
      const cov = ambientState.coverage;
      renderer.setOverlay({
        dimBase: true,
        tint: (i) => (world.map.parcel[i] !== 0 ? coverageTint(cov.has(i)) : null),
      });
      return;
    }
    if (activeOverlay.kind === 'power') {
      // Tint each power-consumer plot green (on the grid) or red (dark), via its parcel anchor;
      // dim the rest so lit/dark buildings read as a layer view, not faint specks on the terrain.
      const lit = powerGrid.poweredAnchors;
      renderer.setOverlay({
        dimBase: true,
        tint: (i) => {
          const pid = world.map.parcel[i];
          if (!pid || !isPowerConsumer(world.parcels.kindAt(pid - 1))) return null;
          const p = world.parcels.get(pid - 1);
          return powerTint(lit.has(world.map.idx(p.x, p.y)));
        },
      });
      return;
    }
    if (activeOverlay.kind === 'redline') {
      // The HOLC grade is a hashed map layer — tint land tiles by it directly.
      // Water carries a grade too (the near-water "cover" nudge), but tinting the
      // river/ocean red reads wrong, so land only — like the eco overlays.
      const redline = world.map.redline;
      renderer.setOverlay({
        dimBase: true,
        tint: (i) => (overlayWater[i] !== Water.None ? null : redlineOverlayTint(redline[i]!)),
      });
      return;
    }
    if (activeOverlay.kind === 'civic') {
      const view = activeOverlay.view as CivicOverlayView;
      const count = deps.civic.count();
      const values = new Uint8Array(count); // per-neighborhood value, rebuilt per refresh
      for (let id = 1; id <= count; id++) {
        const v = deps.civic.getValues(id);
        values[id - 1] = view === 'belonging' ? v.belonging : view === 'voice' ? v.voice : v.trust;
      }
      const t2n = deps.partition.tileToNeighborhood;
      renderer.setOverlay({
        dimBase: true,
        tint: (i) => {
          const id = t2n[i]!;
          return id === 0 ? null : civicOverlayTint(view, values[id - 1]!);
        },
      });
      return;
    }
    const view = activeOverlay.view as OverlayView;
    if (view === 'biodiversity') {
      const field = biodiversityField(world.map);
      renderer.setOverlay({
        dimBase: true,
        tint: (i) => (overlayWater[i] !== Water.None ? null : overlayTint('biodiversity', field[i]!)),
      });
      return;
    }
    if (view === 'airPollution') {
      // The live agent-driven smog field (cars + dirty plants emit it), over LAND — a heatmap that
      // refreshes as the base redraws on the eco cadence. Clean where the player has calmed traffic.
      const poll = ambientState.pollution;
      renderer.setOverlay({
        dimBase: true,
        tint: (i) =>
          overlayWater[i] !== Water.None ? null : overlayTint('airPollution', Math.min(255, poll.get(i) ?? 0)),
      });
      return;
    }
    if (view === 'groundPollution') {
      // The live land-contamination field, over LAND — industry + dirty power + demand-path litter
      // poison the ground; clean land elsewhere. Reparable: it clears as the player heals/rewilds.
      const gp = ambientState.groundPollution;
      renderer.setOverlay({
        dimBase: true,
        tint: (i) =>
          overlayWater[i] !== Water.None ? null : overlayTint('groundPollution', Math.min(255, gp.get(i) ?? 0)),
      });
      return;
    }
    if (view === 'waterPollution') {
      // The live runoff field, over WATER — the dingy creeks downstream of redlined industry. Clean
      // blue where the water is healthy, murky where contamination collects.
      const wp = ambientState.waterPollution;
      renderer.setOverlay({
        dimBase: true,
        tint: (i) =>
          overlayWater[i] === Water.None ? null : overlayTint('waterPollution', Math.min(255, wp.get(i) ?? 0)),
      });
      return;
    }
    const layer =
      view === 'soil'
        ? world.map.soilHealth
        : view === 'flora'
          ? world.map.floraVitality
          : world.map.faunaPresence;
    renderer.setOverlay({
      dimBase: true,
      tint: (i) => (overlayWater[i] !== Water.None ? null : overlayTint(view, layer[i]!)),
    });
  };

  // The SHARED overlay-cycle body — one closure for BOTH the E/C keys and the dock
  // [Eco]/[Civic] buttons, so a key press and a button click can never diverge.
  // Cycles the single composite overlay, re-points the renderer, surfaces the
  // legend in the dock status slot, and refreshes the dock meta active-state.
  const cycleOverlay = (kind: OverlayKind): void => {
    activeOverlay = cycleComposite(activeOverlay, kind);
    applyOverlay();
    const legend =
      activeOverlay === null
        ? null
        : activeOverlay.kind === 'eco'
          ? legendLine(activeOverlay.view as OverlayView)
          : activeOverlay.kind === 'redline'
            ? redlineLegendLine('grade')
            : activeOverlay.kind === 'police'
              ? policeLegendLine('violence')
              : activeOverlay.kind === 'coverage'
                ? coverageLegendLine('coverage')
                : activeOverlay.kind === 'power'
                  ? powerLegendLine('power')
                  : civicLegendLine(activeOverlay.view as CivicOverlayView);
    toolbar.setStatus(legend);
    // The visible colour key for the active overlay (eco/civic ramps, redline bands, police ramp).
    updateLegend(
      activeOverlay === null
        ? null
        : activeOverlay.kind === 'eco'
          ? ecoLegend(activeOverlay.view as OverlayView)
          : activeOverlay.kind === 'civic'
            ? civicLegend(activeOverlay.view as CivicOverlayView)
            : activeOverlay.kind === 'redline'
              ? redlineLegend()
              : activeOverlay.kind === 'police'
                ? policeLegend()
                : activeOverlay.kind === 'coverage'
                  ? coverageLegend()
                  : activeOverlay.kind === 'power'
                    ? powerLegend()
                    : policeLegend(),
    );
    markDirty(); // the overlay tint lives in the cached base → invalidate it
    toolbar.refreshMeta(); // the active overlay changed → dock [Eco]/[Civic] state
  };

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

  // E and C self-bind through the shared compositeKeyFor gate (suppressed while the
  // opening overlay is up); both delegate to cycleOverlay — the same body the dock
  // buttons call.
  window.addEventListener('keydown', (event) => {
    // Let browser/OS shortcuts through — overlay hotkeys (e.g. 'r' for redline) must NOT hijack
    // Cmd/Ctrl+R (reload), Cmd+S, etc. (Maddy playtest).
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const kind = compositeKeyFor(event.key, overlayActive);
    if (kind === null) return;
    event.preventDefault();
    cycleOverlay(kind);
  });

  // B toggles the Budget window; a click on the top bar (funds and the rest) opens it too
  window.addEventListener('keydown', (event) => {
    if (overlayActive || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key !== 'b' && event.key !== 'B') return;
    event.preventDefault();
    budgetPanel.toggle();
  });
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
      econ,
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
  window.addEventListener('keydown', (event) => {
    if (overlayActive || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key !== 's' && event.key !== 'S') return;
    event.preventDefault();
    savesPanel.toggle();
  });

  // L toggles ambient life, gated like E/C (suppressed while the opening overlay is
  // up so it never fires beneath it).
  window.addEventListener('keydown', (event) => {
    if (overlayActive) return;
    if (event.key !== 'l' && event.key !== 'L') return;
    event.preventDefault();
    setAmbient(!ambientOn);
  });

  // G toggles the restoration readout panel (gated like L). On open, show a fresh sample at once
  // (flat — no spurious arrows from a stale prior); the civic cadence then trends it.
  window.addEventListener('keydown', (event) => {
    if (overlayActive) return;
    if (event.key !== 'g' && event.key !== 'G') return;
    event.preventDefault();
    if (restorationPanel.toggle()) {
      const sample = sampleRestoration(ambientState, world.map);
      restorationPanel.set(restorationLines(sample, null));
      prevRestoration = sample;
    }
  });

  // ',' toggles the settings menu (gated like L/G so it never fires under the opening overlay).
  window.addEventListener('keydown', (event) => {
    if (overlayActive) return;
    if (event.key !== ',') return;
    event.preventDefault();
    settingsPanel.toggle();
  });

  // '?' / 'h' toggles the controls reference (same opening-overlay gate).
  window.addEventListener('keydown', (event) => {
    if (overlayActive) return;
    if (event.key !== '?' && event.key !== 'h' && event.key !== 'H') return;
    event.preventDefault();
    helpPanel.toggle();
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
      // The pure readout NAMES the seeded tile; append the LIVE samples the ambient
      // layer carries. Population/health/land-value are keyed by the parcel ANCHOR
      // (resolve through the parcel store); traffic/smog by the clicked tile itself.
      let line = r.info ?? '';
      const i = world.map.idx(tx, ty);
      const pid = world.map.parcel[i];
      let anchor = i;
      if (pid) {
        const p = world.parcels.get(pid - 1);
        anchor = world.map.idx(p.x, p.y);
      }
      const live = liveInspectLine({
        occupancy: ambientState.occupancy.get(anchor),
        landValue: ambientState.landValue.get(anchor),
        health: ambientState.buildingHealth.get(anchor),
        traffic: ambientState.traffic.get(i),
        pollution: ambientState.pollution.get(i),
        // On a water tile, surface its contamination (the poisoned creek made legible).
        water: world.map.water[i] !== Water.None ? ambientState.waterPollution.get(i) : undefined,
        // On a road tile, surface its disrepair (redlined roads crumble).
        road: isRoadKind(world.map.built[i]!) ? ambientState.roadDecay.get(i) : undefined,
        // Where the police have done violence (arrests) — surfaced on any tile that carries it.
        violence: ambientState.policeViolence.get(i),
        // Fire/health service: is this inhabited plot within reach of a station?
        served: pid ? ambientState.coverage.has(anchor) : undefined,
      });
      if (live) line += ` · ${live}`;
      // Power status: a plant shows its output; a consumer shows powered/unpowered.
      const builtHere = world.map.built[i];
      const out = builtHere ? plantOutput(builtHere) : 0;
      if (out > 0) line += ` · output ${out}`;
      else if (pid && isPowerConsumer(world.parcels.kindAt(pid - 1))) {
        line += powerGrid.poweredAnchors.has(anchor) ? ' · powered' : ' · UNPOWERED';
      }
      // The HOLC redline grade of this ground — the apparatus's classification that
      // sited the burdens here. Land only (water carries a grade but it reads wrong).
      if (world.map.water[i] === Water.None) line += ` · redline ${gradeLetter(world.map.redline[i]!)}`;
      toolbar.setStatus(line);
      return;
    }
    if (r.ok) {
      recomputePower(); // built layer changed → re-derive the grid (a new plant lights its district)
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
    // NOTE: the sim's abstract O-D trips (deps.trips) still lay the deterministic traffic-density
    // field that feeds growth/pollution/ped-routing, but they are NO LONGER visualised as ambient
    // cars. The visible traffic is the CITIZENS (owned cars + walkers/cyclists/transit riders), which
    // are persistent — they park and are walked to, never popping out of existence at a destination.
    // (ingestTrips is retained + tested for the trip→ambient path, just not driven from the sim here.)
    if (r.ecoTicked && activeOverlay?.kind === 'eco') {
      // biodiversity is derived → recompute + re-push; soil/flora/fauna read the
      // live layers and need no recompute.
      if (activeOverlay.view === 'biodiversity') applyOverlay();
      markDirty(); // eco overlay re-push changes the base tint → invalidate base
    }
    if (r.civicTicked) {
      // the partition was refreshed/remapped and values changed → rebuild the
      // civic overlay against the new partition + values.
      if (activeOverlay?.kind === 'civic') {
        applyOverlay();
        markDirty(); // civic overlay re-push changes the base tint → invalidate base
      }
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
      const powerChanged = recomputePower();
      const revived = stepRevival(
        world,
        (tile) => ambientState.occupancy.get(tile),
        revivalRng,
        (tile) => powerGrid.poweredAnchors.has(tile),
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
    if (gameClock(now / 1000).slot !== powerSlot && recomputePower()) markDirty();
    // the economy steps once per in-game hour (catching up a few if the tab was in the background)
    const hourNow = gameClock(now / 1000).slot;
    for (let k = 0; k < 6 && econSlot < hourNow; k++) {
      econSlot++;
      runEconomyHour();
    }
    if (econSlot < hourNow) econSlot = hourNow;
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
