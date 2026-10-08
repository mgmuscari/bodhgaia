import { describe, it, expect } from 'vitest';
import { createLessons } from '../../src/app/lessons';
import { LESSONS, serializeSeen } from '../../src/ui/lessonContent';

function harness(stored: string | null = null) {
  let saved = stored;
  let busy = false;
  const started: string[] = [];
  let finishCurrent: (() => void) | null = null;
  let active = false;
  const lessons = createLessons({
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
});
