// Opening-overlay copy: pure presentation that turns a BlightReport and a
// Chronicle into the strings the DOM shell will mount. No DOM, no transcendental
// Math — the architecture guard's pure-ui allowlist scans this file (see
// tests/architecture.test.ts). Keeping the voice here, not in the shell, lets it
// be unit-tested and lets the worldgen layer stay free of presentation concerns.
//
// The screen follows the tour of the city's worst places: its history, era by era, then the city now, then the
// policy that made it. Written as sentences a player reads (Maddy 2026-10-08: it was "sloppy… coordinates instead of
// 'northeast'"): places by compass, the real numbers in plain words, never the engine's units or the history log's
// shorthand. No closing imperative — the tutorial goes on after it.

import type { BlightReport } from '../worldgen/report';
import type { Chronicle, ChronicleEntry } from '../worldgen/chronicle';
import type { EcologyReport } from '../ecology/report';

/** Round a fraction in [0,1] to an integer percentage (exactly-rounded). */
function pct(fraction: number): number {
  return Math.round(fraction * 100);
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
/** "one streetcar line", "two streetcar lines", "12 streetcar lines". */
function count(n: number, noun: string): string {
  return `${n < WORDS.length ? WORDS[n] : n} ${noun}${n === 1 ? '' : 's'}`;
}

/** Where on the map (x, y) lies, by compass: the ninths of a w×h map — "the northeast", "the west", "the middle". */
export function placeName(x: number, y: number, w: number, h: number): string {
  const ns = y * 3 < h ? 'north' : y * 3 >= 2 * h ? 'south' : '';
  const ew = x * 3 < w ? 'west' : x * 3 >= 2 * w ? 'east' : '';
  return ns || ew ? `the ${ns}${ew}` : 'the middle';
}

/** The first event matching `re`, its captures as numbers (or null). */
function find(events: readonly string[], re: RegExp): number[] | null {
  for (const e of events) {
    const m = re.exec(e);
    if (m) return m.slice(1).map(Number);
  }
  return null;
}

/** The expressways from the history log ("highway col 99 from 0 to 58"), by the part of town each splits — a
 *  north–south one by where it runs across, an east–west one by where it runs down. */
function expressways(events: readonly string[], size: { w: number; h: number }): string | null {
  const places: string[] = [];
  for (const e of events) {
    const m = /^highway (col|row) (\d+)/.exec(e);
    if (!m) continue;
    const at = Number(m[2]);
    const span = m[1] === 'col' ? size.w : size.h;
    const third = at * 3 < span ? 0 : at * 3 >= 2 * span ? 2 : 1;
    const place = third === 1 ? 'the middle' : m[1] === 'col' ? (third === 0 ? 'the west' : 'the east') : third === 0 ? 'the north' : 'the south';
    if (!places.includes(place)) places.push(place);
  }
  if (places.length === 0) return null;
  if (places.length === 1) return `An expressway splits ${places[0]}`;
  return `Expressways split ${places.slice(0, -1).join(', ')} and ${places[places.length - 1]}`;
}

/** One era of the city's history as a sentence, opening on its years: "1945–1965 · Expressways split…". */
export function eraLine(entry: ChronicleEntry, size: { w: number; h: number }): string {
  const ev = entry.events;
  let text: string;
  switch (entry.era) {
    case 1: {
      if (ev.includes('no viable site')) {
        text = 'Nobody found ground here to build a town on.';
        break;
      }
      const at = find(ev, /^founded at \((\d+), (\d+)\)/);
      const lines = find(ev, /^streetcar — (\d+) lines?/);
      text = `A town is founded${at ? ` in ${placeName(at[0]!, at[1]!, size.w, size.h)}` : ''}${
        lines && lines[0]! > 0 ? `, a walking town on ${count(lines[0]!, 'streetcar line')}` : ''
      }.`;
      break;
    }
    case 2:
      text = 'The motor age: streets are widened into avenues for the car, and factories and parking lots go up.';
      break;
    case 3: {
      const roads = expressways(ev, size);
      const rails = find(ev, /^rails removed (\d+)/);
      const cleared = find(ev, /^urban renewal — (\d+) parcels demolished/);
      const torn = rails !== null && rails[0]! > 0;
      const n = cleared && cleared[0]! > 0 ? cleared[0]! : 0;
      const renewal = n === 0 ? null : `${n === 1 ? 'one building' : `${n} buildings`}${torn ? '' : n === 1 ? ' is' : ' are'} cleared for “urban renewal”`;
      const after = torn ? `the streetcar is torn up${renewal ? ` and ${renewal}` : ''}` : renewal;
      const parts = [roads, after].filter((p): p is string => p !== null);
      text = parts.length === 0 ? 'The expressway years.' : `${parts.join('; ')}.`;
      text = text[0]!.toUpperCase() + text.slice(1);
      break;
    }
    case 4: {
      const flight = find(ev, /(\d+) core parcels declined/);
      text = flight
        ? `Suburban flight: new houses go up on the roads out of town, and ${
            flight[0] === 1 ? 'one building' : `${flight[0]} buildings`
          } in the old core fall into decline.`
        : 'Suburban flight: new houses go up on the roads out of town, and the old core falls into decline.';
      break;
    }
    case 5: {
      const d = find(ev, /^disinvestment — \d+ decayed, (\d+) abandoned, (\d+) craters/);
      text = d
        ? `Disinvestment: ${d[0] === 1 ? 'one building is' : `${d[0]} buildings are`} abandoned, and ${
            d[1] === 1 ? 'one is torn down to an empty lot' : `${d[1]} torn down to empty lots`
          }.`
        : 'Disinvestment: the banks and the city stop putting money into the town.';
      break;
    }
    default:
      text = 'The years go by.';
  }
  return `${entry.years.replace('-', '–')} · ${text}`;
}

/** The city now: how much of what was built still stands, and in what repair; the towers urban renewal left. */
export function statLines(report: BlightReport): string[] {
  if (report.parcelsTotal === 0) return ['Nothing was ever built here — only open water.'];
  if (report.parcelsAlive === 0) return [`None of the ${report.parcelsTotal} buildings ever raised still stands.`];
  const lines = [
    `${report.parcelsAlive} of the ${report.parcelsTotal} buildings ever raised still stand.`,
    `${pct(report.shareStruggling)}% of them are in poor repair, including ${pct(report.shareDerelict)}% that stand derelict.`,
  ];
  const towers = report.projectsStanding;
  if (towers === 1) lines.push('One tower block from urban renewal still stands over the core.');
  else if (towers > 1) lines.push(`${towers} tower blocks from urban renewal still stand over the core.`);
  return lines;
}

/** The land's wound, in words (the eco-seed stage's corridor soil and edge fauna); null when there is no reading
 *  (no expressway, all water), so the line is left out. */
export function ecologyStatLine(report: EcologyReport): string | null {
  if (report.corridorSoilDeficit === null || report.peripheryFaunaMean === null) return null;
  return 'Along the expressways the soil is broken, and the wild holds on only at the edges of town.';
}

/** The policy that made it, named precisely — housing denied first, then the dumping ground — and the room the
 *  empty lots leave. Nothing on open water. */
export function challengeText(_name: string, report: BlightReport, _chronicle: Chronicle): string[] {
  if (report.parcelsTotal === 0) return [];
  const paras: string[] = [];
  // Redlining was, first, the DENIAL OF HOUSING: HOLC/FHA refused Black families mortgages and barred them from the
  // "good" neighbourhoods, penning them in the red zones — which were THEN made dumping grounds for the highways, the
  // industry, the pollution. Cause, then consequence; named critically.
  if (report.redlinedShare > 0) {
    paras.push('Redlining kept Black families out of the “good” neighbourhoods and penned them into the red ones.');
    paras.push(`Then those blocks — ${pct(report.redlinedShare)}% of the land — were made the city’s dumping ground: the expressways, the smoke, the decay.`);
  }
  const lots = report.craters;
  if (lots !== null && lots > 0) {
    paras.push(lots === 1 ? 'One empty lot is waiting for something kinder.' : `${lots} empty lots are waiting for something kinder.`);
  }
  return paras;
}
