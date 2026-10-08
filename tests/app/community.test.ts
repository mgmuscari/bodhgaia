// Community events, host side (docs/design/community-events.md): from conditions, never called by the player.
// Block parties: a neighbourhood that has come to belong and trust closes its street to cars and gathers in it;
// it belongs and trusts more after.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel, placeTransport } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { createAmbientState, setHouseholds } from '../../src/live/types';
import { computeNeighborhoods } from '../../src/civic/neighborhoods';
import { createCivicState, SEED_BELONGING, SEED_TRUST } from '../../src/civic/state';
import { residentialCensus } from '../../src/citizens/census';
import { createCommunity, COMMUNITY_STEP_MS } from '../../src/app/community';
import { closedTiles } from '../../src/live/network';
import { stepPed } from '../../src/live/peds';
import { stepGatherings } from '../../src/live/gatherings';
import { buildVehicleCtx } from '../../src/live/cars';

function town(belongs: boolean) {
  const map = new GameMap(30, 12);
  for (let x = 0; x < 30; x++) placeTransport(map, x, 5, BuiltKind.RoadStreet);
  const parcels = new ParcelStore();
  for (let x = 2; x < 28; x += 2) {
    placeParcel(map, parcels, { x, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    placeParcel(map, parcels, { x, y: 6, width: 1, height: 1, kind: BuiltKind.HouseSingle });
  }
  const live = createAmbientState();
  setHouseholds(live, residentialCensus(parcels));
  const partition = computeNeighborhoods(map);
  const civic = createCivicState(partition);
  const hood = partition.tileToNeighborhood[map.idx(10, 5)]!;
  if (belongs) civic.setValues(hood, { belonging: 220, voice: civic.getValues(hood).voice, trust: 200 });
  let hour = 12;
  const news: string[] = [];
  const community = createCommunity({ world: { map, parcels }, live, civic, partition: () => partition, rng: createRng('cm').fork('c'), hour: () => hour, on: () => true, news: (t) => news.push(t) });
  let now = 0;
  const liveRng = createRng('l').fork('l');
  const tick = (substeps: number) => {
    for (let i = 0; i < substeps; i++) {
      const ctx = buildVehicleCtx(live, map);
      live.peds = live.peds.filter((p) => stepPed(live, map, liveRng, ctx, p));
      stepGatherings(live);
    }
  };
  const hourPasses = (h?: number) => {
    hour = h ?? (hour + 1) % 24;
    now += COMMUNITY_STEP_MS;
    community.frame(now);
  };
  return { map, live, civic, hood, news, hourPasses, tick, community, setHour: (h: number) => (hour = h) };
}

describe('a demo', () => {
  it('can hold a block party now, whatever the conditions, in the neighbourhood with the most homes', () => {
    const t = town(false);
    expect(t.community.hold('block-party')).toBe(true);
    expect((t.live.gatherings ?? []).map((g) => g.kind)).toEqual(['block-party']);
  });
});

describe('block parties', () => {
  it('a neighbourhood that belongs and trusts throws one on its street, by day; one at the opening does not', () => {
    const held = town(true);
    for (let k = 0; k < 200 && !(held.live.gatherings ?? []).length; k++) held.hourPasses(12 + (k % 6));
    expect((held.live.gatherings ?? []).map((g) => g.kind)).toEqual(['block-party']);
    expect(held.news.some((n) => n.includes('block party'))).toBe(true);

    const opening = town(false);
    for (let k = 0; k < 200; k++) opening.hourPasses(12 + (k % 6));
    expect(opening.live.gatherings ?? []).toHaveLength(0);

    const night = town(true);
    for (let k = 0; k < 200; k++) night.hourPasses(k % 2 === 0 ? 23 : 2);
    expect(night.live.gatherings ?? []).toHaveLength(0);
  });

  it('closes its street to cars while it lasts (people still walk it), and opens it after', () => {
    const t = town(true);
    for (let k = 0; k < 200 && !(t.live.gatherings ?? []).length; k++) t.hourPasses(12 + (k % 6));
    const g = t.live.gatherings![0]!;
    const siteTile = t.map.idx(g.site.x, g.site.y);
    expect(closedTiles(t.map, false)?.has(siteTile)).toBe(true);
    expect(closedTiles(t.map, true)?.has(siteTile) ?? false).toBe(false);
    t.tick(g.life + 600);
    t.hourPasses(14);
    expect(closedTiles(t.map, false)?.has(siteTile) ?? false).toBe(false);
  });

  it('afterwards the neighbourhood belongs and trusts a little more', () => {
    const t = town(true);
    for (let k = 0; k < 200 && !(t.live.gatherings ?? []).length; k++) t.hourPasses(12 + (k % 6));
    const before = t.civic.getValues(t.hood);
    t.tick(t.live.gatherings![0]!.life + 600);
    t.hourPasses(14);
    const after = t.civic.getValues(t.hood);
    expect(after.belonging).toBeGreaterThan(before.belonging);
    expect(after.trust).toBeGreaterThan(before.trust);
    expect(SEED_BELONGING).toBeLessThan(255);
    expect(SEED_TRUST).toBeLessThan(255);
  });
});
