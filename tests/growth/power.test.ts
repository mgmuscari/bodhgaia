// P2 — the SC1989-style power grid sim (flood-fill conduction + capacity/brownout).

import { describe, it, expect } from 'vitest';
import {
  computePowerGrid,
  plantOutput,
  powerDemand,
  isPowerConsumer,
  plantPollution,
  loadProfile,
  demandAt,
  feederOf,
  type GridClock,
  NEUTRAL_POWER_PRACTICES,
} from '../../src/growth/power';
import { ZoneType } from '../../src/engine/zone';
import { GameMap } from '../../src/engine/map';
import { ParcelStore, BuiltKind, placeParcel, placeTransport } from '../../src/engine/fabric';

describe('power tables', () => {
  it('rates plant output and zero for non-plants', () => {
    expect(plantOutput(BuiltKind.NuclearPlant)).toBeGreaterThan(plantOutput(BuiltKind.CoalPlant));
    expect(plantOutput(BuiltKind.HouseSingle)).toBe(0);
  });

  it('charges demand by zone class × density, zero for non-consumers', () => {
    expect(powerDemand(BuiltKind.HouseSingle, 2)).toBe(2); // R: 1×2
    expect(powerDemand(BuiltKind.Industrial, 2)).toBe(6); // I: 3×2
    expect(powerDemand(BuiltKind.Park, 1)).toBe(0);
    expect(powerDemand(BuiltKind.CoalPlant, 1)).toBe(0); // plants don't consume
  });

  it('identifies consumers', () => {
    expect(isPowerConsumer(BuiltKind.HouseSingle)).toBe(true);
    expect(isPowerConsumer(BuiltKind.Offices)).toBe(true);
    expect(isPowerConsumer(BuiltKind.Park)).toBe(false);
    expect(isPowerConsumer(BuiltKind.CoalPlant)).toBe(false);
  });

  it('emits air pollution from dirty combustion plants only', () => {
    expect(plantPollution(BuiltKind.CoalPlant)).toBeGreaterThan(plantPollution(BuiltKind.GasPlant));
    expect(plantPollution(BuiltKind.GasPlant)).toBeGreaterThan(0);
    for (const clean of [
      BuiltKind.HydroPlant,
      BuiltKind.NuclearPlant,
      BuiltKind.WindTurbine,
      BuiltKind.SolarPlant,
      BuiltKind.FusionPlant,
      BuiltKind.EnergyNode,
      BuiltKind.HouseSingle,
    ]) {
      expect(plantPollution(clean)).toBe(0);
    }
  });
});

function world() {
  const map = new GameMap(24, 8);
  const parcels = new ParcelStore();
  return { map, parcels };
}

describe('computePowerGrid: conduction', () => {
  it('powers a home connected to a plant through a road', () => {
    const { map, parcels } = world();
    placeParcel(map, parcels, { x: 2, y: 2, width: 1, height: 1, kind: BuiltKind.CoalPlant });
    for (let x = 3; x <= 8; x++) placeTransport(map, x, 2, BuiltKind.RoadStreet);
    placeParcel(map, parcels, { x: 9, y: 2, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    const grid = computePowerGrid(map, parcels);
    expect(grid.poweredAnchors.has(map.idx(9, 2))).toBe(true);
    expect(grid.capacity).toBe(plantOutput(BuiltKind.CoalPlant));
    expect(grid.demand).toBe(powerDemand(BuiltKind.HouseSingle, 1));
  });

  it('leaves a home with no path to any plant unpowered', () => {
    const { map, parcels } = world();
    placeParcel(map, parcels, { x: 2, y: 2, width: 1, height: 1, kind: BuiltKind.CoalPlant });
    placeParcel(map, parcels, { x: 20, y: 6, width: 1, height: 1, kind: BuiltKind.HouseSingle }); // disconnected
    const grid = computePowerGrid(map, parcels);
    expect(grid.poweredAnchors.has(map.idx(20, 6))).toBe(false);
  });

  it('conducts through any built tile (adjacent zones, no road needed)', () => {
    const { map, parcels } = world();
    placeParcel(map, parcels, { x: 5, y: 3, width: 1, height: 1, kind: BuiltKind.GasPlant });
    placeParcel(map, parcels, { x: 6, y: 3, width: 1, height: 1, kind: BuiltKind.HouseSingle }); // touches the plant
    const grid = computePowerGrid(map, parcels);
    expect(grid.poweredAnchors.has(map.idx(6, 3))).toBe(true);
  });
});

describe('computePowerGrid: brownout', () => {
  it('powers only what capacity covers when demand exceeds it', () => {
    const { map, parcels } = world();
    // a small wind turbine feeding a row of dense industry that out-draws it
    placeParcel(map, parcels, { x: 2, y: 2, width: 1, height: 1, kind: BuiltKind.WindTurbine });
    const homes: number[] = [];
    for (let x = 3; x <= 12; x++) {
      placeParcel(map, parcels, { x, y: 2, width: 1, height: 1, kind: BuiltKind.Industrial, density: 3 });
      homes.push(map.idx(x, 2));
    }
    const grid = computePowerGrid(map, parcels);
    const poweredCount = homes.filter((h) => grid.poweredAnchors.has(h)).length;
    const each = powerDemand(BuiltKind.Industrial, 3);
    expect(poweredCount).toBe(Math.floor(plantOutput(BuiltKind.WindTurbine) / each)); // brownout
    expect(grid.demand).toBeGreaterThan(grid.capacity);
  });

  it('powers plots NEAREST the source first in a brownout (Maddy: distribute from the source out)', () => {
    const { map, parcels } = world();
    // A row of industry to the LEFT of the plant, so tile-index (anchor) order is the REVERSE of
    // distance: the nearest home (x=8) has the HIGHEST anchor, the farthest (x=2) the lowest.
    const homes: { x: number; idx: number }[] = [];
    for (let x = 0; x <= 12; x++) {
      placeParcel(map, parcels, { x, y: 2, width: 1, height: 1, kind: BuiltKind.Industrial, density: 3 });
      homes.push({ x, idx: map.idx(x, 2) });
    }
    placeParcel(map, parcels, { x: 13, y: 2, width: 1, height: 1, kind: BuiltKind.WindTurbine });
    const grid = computePowerGrid(map, parcels);
    const powered = homes.filter((h) => grid.poweredAnchors.has(h.idx));
    const n = Math.floor(plantOutput(BuiltKind.WindTurbine) / powerDemand(BuiltKind.Industrial, 3));
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(homes.length); // a real brownout
    expect(powered.length).toBe(n);
    expect(powered.every((h) => h.x >= 13 - n)).toBe(true); // the n NEAREST the plant, not the far end
  });

  it('powers everything when capacity meets demand', () => {
    const { map, parcels } = world();
    placeParcel(map, parcels, { x: 2, y: 2, width: 1, height: 1, kind: BuiltKind.NuclearPlant });
    const homes: number[] = [];
    for (let x = 3; x <= 10; x++) {
      placeParcel(map, parcels, { x, y: 2, width: 1, height: 1, kind: BuiltKind.HouseSingle });
      homes.push(map.idx(x, 2));
    }
    const grid = computePowerGrid(map, parcels);
    expect(homes.every((h) => grid.poweredAnchors.has(h))).toBe(true);
  });

  it('is deterministic', () => {
    const build = () => {
      const { map, parcels } = world();
      placeParcel(map, parcels, { x: 2, y: 2, width: 1, height: 1, kind: BuiltKind.WindTurbine });
      for (let x = 3; x <= 8; x++) placeParcel(map, parcels, { x, y: 2, width: 1, height: 1, kind: BuiltKind.Industrial });
      return computePowerGrid(map, parcels);
    };
    const a = build();
    const b = build();
    expect([...a.poweredAnchors].sort()).toEqual([...b.poweredAnchors].sort());
  });
});


// ── Time-varying demand + rolling blackouts (Maddy 2026-09-30) ─────────────────────────────────────
// The city should be MOSTLY powered, with brownouts when variable demand peaks: each building's load
// follows its zone's hour-of-day profile, phase-shifted and jittered per building, and a short grid
// sheds whole FEEDERS (8×8 blocks) in an order that ROTATES every few in-game hours.

const clock = (hour: number, slot = hour): GridClock => ({ hour, slot });

describe('load profiles', () => {
  it('homes peak in the evening and idle at night; shops peak midday', () => {
    expect(loadProfile(ZoneType.Residential, 19)).toBeGreaterThan(loadProfile(ZoneType.Residential, 3));
    expect(loadProfile(ZoneType.Residential, 19)).toBeGreaterThan(loadProfile(ZoneType.Residential, 12));
    expect(loadProfile(ZoneType.Commercial, 12)).toBeGreaterThan(loadProfile(ZoneType.Commercial, 3));
  });

  it('every profile averages to ~100% over a day (the base demand is the daily mean)', () => {
    for (const z of [ZoneType.Residential, ZoneType.Commercial, ZoneType.Industrial, ZoneType.Civic]) {
      let sum = 0;
      for (let h = 0; h < 24; h++) sum += loadProfile(z, h);
      expect(sum / 24, `zone ${z}`).toBeGreaterThan(90);
      expect(sum / 24, `zone ${z}`).toBeLessThan(110);
    }
  });
});

describe('demandAt — per-building, per-hour', () => {
  it('is deterministic in (kind, density, anchor, clock)', () => {
    expect(demandAt(BuiltKind.HouseSingle, 2, 777, clock(19))).toBe(demandAt(BuiltKind.HouseSingle, 2, 777, clock(19)));
  });

  it('differs between buildings at the same hour (random per building)', () => {
    const vals = new Set<number>();
    for (let a = 0; a < 40; a++) vals.add(demandAt(BuiltKind.HouseSingle, 2, a * 13, clock(19)));
    expect(vals.size).toBeGreaterThan(10);
  });

  it('varies over time for one building, and stays within ±40% of its profiled load', () => {
    const base = powerDemand(BuiltKind.HouseSingle, 2);
    const seen = new Set<number>();
    for (let slot = 0; slot < 48; slot++) {
      const d = demandAt(BuiltKind.HouseSingle, 2, 4242, clock(slot % 24, slot));
      seen.add(d);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThan(base * 2.5);
    }
    expect(seen.size).toBeGreaterThan(10);
  });

  it('is zero for non-consumers', () => {
    expect(demandAt(BuiltKind.Park, 1, 5, clock(19))).toBe(0);
  });
});

describe('computePowerGrid with a clock — rolling blackouts', () => {
  // A 64×24 grid: one plant feeding a big block of homes spanning many 8×8 feeders.
  function town(plant: BuiltKind) {
    const map = new GameMap(64, 24);
    const parcels = new ParcelStore();
    placeParcel(map, parcels, { x: 0, y: 0, width: 1, height: 1, kind: plant });
    const homes: number[] = [];
    for (let y = 0; y < 24; y++) {
      for (let x = 1; x < 64; x++) {
        placeParcel(map, parcels, { x, y, width: 1, height: 1, kind: BuiltKind.HouseSingle, density: 1 });
        homes.push(map.idx(x, y));
      }
    }
    return { map, parcels, homes };
  }

  it('a grid with headroom powers everyone at the evening peak', () => {
    const { map, parcels, homes } = town(BuiltKind.FusionPlant);
    const g = computePowerGrid(map, parcels, clock(19));
    expect(homes.every((h) => g.poweredAnchors.has(h))).toBe(true);
  });

  it('a short grid sheds WHOLE feeders — a block is lit or dark, never half', () => {
    const { map, parcels, homes } = town(BuiltKind.NuclearPlant);
    const g = computePowerGrid(map, parcels, clock(19));
    expect(g.demand).toBeGreaterThan(g.capacity); // the evening peak out-draws the plant
    const byFeeder = new Map<number, boolean[]>();
    for (const h of homes) {
      const f = feederOf(map, h);
      byFeeder.set(f, [...(byFeeder.get(f) ?? []), g.poweredAnchors.has(h)]);
    }
    for (const [f, states] of byFeeder) expect(new Set(states).size, `feeder ${f}`).toBe(1);
    expect([...byFeeder.values()].some((s) => s[0])).toBe(true); // some lit
    expect([...byFeeder.values()].some((s) => !s[0])).toBe(true); // some dark
  });

  it('the blackout ROLLS — a different set of feeders is dark as the hours pass', () => {
    const { map, parcels, homes } = town(BuiltKind.NuclearPlant);
    const darkAt = (slot: number) => homes.filter((h) => !computePowerGrid(map, parcels, clock(19, slot)).poweredAnchors.has(h)).join();
    const sets = new Set([0, 24, 48, 72, 96].map(darkAt));
    expect(sets.size).toBeGreaterThan(1);
  });

  it('never hands out more than the plant makes', () => {
    const { map, parcels } = town(BuiltKind.NuclearPlant);
    const c = clock(19, 7);
    const g = computePowerGrid(map, parcels, c);
    let drawn = 0;
    for (const a of g.poweredAnchors) drawn += demandAt(BuiltKind.HouseSingle, 1, a, c);
    expect(drawn).toBeLessThanOrEqual(g.capacity + 1e-9);
  });
});

describe('the power practices (docs/design/tech-tree-balance.md)', () => {
  function town(plant: BuiltKind) {
    const map = new GameMap(64, 24);
    const parcels = new ParcelStore();
    placeParcel(map, parcels, { x: 0, y: 0, width: 1, height: 1, kind: plant });
    const homes: number[] = [];
    for (let y = 0; y < 24; y++) {
      for (let x = 1; x < 64; x++) {
        if (x === 50 && y === 12) continue;
        placeParcel(map, parcels, { x, y, width: 1, height: 1, kind: BuiltKind.HouseSingle, density: 1 });
        homes.push(map.idx(x, y));
      }
    }
    return { map, parcels, homes };
  }

  it('neutral practices solve exactly as before', () => {
    const { map, parcels } = town(BuiltKind.NuclearPlant);
    const a = computePowerGrid(map, parcels, clock(19, 3));
    const b = computePowerGrid(map, parcels, clock(19, 3), NEUTRAL_POWER_PRACTICES);
    expect([...b.poweredAnchors]).toEqual([...a.poweredAnchors]);
    expect(b.capacity).toBe(a.capacity);
    expect(b.demand).toBe(a.demand);
  });

  it('Sun and Wire: rooftop solar cuts home demand by day, not by night', () => {
    const { map, parcels } = town(BuiltKind.NuclearPlant);
    const roofs = { ...NEUTRAL_POWER_PRACTICES, homeDayDemand: 0.75 };
    const noon = computePowerGrid(map, parcels, clock(12), NEUTRAL_POWER_PRACTICES).demand;
    expect(computePowerGrid(map, parcels, clock(12), roofs).demand).toBeCloseTo(noon * 0.75, 6);
    const night = computePowerGrid(map, parcels, clock(22), NEUTRAL_POWER_PRACTICES).demand;
    expect(computePowerGrid(map, parcels, clock(22), roofs).demand).toBeCloseTo(night, 9);
  });

  it('Renewable Energy: hydro, wind and solar make a quarter more; coal does not', () => {
    const more = { ...NEUTRAL_POWER_PRACTICES, renewableOutput: 1.25 };
    expect(computePowerGrid(town(BuiltKind.SolarPlant).map, town(BuiltKind.SolarPlant).parcels, undefined, more).capacity).toBe(plantOutput(BuiltKind.SolarPlant) * 1.25);
    const coal = town(BuiltKind.CoalPlant);
    expect(computePowerGrid(coal.map, coal.parcels, undefined, more).capacity).toBe(plantOutput(BuiltKind.CoalPlant));
  });

  it('Local Grids: homes around an energy node stay lit through every rotation of a blackout', () => {
    const { map, parcels } = town(BuiltKind.NuclearPlant);
    placeParcel(map, parcels, { x: 50, y: 12, width: 1, height: 1, kind: BuiltKind.EnergyNode });
    const near = [map.idx(47, 12), map.idx(54, 12), map.idx(50, 8), map.idx(50, 16)];
    const grids = { ...NEUTRAL_POWER_PRACTICES, localGrids: true };
    let darkWithout = 0;
    for (const slot of [0, 3, 6, 9, 12, 15, 18, 21]) {
      const g = computePowerGrid(map, parcels, clock(19, slot), grids);
      for (const h of near) expect(g.poweredAnchors.has(h), `slot ${slot}`).toBe(true);
      const plain = computePowerGrid(map, parcels, clock(19, slot));
      darkWithout += near.filter((h) => !plain.poweredAnchors.has(h)).length;
    }
    expect(darkWithout).toBeGreaterThan(0); // without the practice they take their turn in the dark
  });
});
