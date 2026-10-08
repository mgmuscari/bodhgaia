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

interface TownOpts {
  craft?: boolean;
  /** The neighbourhood's belonging (raw 0..255) when it belongs; default 220. */
  belonging?: number;
  approval?: number;
  extras?: (map: GameMap, parcels: ParcelStore) => void;
}

function town(belongs: boolean, o: TownOpts = {}) {
  const map = new GameMap(30, 12);
  for (let x = 0; x < 30; x++) placeTransport(map, x, 5, BuiltKind.RoadStreet);
  const parcels = new ParcelStore();
  for (let x = 2; x < 28; x += 2) {
    placeParcel(map, parcels, { x, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    placeParcel(map, parcels, { x, y: 6, width: 1, height: 1, kind: BuiltKind.HouseSingle });
  }
  o.extras?.(map, parcels);
  const live = createAmbientState();
  setHouseholds(live, residentialCensus(parcels));
  const partition = computeNeighborhoods(map);
  const civic = createCivicState(partition);
  const hood = partition.tileToNeighborhood[map.idx(10, 5)]!;
  if (belongs) civic.setValues(hood, { belonging: o.belonging ?? 220, voice: civic.getValues(hood).voice, trust: 200 });
  let hour = 12;
  const news: string[] = [];
  const cheers: { approval?: number; goodwill?: number; funds?: number }[] = [];
  const community = createCommunity({
    world: { map, parcels },
    live,
    civic,
    partition: () => partition,
    rng: createRng('cm').fork('c'),
    hour: () => hour,
    on: () => true,
    news: (t) => news.push(t),
    practised: (id) => id === 'craft-fairs' && o.craft === true,
    approval: () => o.approval ?? 50,
    cheer: (d) => cheers.push(d),
  });
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
  return { map, live, civic, hood, news, cheers, hourPasses, tick, community, setHour: (h: number) => (hour = h) };
}

describe('a demo', () => {
  it('can hold a block party now, whatever the conditions, in the neighbourhood with the most homes', () => {
    const t = town(false);
    expect(t.community.hold('block-party')).toBe(true);
    expect((t.live.gatherings ?? []).map((g) => g.kind)).toEqual(['block-party']);
  });

  it('can hold a craft fair at a bazaar, and a festival with its parade, whatever the conditions', () => {
    const t = town(false, {
      extras: (map, parcels) => {
        placeParcel(map, parcels, { x: 13, y: 6, width: 1, height: 1, kind: BuiltKind.Bazaar });
        placeParcel(map, parcels, { x: 12, y: 8, width: 3, height: 2, kind: BuiltKind.Park });
        for (let x = 0; x < 30; x++) placeTransport(map, x, 11, BuiltKind.RoadAvenue);
      },
    });
    expect(t.community.hold('craft-fair')).toBe(true);
    expect(t.community.hold('festival')).toBe(true);
    expect((t.live.gatherings ?? []).map((g) => g.kind).sort()).toEqual(['craft-fair', 'festival', 'parade']);
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

const kinds = (t: ReturnType<typeof town>) => (t.live.gatherings ?? []).map((g) => g.kind).sort();
const drawFor = (t: ReturnType<typeof town>, until: (k: string[]) => boolean) => {
  for (let k = 0; k < 400 && !until(kinds(t)); k++) t.hourPasses(11 + (k % 6));
};

describe('craft fairs', () => {
  const bazaar = (map: GameMap, parcels: ParcelStore) => placeParcel(map, parcels, { x: 13, y: 6, width: 1, height: 1, kind: BuiltKind.Bazaar });

  it('a neighbourhood with a bazaar holds one once it practises Craft Fairs, and the trade brings money in', () => {
    const without = town(true, { extras: bazaar });
    drawFor(without, (k) => k.includes('craft-fair'));
    expect(kinds(without)).not.toContain('craft-fair');

    // belonging enough for a fair, not yet for a block party
    const t = town(true, { craft: true, extras: bazaar, belonging: SEED_BELONGING + 0.2 * (255 - SEED_BELONGING) });
    drawFor(t, (k) => k.includes('craft-fair'));
    expect(kinds(t)).toContain('craft-fair');
    const g = t.live.gatherings!.find((x) => x.kind === 'craft-fair')!;
    t.tick(g.life + 600);
    t.hourPasses(14);
    expect(t.cheers.some((c) => (c.funds ?? 0) > 0)).toBe(true);
  });
});

describe('festivals and parades', () => {
  const park = (map: GameMap, parcels: ParcelStore) => {
    placeParcel(map, parcels, { x: 12, y: 8, width: 3, height: 2, kind: BuiltKind.Park });
    for (let x = 0; x < 30; x++) placeTransport(map, x, 11, BuiltKind.RoadAvenue);
  };

  it('a city that approves and trusts holds a festival at its park, with a parade down the avenue', () => {
    const low = town(true, { extras: park, approval: 40 });
    drawFor(low, (k) => k.includes('festival'));
    expect(kinds(low)).not.toContain('festival');

    const t = town(true, { extras: park, approval: 75 });
    drawFor(t, (k) => k.includes('festival'));
    expect(kinds(t)).toContain('festival');
    expect(kinds(t)).toContain('parade');
    const parade = t.live.gatherings!.find((g) => g.kind === 'parade')!;
    expect(t.map.built[t.map.idx(parade.site.x, parade.site.y)]).toBe(BuiltKind.RoadAvenue);
    expect(closedTiles(t.map, false)?.has(t.map.idx(parade.site.x, parade.site.y))).toBe(true);
  });

  it('a festival lifts approval and goodwill when it ends', () => {
    const t = town(true, { extras: park, approval: 75 });
    drawFor(t, (k) => k.includes('festival'));
    t.tick(Math.max(...t.live.gatherings!.map((g) => g.life)) + 800);
    t.hourPasses(14);
    expect(t.cheers.some((c) => (c.approval ?? 0) > 0 && (c.goodwill ?? 0) > 0)).toBe(true);
  });
});
