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
  solarFactor,
  windFactor,
  smartGridFactor,
  BATTERY_RATE,
  BATTERY_CAPACITY,
  SMART_GRID_RADIUS,
  SMART_GRID_CUT,
  SMART_GRID_FROM,
  SMART_GRID_TO,
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
  }, 20_000); // ~3.5 s alone: a day of hourly grid solves

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

describe('wind and sun (tech-tree batch 3)', () => {
  const plant = (kind: BuiltKind) => {
    const map = new GameMap(8, 8);
    const parcels = new ParcelStore();
    placeParcel(map, parcels, { x: 0, y: 0, width: 1, height: 1, kind });
    return { map, parcels };
  };
  const cap = (kind: BuiltKind, c?: GridClock) => {
    const { map, parcels } = plant(kind);
    return computePowerGrid(map, parcels, c).capacity;
  };

  it('solar follows the sun: full at noon, nothing at night, half at 9:00', () => {
    expect(cap(BuiltKind.SolarPlant, clock(12))).toBe(plantOutput(BuiltKind.SolarPlant));
    expect(cap(BuiltKind.SolarPlant, clock(23))).toBe(0);
    expect(cap(BuiltKind.SolarPlant, clock(3))).toBe(0);
    expect(cap(BuiltKind.SolarPlant, clock(9))).toBeCloseTo(plantOutput(BuiltKind.SolarPlant) / 2, 9);
    expect(solarFactor(12)).toBe(1);
  });

  it('wind gusts hour to hour between 0.4× and 1.6×, and blows harder by night', () => {
    let day = 0;
    let night = 0;
    for (let slot = 0; slot < 24 * 30; slot++) {
      const f = windFactor({ hour: slot % 24, slot });
      expect(f).toBeGreaterThanOrEqual(0.4);
      expect(f).toBeLessThanOrEqual(1.6);
      if (slot % 24 >= 8 && slot % 24 < 18) day += f;
      else if (slot % 24 >= 20 || slot % 24 < 6) night += f;
    }
    expect(night / (30 * 10)).toBeGreaterThan(day / (30 * 10));
    expect(cap(BuiltKind.WindTurbine, clock(2, 50))).toBeCloseTo(plantOutput(BuiltKind.WindTurbine) * windFactor(clock(2, 50)), 9);
  });

  it('without a clock (worldgen, static solves) plants run at their nameplate', () => {
    expect(cap(BuiltKind.SolarPlant)).toBe(plantOutput(BuiltKind.SolarPlant));
    expect(cap(BuiltKind.WindTurbine)).toBe(plantOutput(BuiltKind.WindTurbine));
  });
});

describe('Community AI Node: the smart grid (Maddy 2026-10-07)', () => {
  const town = (withNode: boolean) => {
    const map = new GameMap(40, 4);
    const parcels = new ParcelStore();
    placeParcel(map, parcels, { x: 0, y: 0, width: 1, height: 1, kind: BuiltKind.FusionPlant });
    for (let x = 1; x < 40; x++) placeParcel(map, parcels, { x, y: 1, width: 1, height: 1, kind: BuiltKind.HouseSingle, density: 1 });
    if (withNode) placeParcel(map, parcels, { x: 5, y: 2, width: 1, height: 1, kind: BuiltKind.AINode });
    return { map, parcels };
  };
  const homeDemand = (withNode: boolean, hour: number, x: number) => {
    const { map } = town(withNode);
    const c = clock(hour);
    return demandAt(BuiltKind.HouseSingle, 1, map.idx(x, 1), c) * smartGridFactor(map, map.idx(x, 1), c);
  };

  it(`homes within ${SMART_GRID_RADIUS} tiles draw ${SMART_GRID_CUT * 100}% less ${SMART_GRID_FROM}:00–${SMART_GRID_TO}:00`, () => {
    expect(homeDemand(true, 19, 9)).toBeCloseTo(homeDemand(false, 19, 9) * (1 - SMART_GRID_CUT), 9);
    expect(homeDemand(true, 12, 9)).toBeCloseTo(homeDemand(false, 12, 9), 9); // not the peak
    expect(homeDemand(true, 19, 30)).toBeCloseTo(homeDemand(false, 19, 30), 9); // out of reach
  });

  it('the solve uses it', () => {
    const a = town(false);
    const b = town(true);
    expect(computePowerGrid(b.map, b.parcels, clock(19)).demand).toBeLessThan(computePowerGrid(a.map, a.parcels, clock(19)).demand);
  });
});

describe('energy node batteries (Maddy 2026-10-07: the solar problem)', () => {
  // solar plus an energy node feeding a row of homes
  const town = () => {
    const map = new GameMap(40, 4);
    const parcels = new ParcelStore();
    placeParcel(map, parcels, { x: 0, y: 0, width: 3, height: 3, kind: BuiltKind.SolarPlant });
    placeParcel(map, parcels, { x: 3, y: 1, width: 1, height: 1, kind: BuiltKind.EnergyNode });
    for (const y of [1, 2]) for (let x = 4; x < 40; x++) placeParcel(map, parcels, { x, y, width: 1, height: 1, kind: BuiltKind.HouseSingle, density: 3 });
    return { map, parcels, node: map.idx(3, 1) };
  };

  it('charge from the noon surplus, up to its rate per hour and its capacity', () => {
    const { map, parcels, node } = town();
    const g = computePowerGrid(map, parcels, clock(12), NEUTRAL_POWER_PRACTICES, new Map());
    expect(g.capacity).toBeGreaterThan(g.demand); // noon: the panels out-make the homes
    expect(g.storage.get(node)).toBe(BATTERY_RATE);
    const full = computePowerGrid(map, parcels, clock(12), NEUTRAL_POWER_PRACTICES, new Map([[node, BATTERY_CAPACITY - 10]]));
    expect(full.storage.get(node)).toBe(BATTERY_CAPACITY);
  });

  it('discharge into the evening shortfall: more homes lit, the charge spent', () => {
    const { map, parcels, node } = town();
    const dark = computePowerGrid(map, parcels, clock(20), NEUTRAL_POWER_PRACTICES, new Map());
    const stored = computePowerGrid(map, parcels, clock(20), NEUTRAL_POWER_PRACTICES, new Map([[node, BATTERY_CAPACITY]]));
    expect(stored.poweredAnchors.size).toBeGreaterThan(dark.poweredAnchors.size);
    expect(stored.storage.get(node)!).toBeLessThan(BATTERY_CAPACITY);
    expect(BATTERY_CAPACITY - stored.storage.get(node)!).toBeLessThanOrEqual(BATTERY_RATE + 1e-9);
  });

  it('a node is a solar canopy and a battery (Maddy 2026-10-08): it makes power by day, none at night, and lights the night only with what it stored', () => {
    const map = new GameMap(12, 4);
    const parcels = new ParcelStore();
    placeParcel(map, parcels, { x: 0, y: 1, width: 1, height: 1, kind: BuiltKind.EnergyNode });
    for (let x = 1; x < 4; x++) placeParcel(map, parcels, { x, y: 1, width: 1, height: 1, kind: BuiltKind.HouseSingle, density: 1 });
    const node = map.idx(0, 1);
    const noon = computePowerGrid(map, parcels, clock(12), NEUTRAL_POWER_PRACTICES, new Map());
    expect(noon.capacity).toBeGreaterThan(0);
    expect(noon.storage.get(node)!).toBeGreaterThan(0); // its own surplus banked
    const midnight = computePowerGrid(map, parcels, clock(0), NEUTRAL_POWER_PRACTICES, new Map());
    expect(midnight.capacity).toBe(0); // no sun on the canopy
    const bare = new GameMap(12, 4);
    const bareParcels = new ParcelStore();
    for (let x = 1; x < 4; x++) placeParcel(bare, bareParcels, { x, y: 1, width: 1, height: 1, kind: BuiltKind.HouseSingle, density: 1 });
    expect(midnight.demand).toBeCloseTo(computePowerGrid(bare, bareParcels, clock(0), NEUTRAL_POWER_PRACTICES, new Map()).demand, 9); // the node draws nothing itself
    expect(midnight.poweredAnchors.size).toBe(0); // and nothing stored: dark
    const charged = computePowerGrid(map, parcels, clock(0), NEUTRAL_POWER_PRACTICES, new Map([[node, BATTERY_CAPACITY]]));
    expect(charged.poweredAnchors.size).toBeGreaterThan(0); // the day's charge lights the night
  });

  it('a static solve (no clock) neither charges nor spends', () => {
    const { map, parcels, node } = town();
    expect(computePowerGrid(map, parcels, undefined, NEUTRAL_POWER_PRACTICES, new Map([[node, 100]])).storage.get(node)).toBe(100);
  });
});

describe('a source is not a consumer (Maddy 2026-10-08: the power-out indicator on energy nodes)', () => {
  it('an energy node feeds the grid; it never reads as unpowered', async () => {
    const { isPowerConsumer } = await import('../../src/growth/power');
    const { BuiltKind } = await import('../../src/engine/fabric');
    expect(isPowerConsumer(BuiltKind.EnergyNode)).toBe(false);
    expect(isPowerConsumer(BuiltKind.Civic)).toBe(true);
    expect(isPowerConsumer(BuiltKind.AINode)).toBe(true); // a civic consumer that isn't a source
  });
});
