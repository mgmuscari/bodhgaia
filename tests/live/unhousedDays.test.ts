// The unhoused have days (Maddy 2026-10-08): from their camps they go out to the commercial streets and come back,
// and where they spend their days, commerce's tax base thins.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel, placeTransport } from '../../src/engine/fabric';
import { createAmbientState } from '../../src/live/types';
import { createRng } from '../../src/engine/rng';
import { spawnUnhoused, UNHOUSED_OUT_DIVISOR } from '../../src/live/unhoused';
import { stepPed } from '../../src/live/peds';
import { buildVehicleCtx } from '../../src/live/cars';

function street() {
  const map = new GameMap(40, 12);
  const parcels = new ParcelStore();
  for (let x = 0; x < 40; x++) placeTransport(map, x, 6, BuiltKind.RoadStreet);
  for (const x of [20, 22, 24]) placeParcel(map, parcels, { x, y: 5, width: 1, height: 1, kind: BuiltKind.CommercialStrip });
  const state = createAmbientState();
  state.camps = new Map([[map.idx(5, 9), 12], [map.idx(8, 9), 12]]);
  state.unhoused = 24;
  return { map, parcels, state };
}

describe("the unhoused's days", () => {
  it('a share of the camps is out, walking from the camps to the commercial street', () => {
    const { map, state } = street();
    const rng = createRng('u').fork('u');
    for (let k = 0; k < 40; k++) spawnUnhoused(state, map, rng);
    const out = state.peds.filter((p) => p.shelter !== undefined);
    expect(out.length).toBe(Math.round(24 / UNHOUSED_OUT_DIVISOR));
    for (const p of out) {
      expect(state.camps!.has(p.shelter!)).toBe(true);
      expect(map.built[map.idx(p.building!.x, p.building!.y)]).toBe(BuiltKind.CommercialStrip);
    }
  });

  it('they visit (it is recorded where), then walk back to their camp', () => {
    const { map, state } = street();
    const rng = createRng('u').fork('u');
    for (let k = 0; k < 3000; k++) {
      spawnUnhoused(state, map, rng);
      const ctx = buildVehicleCtx(state, map);
      state.peds = state.peds.filter((p) => stepPed(state, map, rng, ctx, p));
    }
    const visited = [...(state.unhousedVisits ?? new Map()).keys()];
    expect(visited.length).toBeGreaterThan(0);
    for (const t of visited) expect(map.built[t]).toBe(BuiltKind.CommercialStrip);
  });

  it("where they spend their days, commerce's tax base thins", async () => {
    const { readCity } = await import('../../src/economy/readings');
    const { map, parcels } = street();
    const inputs = (visits: number) => ({
      map, parcels, occupancyAt: () => 5, landValueAt: () => 200, wellbeing: 0.5, extraInfra: 0,
      harms: { smog: 0, decay: 0, violence: 0, unhoused: 0 } as never, repairs: 0,
      unhousedVisitsAt: (t: number) => (t === map.idx(20, 5) ? visits : 0),
    });
    const calm = readCity(inputs(0)).base.c;
    const busy = readCity(inputs(1000)).base.c;
    expect(busy).toBeLessThan(calm);
    expect(busy).toBeGreaterThan(calm * 0.5); // one shop of three thinned, not the street emptied
  });
});

// Fuller days (Maddy 2026-10-21 "Unhoused as people"): not only the shops — a meal at a pantry or food bank, warmth
// at a library or civic hall (more of it come evening), a clinic, a park. Where there's none of a kind in reach,
// they go where there is; only the shops' visits thin commerce's taxes.
describe('fuller days', () => {
  function town() {
    const { map, parcels, state } = street();
    placeParcel(map, parcels, { x: 12, y: 5, width: 1, height: 1, kind: BuiltKind.Pantry });
    placeParcel(map, parcels, { x: 14, y: 5, width: 1, height: 1, kind: BuiltKind.Library });
    placeParcel(map, parcels, { x: 16, y: 5, width: 1, height: 1, kind: BuiltKind.Clinic });
    placeParcel(map, parcels, { x: 10, y: 7, width: 2, height: 2, kind: BuiltKind.Park });
    return { map, parcels, state };
  }
  const WANT: Record<string, number[]> = {
    shop: [BuiltKind.CommercialStrip],
    meal: [BuiltKind.Pantry, BuiltKind.FoodBank],
    warmth: [BuiltKind.Library, BuiltKind.Civic],
    care: [BuiltKind.Clinic],
    rest: [BuiltKind.Park, BuiltKind.CommunityGarden, BuiltKind.Parklet],
  };
  const errands = (hour: number) => {
    const { map, state } = town();
    const rng = createRng('d').fork('d');
    const seen: Record<string, number> = {};
    for (let k = 0; k < 400; k++) {
      state.peds = [];
      spawnUnhoused(state, map, rng, hour);
      for (const p of state.peds) {
        const e = p.errand ?? 'none';
        seen[e] = (seen[e] ?? 0) + 1;
        expect(WANT[e], e).toContain(map.built[map.idx(p.building!.x, p.building!.y)]);
      }
    }
    return seen;
  };

  it('a day out may be a meal, warmth, care, rest or the shops', () => {
    const seen = errands(12);
    for (const e of ['shop', 'meal', 'warmth', 'care', 'rest']) expect(seen[e] ?? 0, e).toBeGreaterThan(0);
  });

  it('come evening, more go somewhere warm', () => {
    const share = (s: Record<string, number>) => (s.warmth ?? 0) / Object.values(s).reduce((a, b) => a + b, 0);
    expect(share(errands(19))).toBeGreaterThan(share(errands(12)));
  });

  it('with only shops in reach, the shops it is', () => {
    const { map, state } = street();
    const rng = createRng('d').fork('d');
    for (let k = 0; k < 40; k++) spawnUnhoused(state, map, rng, 12);
    for (const p of state.peds) expect(p.errand).toBe('shop');
  });
});
