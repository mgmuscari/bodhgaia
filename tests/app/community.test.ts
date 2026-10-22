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
  /** Every neighbourhood's health, 0..255 (undefined: no reading yet). */
  health?: number;
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
    health: () => o.health,
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
    expect(t.live.events?.some((e) => e.kind === 'party')).toBe(true); // and the camera goes
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

// Sideshows (Maddy 2026-10-21): car sideshows — "due to community stress", "they should happen at intersections, and be
// more likely and bigger in bigger intersections", and "leave tire marks in intersections". At night, in a
// hard-pressed neighbourhood, cars take over a crossing and spin donuts while the neighbours ring it to watch.
import { SIDESHOW_HEALTH } from '../../src/app/community';
function crossTown(wide: boolean, health: number | undefined) {
  const map = new GameMap(32, 16);
  const rows = wide ? [7, 8] : [7];
  const cols = wide ? [15, 16] : [15];
  for (const y of rows) for (let x = 0; x < 32; x++) placeTransport(map, x, y, BuiltKind.RoadStreet);
  for (const x of cols) for (let y = 0; y < 16; y++) placeTransport(map, x, y, BuiltKind.RoadStreet);
  const parcels = new ParcelStore();
  for (let x = 1; x < 31; x += 2) {
    if (cols.includes(x)) continue;
    placeParcel(map, parcels, { x, y: 6, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    placeParcel(map, parcels, { x, y: rows[rows.length - 1]! + 1, width: 1, height: 1, kind: BuiltKind.HouseSingle });
  }
  const live = createAmbientState();
  live.events = [];
  setHouseholds(live, residentialCensus(parcels));
  const partition = computeNeighborhoods(map);
  const civic = createCivicState(partition);
  let hour = 22;
  const news: string[] = [];
  const community = createCommunity({
    world: { map, parcels }, live, civic, partition: () => partition, rng: createRng('ss').fork('c'), hour: () => hour, on: () => true,
    news: (t) => news.push(t), practised: () => false, approval: () => 50, health: () => health, cheer() {}, ignite() {},
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
  const hourPasses = (h: number) => {
    hour = h;
    now += COMMUNITY_STEP_MS;
    community.frame(now);
  };
  const box = new Set<number>();
  for (const y of rows) for (const x of cols) box.add(map.idx(x, y));
  return { map, live, civic, partition, news, tick, hourPasses, box };
}
const NIGHT = [21, 22, 23, 0, 1, 2];
function sideshows(t: ReturnType<typeof crossTown>, hours: number) {
  const seen = new Map<number, NonNullable<ReturnType<typeof crossTown>['live']['gatherings']>[number]>();
  for (let k = 0; k < hours; k++) {
    t.hourPasses(NIGHT[k % NIGHT.length]!);
    for (const g of t.live.gatherings ?? []) if (g.kind === 'sideshow') seen.set(g.id, g);
    t.tick(30);
  }
  return [...seen.values()];
}

describe('sideshows', () => {
  it('a hard-pressed neighbourhood: at night, cars take over its crossing, the neighbours ring it, through traffic is shut out', () => {
    const t = crossTown(false, 30);
    const [g] = sideshows(t, 300);
    expect(g).toBeDefined();
    const inBox = [...t.box].some((i) => {
      const x = i % t.map.width, y = (i - x) / t.map.width;
      return x >= g!.site.x && x < g!.site.x + g!.site.w && y >= g!.site.y && y < g!.site.y + g!.site.h;
    });
    expect(inBox).toBe(true);
    expect(g!.cars).toBeGreaterThanOrEqual(1);
    expect(t.news.some((n) => /sideshow/i.test(n))).toBe(true);
  });

  it('never in a thriving neighbourhood, never with no reading, and never by day', () => {
    expect(sideshows(crossTown(false, SIDESHOW_HEALTH + 40), 300)).toHaveLength(0);
    expect(sideshows(crossTown(false, undefined), 300)).toHaveLength(0);
    const day = crossTown(false, 10);
    for (let k = 0; k < 300; k++) day.hourPasses(10 + (k % 8));
    expect((day.live.gatherings ?? []).filter((g) => g.kind === 'sideshow')).toHaveLength(0);
  });

  it('a bigger crossing: likelier, and bigger — more cars', () => {
    const small = sideshows(crossTown(false, 40), 600);
    const big = sideshows(crossTown(true, 40), 600);
    expect(big.length).toBeGreaterThan(small.length);
    expect(Math.max(...big.map((g) => g.cars ?? 0))).toBeGreaterThan(Math.max(...small.map((g) => g.cars ?? 0)));
  });

  it('leaves tire marks in the crossing, which fade slowly', () => {
    const t = crossTown(true, 20);
    const [g] = sideshows(t, 300);
    expect(g).toBeDefined();
    const marked = [...t.box].filter((i) => (t.live.skids?.get(i) ?? 0) > 0);
    expect(marked.length).toBeGreaterThan(0);
  });
});

// Fireworks (interdependence §6): at a festival's night, bursts over the park — they lift the city's belonging (so
// its wellbeing) for the night, and leave a whisper of smog: even joy has a cost.
describe('fireworks', () => {
  const fest = () =>
    town(false, {
      extras: (map, parcels) => {
        placeParcel(map, parcels, { x: 12, y: 8, width: 3, height: 2, kind: BuiltKind.Park });
      },
    });

  it('a festival still on after dark puts on a show — once — and the city belongs a little more', () => {
    const t = fest();
    t.hourPasses(18);
    expect(t.community.hold('festival')).toBe(true);
    const g = t.live.gatherings!.find((x) => x.kind === 'festival')!;
    t.hourPasses(19);
    expect(g.fireworks ?? false).toBe(false); // not yet dark
    const before = t.civic.getValues(t.hood).belonging;
    const smogBefore = [...t.live.pollution.values()].reduce((a, b) => a + b, 0);
    t.hourPasses(21);
    expect(g.fireworks).toBe(true);
    expect(t.news.filter((n) => /fireworks/i.test(n))).toHaveLength(1);
    expect(t.civic.getValues(t.hood).belonging).toBeGreaterThan(before);
    expect([...t.live.pollution.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(smogBefore);
    t.hourPasses(22);
    expect(t.news.filter((n) => /fireworks/i.test(n))).toHaveLength(1); // one show a festival
  });
});
