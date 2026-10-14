// The building-status infoview (Maddy 2026-10-14: "we need a way to see legends. maybe an infoview for building
// statuses"): the map's badges — the blinking bolt, the heart, the raincloud, the boosted sparkle — explained in a key
// that draws the badges themselves, over a map dimmed to the buildings that wear one.
import { describe, expect, it } from 'vitest';
import {
  HOME_SUFFERING,
  HOME_THRIVING,
  STATUS_ICONS,
  STATUS_VIEWS,
  homeBadge,
  statusLegend,
  statusLegendLine,
} from '../../src/ui/statusOverlayContent';

describe('building status: the home badges', () => {
  it('flag exceptions, not every home: a heart at ≥ 9, a raincloud at ≤ −6 (sooner — suffering is actionable)', () => {
    expect([HOME_THRIVING, HOME_SUFFERING]).toEqual([9, -6]);
    expect(homeBadge(9)).toBe('thriving');
    expect(homeBadge(8)).toBeNull();
    expect(homeBadge(0)).toBeNull();
    expect(homeBadge(-5)).toBeNull();
    expect(homeBadge(-6)).toBe('suffering');
    expect(homeBadge(undefined)).toBeNull();
  });
});

describe('building status: the infoview', () => {
  it('one view, its caption', () => {
    expect(STATUS_VIEWS).toEqual(['status']);
    expect(statusLegendLine()).toBe('Building status — the badges, and what they mean');
  });

  it('the key draws each badge beside what it means, in the order a player meets them', () => {
    expect(STATUS_ICONS).toEqual(['unpowered', 'suffering', 'thriving', 'boosted']);
    const key = statusLegend();
    expect(key.title).toBe('Building status');
    expect(key.stops.map((s) => [s.icon, s.label])).toEqual([
      ['unpowered', 'no power'],
      ['suffering', 'a home suffering'],
      ['thriving', 'a home thriving'],
      ['boosted', 'boosted — inspect for why'],
    ]);
  });
});
