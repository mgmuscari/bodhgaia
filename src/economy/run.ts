// One in-game hour of the economy: the projects underway draw their hourly shares from the stocks on hand,
// then the stocks step (model.ts) with those spends as the hour's outflows. Pure; the city supplies the
// reading (readings.ts) and acts on the completed projects' payloads.

import { stepEconomy, type CityReading, type EconomyState, type Levers } from './model';
import { advanceProjects, startProject, type Project } from './projects';

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

/** A Commons practice as a project: effort AND funds (Maddy's decision), scaled with the node's cost, taking
 *  longer the deeper in the tree it sits. Tuning data. */
export function practiceProject(node: { id: string; name: string; cost: number }): Project {
  return startProject({
    id: node.id,
    label: node.name,
    effort: node.cost * 12,
    funds: node.cost * 50,
    hours: 12 + node.cost * 2,
    payload: { practice: node.id },
  });
}
