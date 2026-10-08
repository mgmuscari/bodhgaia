// App shell: the economy controller (src/economy, docs/design/economy-system-dynamics.md). Funds, perishable
// effort, burnout, approval and rent, stepped once per in-game hour. Goodwill IS the city's civic trust (one
// trust stock): the hour reads it and applies its shock back onto every neighbourhood. Practices are projects
// that take time; the fabric is bought with funds through the wallet, the commons with effort.
//
// The run is replaced (never mutated) each step, so readers hold the controller and call run() — never a
// snapshot. The shell is told what to refresh through the injected `ui` callbacks; autosave is a dep read at
// call time (the saves wiring blanks it on load / new city).

import type { GameMap } from '../engine/map';
import type { ParcelStore } from '../engine/fabric';
import type { TechState } from '../tech/state';
import type { CivicState } from '../civic/state';
import type { PowerGrid } from '../growth/power';
import { isPowerConsumer } from '../growth/power';
import { TECH_TREE } from '../tech/tree';
import { wellbeing } from '../tech/effort';
import { TRUST_FLOOR } from '../civic/dynamics';
import { createEconomy, effortCapacity, mourn, loanOffer, takeLoan, ECON, type CityReading, type EconomyState } from '../economy/model';
import { homeProtections, readCity, type CityInputs } from '../economy/readings';
import { economyHour, practiceProject, practiceTerms, DEFAULT_LEVERS, type EconomyRun } from '../economy/run';
import { projectProgress } from '../economy/projects';
import { economyLine } from '../ui/economyContent';
import { budgetView, type BudgetView } from '../ui/budgetContent';
import { gameClock } from '../ui/lighting';
import type { Wallet } from '../tools/tools';

/** Autosave every this many in-game hours (and whenever the tab is hidden or closed — see app/saves). */
export const AUTOSAVE_HOURS = 6;
/** A new city's opening treasury. */
const OPENING_FUNDS = 20_000;
/** Hours caught up per frame after a background tab; beyond this the clock snaps to now. */
const MAX_CATCH_UP = 6;

/** What the shell refreshes as an hour lands (in this order). */
export interface EconomyUi {
  /** A finished practice project granted its tech (toolbar refresh + flash, dock/panel snapshots, tech panel). */
  practiceGranted(): void;
  /** The hour's refreshes (toolbar, tech panel, budget panel); `reliefNow` → open the Budget window. */
  hourRefreshed(reliefNow: boolean): void;
  /** Rewrite the pulse line (the economy readout · the last civic pulse). */
  pulse(): void;
}

export interface EconomyDeps {
  map: GameMap;
  parcels: ParcelStore;
  tech: TechState;
  civic: CivicState;
  /** The sim deps (simTick rewrites their means each cadence) — read at call time. */
  sim: {
    ecoMeans?: { soil: number; flora: number; fauna: number };
    civicMeans?: { belonging: number; voice: number; trust: number };
  };
  /** The live layer's stocks the reading samples. */
  live: {
    occupancy: { get(tile: number): number | undefined };
    landValue: { get(tile: number): number | undefined };
    policeViolence: { values(): Iterable<number> };
  };
  powerGrid: () => PowerGrid;
  /** A resumed game's run (null → a new city, primed on its first hour with occupancy). */
  initial: EconomyRun | null;
  /** Called every AUTOSAVE_HOURS hours — the caller resolves the current autosave at call time. */
  autosave: () => void;
  ui: EconomyUi;
  /** Wall-clock seconds the in-game clock reads (default performance.now() / 1000). */
  nowSec?: () => number;
  /** How organised the neighbourhood at a tile is, 0..1 (civic voice ÷ 255) — tenant organising. Default 0. */
  voiceAt?(tile: number): number;
  /** Take the hour's rent-displaced people out of real homes (live displaceFromHomes), sparing each home by its
   *  protection; returns how many actually left. Absent ⇒ displacement is only counted. */
  displace?(amount: number, protectionAt: (tile: number) => number): number;
}

export interface EconomyController {
  /** The current run (replaced by every step and lever). */
  run(): EconomyRun;
  /** Funds as a get/set view (tools buy the fabric through it). */
  readonly wallet: Wallet;
  /** Effort capacity at the last hour's reading. */
  capacity(): number;
  /** The last hour's funds flow (the relief grant excluded). */
  fundsPerHour(): number;
  /** The last hour's reading (null before the first hour). */
  lastCity(): CityReading | null;
  /** The pulse dock's economy readout. */
  readout(): string;
  /** Step one in-game hour. */
  runHour(): void;
  /** Step once per in-game hour elapsed by `nowMs` (catching up a few after a background tab). */
  advance(nowMs: number): void;
  /** The Budget window's view (projected from the last hour's reading). */
  budgetView(): BudgetView;
  setTax(cls: 'r' | 'c' | 'i', rate: number): void;
  setPolice(perHour: number): void;
  /** Borrow on the current offer; false if refused. */
  borrow(amount: number): boolean;
  /** Begin a practice as a project (effort + funds over time); false if unknown, blocked, or underway. */
  beginPractice(id: string): boolean;
  /** A practice project's progress 0..1, or undefined if none is underway. */
  projectProgress(id: string): number | undefined;
  /** The city mourns `deaths` residents: approval, goodwill and effort fall at once. */
  mourn(deaths: number): void;
}

export function createEconomyController(deps: EconomyDeps): EconomyController {
  const { map, parcels, tech, civic, sim, live, ui } = deps;
  const nowSec = deps.nowSec ?? ((): number => performance.now() / 1000);

  const wellbeing01 = (): number =>
    Math.min(1, wellbeing({ parcels, ecoMeans: sim.ecoMeans, civicMeans: sim.civicMeans }) / 200);
  const inputsNow = (harms: CityReading['harms']): CityInputs => ({
    map,
    parcels,
    occupancyAt: (t) => live.occupancy.get(t),
    landValueAt: (t) => live.landValue.get(t),
    wellbeing: wellbeing01(),
    extraInfra: tech.effects().socialInfra,
    practices: tech.effects(),
    voiceAt: deps.voiceAt,
    harms,
    repairs: 0, // civic trust already earns repairs itself
  });
  const readNow = (harms: CityReading['harms']): CityReading => readCity(inputsNow(harms));
  const violenceTotal = (): number => {
    let sum = 0;
    for (const v of live.policeViolence.values()) sum += v;
    return sum;
  };

  let econ: EconomyRun = deps.initial ?? { state: createEconomy(OPENING_FUNDS), projects: [], levers: DEFAULT_LEVERS };
  let econCapacity = 0;
  let econPrimed = deps.initial !== null; // the opening reserve is set on the first hour with live occupancy to read
  let econFundsPerHour = 0;
  let lastCity: CityReading | null = null; // the last hour's reading (the Budget window projects from it)
  let econSlot = gameClock(nowSec()).slot;
  let prevViolence = violenceTotal();

  const cityForBudget = (): CityReading => lastCity ?? readNow({ blackouts: 0, policeViolence: 0, takings: 0 });
  const leversNow = () => ({ ...econ.levers, spendEffort: 0, spendFunds: 0 });
  const setState = (state: EconomyState): void => {
    econ = { ...econ, state };
  };

  const runHour = (): void => {
    // harms this hour: the share of powered consumers in blackout, and fresh police violence
    let consumers = 0;
    for (const i of parcels.aliveIndices()) if (isPowerConsumer(parcels.get(i).kind)) consumers++;
    const dark = Math.max(0, consumers - deps.powerGrid().poweredAnchors.size);
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
    const trust = sim.civicMeans ? (sim.civicMeans.trust / 255) * 100 : econ.state.goodwill;
    setState({ ...econ.state, goodwill: trust, effort: tech.effort });
    const before = econ.state.funds;
    const hadRelief = econ.state.reliefTaken;
    const displacedBefore = econ.state.displaced;
    const r = economyHour(econ, city);
    econ = r.run;
    // rent's displaced leave real homes, the unprotected on dear land first (rehoming.md)
    const displacedNow = econ.state.displaced - displacedBefore;
    if (displacedNow > 0 && deps.displace) {
      const protection = homeProtections(inputsNow(harms));
      deps.displace(displacedNow, (t) => protection.get(t) ?? 0);
    }
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
      if (practice && tech.grant(practice)) ui.practiceGranted();
    }
    ui.hourRefreshed(reliefNow); // refreshes; the relief grant opens the Budget window with its strings
    if (econ.state.tick % AUTOSAVE_HOURS === 0) deps.autosave();
    ui.pulse();
  };

  return {
    run: () => econ,
    wallet: {
      get funds() {
        return econ.state.funds;
      },
      set funds(v: number) {
        setState({ ...econ.state, funds: v });
      },
    },
    capacity: () => econCapacity,
    fundsPerHour: () => econFundsPerHour,
    lastCity: () => lastCity,
    readout: () =>
      economyLine({
        funds: econ.state.funds,
        fundsPerHour: econFundsPerHour,
        effort: tech.effort,
        capacity: econCapacity,
        approval: econ.state.approval,
        goodwill: econ.state.goodwill,
        burnout: econ.state.burnout,
      }),
    runHour,
    advance: (nowMs) => {
      const hourNow = gameClock(nowMs / 1000).slot;
      for (let k = 0; k < MAX_CATCH_UP && econSlot < hourNow; k++) {
        econSlot++;
        runHour();
      }
      if (econSlot < hourNow) econSlot = hourNow;
    },
    budgetView: () => budgetView(econ.state, cityForBudget(), leversNow()),
    setTax: (cls, rate) => {
      econ = { ...econ, levers: { ...econ.levers, tax: { ...econ.levers.tax, [cls]: rate } } };
    },
    setPolice: (perHour) => {
      econ = { ...econ, levers: { ...econ.levers, police: perHour } };
    },
    borrow: (amount) => {
      const next = takeLoan(econ.state, loanOffer(econ.state, cityForBudget(), leversNow()), amount);
      if (!next) return false;
      setState(next);
      return true;
    },
    beginPractice: (id) => {
      const r = tech.canUnlock(id);
      const node = TECH_TREE.find((n) => n.id === id);
      if (!node || !(r.ok || r.reason === 'effort') || econ.projects.some((p) => p.id === id)) return false;
      // the money is paid up front, once; the work then draws effort over its days
      const upfront = practiceTerms(node).upfront;
      if (econ.state.funds < upfront) return false;
      econ = { ...econ, state: { ...econ.state, funds: econ.state.funds - upfront }, projects: [...econ.projects, practiceProject(node)] };
      return true;
    },
    mourn: (deaths) => {
      if (deaths <= 0) return;
      setState(mourn(econ.state, deaths));
      // the effort on hand lives on the tech state between hours (runHour folds it back into the run)
      tech.effort = Math.max(0, tech.effort - ECON.deathEffort * deaths);
    },
    projectProgress: (id) => {
      const p = econ.projects.find((q) => q.id === id);
      return p ? projectProgress(p) : undefined;
    },
  };
}
