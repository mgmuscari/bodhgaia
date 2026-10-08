// Browser entry point — the composition root. Builds the city from the URL seed (or the save in progress), then
// wires the controllers in src/app/ together: the view, the live layer, power, the economy, overlays, the tool
// dock, the panels, saves, keys, and the two clocks (src/app/loop.ts). Each controller documents itself; this
// file only says what talks to what. All DOM access is guarded so this module stays safe to import headless.

import { createRng } from './engine/rng';
import { cityName } from './engine/names';
import { installUiTheme } from './ui/uiTheme';
import { attachInput } from './ui/input';
import { mountPulseDock } from './ui/pulseDock';
import { mountToolbar } from './ui/toolbar';
import { metaButtons } from './ui/dockContent';
import { mountSavesPanel } from './ui/savesPanel';
import { inspectReadout } from './ui/inspectContent';
import { sampleRestoration } from './ui/restorationContent';
import { wellbeing } from './tech/effort';
import type { SaveV1 } from './save/snapshot';
import { CURRENT, readSlot } from './save/store';
import { createCity } from './app/city';
import { createSettingsController } from './app/settings';
import { createView } from './app/view';
import { createLive } from './app/live';
import { createPowerController } from './app/power';
import { installDevHandle } from './app/devHandle';
import { mountOpeningFor } from './app/opening';
import { createEconomyController } from './app/economy';
import { neighborhoodVoice } from './civic/voice';
import { displaceFromHomes } from './live/fields/occupancy';
import { createOverlayController, mountOverlayLegend } from './app/overlays';
import { createPanelRegistry, createPulse, isPanelId, mountPanels } from './app/panels';
import { createToolController } from './app/tools';
import { createSaves } from './app/saves';
import { installKeys } from './app/keys';
import { createSimTick, createFrame, runFrames } from './app/loop';
import { createSound } from './app/sound';
import { createNews } from './app/news';
import { isPowerConsumer } from './growth/power';
import { placeCategoryOf } from './audio/sfx';
import { gameClock } from './ui/lighting';
import { BuiltKind } from './engine/fabric';

const DEFAULT_SEED = 'bodhitropolis';

export function main(save: SaveV1 | null = null): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('missing #game canvas');
  installUiTheme(); // the pixel UI kit: palette variables, 9-slice frames, pixel font
  const params = new URLSearchParams(window.location.search);

  // Settings (persisted; the world size feeds worldgen, so it applies on the next load), then the city.
  const settings = createSettingsController({
    applyLive: (caps) => live.applyCaps(caps),
    setRenderer: (m) => view.setMode(m),
    applyAudio: (a) => sound.applySettings(a), // only on a user change, after `sound` exists
  });
  const { world: size } = settings.current();
  const city = createCity({ seed: params.get('seed') ?? DEFAULT_SEED, size: { width: size.mapWidth, height: size.mapHeight }, save });
  const { seed, world, tech, civic, sim: deps } = city;

  // The opening is up unless `?nointro=1` or a resumed city; while it is, the key table swallows every game key.
  let openingUp = params.get('nointro') !== '1' && !save;

  const view = createView({ canvas, map: world.map, camera: save?.camera, mode: settings.current().renderer });
  const { camera, renderer, markDirty, markPreviewDirty } = view;
  const live = createLive({
    seed,
    map: world.map,
    parcels: world.parcels,
    caps: settings.current().live,
    saved: save?.live ?? null,
    legacyDisplaced: save?.econ.state.displaced ?? 0,
    practices: () => tech.effects(), // the tech tree's live coefficients (Walkable Streets…)
  });
  const power = createPowerController({
    map: world.map,
    parcels: world.parcels,
    publish: (a) => renderer.setPowerGrid(a),
    practices: () => tech.effects(), // Sun and Wire, Renewable Energy, Local Grids
  });

  // Sound: silent until the first click or key unlocks it; listens to the city through the camera.
  const sound = createSound({
    live: live.state,
    view: () => {
      const a = camera.screenToWorld(0, 0);
      const b = camera.screenToWorld(view.width(), view.height());
      return { x0: Math.floor(a.wx), y0: Math.floor(a.wy), x1: Math.ceil(b.wx), y1: Math.ceil(b.wy) };
    },
    hour: () => gameClock(performance.now() / 1000).hour,
    hasHealing: () => world.parcels.aliveIndices().some((i) => world.parcels.kindAt(i) === BuiltKind.HealingCommons),
    hidden: () => document.hidden,
  });
  sound.applySettings(settings.current().audio);
  let deniedAt = 0; // a refused drag would repeat per tile — one 'no' per gesture is enough

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
  if (openingUp) {
    mountOpeningFor(world, seed, () => {
      openingUp = false;
      markDirty();
    });
  }

  const economy = createEconomyController({
    map: world.map,
    parcels: world.parcels,
    tech,
    civic,
    sim: deps,
    live: live.state,
    powerGrid: power.grid,
    initial: save?.econ ?? null,
    // tenant organising protects homes; rent's displaced leave real homes into the unhoused (rehoming.md)
    voiceAt: (t) => neighborhoodVoice(civic, deps.partition, t),
    displace: (amount, protectionAt) => displaceFromHomes(live.state, world.map, amount, protectionAt),
    autosave: () => saves.autosave(), // read at call time (loading a slot blanks autosave first)
    ui: {
      practiceGranted: () => {
        sound.sfx.unlock();
        news.push('A new practice takes root in the city');
        tools.afterEffortChange();
        toolbar.flash();
        panels.get('tech').refresh();
      },
      hourRefreshed: (reliefNow) => {
        toolbar.refresh();
        panels.get('tech').refresh(); // projects advanced (no-op while the panel is closed)
        panels.get('budget').refresh();
        if (reliefNow) {
          panels.get('budget').open(); // the grant and its strings, shown as they arrive
          sound.sfx.relief();
          news.push('A relief grant arrives — with outside oversight');
        }
      },
      pulse: () => pulse.refresh(),
    },
  });

  // Created BEFORE the dock mounts: the dock reads the overlay and the panel flags at mount (the registry reports
  // every panel closed until attach()).
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
  const panels = createPanelRegistry();

  // The [Life] toggle — one closure for the L key AND the dock button (turning it ON restarts the live clock).
  const setAmbient = (on: boolean): void => {
    live.on = on;
    markDirty();
    toolbar.refreshMeta();
  };

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
        if (id === 'life') setAmbient(!live.on);
        else if (isPanelId(id)) panels.toggle(id);
        else overlays.cycle(id); // each the SAME closure its key calls
      },
    },
    techPanel: () => mounted.tech,
    inspect: (info, tx, ty) => inspectReadout(info, tx, ty, world, live.state, power.grid().poweredAnchors),
    placed: () => {
      power.recompute(); // a new plant lights its district
      live.recomputePlantEmitters(); // a placed/bulldozed dirty plant changes the smog sources
    },
    // credit the anchor tile's neighborhood from the LIVE partition (id 0 = none: a safe no-op)
    repaired: (tx, ty) => deps.civic.recordRepair(deps.partition.tileToNeighborhood[world.map.idx(tx, ty)] ?? 0, sim.tick()),
    feedback: {
      selected: () => sound.sfx.toolSelect(),
      applied: (def) => (def.id === 'bulldoze' ? sound.sfx.bulldoze() : sound.sfx.place(placeCategoryOf(def.kind))),
      denied: () => {
        const t = performance.now();
        if (t - deniedAt > 400) sound.sfx.denied();
        deniedAt = t;
      },
    },
  });
  const toolbar = tools.toolbar;

  // The top bar, then the windows (DOM order is stacking order); Saves mounts with its wiring below.
  const pulseDock = mountPulseDock(document.body, { onClick: () => panels.toggle('budget') });
  const pulse = createPulse({
    set: (line) => pulseDock.set(line),
    readout: () => economy.readout(),
    wellbeing: () => wellbeing({ parcels: world.parcels, ecoMeans: deps.ecoMeans, civicMeans: deps.civicMeans }),
    // the city's decline left them without a home, or rent displaced them (loop-coupled: healing lowers it)
    unhoused: () => Math.round(live.state.unhoused), // people without a home (docs/design/rehoming.md)
  });
  const mounted = mountPanels({
    container: document.body,
    economy,
    tech,
    art: (key) => renderer.artImage(key),
    sampleRestoration: () => sampleRestoration(live.state, world.map),
    settings: settings.panel,
    onBorrowed: () => {
      sound.sfx.loanTaken();
      news.push('The city takes out a loan');
      toolbar.refresh(); // the fabric may be affordable again
      pulse.refresh();
    },
    onPracticeBegun: () => tools.afterEffortChange(),
    onToggle: () => {
      toolbar.refreshMeta(); // the key, the dock button AND any dismiss
      sound.sfx.uiClick();
    },
  });
  const showLegend = mountOverlayLegend(document.body);

  // The news ticker along the status bar: the city's changes as headlines (arrests, homes lost and found, gridlock,
  // outages), plus the economy's moments pushed above.
  const news = createNews({
    width: world.map.width,
    height: world.map.height,
    policeViolence: () => live.state.policeViolence,
    traffic: () => live.state.traffic,
    unhoused: () => Math.round(live.state.unhoused), // people without a home (docs/design/rehoming.md)
    dark: () => {
      const lit = power.grid().poweredAnchors;
      let dark = 0;
      let darkAt: { x: number; y: number } | undefined;
      for (const i of world.parcels.aliveIndices()) {
        const p = world.parcels.get(i);
        if (!isPowerConsumer(p.kind) || p.density <= 0 || lit.has(world.map.idx(p.x, p.y))) continue;
        dark++;
        darkAt ??= { x: p.x, y: p.y };
      }
      return { dark, darkAt };
    },
    show: (items) => toolbar.setNews(items),
  });
  {
    const u = Math.round(live.state.unhoused);
    if (u > 0) news.push(`${u} residents are without a home`); // the inherited crisis, from the first frame
  }

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

  installKeys({ target: window, openingUp: () => openingUp, cycleOverlay: overlays.cycle, toggleLife: () => setAmbient(!live.on), togglePanel: panels.toggle });
  attachInput(canvas, camera, { onChange: markDirty, ...tools.input });
  window.addEventListener('resize', view.resize);
  // Back from a hidden tab: reset ONLY the live clock (the sim's catch-up stays clamped by its own loop, so sim
  // output is identical whether life is on or off) and repaint.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    live.resetClock();
    markDirty();
  });

  // The two clocks: the fixed-tick sim (a resumed game keeps its clock — repair rings are stamped in ticks) and
  // the rAF frame (the live layer steps on its own clock inside it).
  const sim = createSimTick({ sim: deps, startTick: save?.tick ?? 0, power, live, overlays, pulse, restore: () => mounted.restore, markDirty });
  const frame = createFrame({ start: performance.now(), power, economy, sim, view, live, world, hidden: () => document.hidden, syncDock: tools.syncDock });
  runFrames(frame, (cb) => window.requestAnimationFrame(cb));
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
