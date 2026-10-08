// Lessons (Maddy 2026-10-07): the first time a practice is granted that belongs to a mechanic, that mechanic's lesson
// plays — a few screens in the tutorial's dialogue box, pointing at the overlay that shows it. Each lesson plays once
// per player (remembered in the browser). Pure — no DOM, no transcendental Math (pure-ui allowlist): the lessons,
// which tech triggers which, and the seen-set's storage format. Numbers come from the sim's own constants.

import type { TutorialStep } from './tutorialContent';
import { BATTERY_CAPACITY, LOCAL_GRID_RADIUS, SMART_GRID_CUT } from '../growth/power';
import { COVERAGE_RADIUS, SAFE_RADIUS, SHELTER_RADIUS, WALK_RANGE, BIKE_RANGE, EVAPORATION, OCC_FLOOR } from '../live/tuning';
import { ECON } from '../economy/model';

export type LessonStep = Extract<TutorialStep, { kind: 'say' } | { kind: 'ui' }>;

export interface Lesson {
  id: string;
  title: string;
  /** The practices whose first grant plays this lesson. */
  techs: readonly string[];
  steps: readonly LessonStep[];
}

const say = (text: string): LessonStep => ({ kind: 'say', text });
const point = (target: string, text: string): LessonStep => ({ kind: 'ui', target, text });
const pct = (v: number): string => `${Math.round(v * 100)}%`;

export const LESSONS: readonly Lesson[] = [
  {
    id: 'organising',
    title: 'Organising, and coming home',
    techs: ['circles', 'participatory-budgeting', 'gift-circles', 'coop-housing', 'communes', 'tiny-home-villages'],
    steps: [
      say('A neighbourhood is a district between the big roads. Each has belonging, trust — and voice: how organised its people are.'),
      point('[data-meta-id="civic"]', 'The Civic overlay shows them. Circles, Budgeting and Gift Circles raise voice; police on redlined streets silence it.'),
      say('An organised neighbourhood protects its homes: rent can’t push its people out. And it welcomes the unhoused back into its empty rooms.'),
      point('.pulse-dock', 'Watch the Unhoused count. Co-ops and communes make room for people whatever the neighbourhood; a tiny-home village shelters only those who have nowhere else.'),
    ],
  },
  {
    id: 'rent',
    title: 'Rent and displacement',
    techs: ['community-land-trust', 'coop-housing', 'adus'],
    steps: [
      say('Rent follows land value. When a place gets better, rent rises — and the people who made it better can be priced out.'),
      say('Each hour, homes whose rent outruns what their people can bear lose residents to the street — the unprotected homes on the dearest land first.'),
      say('Homes held in common — co-ops, communes, a Land Trust’s ground — and homes in organised neighbourhoods are protected. Heal a place without emptying it.'),
      say('More room helps too: a cottage in a back yard lets a house hold more people without tearing anything down.'),
    ],
  },
  {
    id: 'power',
    title: 'Power and blackouts',
    techs: ['sun-and-wire', 'renewable-energy', 'local-grids', 'community-energy-nodes', 'wind-power', 'solar-arrays', 'fusion-power', 'community-ai-nodes'],
    steps: [
      point('[data-meta-id="power"]', 'The Power overlay. Demand rises and falls through the day — homes peak in the evening. When there isn’t enough, whole blocks go dark in turn.'),
      say('Solar makes power at noon and nothing at night; wind blows hardest after dark. A clean grid needs both — and somewhere to keep the noon.'),
      say(`Energy nodes carry batteries: each banks up to ${BATTERY_CAPACITY} of the surplus and gives it back when power runs short. With Local Grids, homes within ${LOCAL_GRID_RADIUS} tiles of a node stay lit first.`),
      say(`A Community AI Node shifts flexible load off the evening peak: homes near it draw ${pct(SMART_GRID_CUT)} less from 17:00 to 21:00.`),
    ],
  },
  {
    id: 'moving',
    title: 'Getting around',
    techs: ['walkable-streets', 'road-diets', 'bike-paths', 'bike-shares', 'streetcar-revival', 'elevated-rail', 'quiet-streets', 'urban-promenades', 'parklets', 'drone-deliveries'],
    steps: [
      say(`People walk anything within ${WALK_RANGE} tiles and cycle up to ${BIKE_RANGE}; farther, they ride a line that reaches both ends — or drive.`),
      say(`A jammed road makes a longer walk or ride worth it, and up to ${pct(EVAPORATION)} of the drives into a full jam simply don’t happen. Fewer lanes can mean less traffic.`),
      say('Quiet streets and promenades carry no cars and walkers prefer them. Each car you take off the road is one less in someone’s way.'),
    ],
  },
  {
    id: 'ecology',
    title: 'Soil, plants and animals',
    techs: ['soil-and-soul', 'urban-composting', 'community-gardens', 'rewilding', 'pocket-parks', 'wastewater-recycling', 'vertical-farming'],
    steps: [
      point('[data-meta-id="eco"]', 'The Eco overlay: soil, plants and animals. Pavement seals the soil; busy roads cut animals off from each other.'),
      say('Greens heal the ground around them, and quiet streets and bike paths let wildlife cross. Rewilded land tends itself.'),
      say('A wastewater works is the only thing that cleans a poisoned creek.'),
    ],
  },
  {
    id: 'effort',
    title: 'Effort, tending and burnout',
    techs: ['shared-table', 'craft-fairs', 'maker-spaces', 'urban-bazaars'],
    steps: [
      point('.pulse-dock', 'Effort is your neighbours’ time and energy. It comes back each hour — more when people are well and trust you.'),
      say('Every commons — a garden, a parklet, a healing commons — needs tending, paid in effort before any project.'),
      say(`Ask for more than comes back while the reserve is nearly gone, and people burn out: effort returns slower until they recover (${ECON.burnoutHeal * 1000}‰ an hour). Leave a buffer.`),
    ],
  },
  {
    id: 'policing',
    title: 'Policing and refuge',
    techs: ['healing-commons', 'circles'],
    steps: [
      point('[data-meta-id="police"]', 'The Police overlay shows where arrests fall. Patrols concentrate on redlined streets; each arrest takes a person from their home and leaves a mark.'),
      say(`Police won’t patrol or arrest within ${SAFE_RADIUS} tiles of a healing commons, garden, bazaar, maker space, civic hall or park — refuges you build.`),
      point('[data-meta-id="coverage"]', `A healing commons also covers fire and health within ${COVERAGE_RADIUS} tiles, and no one dies of exposure within ${SHELTER_RADIUS} of it.`),
    ],
  },
  {
    id: 'work',
    title: 'Work and home',
    techs: ['collective-ownership', 'mutual-aid', 'communes'],
    steps: [
      say('People bring home what their day gives them: a grim day at the works drags a household down; a good place lifts it.'),
      say('Worker-owned industry costs its people far less.'),
      say(`Mutual Aid means no home thins below half its people (it was ${pct(OCC_FLOOR)}) — neighbours take each other in.`),
    ],
  },
];

/** The first lesson `techId` belongs to that hasn't been seen, or null. */
export function lessonFor(techId: string, seen: ReadonlySet<string>): Lesson | null {
  return LESSONS.find((l) => l.techs.includes(techId) && !seen.has(l.id)) ?? null;
}

/** The seen-set as stored in the browser. */
export function serializeSeen(seen: ReadonlySet<string>): string {
  return JSON.stringify([...seen]);
}

/** Read a stored seen-set; anything unreadable is an empty set. */
export function parseSeen(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const v: unknown = JSON.parse(raw);
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
