import { describe, it, expect } from 'vitest';
import { LESSONS, lessonFor, parseSeen, serializeSeen } from '../../src/ui/lessonContent';
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
});
