// One in-game hour of the economy: the projects underway draw their hourly shares from the stocks on hand,
// then the stocks step (model.ts) with those spends as the hour's outflows. Pure; the city supplies the
// reading (readings.ts) and acts on the completed projects' payloads.

import { stepEconomy, type CityReading, type EconomyState, type Levers } from './model';
import { advanceProjects, startProject, type Project } from './projects';
import type { GameMap } from '../engine/map';
import { BuiltKind } from '../engine/fabric';
import { FUNDS_PER_COST } from '../tools/tools';

/** The player's standing levers (the per-hour project spends are filled in each hour). */
export type StandingLevers = Pick<Levers, 'tax' | 'police'>;

export const DEFAULT_LEVERS: StandingLevers = { tax: { r: 0.07, c: 0.07, i: 0.07 }, police: 0 };

export interface EconomyRun {
  state: EconomyState;
  projects: Project[];
  levers: StandingLevers;
}

export function economyHour(run: EconomyRun, city: CityReading): { run: EconomyRun; completed: Project[] } {
  const adv = advanceProjects(run.projects, { effort: run.state.effort, funds: Math.max(0, run.state.funds) });
  const state = stepEconomy(run.state, city, { ...run.levers, spendEffort: adv.spentEffort, spendFunds: adv.spentFunds });
  return { run: { ...run, state, projects: adv.active }, completed: adv.completed };
}

/** What a Commons practice costs (Maddy 2026-10-07): money ONCE to begin it, then effort drawn over its days —
 *  scaled with the node's cost, taking longer the deeper in the tree it sits. Tuning data. */
export function practiceTerms(node: { cost: number }): { upfront: number; effort: number; hours: number } {
  return { upfront: node.cost * 50, effort: node.cost * 12, hours: 12 + node.cost * 2 };
}

/** A begun practice as a project: its money was paid at the start, so the work draws effort only. */
export function practiceProject(node: { id: string; name: string; cost: number }): Project {
  const t = practiceTerms(node);
  return startProject({
    id: node.id,
    label: node.name,
    effort: t.effort,
    funds: 0,
    hours: t.hours,
    payload: { practice: node.id },
  });
}

/** Effort a construction site takes in an hour (Maddy 2026-10-08): a commons work rises as the commons pays for it. */
export const SITE_EFFORT_PER_HOUR = 2;

/** Raising a commons work at (x, y): its cost in effort, drawn SITE_EFFORT_PER_HOUR an hour; done, the site there
 *  becomes `kind` (the city calls finishSite on completion). */
export function buildProject(spec: { kind: number; name: string; cost: number; x: number; y: number; pay?: 'effort' | 'funds'; effort?: number }): Project {
  const funds = spec.pay === 'funds'; // a civic building is paid from the treasury, the commons in effort
  return startProject({
    id: `build-${spec.kind}@${spec.x},${spec.y}`,
    label: `Raising ${spec.name}`,
    effort: funds ? 0 : (spec.effort ?? spec.cost), // volunteers raising a civic work pay its price in effort
    funds: funds ? spec.cost * FUNDS_PER_COST : 0,
    hours: Math.ceil(spec.cost / SITE_EFFORT_PER_HOUR),
    payload: { site: { x: spec.x, y: spec.y, kind: spec.kind } },
  });
}

/** The projects still worth working: a site bulldozed before it was done drops out — its effort is not refunded. */
export function liveProjects(projects: readonly Project[], map: GameMap): Project[] {
  return projects.filter((p) => {
    const site = (p.payload as { site?: { x: number; y: number } } | null)?.site;
    return !site || (map.inBounds(site.x, site.y) && map.built[map.idx(site.x, site.y)] === BuiltKind.Site);
  });
}

