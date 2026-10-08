import { describe, it, expect } from 'vitest';
import { createEconomyController, AUTOSAVE_HOURS, type EconomyUi, type EconomyDeps } from '../../src/app/economy';
import { GameMap } from '../../src/engine/map';
import { ParcelStore, BuiltKind, placeParcel, placeTransport } from '../../src/engine/fabric';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';
import { computeNeighborhoods } from '../../src/civic/neighborhoods';
import { createCivicState } from '../../src/civic/state';
import { createEconomy, ECON } from '../../src/economy/model';
import { DEFAULT_LEVERS, practiceProject, practiceTerms, type EconomyRun } from '../../src/economy/run';
import { DAYSPEED } from '../../src/ui/lighting';
import type { PowerGrid } from '../../src/growth/power';
import { money } from '../../src/ui/moneyFormat';

// The economy controller owns main's economy run: it steps one in-game hour at a time (catching up a few after
// a background tab), applies the hour's shock to civic trust, grants finished practices, and tells the shell
// what to refresh — through injected callbacks, never by reaching out.
const HOUR_MS = ((2 * Math.PI) / (DAYSPEED * 24)) * 1000; // one in-game hour of wall-clock ms

function setup(initial: EconomyRun | null = null, autosaveOverride?: () => void, extra: Partial<EconomyDeps> = {}) {
  const map = new GameMap(16, 8);
  const parcels = new ParcelStore();
  for (let x = 1; x <= 10; x++) placeTransport(map, x, 2, BuiltKind.RoadStreet); // upkeep > 0
  placeParcel(map, parcels, { x: 4, y: 3, width: 1, height: 1, kind: BuiltKind.HouseSingle });
  const anchor = map.idx(4, 3);
  const tech = createTechState(TECH_TREE);
  const partition = computeNeighborhoods(map);
  const civic = createCivicState(partition);
  const sim: { ecoMeans?: { soil: number; flora: number; fauna: number }; civicMeans?: { belonging: number; voice: number; trust: number } } = {};
  const live = {
    occupancy: new Map<number, number>([[anchor, 40]]),
    landValue: new Map<number, number>([[anchor, 128]]),
    policeViolence: new Map<number, number>(),
  };
  const grid: PowerGrid = { capacity: 0, demand: 0, poweredAnchors: new Set([anchor]), storage: new Map() };
  const log: string[] = [];
  let autosaves = 0;
  const ui: EconomyUi = {
    practiceGranted: () => log.push('granted'),
    hourRefreshed: (relief) => log.push(relief ? 'refreshed+relief' : 'refreshed'),
    pulse: () => log.push('pulse'),
  };
  let t = 0.5 * HOUR_MS; // mid-hour, slot 0
  const econ = createEconomyController({
    map,
    parcels,
    tech,
    civic,
    sim,
    live,
    powerGrid: () => grid,
    initial,
    autosave:
      autosaveOverride ??
      (() => {
        autosaves++;
        log.push('autosave');
      }),
    ui,
    nowSec: () => t / 1000,
    ...extra,
  });
  return { map, parcels, tech, civic, sim, live, econ, log, autosaves: () => autosaves, setT: (ms: number) => (t = ms) };
}

describe('createEconomyController', () => {
  it('starts a new city with the opening treasury; a resumed one keeps its run', () => {
    expect(setup().econ.run().state.funds).toBe(20_000);
    const saved: EconomyRun = { state: { ...createEconomy(1234), tick: 3 }, projects: [], levers: DEFAULT_LEVERS };
    expect(setup(saved).econ.run()).toBe(saved);
  });

  it('the wallet is a live get/set view over the run’s funds', () => {
    const { econ } = setup();
    econ.wallet.funds = 500;
    expect(econ.run().state.funds).toBe(500);
    expect(econ.wallet.funds).toBe(500);
  });

  it('an hour refreshes the shell, then pulses (no autosave off the cadence)', () => {
    const { econ, log } = setup();
    econ.runHour();
    expect(log).toEqual(['refreshed', 'pulse']);
    expect(econ.run().state.tick).toBe(1);
    expect(econ.lastCity()).not.toBeNull();
  });

  it(`autosaves every ${AUTOSAVE_HOURS} hours, after the refreshes and before the pulse`, () => {
    const { econ, log, autosaves } = setup();
    for (let h = 0; h < 2 * AUTOSAVE_HOURS; h++) econ.runHour();
    expect(autosaves()).toBe(2);
    const i = log.indexOf('autosave');
    expect(log.slice(i - 1, i + 2)).toEqual(['refreshed', 'autosave', 'pulse']);
  });

  it('autosave is read at call time (the caller can blank it later)', () => {
    let calls = 0;
    let current = (): void => {
      calls++;
    };
    const { econ } = setup(null, () => current());
    current = () => {};
    for (let h = 0; h < AUTOSAVE_HOURS; h++) econ.runHour();
    expect(calls).toBe(0);
  });

  it('primes effort to half capacity on the first hour with live occupancy; a resumed city is already primed', () => {
    const fresh = setup();
    fresh.econ.runHour();
    expect(fresh.econ.capacity()).toBeGreaterThan(0);
    // the hour's own step moves effort after the prime; it opens around half-rested, not empty
    expect(fresh.tech.effort).toBeGreaterThan(0);

    const resumed = setup({ state: createEconomy(20_000), projects: [], levers: DEFAULT_LEVERS });
    resumed.econ.runHour();
    expect(resumed.tech.effort).toBe(0); // no prime → effort regenerates from empty
  });

  it('relief: the grant opens the budget once and is excluded from funds/hour', () => {
    const { econ, log } = setup({ state: createEconomy(-100), projects: [], levers: DEFAULT_LEVERS });
    econ.runHour();
    expect(log).toEqual(['refreshed+relief', 'pulse']);
    const city = econ.lastCity()!;
    expect(city.upkeep).toBeGreaterThan(0);
    const grant = ECON.reliefDays * 24 * city.upkeep;
    expect(econ.fundsPerHour()).toBeCloseTo(econ.run().state.funds - -100 - grant, 9);
    expect(Math.abs(econ.fundsPerHour())).toBeLessThan(grant); // the flow, not the one-off
    log.length = 0;
    econ.runHour();
    expect(log).toEqual(['refreshed', 'pulse']); // relief is once
  });

  it('fresh police violence is a harm whose shock lands on every neighbourhood’s trust', () => {
    const { econ, civic, live } = setup();
    econ.runHour();
    const before = civic.getValues(1).trust;
    live.policeViolence.set(5, 5000);
    econ.runHour();
    expect(econ.run().state.shock).toBeLessThan(0);
    expect(civic.getValues(1).trust).toBeLessThan(before);
  });

  it('goodwill reads civic trust (0..255 → 0..100) at the top of the hour', () => {
    const a = setup();
    const b = setup();
    a.sim.civicMeans = { belonging: 0, voice: 0, trust: 255 };
    b.sim.civicMeans = { belonging: 0, voice: 0, trust: 0 };
    a.econ.runHour();
    b.econ.runHour();
    expect(a.econ.run().state.goodwill).toBeGreaterThan(b.econ.run().state.goodwill);
  });

  it('a finished practice project is granted and the shell told before the hour’s refreshes', () => {
    const node = TECH_TREE.find((n) => n.id === 'walkable-streets')!;
    const p = practiceProject(node);
    const run: EconomyRun = {
      state: { ...createEconomy(1e6), effort: 1e6 },
      projects: [{ ...p, done: p.hours - 1 }],
      levers: DEFAULT_LEVERS,
    };
    const { econ, tech, log } = setup(run);
    tech.effort = 1e6;
    econ.runHour();
    expect(tech.unlocked.has('walkable-streets')).toBe(true);
    expect(log).toEqual(['granted', 'refreshed', 'pulse']);
    expect(econ.run().projects).toHaveLength(0);
  });

  it('the hour’s rent displacement empties real homes — sparing the ones their neighbourhood protects', () => {
    const calls: { amount: number; house: number }[] = [];
    const run = (voice: number) => {
      calls.length = 0;
      const priced: EconomyRun = { state: { ...createEconomy(1e6), rent: 1 }, projects: [], levers: DEFAULT_LEVERS };
      const { econ, map } = setup(priced, undefined, {
        voiceAt: () => voice,
        displace: (amount, protectionAt) => {
          calls.push({ amount, house: protectionAt(map.idx(4, 3)) });
          return amount;
        },
      });
      const before = econ.run().state.displaced;
      econ.runHour();
      return econ.run().state.displaced - before;
    };
    const displaced = run(0);
    expect(displaced).toBeGreaterThan(0);
    expect(calls).toEqual([{ amount: displaced, house: 0 }]);
    run(1); // a fully organised neighbourhood: protected, nobody displaced
    expect(calls.every((c) => c.amount === 0) || calls.length === 0).toBe(true);
  });

  it('mourn: deaths take approval, goodwill and the effort on hand at once', () => {
    const { econ, tech } = setup();
    tech.effort = 100;
    const before = econ.run().state;
    econ.mourn(2);
    expect(econ.run().state.approval).toBeCloseTo(before.approval - 2 * ECON.deathApproval, 9);
    expect(econ.run().state.goodwill).toBeCloseTo(before.goodwill - 2 * ECON.deathGoodwill, 9);
    expect(tech.effort).toBe(100 - 2 * ECON.deathEffort);
  });

  it('beginning a practice pays its money up front, once — and is refused without it', () => {
    const terms = practiceTerms(TECH_TREE.find((n) => n.id === 'walkable-streets')!);
    const rich = setup({ state: createEconomy(terms.upfront + 100), projects: [], levers: DEFAULT_LEVERS });
    expect(rich.econ.beginPractice('walkable-streets')).toBe(true);
    expect(rich.econ.run().state.funds).toBe(100);
    expect(rich.econ.run().projects[0]!.funds).toBe(0); // only effort is left to draw
    const poor = setup({ state: createEconomy(terms.upfront - 1), projects: [], levers: DEFAULT_LEVERS });
    expect(poor.econ.beginPractice('walkable-streets')).toBe(false);
    expect(poor.econ.run().state.funds).toBe(terms.upfront - 1);
    expect(poor.econ.run().projects).toHaveLength(0);
  });

  it('beginPractice queues a project once; projectProgress reads it', () => {
    const { econ } = setup();
    expect(econ.beginPractice('walkable-streets')).toBe(true);
    expect(econ.beginPractice('walkable-streets')).toBe(false); // already underway
    expect(econ.beginPractice('road-diets')).toBe(false); // prereqs unmet
    expect(econ.beginPractice('no-such-node')).toBe(false);
    expect(econ.projectProgress('walkable-streets')).toBe(0);
    expect(econ.projectProgress('road-diets')).toBeUndefined();
  });

  it('advance steps once per new in-game hour, catching up at most 6 then snapping to now', () => {
    const { econ } = setup();
    econ.advance(0.9 * HOUR_MS);
    expect(econ.run().state.tick).toBe(0); // same hour
    econ.advance(2.5 * HOUR_MS);
    expect(econ.run().state.tick).toBe(2);
    econ.advance(20.5 * HOUR_MS);
    expect(econ.run().state.tick).toBe(8); // 6 caught up, the rest skipped
    econ.advance(21.5 * HOUR_MS);
    expect(econ.run().state.tick).toBe(9);
  });

  it('budget levers: tax and police set the standing levers; borrow takes a loan within the offer', () => {
    const { econ } = setup();
    econ.setTax('r', 0.12);
    econ.setPolice(40);
    expect(econ.run().levers).toEqual({ tax: { ...DEFAULT_LEVERS.tax, r: 0.12 }, police: 40 });
    const funds = econ.run().state.funds;
    const limit = econ.budgetView().offer.limit;
    expect(limit).toBeGreaterThanOrEqual(500);
    expect(econ.borrow(500)).toBe(true);
    expect(econ.run().state.funds).toBe(funds + 500);
    expect(econ.run().state.loans).toHaveLength(1);
    expect(econ.borrow(1e12)).toBe(false);
  });

  it('readout reflects the run (funds shown)', () => {
    const { econ } = setup();
    expect(econ.readout()).toContain(money(20_000));
  });
});
