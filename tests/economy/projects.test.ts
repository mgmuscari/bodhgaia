import { describe, it, expect } from 'vitest';
import { startProject, advanceProjects, projectProgress, type Project } from '../../src/economy/projects';

// Projects take time (Maddy 2026-09-30): a work's effort and funds are drawn a share per in-game hour over
// its duration; it stalls when either runs dry and completes once fully paid. Delays are where the
// system's dynamics live.
const p = (over: Partial<Parameters<typeof startProject>[0]> = {}): Project =>
  startProject({ id: 'garden-1', label: 'Community Garden', effort: 48, funds: 0, hours: 24, payload: { tool: 'build-49' }, ...over });

describe('projects', () => {
  it('draw their cost evenly over the duration and complete when paid', () => {
    let ps = [p()];
    let completed: Project[] = [];
    let spent = 0;
    for (let h = 0; h < 24; h++) {
      const r = advanceProjects(ps, { effort: 100, funds: 100 });
      spent += r.spentEffort;
      ps = r.active;
      completed = completed.concat(r.completed);
    }
    expect(spent).toBeCloseTo(48, 9);
    expect(completed.map((c) => c.id)).toEqual(['garden-1']);
    expect(ps).toEqual([]);
  });

  it('stall without effort — and resume where they stopped', () => {
    const r1 = advanceProjects([p()], { effort: 0, funds: 100 });
    expect(r1.spentEffort).toBe(0);
    expect(projectProgress(r1.active[0]!)).toBe(0);
    expect(r1.active[0]!.stalled).toBe(true);
    const r2 = advanceProjects(r1.active, { effort: 100, funds: 100 });
    expect(projectProgress(r2.active[0]!)).toBeCloseTo(1 / 24, 9);
    expect(r2.active[0]!.stalled).toBe(false);
  });

  it('a practice draws effort AND funds, and stalls when either runs out', () => {
    const practice = p({ id: 'clt', label: 'Community Land Trust', effort: 24, funds: 240, hours: 24 });
    const r = advanceProjects([practice], { effort: 100, funds: 0 });
    expect(r.spentEffort).toBe(0); // no money, no progress — the work waits whole, it doesn't half-start
    expect(r.active[0]!.stalled).toBe(true);
    const ok = advanceProjects([practice], { effort: 100, funds: 100 });
    expect(ok.spentEffort).toBeCloseTo(1, 9);
    expect(ok.spentFunds).toBeCloseTo(10, 9);
  });

  it('share what is available in queue order (the first project is staffed first)', () => {
    const a = p({ id: 'a', effort: 48, hours: 24 }); // wants 2 / hour
    const b = p({ id: 'b', effort: 48, hours: 24 });
    const r = advanceProjects([a, b], { effort: 3, funds: 0 });
    expect(projectProgress(r.active[0]!)).toBeCloseTo(1 / 24, 9);
    expect(projectProgress(r.active[1]!)).toBe(0); // only 1 left over — not enough for b's hourly share
    expect(r.spentEffort).toBeCloseTo(2, 9);
  });

  it('never overspends what it was given', () => {
    const r = advanceProjects([p({ effort: 1000, hours: 1 })], { effort: 7, funds: 0 });
    expect(r.spentEffort).toBeLessThanOrEqual(7);
  });
});
