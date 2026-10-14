// Indicators (docs/design/interdependence.md §8, step 1): the city's state in a few numbers with a trend — employment
// (jobs against working residents), how well its buildings are kept, and how people get around.
import { describe, expect, it } from 'vitest';
import { indicatorLines, WORKING_SHARE, type IndicatorReading } from '../../src/economy/indicators';

const r = (o: Partial<IndicatorReading> = {}): IndicatorReading => ({
  jobs: 800,
  residents: 2000,
  condition: 160,
  modes: { walk: 40, bike: 10, transit: 5, car: 45 },
  ...o,
});

describe('indicatorLines', () => {
  it('employment: jobs for the working residents, as a share (capped at all of them)', () => {
    const [emp] = indicatorLines(r(), null);
    expect(emp!.label).toBe('Employment');
    expect(WORKING_SHARE).toBe(0.5);
    expect(emp!.value).toBe("80% — 800 jobs for 1,000 workers");
    expect(indicatorLines(r({ jobs: 5000 }), null)[0]!.value.startsWith('100%')).toBe(true);
  });
  it('buildings kept: mean condition as a share', () => {
    expect(indicatorLines(r(), null)[1]!.value).toBe('63%');
  });
  it('getting around: the share of trips by each way', () => {
    expect(indicatorLines(r(), null)[2]!.value).toBe('walk 40% · bike 10% · transit 5% · car 45%');
    expect(indicatorLines(r({ modes: { walk: 0, bike: 0, transit: 0, car: 0 } }), null)[2]!.value).toBe('nobody out');
  });
  it('trends: none before a previous reading; up/down by what is good — fewer car trips is good', () => {
    expect(indicatorLines(r(), null).map((l) => l.trend)).toEqual(['', '', '']);
    const later = indicatorLines(r({ jobs: 900, condition: 150, modes: { walk: 50, bike: 10, transit: 5, car: 35 } }), r());
    expect(later[0]!.trend).toBe('↗');
    expect(later[0]!.good).toBe(true);
    expect(later[1]!.trend).toBe('↘');
    expect(later[1]!.good).toBe(false);
    expect(later[2]!.trend).toBe('↘'); // car share fell…
    expect(later[2]!.good).toBe(true); // …which is good
  });
});
