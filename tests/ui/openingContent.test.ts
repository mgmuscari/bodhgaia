import { describe, it, expect } from 'vitest';
import type { BlightReport } from '../../src/worldgen/report';
import type { Chronicle } from '../../src/worldgen/chronicle';
import type { EcologyReport } from '../../src/ecology/report';
import { statLines, eraLine, challengeText, ecologyStatLine, placeName } from '../../src/ui/openingContent';

// openingContent is pure presentation: data in, strings out — the city's history and state as the player reads them
// after the tour of its worst places. Maddy 2026-10-08: "the post tutorial summary is kind of sloppy… it also includes
// things like coordinates instead of 'northeast'". So: written sentences, places by compass, the real numbers in plain
// words, no engine units or debug log, and no closing imperative (the tutorial goes on after it).

const FOUNDED_REPORT: BlightReport = {
  parcelsTotal: 588,
  parcelsAlive: 412,
  preEra5Standing: 469,
  abandoned: 57,
  craters: 9,
  organicAdded: 24,
  yardsAdded: 300,
  ruinsAdded: 40,
  conditionMean: 137.4,
  conditionMedian: 150,
  shareDerelict: 0.2,
  shareStruggling: 0.45,
  projectsStanding: 16,
  railLost: { removed: 143, peak: 269 },
  coreMean: 90,
  peripheryMean: 180,
  coreAbandonedShare: 0.3,
  peripheryAbandonedShare: 0.05,
  byKind: {},
  redlinedShare: 0.35,
};

const SPARSE_REPORT: BlightReport = {
  ...FOUNDED_REPORT,
  preEra5Standing: null,
  abandoned: null,
  craters: null,
  organicAdded: null,
  yardsAdded: null,
  ruinsAdded: null,
  railLost: null,
};

const CHRONICLE: Chronicle = {
  entries: [
    { era: 1, years: '1900-1920', events: ['founded at (6, 6)', 'streetcar — 2 lines, 30 rail tiles'] },
    { era: 3, years: '1945-1965', events: ['rails removed 143 (peak 269)'] },
  ],
  unparsed: [],
};

// The REALISTIC all-water shape the pipeline actually produces (cf. the Task-2
// all-water chronicle test and the Task-3 all-water report): zero parcels and a
// single era-1 "no viable site" entry. firstEvent() returns 'no viable site', so
// the challenge takes the verbatim-fact branch (not the no-events fallback).
const ALL_WATER_REPORT: BlightReport = {
  parcelsTotal: 0,
  parcelsAlive: 0,
  preEra5Standing: null,
  abandoned: null,
  craters: null,
  organicAdded: null,
  yardsAdded: null,
  ruinsAdded: null,
  conditionMean: 0,
  conditionMedian: 0,
  shareDerelict: 0,
  shareStruggling: 0,
  projectsStanding: 0,
  railLost: null,
  coreMean: null,
  peripheryMean: null,
  coreAbandonedShare: null,
  peripheryAbandonedShare: null,
  byKind: {},
  redlinedShare: 0,
};
const ALL_WATER_CHRONICLE: Chronicle = {
  entries: [{ era: 1, years: '1900-1920', events: ['no viable site'] }],
  unparsed: [],
};


const SIZE = { w: 128, h: 128 };
/** Real history logs (moses.ts) for two seeds, era-grouped as parseChronicle does. */
const REAL: Chronicle[] = [
  {
    entries: [
      { era: 1, years: '1900-1920', events: ['founded at (100, 36)', 'streetcar — 2 lines, 20 rail tiles', 'fabric — 80 parcels (6 commercial)'] },
      { era: 2, years: '1920-1945', events: ['motor age — 100 avenue tiles, 8 industry, 3 parking, 3 fields (12 lots), 311 infill'] },
      { era: 3, years: '1945-1965', events: ['highway col 99 from 0 to 58', 'highway row 18 from 90 to 127', 'rails removed 20 (peak 20)', 'urban renewal — 87 parcels demolished, 5 projects, 1 civic, 4 power, 4 precincts, 4 services, 9 civic services'] },
      { era: 4, years: '1965-1985', events: ['suburban flight — 24 spurs, 59 suburban parcels, 5 offices, 125 core parcels declined'] },
      { era: 5, years: '1985-2000', events: ['disinvestment — 923 decayed, 235 abandoned, 134 craters (of 923 standing)', 'the land kept the bill — soil broken along the corridors, the wild pushed to the edges'] },
    ],
    unparsed: [],
  },
  {
    entries: [
      { era: 1, years: '1900-1920', events: ['founded at (20, 100)', 'streetcar — 1 lines, 12 rail tiles'] },
      { era: 3, years: '1945-1965', events: ['highway col 64 from 0 to 127', 'rails removed 12 (peak 12)'] },
      { era: 5, years: '1985-2000', events: ['disinvestment — 10 decayed, 1 abandoned, 1 craters (of 10 standing)'] },
    ],
    unparsed: [],
  },
];
const JARGON = /\(\d+, ?\d+\)|\btiles?\b|\bcol\b|\brow\b|\bparcels?\b|of 255|infill|spurs|craters|undefined|NaN/i;
const everything = (c: Chronicle, r: BlightReport): string[] => [
  ...c.entries.map((e) => eraLine(e, SIZE)),
  ...statLines(r),
  ...challengeText('Flet', r, c),
];

describe('placeName — compass, not coordinates', () => {
  it('names the ninths of the map', () => {
    expect(placeName(100, 36, 128, 128)).toBe('the northeast');
    expect(placeName(20, 100, 128, 128)).toBe('the southwest');
    expect(placeName(64, 64, 128, 128)).toBe('the middle');
    expect(placeName(64, 10, 128, 128)).toBe('the north');
    expect(placeName(120, 64, 128, 128)).toBe('the east');
  });
});

describe('the history, era by era, in sentences', () => {
  const [a, b] = REAL;
  const lines = a!.entries.map((e) => eraLine(e, SIZE));

  it('one line per era, opening on its years', () => {
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(/^1900–1920 · /);
    expect(lines[4]).toMatch(/^1985–2000 · /);
  });

  it('the founding and the expressways by compass, never by grid coordinate', () => {
    expect(lines[0]).toContain('the northeast');
    expect(lines[2]).toMatch(/Expressways split the east and the north/); // a north–south one in the east, an east–west one in the north
  });

  it('keeps the real numbers, in plain words', () => {
    expect(lines[2]).toContain('87'); // buildings cleared
    expect(lines[3]).toContain('125'); // the core's decline
    expect(lines[4]).toContain('235'); // abandoned
    expect(lines[4]).toContain('134'); // torn down to empty lots
  });

  it('counts agree with their nouns', () => {
    const small = b!.entries.map((e) => eraLine(e, SIZE));
    expect(small[0]).toMatch(/one streetcar line\b/);
    expect(small[1]).toMatch(/An expressway splits the middle/);
    expect(small.join(' ')).not.toMatch(/\b1 (buildings|lots|lines)\b/);
  });

  it('an era with nothing parseable still reads as a sentence', () => {
    expect(eraLine({ era: 2, years: '1920-1945', events: [] }, SIZE)).toMatch(/^1920–1945 · [A-Z].+\.$/);
  });
});

describe('the whole screen', () => {
  it('no coordinates, engine units or debug log anywhere — real logs, fixtures, all-water', () => {
    for (const c of REAL) for (const line of everything(c, FOUNDED_REPORT)) expect(line, line).not.toMatch(JARGON);
    for (const line of everything(CHRONICLE, SPARSE_REPORT)) expect(line, line).not.toMatch(JARGON);
    for (const line of everything(ALL_WATER_CHRONICLE, ALL_WATER_REPORT)) expect(line, line).not.toMatch(JARGON);
  });

  it('every line is a sentence: a capital (or the years) to start, a full stop to end, and not too long to read', () => {
    for (const c of REAL)
      for (const line of everything(c, FOUNDED_REPORT)) {
        expect(line, line).toMatch(/^([A-Z0-9]|“)/);
        expect(line, line).toMatch(/[.!]$/);
        expect(line.length, line).toBeLessThanOrEqual(150);
      }
  });

  it('is deterministic', () => {
    expect(everything(REAL[0]!, FOUNDED_REPORT)).toEqual(everything(REAL[0]!, FOUNDED_REPORT));
  });
});

describe('statLines — the city now', () => {
  it('buildings standing of those ever built, the share in poor repair and the share derelict (of all, not stacked)', () => {
    const lines = statLines(FOUNDED_REPORT);
    expect(lines[0]).toBe('412 of the 588 buildings ever raised still stand.');
    expect(lines[1]).toContain('45%');
    expect(lines[1]).toContain('20%');
  });

  it('the towers by count, singular and plural; none — no line', () => {
    expect(statLines({ ...FOUNDED_REPORT, projectsStanding: 1 }).join(' ')).toMatch(/One tower block .* stands/);
    expect(statLines({ ...FOUNDED_REPORT, projectsStanding: 16 }).join(' ')).toMatch(/16 tower blocks .* stand/);
    expect(statLines({ ...FOUNDED_REPORT, projectsStanding: 0 }).join(' ')).not.toMatch(/tower/);
  });

  it('nothing built: says so plainly', () => {
    expect(statLines(ALL_WATER_REPORT)).toEqual(['Nothing was ever built here — only open water.']);
  });
});

describe('ecologyStatLine', () => {
  const eco = { corridorSoilDeficit: 42, peripheryFaunaMean: 101 } as unknown as EcologyReport;
  it('the wound in words: the soil along the expressways, the wild at the edges', () => {
    const line = ecologyStatLine(eco)!;
    expect(line).toMatch(/soil/);
    expect(line).toMatch(/edges/);
    expect(line).not.toMatch(/\d/);
  });
  it('returns null (line omitted) when a ring scalar is null', () => {
    expect(ecologyStatLine({ corridorSoilDeficit: null, peripheryFaunaMean: 3 } as unknown as EcologyReport)).toBeNull();
  });
});

describe('challengeText', () => {
  it('names redlining precisely — housing denied first, then the dumping ground — with the real share', () => {
    const t = challengeText('Flet', FOUNDED_REPORT, CHRONICLE).join(' ');
    expect(t).toMatch(/Redlining/);
    expect(t).toMatch(/Black families/);
    expect(t).toContain('35%');
    expect(t.indexOf('Black families')).toBeLessThan(t.indexOf('35%'));
  });

  it('the empty lots, as room for something kinder', () => {
    expect(challengeText('Flet', FOUNDED_REPORT, CHRONICLE).join(' ')).toMatch(/\b9 empty lots\b/);
  });

  it('no closing imperative: the tutorial goes on after this screen', () => {
    const t = challengeText('Flet', FOUNDED_REPORT, CHRONICLE).join(' ');
    expect(t).not.toMatch(/\bBegin\b|planner/i);
  });

  it('no redlining on a city that had none; nothing at all on open water', () => {
    expect(challengeText('Flet', { ...FOUNDED_REPORT, redlinedShare: 0 }, CHRONICLE).join(' ')).not.toMatch(/Redlining/);
    expect(challengeText('Flet', ALL_WATER_REPORT, ALL_WATER_CHRONICLE)).toEqual([]);
  });
});
