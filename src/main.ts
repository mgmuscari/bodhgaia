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
import { createEventsController } from './app/events';
import { chooseSeed, randomSeed } from './app/seed';
import { ZoneType, zoneTypeOf } from './engine/zone';
import { neighborhoodVoice } from './civic/voice';
import { displaceFromHomes } from './live/fields/occupancy';
import { createOverlayController, mountOverlayLegend } from './app/overlays';
import { createPanelRegistry, createPulse, isPanelId, mountPanels } from './app/panels';
import { createToolController } from './app/tools';
import { createSaves } from './app/saves';
import { installKeys } from './app/keys';
import { createFrameProfile, createSimTick, createFrame, runFrames } from './app/loop';
import { createSound } from './app/sound';
import { createNews } from './app/news';
import { isPowerConsumer } from './growth/power';
import { placeCategoryOf } from './audio/sfx';
import { gameClock } from './ui/lighting';
import { gameSec, setGameHour } from './ui/gameTime';
import { OPENING_TIMING } from './ui/openingScript';
import { mountNightOverlay } from './ui/openingNight';
import { createNightOpening } from './app/openingNight';
import { cityFocus, tourStops } from './ui/tourContent';
import { worstSpots } from './ui/tutorialContent';
import { touchScreen } from './ui/touch';
import { mountTutorial } from './ui/tutorial';
import { createTutorial, type Tutorial } from './app/tutorial';
import { createLessons } from './app/lessons';
import { createFireController } from './app/fire';
import { drawSpills } from './live/spills';
import { drawCrashes } from './live/accidents';
import { drawCrime } from './live/crime';
import { neighborhoodBelonging } from './civic/voice';
import { NIGHT_FROM, NIGHT_TO } from './live/tuning';
import { createWeather } from './app/weather';
import { createFloodController } from './app/flood';
import { createCommunity } from './app/community';
import { applyRain } from './live/fields/pollution';
import { createDemo, type DemoKind } from './app/demo';
import { BuiltKind } from './engine/fabric';
import { registerServiceWorker } from './app/pwa';
import { installNoBrowserZoom } from './app/noBrowserZoom';


export function main(save: SaveV1 | null = null): void {
  registerServiceWorker(); // installable + offline; a production build checks the site for a new release on launch
  installNoBrowserZoom(document); // the page never zooms: the map's pinch is the game's
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('missing #game canvas');
  installUiTheme(); // the pixel UI kit: palette variables, 9-slice frames, pixel font
  const params = new URLSearchParams(window.location.search);

  // Settings (persisted; the world size feeds worldgen, so it applies on the next load), then the city.
  const settings = createSettingsController({
    applyLive: (caps) => live.applyCaps(caps),
    setRenderer: (m) => view.setMode(m),
    applyAudio: (a) => sound.applySettings(a), // only on a user change, after `sound` exists
    music: () => sound.music, // the picker opens only after `sound` exists
  });
  const { world: size } = settings.current();
  // A resumed city brings its own seed; `?seed=` pins one; otherwise a new player (or New city) gets a random world
  // — a few draws at most, so a first city is never a hamlet.
  const mapSize = { width: size.mapWidth, height: size.mapHeight };
  const homesOf = (s: string): number => {
    const parcels = createCity({ seed: s, size: mapSize, save: null }).world.parcels;
    let homes = 0;
    for (const i of parcels.aliveIndices()) if (zoneTypeOf(parcels.kindAt(i)) === ZoneType.Residential) homes++;
    return homes;
  };
  const citySeed = params.get('seed') ?? (save ? save.seed : chooseSeed(() => randomSeed(), homesOf));
  const city = createCity({ seed: citySeed, size: mapSize, save });
  const { seed, world, tech, civic, sim: deps } = city;

  // The opening is up unless `?nointro=1` or a resumed city; while it is, the key table swallows every game key.
  let openingUp = params.get('nointro') !== '1' && !save;
  // A new city opens at night (bodhgaia-opening.md): set the clock before power and the economy read it.
  if (openingUp) setGameHour(OPENING_TIMING.startHour);

  const view = createView({ canvas, map: world.map, camera: save?.camera, mode: settings.current().renderer });
  if (!save?.camera) {
    const f = cityFocus(world.map, world.parcels); // a new city opens on the city, not the map's corner
    view.camera.centerOn(f.x, f.y, view.camera.zoom);
  }
  const { camera, renderer, markDirty, markPreviewDirty } = view;
  const live = createLive({
    seed,
    map: world.map,
    parcels: world.parcels,
    caps: settings.current().live,
    saved: save?.live ?? null,
    legacyDisplaced: save?.econ.state.displaced ?? 0,
    practices: () => tech.effects(), // the tech tree's live coefficients (Walkable Streets…)
    hour: () => gameClock(gameSec()).hour, // exposure deaths happen at night
  });
  const power = createPowerController({
    map: world.map,
    parcels: world.parcels,
    publish: (a) => renderer.setPowerGrid(a),
    practices: () => tech.effects(), // Sun and Wire, Renewable Energy, Local Grids
    storage: new Map(save?.power?.storage ?? []), // the energy nodes' batteries
  });

  // Sound: silent until the first click or key unlocks it; listens to the city through the camera.
  const sound = createSound({
    live: live.state,
    view: () => {
      const a = camera.screenToWorld(0, 0);
      const b = camera.screenToWorld(view.width(), view.height());
      return { x0: Math.floor(a.wx), y0: Math.floor(a.wy), x1: Math.ceil(b.wx), y1: Math.ceil(b.wy) };
    },
    hour: () => gameClock(gameSec()).hour,
    hasHealing: () => world.parcels.aliveIndices().some((i) => world.parcels.kindAt(i) === BuiltKind.HealingCommons),
    hidden: () => document.hidden,
    firstTrack: import.meta.env.DEV ? (params.get('track') ?? undefined) : undefined, // DEV: audition a piece
    intro: openingUp, // the intro plays Kyabdro
  });
  sound.applySettings(settings.current().audio);
  let deniedAt = 0; // a refused drag would repeat per tile — one 'no' per gesture is enough

  // DEV: time each phase of the frame (window.bodhgaia.prof()) — stripped from the release build
  const frameProfile = import.meta.env.DEV ? createFrameProfile() : undefined;
  if (import.meta.env.DEV) {
    installDevHandle({
      prof: () => frameProfile!.report(),
      camera,
      world,
      ambient: live.state,
      tech,
      power: power.grid,
      markDirty,
      gpu: { isOn: () => view.gpu() !== null, mount: view.mountGpu, unmount: view.unmountGpu },
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
    built: () => {
      // a construction site became its building: it may draw or make power, and the base must show it
      power.recompute();
      live.recomputePlantEmitters();
      markDirty();
    },
    ui: {
      practiceGranted: (id) => {
        lessons.offer(id); // its mechanic's lesson, the first time (plays when the screen is free)
        if (power.recompute()) markDirty(); // a power practice (Sun and Wire, Renewables, Local Grids) acts now, not next hour
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
      buttons: () => metaButtons(panels.isOpen('tech'), overlays.active(), live.on, panels.openFlags(), !touchScreen()),
      onMeta: (id) => {
        if (id === 'life') setAmbient(!live.on);
        else if (isPanelId(id)) panels.toggle(id);
        else overlays.cycle(id); // each the SAME closure its key calls
      },
    },
    techPanel: () => mounted.tech,
    inspect: (info, tx, ty) => inspectReadout(info, tx, ty, world, live.state, power.grid().poweredAnchors, power.grid().storage),
    siteLaid: (site) => economy.startBuild(site), // a commons work rises as the commons pays for it
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
    onReplayLessons: () => lessons.replay(),
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
      power: { storage: power.grid().storage },
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
  // The opening's first act — the night: epigraphs, a walk to a death, the mantra, the dawn — then the city's
  // indictment (the statistics + chronicle overlay), then play.
  const night = openingUp
    ? createNightOpening({
        live: live.state,
        map: world.map,
        rng: createRng(seed).fork('opening-night'),
        ui: mountNightOverlay(document.body),
        follow: (x, y, zoom) => {
          camera.centerOn(x, y, zoom ?? OPENING_TIMING.followZoom);
          markDirty();
        },
        centre: () => ({
          x: camera.x + camera.viewportWidth / camera.tileSize / 2,
          y: camera.y + camera.viewportHeight / camera.tileSize / 2,
        }),
        stops: () => tourStops(world.map, world.parcels),
        hour: () => gameClock(gameSec()).hour,
        setHour: (h) => setGameHour(h),
        // act three: the tutorial — the worst places, the indictment, the interface
        onDone: () => {
          tutorial = createTutorial({
            ui: mountTutorial(document.body),
            follow: (x, y, zoom) => {
              camera.centerOn(x, y, zoom ?? OPENING_TIMING.followZoom);
              markDirty();
            },
            centre: () => ({
              x: camera.x + camera.viewportWidth / camera.tileSize / 2,
              y: camera.y + camera.viewportHeight / camera.tileSize / 2,
            }),
            spots: () => worstSpots(world.map, world.parcels, live.state),
            indict: (onContinue) => mountOpeningFor(world, seed, onContinue, 'Continue'),
            onDone: () => {
              openingUp = false;
              markDirty();
            },
          });
        },
      })
    : null;
  let tutorial: Tutorial | null = null;

  // Lessons: the first time a practice takes root, its mechanic is explained (lessonContent.ts) — once per player,
  // remembered in this browser (storage may be unavailable: then they simply play each time).
  const LESSONS_KEY = 'bodhgaia.lessonsSeen';
  const lessons = createLessons({
    storage: {
      get: () => {
        try {
          return window.localStorage.getItem(LESSONS_KEY);
        } catch {
          return null;
        }
      },
      set: (v) => {
        try {
          window.localStorage.setItem(LESSONS_KEY, v);
        } catch {
          // private window / blocked storage: nothing to remember with
        }
      },
    },
    busy: () => !!night?.active() || !!tutorial?.active(),
    play: (lesson, onDone) =>
      createTutorial(
        {
          ui: mountTutorial(document.body, 'Skip'),
          follow: () => {},
          centre: () => ({ x: 0, y: 0 }),
          spots: () => [],
          indict: (onContinue) => onContinue(),
          onDone,
        },
        [{ kind: 'say', text: lesson.title }, ...lesson.steps],
      ),
  });
  if (import.meta.env.DEV) {
    const handle = (window as unknown as { bodhgaia?: Record<string, unknown> }).bodhgaia;
    if (handle) handle.lessons = lessons; // live checks: offer a lesson without waiting out a practice
  }

  // Disasters (disasters.md) start only with the setting on, and never during the opening's night or tutorial.
  const disastersOn = (): boolean => settings.current().disasters && !night?.active() && !tutorial?.active();
  // Industrial spills: drawn once a game hour from the works' conditions; the cloud is stepped by the live layer.
  const spillRng = createRng(seed).fork('spill');
  // Traffic accidents: drawn once a game hour from the jams under moving cars.
  const crashRng = createRng(seed).fork('crash');
  const drawCrashesNow = (): void => {
    if (!disastersOn()) return;
    const n = drawCrashes(live.state, world.map, crashRng, gameClock(gameSec()).hour);
    if (n > 0) news.push(n > 1 ? `${n} crashes on jammed roads` : 'A crash on a jammed road');
  };
  // Violent crime (conditions, not cops): drawn once a game hour from the despair on the street — at most one life.
  const crimeRng = createRng(seed).fork('crime');
  const drawCrimeNow = (): void => {
    if (!disastersOn()) return;
    const h = gameClock(gameSec()).hour;
    if (drawCrime(live.state, world, crimeRng, h, h >= NIGHT_FROM || h < NIGHT_TO, (t) => neighborhoodBelonging(civic, deps.partition, t))) {
      news.push('A life lost to violence on the street');
    }
  };
  const drawSpillsNow = (): void => {
    if (!disastersOn()) return;
    for (const _ of drawSpills(live.state, world, spillRng, gameClock(gameSec()).hour)) news.push('A toxic spill at the works — a cloud drifts downwind');
  };

  // Weather: storms on their own seeded schedule — rain seen and heard, the air washed; heavy ones flood.
  const weather = createWeather({ live: live.state, map: world.map, rng: createRng(seed).fork('weather'), wash: () => applyRain(live.state, world.map) });

  // Floods: heavy rain lifts the water over the low land by it; homes under water are evacuated until it goes.
  const flood = createFloodController({ world, live: live.state, hour: () => gameClock(gameSec()).hour, disastersOn, markDirty, news: (t) => news.push(t) });

  // Community events (community-events.md): from conditions, never called — block parties first.
  const community = createCommunity({
    world,
    live: live.state,
    civic,
    partition: () => deps.partition,
    rng: createRng(seed).fork('community'),
    hour: () => gameClock(gameSec()).hour,
    on: () => !night?.active() && !tutorial?.active(),
    news: (t) => news.push(t),
    practised: (id) => tech.unlocked.has(id),
    approval: () => economy.run().state.approval,
    cheer: (d) => economy.cheer(d),
    ignite: (i) => fire.ignite(i),
  });

  // Fire (disasters.md): ignition from conditions once a game hour, trucks from the stations, burnt-out ruins. Nothing
  // new ignites while Disasters is off, or during the opening's night and tutorial.
  const fire = createFireController({
    world,
    live: live.state,
    rng: createRng(seed).fork('fire'),
    hour: () => gameClock(gameSec()).hour,
    disastersOn,
    markDirty,
    refreshHouseholds: () => live.refreshHouseholds(),
    news: (t) => news.push(t),
  });
  if (import.meta.env.DEV) {
    const handle = (window as unknown as { bodhgaia?: Record<string, unknown> }).bodhgaia;
    if (handle) {
      handle.fire = fire; // live checks: light a building (and live/spills.ts startSpill for a spill)
      handle.weather = weather; // live checks: weather.storm(heavy)
      handle.flood = flood;
    }
  }

  // DEV: `?demo=fire|spill|disasters` stages them in this city without waiting (serve on a port of its own).
  const demoKind = params.get('demo');
  const demo =
    import.meta.env.DEV && (demoKind === 'fire' || demoKind === 'spill' || demoKind === 'flood' || demoKind === 'crash' || demoKind === 'party' || demoKind === 'fair' || demoKind === 'festival' || demoKind === 'protest' || demoKind === 'uprising' || demoKind === 'disasters')
      ? createDemo(demoKind as DemoKind, {
          world,
          live: live.state,
          ignite: (i) => fire.ignite(i),
          storm: (heavy) => weather.storm(heavy),
          party: (kind = 'block-party') => {
            if (!community.hold(kind)) return null;
            const g = live.state.gatherings!.find((x) => x.kind === kind)!;
            return { x: g.site.x + g.site.w / 2, y: g.site.y + g.site.h / 2 };
          },
          view: (x, y) => {
            camera.centerOn(x, y, 3);
            markDirty();
          },
        })
      : null;

  // The live event feed: deaths are mourned (costs, belonging, grief, news); every event shows in the CCTV inset.
  const events = createEventsController({
    map: world.map,
    world,
    live: live.state,
    civic,
    partition: () => deps.partition,
    mourn: (n) => economy.mourn(n),
    news: (t) => news.push(t),
    skin: view.skin,
    cctvOn: () => !night?.active() && !tutorial?.active(), // the opening's camera is its own
    goTo: (x, y, zoom) => {
      camera.centerOn(x, y, zoom);
      markDirty();
    },
    main: { canvas, renderer, gpu: view.gpu, smog: view.smog },
    powered: () => power.grid().poweredAnchors,
    clock: () => {
      const h = gameClock(gameSec()).hour;
      return `${String(h).padStart(2, '0')}:00`;
    },
  });
  const frame = createFrame({
    prof: frameProfile,
    start: performance.now(),
    power,
    economy,
    sim,
    view,
    live,
    world,
    hidden: () => document.hidden,
    syncDock: tools.syncDock,
    afterRender: (now) => {
      night?.frame(now);
      tutorial?.frame(now);
      lessons.frame(now);
      if (!night?.active() && !tutorial?.active()) weather.frame(now);
      demo?.frame(now);
      flood.frame(now);
      community.frame(now);
      fire.frame(now);
      drawSpillsNow();
      drawCrashesNow();
      drawCrimeNow();
      events.frame(now);
    },
    afterGpu: (now) => events.gpuPass(now),
  });
  // 30 fps on a touch screen: nothing moves faster than 20 steps a second, and a phone heated drawing 120 (Maddy 2026-10-08)
  runFrames(frame, (cb) => window.requestAnimationFrame(cb), touchScreen() ? 1000 / 30 : 0);
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
