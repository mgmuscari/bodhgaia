import { describe, it, expect } from 'vitest';
import {
  OVERLAY_KINDS,
  OVERLAYS,
  type OverlayContext,
  type OverlayKind,
} from '../../src/ui/overlayRegistry';
import { OVERLAY_ALPHA, overlayTint, ecoLegend, OVERLAY_VIEWS } from '../../src/ui/ecoOverlayContent';
import { civicOverlayTint, civicLegend, CIVIC_VIEWS } from '../../src/ui/civicOverlayContent';
import { redlineOverlayTint, redlineLegend } from '../../src/ui/redlineOverlayContent';
import { policeLegend, POLICE_OVERLAY_ALPHA } from '../../src/ui/policeViolenceOverlayContent';
import { coverageTint, coverageLegend } from '../../src/ui/coverageOverlayContent';
import { powerTint, powerLegend } from '../../src/ui/powerOverlayContent';
import { GameMap, Water } from '../../src/engine/map';
import { ParcelStore, BuiltKind, placeParcel } from '../../src/engine/fabric';
import { biodiversityField } from '../../src/ecology/biodiversity';

// The overlay registry is the ONE dispatch for the map overlays (kind → views, legend line, colour key,
// tint source, refresh cadence). Adding an overlay = one entry. These tests pin today's behaviour: the
// cycle order, the exact legend strings, and that each kind's tint source reads the same data as before.

describe('overlay registry: every kind registered', () => {
  it('lists the six kinds in dock/key order, each with an entry', () => {
    expect(OVERLAY_KINDS).toEqual(['eco', 'civic', 'redline', 'police', 'coverage', 'power']);
    expect(Object.keys(OVERLAYS).sort()).toEqual([...OVERLAY_KINDS].sort());
  });

  it('pins each kind\'s views (the cycle order)', () => {
    expect(OVERLAYS.eco.views).toEqual([
      'soil',
      'flora',
      'fauna',
      'biodiversity',
      'airPollution',
      'groundPollution',
      'waterPollution',
    ]);
    expect(OVERLAYS.civic.views).toEqual(['belonging', 'voice', 'trust']);
    expect(OVERLAYS.redline.views).toEqual(['grade']);
    expect(OVERLAYS.police.views).toEqual(['violence']);
    expect(OVERLAYS.coverage.views).toEqual(['coverage']);
    expect(OVERLAYS.power.views).toEqual(['power']);
  });

  it('carries each kind\'s fill alpha (police keeps its lighter stain)', () => {
    for (const k of OVERLAY_KINDS) expect(OVERLAYS[k].alpha).toBe(k === 'police' ? POLICE_OVERLAY_ALPHA : OVERLAY_ALPHA);
  });
});

describe('overlay registry: legend lines (pinned to today\'s strings)', () => {
  const LINES: Record<OverlayKind, Record<string, string>> = {
    eco: {
      soil: 'Soil health — broken brown to living green',
      flora: 'Flora vitality — bare ground to deep canopy',
      fauna: 'Fauna presence — quiet to teeming',
      biodiversity: 'Biodiversity — richness, violet to gold',
      airPollution: 'Air pollution — clear air to dark smog',
      groundPollution: 'Ground pollution — clean land to toxic ground',
      waterPollution: 'Water pollution — clear to dingy creek',
    },
    civic: {
      belonging: 'Belonging — adrift to held',
      voice: 'Voice — unheard to heard',
      trust: 'Trust — wary to trusting',
    },
    redline: { grade: 'Redline grade — A greenlined (best) to D redlined (HOLC)' },
    police: { violence: 'Police violence — where the state does harm' },
    coverage: { coverage: 'Service coverage — served (green) vs under-served (red)' },
    power: { power: 'Power grid — powered (green) vs dark (red)' },
  };
  for (const k of OVERLAY_KINDS) {
    it(`${k}: one line per view, identical to today`, () => {
      expect(Object.keys(LINES[k])).toEqual([...OVERLAYS[k].views]);
      for (const v of OVERLAYS[k].views) expect(OVERLAYS[k].legendLine(v)).toBe(LINES[k][v]);
    });
  }
});

describe('overlay registry: colour keys', () => {
  it('returns each module\'s legend for each view', () => {
    for (const v of OVERLAY_VIEWS) expect(OVERLAYS.eco.legend(v)).toEqual(ecoLegend(v));
    for (const v of CIVIC_VIEWS) expect(OVERLAYS.civic.legend(v)).toEqual(civicLegend(v));
    expect(OVERLAYS.redline.legend('grade')).toEqual(redlineLegend());
    expect(OVERLAYS.police.legend('violence')).toEqual(policeLegend());
    expect(OVERLAYS.coverage.legend('coverage')).toEqual(coverageLegend());
    expect(OVERLAYS.power.legend('power')).toEqual(powerLegend());
  });
});

// cycleComposite (defined in the registry) keeps its truth table in civicOverlayContent.test.ts.

// A tiny world: 4×2, the right column water; a home (consumer) at (0,0), a park (non-consumer) at (1,0).
function ctxFixture() {
  const map = new GameMap(4, 2);
  const parcels = new ParcelStore();
  for (let y = 0; y < 2; y++) map.water[map.idx(3, y)] = Water.River;
  placeParcel(map, parcels, { x: 0, y: 0, width: 1, height: 1, kind: BuiltKind.HouseSingle });
  placeParcel(map, parcels, { x: 1, y: 0, width: 1, height: 1, kind: BuiltKind.Park });
  for (let i = 0; i < 8; i++) {
    map.soilHealth[i] = 10 * i;
    map.floraVitality[i] = 20 * i;
    map.faunaPresence[i] = 30 * i;
    map.redline[i] = 32 * i;
  }
  const t2n = new Uint16Array([1, 1, 2, 0, 1, 2, 2, 0]);
  const values = [
    { belonging: 10, voice: 20, trust: 30 },
    { belonging: 200, voice: 100, trust: 50 },
  ];
  const ctx: OverlayContext = {
    map,
    parcels,
    live: {
      pollution: new Map([[0, 300], [1, 40]]),
      groundPollution: new Map([[2, 99]]),
      waterPollution: new Map([[3, 120]]),
      coverage: new Set([0]),
    },
    poweredAnchors: new Set<number>(),
    civic: { count: () => 2, getValues: (id: number) => values[id - 1]! },
    tileToNeighborhood: t2n,
  };
  return { map, ctx, values, t2n };
}

const tints = (src: { tint(i: number): unknown } | null | undefined, n = 8) =>
  Array.from({ length: n }, (_, i) => (src ? src.tint(i) : 'none'));

describe('overlay registry: tint sources read the same data as before', () => {
  it('every base kind dims the map; police has no base source and is drawn live', () => {
    const { ctx } = ctxFixture();
    for (const k of OVERLAY_KINDS) {
      if (k === 'police') {
        expect(OVERLAYS.police.source).toBeUndefined();
        expect(OVERLAYS.police.live).toBe('police');
      } else {
        expect(OVERLAYS[k].live).toBeUndefined();
        for (const v of OVERLAYS[k].views) expect(OVERLAYS[k].source!(v, ctx).dimBase).toBe(true);
      }
    }
  });

  it('eco land layers tint land only, from the map layer', () => {
    const { map, ctx } = ctxFixture();
    const layers = { soil: map.soilHealth, flora: map.floraVitality, fauna: map.faunaPresence } as const;
    for (const v of ['soil', 'flora', 'fauna'] as const) {
      const got = tints(OVERLAYS.eco.source!(v, ctx));
      expect(got).toEqual(Array.from({ length: 8 }, (_, i) => (i % 4 === 3 ? null : overlayTint(v, layers[v][i]!))));
    }
  });

  it('eco biodiversity tints land from the derived field', () => {
    const { map, ctx } = ctxFixture();
    const field = biodiversityField(map);
    expect(tints(OVERLAYS.eco.source!('biodiversity', ctx))).toEqual(
      Array.from({ length: 8 }, (_, i) => (i % 4 === 3 ? null : overlayTint('biodiversity', field[i]!))),
    );
  });

  it('eco pollution views read the live fields (air/ground over land, water over water), capped at 255', () => {
    const { ctx } = ctxFixture();
    const air = tints(OVERLAYS.eco.source!('airPollution', ctx));
    expect(air[0]).toEqual(overlayTint('airPollution', 255));
    expect(air[1]).toEqual(overlayTint('airPollution', 40));
    expect(air[2]).toEqual(overlayTint('airPollution', 0));
    expect(air[3]).toBeNull();
    const ground = tints(OVERLAYS.eco.source!('groundPollution', ctx));
    expect(ground[2]).toEqual(overlayTint('groundPollution', 99));
    expect(ground[3]).toBeNull();
    const water = tints(OVERLAYS.eco.source!('waterPollution', ctx));
    expect(water[0]).toBeNull();
    expect(water[3]).toEqual(overlayTint('waterPollution', 120));
    expect(water[7]).toEqual(overlayTint('waterPollution', 0));
  });

  it('civic tints each tile by its neighbourhood\'s value for the view; id 0 untinted', () => {
    const { ctx, values, t2n } = ctxFixture();
    for (const v of CIVIC_VIEWS) {
      expect(tints(OVERLAYS.civic.source!(v, ctx))).toEqual(
        Array.from(t2n, (id) => (id === 0 ? null : civicOverlayTint(v, values[id - 1]![v]))),
      );
    }
  });

  it('redline tints land by grade band', () => {
    const { map, ctx } = ctxFixture();
    expect(tints(OVERLAYS.redline.source!('grade', ctx))).toEqual(
      Array.from({ length: 8 }, (_, i) => (i % 4 === 3 ? null : redlineOverlayTint(map.redline[i]!))),
    );
  });

  it('coverage tints developed plots served/under-served', () => {
    const { ctx } = ctxFixture();
    const got = tints(OVERLAYS.coverage.source!('coverage', ctx));
    expect(got[0]).toEqual(coverageTint(true));
    expect(got[1]).toEqual(coverageTint(false)); // the park is a developed plot outside coverage
    expect(got[2]).toBeNull();
  });

  it('power tints consumer plots by their anchor\'s grid state; non-consumers untinted', () => {
    const { map, ctx } = ctxFixture();
    expect(tints(OVERLAYS.power.source!('power', ctx))[0]).toEqual(powerTint(false));
    const lit = { ...ctx, poweredAnchors: new Set([map.idx(0, 0)]) };
    const got = tints(OVERLAYS.power.source!('power', lit));
    expect(got[0]).toEqual(powerTint(true));
    expect(got[1]).toBeNull(); // a park draws no power
    expect(got[2]).toBeNull();
  });
});

describe('overlay registry: sim-cadence refresh', () => {
  it('eco re-pushes on the eco tick (re-deriving only biodiversity); civic re-derives on the civic tick', () => {
    expect(OVERLAYS.eco.refresh?.on).toBe('eco');
    for (const v of OVERLAYS.eco.views) expect(OVERLAYS.eco.refresh!.rederive(v)).toBe(v === 'biodiversity');
    expect(OVERLAYS.civic.refresh?.on).toBe('civic');
    for (const v of OVERLAYS.civic.views) expect(OVERLAYS.civic.refresh!.rederive(v)).toBe(true);
    for (const k of ['redline', 'police', 'coverage', 'power'] as const) expect(OVERLAYS[k].refresh).toBeUndefined();
  });
});
