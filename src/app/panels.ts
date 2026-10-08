// App shell: the panels and the top bar. Every toggled window (Budget, Tech, Restoration, Saves, Settings, Help)
// returns the one PanelHandle (ui/panelHandle.ts); the registry maps id → handle so the key dispatch, the dock's
// onMeta and the dock's active flags all read ONE table — a panel opened by its key and by its button is the
// same call. mountPanels mounts the windows over their game deps; createPulse drives the always-on top bar.
//
// The handles attach after the dock mounts (DOM order is stacking order for equal z-index), so the registry
// reports every panel closed until then — the dock reads its flags at its own mount.

import type { PanelHandle } from '../ui/panelHandle';
import { mountBudgetPanel } from '../ui/budgetPanel';
import { mountTechPanel, type TechPanelHandle } from '../ui/techPanel';
import { mountRestorationPanel } from '../ui/restorationPanel';
import { mountSettingsPanel, type SettingsPanelCallbacks } from '../ui/settingsPanel';
import { mountHelpPanel } from '../ui/helpPanel';
import { restorationLines, type RestorationSample } from '../ui/restorationContent';
import { effortLine, practiceCost } from '../ui/techContent';
import { techLayout } from '../ui/techLayout';
import { pulseLine } from '../ui/pulseContent';
import { unhousedSuffix } from '../ui/unhousedContent';
import { TECH_TREE } from '../tech/tree';
import type { TechState } from '../tech/state';
import { practiceTerms } from '../economy/run';
import type { EconomyController } from './economy';

export const PANEL_IDS = ['budget', 'tech', 'restore', 'saves', 'settings', 'help'] as const;
export type PanelId = (typeof PANEL_IDS)[number];

export function isPanelId(id: string): id is PanelId {
  return (PANEL_IDS as readonly string[]).includes(id);
}

export interface PanelRegistry {
  /** The mounted handle (throws before attach). */
  get(id: PanelId): PanelHandle;
  isOpen(id: PanelId): boolean;
  toggle(id: PanelId): boolean;
  /** Each panel's open state, keyed as the dock's metaButtons wants it. */
  openFlags(): Record<PanelId, boolean>;
  attach(handles: Record<PanelId, PanelHandle>): void;
}

export function createPanelRegistry(): PanelRegistry {
  let handles: Record<PanelId, PanelHandle> | null = null;
  const get = (id: PanelId): PanelHandle => {
    if (!handles) throw new Error(`panel '${id}' read before the panels mounted`);
    return handles[id];
  };
  const isOpen = (id: PanelId): boolean => handles?.[id].isOpen() ?? false;
  return {
    get,
    isOpen,
    toggle: (id) => get(id).toggle(),
    openFlags: () => Object.fromEntries(PANEL_IDS.map((id) => [id, isOpen(id)])) as Record<PanelId, boolean>,
    attach: (h) => {
      handles = h;
    },
  };
}

/**
 * A readout that trends each reading against the previous one: `read(true)` takes a fresh reading compared to
 * nothing (a panel just opened — no stale arrows), `read(false)` compares to the reading before it.
 */
export function trendReader<S>(sample: () => S, lines: (cur: S, prev: S | null) => string[]): (fresh: boolean) => string[] {
  let prev: S | null = null;
  return (fresh) => {
    const cur = sample();
    const out = lines(cur, fresh ? null : prev);
    prev = cur;
    return out;
  };
}

export interface PanelsDeps {
  container: HTMLElement;
  /** Help → Replay lessons. */
  onReplayLessons?(): void;
  economy: Pick<EconomyController, 'budgetView' | 'setTax' | 'setPolice' | 'borrow' | 'beginPractice' | 'projectProgress' | 'run'>;
  tech: TechState;
  /** The image for an art key (a game tile or `@ui/` icon). */
  art(key: string): CanvasImageSource | undefined;
  /** A live restoration sample; the readout trends successive ones. */
  sampleRestoration(): RestorationSample;
  /** Settings changes (live caps, world size, renderer) — applied by the host. */
  settings: Omit<SettingsPanelCallbacks, 'onToggle'>;
  /** A loan came through: the funds moved (the dock's affordability, the top bar). */
  onBorrowed(): void;
  /** A practice was begun: effort and funds spent (the dock's affordability, the signatures). */
  onPracticeBegun(): void;
  /** Any panel opened or closed (the dock's active flags). */
  onToggle(): void;
}

/** The windows mountPanels owns (Saves is mounted by the saves wiring, app/saves.ts). */
export interface MountedPanels {
  budget: PanelHandle;
  tech: TechPanelHandle;
  restore: PanelHandle;
  settings: PanelHandle;
  help: PanelHandle;
}

/** Mount the windows, in stacking order, each hidden until opened. */
export function mountPanels(deps: PanelsDeps): MountedPanels {
  const { container, economy, tech } = deps;
  const onToggle = (): void => deps.onToggle();

  // The Budget window: tax sliders, the police line, the hourly ledger, and loans (Maddy 2026-10-01: "we need
  // taxes and loans, once you go negative you can't dig back out")
  const budget = mountBudgetPanel(container, {
    getView: () => economy.budgetView(),
    onTax: (cls, rate) => economy.setTax(cls, rate),
    onPolice: (perHour) => economy.setPolice(perHour),
    onBorrow: (amount) => {
      if (economy.borrow(amount)) deps.onBorrowed();
    },
    onToggle,
  });

  // The Commons (tech tree): zero game imports in the panel — it receives its content and the unlock action here.
  const techPanel = mountTechPanel(container, {
    getContent: () => ({ effort: effortLine(tech), layout: techLayout(TECH_TREE, tech) }),
    art: (key) => deps.art(key),
    progress: (id) => economy.projectProgress(id),
    cost: (id) => {
      const node = TECH_TREE.find((n) => n.id === id);
      return node ? practiceCost(practiceTerms(node), economy.run().state.funds) : undefined;
    },
    // Cheap per-tick header source (no branchColumns derive) for refreshHeader (Y5).
    getEffort: () => effortLine(tech),
    onUnlock: (id) => {
      // a practice is begun as a project (effort + funds over time); it unlocks when the work is done. The panel
      // re-renders itself; the host refreshes the dock (the unlock FLASH still fires from the sim-gated path).
      const ok = economy.beginPractice(id);
      if (ok) deps.onPracticeBegun();
      return ok;
    },
    onToggle,
  });

  // Restoration readout (G): "is my repair helping?" — the live metrics with improvement-oriented trend arrows.
  // Opening (key or dock) shows a fresh sample at once; the civic cadence's refresh trends it.
  const restore = mountRestorationPanel(container, {
    read: trendReader(() => deps.sampleRestoration(), restorationLines),
    onToggle,
  });

  // Settings (','): live caps apply instantly; world size persists for the next load.
  const settings = mountSettingsPanel(container, { ...deps.settings, onToggle });

  // Help: the full keybinding reference and the credits ('?'/'h').
  const help = mountHelpPanel(container, { onToggle, onReplayLessons: deps.onReplayLessons });

  return { budget, tech: techPanel, restore, settings, help };
}

export interface PulseDeps {
  /** Write the top bar's line. */
  set(line: string): void;
  /** The economy readout (funds, effort, approval, …). */
  readout(): string;
  wellbeing(): number;
  /** The unhoused: those the city's decline left without a home, plus households rent displaced. */
  unhoused(): number;
}

export interface Pulse {
  /** The civic cadence: re-sample wellbeing and the unhoused, trended against the previous cadence. */
  tick(): void;
  /** The economy moved: rewrite its readout over the last civic line (no re-sample). */
  refresh(): void;
}

/** The always-on top bar: `economy readout · Wellbeing n ↗ · Unhoused n ↓`. Writes its first (flat) line at once. */
export function createPulse(deps: PulseDeps): Pulse {
  let prevWellbeing: number | null = null;
  let prevUnhoused: number | null = null;
  let civicLine = '';
  const refresh = (): void => deps.set(`${deps.readout()}  ·  ${civicLine}`);
  const sample = (wb: number): void => {
    const unhoused = deps.unhoused();
    civicLine = `${pulseLine(wb, prevWellbeing)}  ·  ${unhousedSuffix(unhoused, prevUnhoused)}`;
    prevUnhoused = unhoused;
    refresh();
  };
  sample(deps.wellbeing()); // the first line: flat — and not a prior for the first cadence
  return {
    tick: () => {
      const wb = deps.wellbeing();
      sample(wb);
      prevWellbeing = wb;
    },
    refresh,
  };
}
