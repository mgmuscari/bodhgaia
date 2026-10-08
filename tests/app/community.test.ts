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
  live.events = []; // the camera's feed
  setHouseholds(live, residentialCensus(parcels));
  const partition = computeNeighborhoods(map);
  const civic = createCivicState(partition);
  const hood = partition.tileToNeighborhood[map.idx(10, 5)]!;
  if (belongs) civic.setValues(hood, { belonging: o.belonging ?? 220, voice: civic.getValues(hood).voice, trust: 200 });
  let hour = 12;
  const news: string[] = [];
  const cheers: { approval?: number; goodwill?: number; funds?: number }[] = [];
  const ignited: number[] = [];
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
    ignite: (i) => ignited.push(i),
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
  return { map, parcels, live, civic, hood, news, cheers, ignited, hourPasses, tick, community, setHour: (h: number) => (hour = h) };
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

describe('protests and uprisings (conditions, not cops)', () => {
  /** A harmed neighbourhood: police violence on its streets, a precinct and shops on it. */
  const harmed = (map: GameMap, parcels: ParcelStore) => {
    placeParcel(map, parcels, { x: 13, y: 6, width: 1, height: 1, kind: BuiltKind.Precinct });
    placeParcel(map, parcels, { x: 15, y: 6, width: 1, height: 1, kind: BuiltKind.CommercialStrip });
  };
  const wound = (t: ReturnType<typeof town>) => {
    for (let x = 0; x < 30; x++) for (const y of [4, 5, 6]) t.live.policeViolence.set(t.map.idx(x, y), 220);
  };
  const organise = (t: ReturnType<typeof town>, voice: number) => t.civic.setValues(t.hood, { ...t.civic.getValues(t.hood), voice });
  const endAll = (t: ReturnType<typeof town>) => {
    t.tick(Math.max(0, ...(t.live.gatherings ?? []).map((g) => g.life - g.age)) + 800);
    t.hourPasses(14);
  };

  it('a harmed neighbourhood with a voice protests — on camera, placards and all; one with no voice cannot', () => {
    const silent = town(false, { extras: harmed });
    wound(silent);
    drawFor(silent, (k) => k.includes('protest'));
    expect(kinds(silent)).not.toContain('protest');

    const t = town(false, { extras: harmed });
    wound(t);
    organise(t, 160);
    drawFor(t, (k) => k.includes('protest'));
    expect(kinds(t)).toContain('protest');
    expect(t.live.events?.some((e) => e.kind === 'protest')).toBe(true);
  });

  it('a protest raises its voice; while the cause stands, approval falls', () => {
    const t = town(false, { extras: harmed });
    wound(t);
    organise(t, 160);
    drawFor(t, (k) => k.includes('protest'));
    const before = t.civic.getValues(t.hood).voice;
    endAll(t);
    expect(t.civic.getValues(t.hood).voice).toBeGreaterThan(before);
    expect(t.cheers.some((c) => (c.approval ?? 0) < 0)).toBe(true);
  });

  it('when protest goes unheard and the violence goes on, an uprising: fires — never at homes', () => {
    const t = town(false, { extras: harmed });
    wound(t);
    organise(t, 160);
    for (let round = 0; round < 6 && !kinds(t).includes('uprising'); round++) {
      drawFor(t, (k) => k.includes('protest') || k.includes('uprising'));
      if (!kinds(t).includes('uprising')) endAll(t);
      wound(t); // nothing changed
    }
    expect(kinds(t)).toContain('uprising');
    expect(t.live.events?.some((e) => e.kind === 'uprising')).toBe(true);
    expect(t.ignited.length).toBeGreaterThan(0);
    for (const i of t.ignited) expect(t.parcels.kindAt(i)).not.toBe(BuiltKind.HouseSingle);
  });

  it('cruisers sent to an uprising make it worse; a refuge in reach calms it', () => {
    const escalate = (cruise: boolean, refuge: boolean) => {
      const t = town(false, { extras: (m, p) => { harmed(m, p); if (refuge) placeParcel(m, p, { x: 11, y: 6, width: 1, height: 1, kind: BuiltKind.HealingCommons }); } });
      wound(t);
      organise(t, 100); // a voice, but not yet enough to calm an uprising
      for (let round = 0; round < 6 && !kinds(t).includes('uprising'); round++) {
        drawFor(t, (k) => k.includes('protest') || k.includes('uprising'));
        if (!kinds(t).includes('uprising')) endAll(t);
        wound(t);
      }
      const g = t.live.gatherings!.find((x) => x.kind === 'uprising')!;
      const lit = t.ignited.length;
      if (cruise) t.live.cruisers.push({ x: g.site.x, y: g.site.y, dir: 1, tx: g.site.x + 1, ty: g.site.y });
      for (let h = 0; h < 4; h++) t.hourPasses(12 + h);
      return { more: t.ignited.length - lit, leaving: g.leaving, life: g.life };
    };
    expect(escalate(true, false).more).toBeGreaterThan(escalate(false, false).more);
    expect(escalate(false, true).leaving).toBe(true);
  });
});

describe('a demo of protest', () => {
  it('can hold a protest, or an uprising, in the neighbourhood the police have harmed most', () => {
    const t = town(false, { extras: (m, p) => placeParcel(m, p, { x: 13, y: 6, width: 1, height: 1, kind: BuiltKind.Precinct }) });
    for (let x = 0; x < 30; x++) t.live.policeViolence.set(t.map.idx(x, 5), 200);
    expect(t.community.hold('protest')).toBe(true);
    expect(t.community.hold('uprising')).toBe(false); // that neighbourhood is already out
    expect(kinds(t)).toEqual(['protest']);
  });
});
