// The voice budget (PURE). The S-DSP had 8 voices; WebAudio can afford more but not unboundedly, so the engine
// caps the sounding voices and STEALS over budget: a releasing voice first (it is already on its way out), else
// the quietest (oldest on a tie). A newcomer never steals a voice louder than itself — it is refused instead
// (play() → null), so a burst of quiet clicks can't cut off the melody.

export const MAX_VOICES = 24;

interface Slot {
  velocity: number;
  start: number;
  /** Engine time the voice falls silent (Infinity while held). */
  end: number;
  released: boolean;
}

export interface Admission {
  id: number;
  /** A voice to silence now to make room, or null. */
  steal: number | null;
}

export class VoicePool {
  private readonly slots = new Map<number, Slot>();
  private nextId = 1;

  constructor(private readonly cap = MAX_VOICES) {}

  get size(): number {
    return this.slots.size;
  }

  has(id: number): boolean {
    return this.slots.has(id);
  }

  /** Admit a note of `velocity` starting at `now`, ending at `end` (Infinity = until released). */
  admit(velocity: number, now: number, end: number): Admission | null {
    for (const [id, s] of this.slots) if (s.end <= now) this.slots.delete(id);
    let steal: number | null = null;
    if (this.slots.size >= this.cap) {
      steal = this.victim(velocity);
      if (steal === null) return null;
      this.slots.delete(steal);
    }
    const id = this.nextId++;
    this.slots.set(id, { velocity, start: now, end, released: false });
    return { id, steal };
  }

  /** The voice gated off; it falls silent at `end`. */
  release(id: number, end: number): void {
    const s = this.slots.get(id);
    if (s) {
      s.released = true;
      s.end = end;
    }
  }

  remove(id: number): void {
    this.slots.delete(id);
  }

  private victim(velocity: number): number | null {
    let best: number | null = null;
    let bestSlot: Slot | null = null;
    for (const [id, s] of this.slots) {
      if (!s.released && s.velocity > velocity) continue;
      if (!bestSlot || better(s, bestSlot)) {
        best = id;
        bestSlot = s;
      }
    }
    return best;
  }
}

/** Is `a` a better steal than `b`? Releasing first, then quietest, then oldest. */
function better(a: Slot, b: Slot): boolean {
  if (a.released !== b.released) return a.released;
  if (a.velocity !== b.velocity) return a.velocity < b.velocity;
  return a.start < b.start;
}
