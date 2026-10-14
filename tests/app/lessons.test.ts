import { describe, it, expect } from 'vitest';
import { createLessons } from '../../src/app/lessons';
import { LESSONS, serializeSeen } from '../../src/ui/lessonContent';

function harness(stored: string | null = null) {
  let saved = stored;
  let busy = false;
  const started: string[] = [];
  let finishCurrent: (() => void) | null = null;
  let active = false;
  const unlocked = new Set<string>();
  const lessons = createLessons({
    unlocked: () => unlocked,
    storage: { get: () => saved, set: (v) => (saved = v) },
    busy: () => busy,
    play: (lesson, onDone) => {
      started.push(lesson.id);
      active = true;
      finishCurrent = () => {
        active = false;
        onDone();
      };
      return { frame: () => {}, active: () => active };
    },
  });
  return {
    lessons,
    started,
    finish: () => finishCurrent?.(),
    setBusy: (b: boolean) => (busy = b),
    unlocked,
    saved: () => saved,
  };
}

describe('lessons', () => {
  it('a granted practice plays its lesson once — remembered in the browser', () => {
    const h = harness();
    h.lessons.offer('solar-arrays');
    h.lessons.frame(0);
    expect(h.started).toEqual(['power']);
    expect(JSON.parse(h.saved()!)).toEqual(['power']);
    h.finish();
    h.lessons.offer('wind-power'); // the same lesson: already seen
    h.lessons.frame(1);
    expect(h.started).toEqual(['power']);
  });

  it('waits while the opening or another lesson is showing, then plays them in turn', () => {
    const h = harness();
    h.setBusy(true);
    h.lessons.offer('solar-arrays');
    h.lessons.offer('soil-and-soul');
    h.lessons.frame(0);
    expect(h.started).toEqual([]);
    h.setBusy(false);
    h.lessons.frame(1);
    expect(h.started).toEqual(['power']);
    h.lessons.frame(2);
    expect(h.started).toEqual(['power']); // one at a time
    h.finish();
    h.lessons.frame(3);
    expect(h.started).toEqual(['power', 'ecology']);
  });

  it('a lesson already seen in an earlier city does not play; replay clears the memory', () => {
    const h = harness(serializeSeen(new Set(['power'])));
    h.lessons.offer('solar-arrays');
    h.lessons.frame(0);
    expect(h.started).toEqual([]);
    h.lessons.replay();
    h.lessons.offer('solar-arrays');
    h.lessons.frame(1);
    expect(h.started).toEqual(['power']);
  });

  it('two practices of the same lesson granted together queue it once', () => {
    const h = harness();
    h.setBusy(true);
    h.lessons.offer('solar-arrays');
    h.lessons.offer('wind-power');
    h.setBusy(false);
    h.lessons.frame(0);
    h.finish();
    h.lessons.frame(1);
    expect(h.started).toEqual(['power']);
    expect(LESSONS.find((l) => l.id === 'power')).toBeDefined();
  });

  it('one set per grant (Maddy 2026-10-14): a practice plays its own lesson; one with none carries a lesson an earlier grant left owed', () => {
    const h = harness();
    const grant = (id: string, n: number) => {
      h.unlocked.add(id);
      h.lessons.offer(id);
      h.lessons.frame(n);
    };
    grant('mutual-aid', 0); // opens work, food and pairings — plays only the first
    expect(h.started).toEqual(['work']);
    h.finish();
    h.lessons.frame(1);
    expect(h.started).toEqual(['work']); // no pile-up
    grant('wind-power', 2); // its own lesson first
    h.finish();
    expect(h.started).toEqual(['work', 'power']);
    grant('solar-arrays', 3); // power seen: carries what Mutual Aid left owed
    h.finish();
    grant('fusion-power', 4);
    h.finish();
    expect(h.started).toEqual(['work', 'power', 'food', 'pairings']);
    grant('renewable-energy', 5); // nothing owed: nothing plays
    expect(h.started).toEqual(['work', 'power', 'food', 'pairings']);
  });
});
