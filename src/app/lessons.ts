// App shell: the lessons (lessonContent.ts) — the first time a practice is granted that belongs to a mechanic, its
// lesson plays, once per player (remembered in the browser). ONE set per grant (Maddy 2026-10-14): a practice that
// opens several mechanics plays the first, and later grants carry the rest — a grant with no lesson of its own plays
// one still owed to a practice already held (derived from what's unlocked, so a reload keeps the debt). Lessons wait
// while the opening runs or another lesson is showing. DOM-free: storage, the tech state and the player arrive as deps.

import { LESSONS, lessonsFor, parseSeen, serializeSeen, type Lesson } from '../ui/lessonContent';

export interface LessonPlayer {
  frame(now: number): void;
  active(): boolean;
}

export interface LessonsDeps {
  /** The browser's memory of seen lessons (null when nothing is stored or storage is unavailable). */
  storage: { get(): string | null; set(value: string): void };
  /** The practices held now (the owed lessons are theirs). */
  unlocked(): ReadonlySet<string>;
  /** True while something else holds the screen (the opening, the tutorial). */
  busy(): boolean;
  /** Start showing a lesson; `onDone` when it ends. */
  play(lesson: Lesson, onDone: () => void): LessonPlayer;
}

export interface Lessons {
  /** A practice was granted: queue its lesson not yet seen — or, if none, one owed to a practice already held. */
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
      const own = lessonsFor(techId, pending)[0];
      const held = deps.unlocked();
      const owed = own ?? LESSONS.find((l) => !pending.has(l.id) && l.techs.some((t) => held.has(t)));
      if (owed) queue.push(owed);
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
