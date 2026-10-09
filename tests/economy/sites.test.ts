// Commons projects take time (Maddy 2026-10-08: effort drawn per hour, no refund if bulldozed): placing one puts
// down a construction site; the commons pays effort into it each hour; paid in full, it becomes the real thing.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel, finishSite, demolishParcel } from '../../src/engine/fabric';
import { buildProject, liveProjects, SITE_EFFORT_PER_HOUR } from '../../src/economy/run';
import { advanceProjects } from '../../src/economy/projects';

describe('construction sites', () => {
  it('a site project runs its cost over cost ÷ rate hours, drawing effort as it goes', () => {
    const p = buildProject({ kind: BuiltKind.CommunityGarden, name: 'Community Garden', cost: 10, x: 3, y: 4 });
    expect(p.effort).toBe(10);
    expect(p.funds).toBe(0);
    expect(p.hours).toBe(Math.ceil(10 / SITE_EFFORT_PER_HOUR));
    let projects = [p];
    let completed = 0;
    for (let h = 0; h < p.hours; h++) {
      const r = advanceProjects(projects, { effort: 100, funds: 0 });
      projects = r.active;
      completed += r.completed.length;
    }
    expect(completed).toBe(1);
  });

  it('finished, the site becomes the building it was raising', () => {
    const map = new GameMap(10, 10);
    const store = new ParcelStore();
    placeParcel(map, store, { x: 3, y: 4, width: 2, height: 2, kind: BuiltKind.Site });
    expect(finishSite(map, store, 3, 4, BuiltKind.CommunityGarden)).toBe(true);
    expect(map.getBuilt(4, 5)).toBe(BuiltKind.CommunityGarden);
    expect(store.get(map.parcel[map.idx(3, 4)]! - 1).kind).toBe(BuiltKind.CommunityGarden);
    expect(finishSite(map, store, 3, 4, BuiltKind.Park)).toBe(false); // no longer a site
  });

  it('a site bulldozed before it is done drops its project — no refund', () => {
    const map = new GameMap(10, 10);
    const store = new ParcelStore();
    const i = placeParcel(map, store, { x: 3, y: 4, width: 1, height: 1, kind: BuiltKind.Site });
    const p = buildProject({ kind: BuiltKind.CompostHub, name: 'Compost Hub', cost: 10, x: 3, y: 4 });
    expect(liveProjects([p], map)).toHaveLength(1);
    demolishParcel(map, store, i);
    expect(liveProjects([p], map)).toHaveLength(0);
  });
});

describe('a civic site draws money, not effort', () => {
  it('its price in funds, over the same hours', async () => {
    const { FUNDS_PER_COST } = await import('../../src/tools/tools');
    const p = buildProject({ kind: BuiltKind.School, name: 'School', cost: 16, x: 3, y: 4, pay: 'funds' });
    expect(p.effort).toBe(0);
    expect(p.funds).toBe(16 * FUNDS_PER_COST);
    expect(p.hours).toBe(Math.ceil(16 / SITE_EFFORT_PER_HOUR));
  });
});
