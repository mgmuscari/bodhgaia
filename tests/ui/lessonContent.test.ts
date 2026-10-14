import { describe, it, expect } from 'vitest';
import { LESSONS, lessonFor, lessonsFor, parseSeen, serializeSeen } from '../../src/ui/lessonContent';
import { PAIRINGS, PAIR_REACH } from '../../src/engine/pairings';
import { MAKER_SUPPLY } from '../../src/engine/fabric';
import { BANK_REACH, PANTRY_REACH } from '../../src/live/food';
import { MAKER_RADIUS_SUPPLIED } from '../../src/growth/revival';
import { DRONE_RADIUS } from '../../src/live/drones';
import { TECH_TREE } from '../../src/tech/tree';

const ids = new Set(TECH_TREE.map((n) => n.id));

describe('lessons', () => {
  it('each is triggered by real techs and says something on every screen', () => {
    expect(LESSONS.length).toBeGreaterThanOrEqual(8);
    for (const l of LESSONS) {
      expect(l.techs.length, l.id).toBeGreaterThan(0);
      for (const t of l.techs) expect(ids.has(t), `${l.id}: ${t}`).toBe(true);
      expect(l.steps.length, l.id).toBeGreaterThanOrEqual(3);
      for (const s of l.steps) expect(s.kind === 'say' || s.kind === 'ui', l.id).toBe(true);
    }
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
  });

  it('every tech teaches something', () => {
    const taught = new Set(LESSONS.flatMap((l) => l.techs));
    for (const n of TECH_TREE) expect(taught.has(n.id), n.id).toBe(true);
  });

  it('the first unseen lesson for a tech plays once — then the next one that tech belongs to, then none', () => {
    const seen = new Set<string>();
    const first = lessonFor('circles', seen)!;
    expect(first).toBeDefined();
    seen.add(first.id);
    const second = lessonFor('circles', seen);
    if (second) {
      expect(second.id).not.toBe(first.id);
      seen.add(second.id);
    }
    expect(lessonFor('circles', seen)).toBeNull();
    expect(lessonFor('no-such-tech', new Set())).toBeNull();
  });

  it('remembers what has been seen as a small string (browser storage), forgiving of junk', () => {
    expect([...parseSeen(serializeSeen(new Set(['power', 'ecology'])))]).toEqual(['power', 'ecology']);
    expect([...parseSeen(null)]).toEqual([]);
    expect([...parseSeen('{not json')]).toEqual([]);
    expect([...parseSeen('[1, "power"]')]).toEqual(['power']);
  });

  it('lessonsFor: every unseen lesson a tech belongs to, in order (a practice can open two mechanics)', () => {
    expect(lessonsFor('mutual-aid', new Set()).map((l) => l.id)).toEqual(['work', 'food', 'pairings']);
    expect(lessonsFor('mutual-aid', new Set(['work'])).map((l) => l.id)).toEqual(['food', 'pairings']);
    expect(lessonsFor('no-such-tech', new Set())).toEqual([]);
  });
});

// The interdependence mechanics (Maddy 2026-10-14: "do we have appropriate tutorial cards … at the appropriate
// unlock?") — each gets its lesson at the practice that opens it, with the sim's own numbers.
describe('lessons: the interdependence mechanics', () => {
  const lesson = (id: string) => LESSONS.find((l) => l.id === id)!;
  const text = (id: string) => lesson(id).steps.map((s) => s.text).join(' ');

  it('food, field to table: at the pantry, the food bank, the gardens and the farms', () => {
    expect(lesson('food').techs).toEqual(['shared-table', 'mutual-aid', 'community-gardens', 'urban-farms']);
    expect(text('food')).toContain(`${PANTRY_REACH} tiles`);
    expect(text('food')).toContain(`${BANK_REACH} tiles`);
    expect(text('food')).toMatch(/neighbourhood health/i);
  });

  it('makers and the works: at Maker Spaces, with the supply reach and what it does', () => {
    expect(lesson('making').techs).toEqual(['maker-spaces']);
    expect(text('making')).toContain(`${MAKER_SUPPLY} tiles`);
    expect(text('making')).toContain(`${MAKER_RADIUS_SUPPLIED} tiles`);
  });

  it('dispatch and drones: at the AI nodes and Drone Deliveries, with the drone radius', () => {
    expect(lesson('drones').techs).toEqual(['community-ai-nodes', 'drone-deliveries']);
    expect(text('drones')).toContain(`${DRONE_RADIUS} tiles`);
  });

  it('buildings that work together: at every practice that opens a paired building, pointing at the status key', () => {
    const paired = new Set(PAIRINGS.flatMap((p) => [p.a, p.b]));
    const opens = TECH_TREE.filter((n) => (n.grants.kinds ?? []).some((k) => paired.has(k))).map((n) => n.id);
    expect(opens.length).toBeGreaterThan(5);
    expect([...lesson('pairings').techs].sort()).toEqual([...opens].sort());
    expect(text('pairings')).toContain(`${PAIR_REACH} tiles`);
    expect(lesson('pairings').steps.some((s) => s.kind === 'ui' && s.target === '[data-meta-id="status"]')).toBe(true);
  });

  it('organising points the Civic overlay at neighbourhood health, the hub', () => {
    expect(text('organising')).toMatch(/neighbourhood health/i);
  });
});
