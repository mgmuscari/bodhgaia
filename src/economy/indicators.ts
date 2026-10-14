// Indicators (docs/design/interdependence.md §8): the city in a few numbers, each with its trend — employment (jobs
// against the working residents), how well its buildings are kept, and how people get around. PURE: the host reads the
// numbers (jobs and condition from the economy's city reading, the trips from the live layer) and formats them here.

/** The share of residents who work (the rest are children, elders, carers…). */
export const WORKING_SHARE = 0.5;

export interface IndicatorReading {
  /** Jobs across the city's workplaces (economy readCity). */
  jobs: number;
  /** Housed residents. */
  residents: number;
  /** Mean building condition, 0..255. */
  condition: number;
  /** People out right now, by how they travel. */
  modes: { walk: number; bike: number; transit: number; car: number };
}

export interface IndicatorLine {
  label: string;
  value: string;
  /** '↗' / '↘' / '→' against the previous reading; '' with none. */
  trend: string;
  /** Whether the trend is the good direction (a flat or absent trend counts as good). */
  good: boolean;
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

function employment(r: IndicatorReading): number {
  const workers = r.residents * WORKING_SHARE;
  return workers > 0 ? Math.min(1, r.jobs / workers) : 0;
}
function carShare(r: IndicatorReading): number {
  const all = r.modes.walk + r.modes.bike + r.modes.transit + r.modes.car;
  return all > 0 ? r.modes.car / all : 0;
}

/** Trend glyph of `now` against `prev`, and whether it's good when higher is (`up`) or lower is. */
function trend(now: number, prev: number | null, up: boolean): { trend: string; good: boolean } {
  if (prev === null) return { trend: '', good: true };
  const d = now - prev;
  if (Math.abs(d) < 0.005) return { trend: '→', good: true };
  return { trend: d > 0 ? '↗' : '↘', good: d > 0 === up };
}

/** The indicator lines for the Budget window. */
export function indicatorLines(now: IndicatorReading, prev: IndicatorReading | null): IndicatorLine[] {
  const all = now.modes.walk + now.modes.bike + now.modes.transit + now.modes.car;
  const share = (n: number): string => pct(all > 0 ? n / all : 0);
  return [
    {
      label: 'Employment',
      value: `${pct(employment(now))} — ${fmt(now.jobs)} jobs for ${fmt(now.residents * WORKING_SHARE)} workers`,
      ...trend(employment(now), prev && employment(prev), true),
    },
    { label: 'Buildings kept', value: pct(now.condition / 255), ...trend(now.condition / 255, prev && prev.condition / 255, true) },
    {
      label: 'Getting around',
      value: all > 0 ? `walk ${share(now.modes.walk)} · bike ${share(now.modes.bike)} · transit ${share(now.modes.transit)} · car ${share(now.modes.car)}` : 'nobody out',
      ...trend(carShare(now), prev && carShare(prev), false), // fewer trips by car is good
    },
  ];
}
