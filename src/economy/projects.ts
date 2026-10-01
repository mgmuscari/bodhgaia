// Projects: works that take time (Maddy 2026-09-30, "projects take time"). A practice from the Commons or a
// commons build (a garden, a parklet…) is not bought in one go: its effort and funds are drawn an hourly
// share over its duration. In an hour the share can't be met, the work STALLS whole (it waits rather than
// half-starting) and resumes where it stopped. Projects are staffed in queue order, so what you start first
// gets the people first. Pure: no DOM, no rng, no transcendental Math.

export interface ProjectSpec {
  id: string;
  label: string;
  /** Total effort and funds the work needs. */
  effort: number;
  funds: number;
  /** How many in-game hours it takes when fully staffed (≥ 1). */
  hours: number;
  /** What completing it does — opaque here (a tool action, a practice id), interpreted by the city. */
  payload: unknown;
}

export interface Project extends ProjectSpec {
  /** Fully-staffed hours worked so far. */
  done: number;
  /** True if the last hour couldn't be staffed or funded. */
  stalled: boolean;
}

export function startProject(spec: ProjectSpec): Project {
  return { ...spec, hours: Math.max(1, spec.hours), done: 0, stalled: false };
}

/** Fraction complete, 0..1. */
export function projectProgress(p: Project): number {
  return Math.min(1, p.done / p.hours);
}

/** One hour of work: each project in order takes its hourly share of effort and funds if both are there. */
export function advanceProjects(
  projects: readonly Project[],
  available: { effort: number; funds: number },
): { active: Project[]; completed: Project[]; spentEffort: number; spentFunds: number } {
  let effort = available.effort;
  let funds = available.funds;
  const active: Project[] = [];
  const completed: Project[] = [];
  for (const p of projects) {
    const needE = p.effort / p.hours;
    const needF = p.funds / p.hours;
    if (needE <= effort + 1e-9 && needF <= funds + 1e-9) {
      effort -= needE;
      funds -= needF;
      const next: Project = { ...p, done: p.done + 1, stalled: false };
      if (next.done >= next.hours) completed.push(next);
      else active.push(next);
    } else {
      active.push({ ...p, stalled: true });
    }
  }
  return { active, completed, spentEffort: available.effort - effort, spentFunds: available.funds - funds };
}
