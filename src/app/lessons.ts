// App shell: the lessons (lessonContent.ts) — the first time a practice is granted that belongs to a mechanic, its
// lesson plays, once per player (remembered in the browser). Lessons wait while the opening runs or another lesson is
// showing, then play in turn. DOM-free: storage and the player arrive as deps.

import { lessonFor, parseSeen, serializeSeen, type Lesson } from '../ui/lessonContent';

export interface LessonPlayer {
  frame(now: number): void;
  active(): boolean;
}

export interface LessonsDeps {
  /** The browser's memory of seen lessons (null when nothing is stored or storage is unavailable). */
  storage: { get(): string | null; set(value: string): void };
  /** True while something else holds the screen (the opening, the tutorial). */
  busy(): boolean;
  /** Start showing a lesson; `onDone` when it ends. */
  play(lesson: Lesson, onDone: () => void): LessonPlayer;
}

export interface Lessons {
  /** A practice was granted: queue its lesson if it has one not yet seen. */
  offer(techId: string): void;
  frame(now: number): void;
  /** Forget what has been seen (Help → replay lessons). */
  replay(): void;
}

export function createLessons(deps: LessonsDeps): Lessons {
  let seen = parseSeen(deps.storage.get());
  const queue: Lesson[] = [];
  let current: LessonPlayer | null = null;
  const remember = (): void => deps.storage.set(serializeSeen(seen));

  return {
    offer(techId) {
      const pending = new Set([...seen, ...queue.map((l) => l.id)]);
      const lesson = lessonFor(techId, pending);
      if (lesson) queue.push(lesson);
    },
    frame(now) {
      if (current?.active()) return current.frame(now);
      current = null;
      if (queue.length === 0 || deps.busy()) return;
      const lesson = queue.shift()!;
      seen.add(lesson.id);
      remember();
      current = deps.play(lesson, () => {
        current = null;
      });
      current.frame(now);
    },
    replay() {
      seen = new Set();
      remember();
    },
  };
}
