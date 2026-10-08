// The voice budget (PURE). The S-DSP had 8 voices; WebAudio can afford more but not unboundedly, so the engine
// caps the sounding voices and STEALS over budget: a releasing voice first (it is already on its way out), else
// the quietest (oldest on a tie). A newcomer never steals a voice louder than itself — it is refused instead
// (play() → null), so a burst of quiet clicks can't cut off the melody. The city comes before the music (Maddy
// 2026-10-08): a music note only ever displaces music, and an effect or the soundscape (birds, the siren, the beds)
// takes a music voice first, whatever its loudness — so the band never crowds out a bird call or a siren.

import type { Bus } from '../contract';

export const MAX_VOICES = 24;

interface Slot {
  bus: Bus;
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

  /** Admit a note of `velocity` on `bus` starting at `now`, ending at `end` (Infinity = until released). When the
   *  pool is full, music gives way: a music note may only take another music voice, and an effect or the
   *  soundscape takes a music voice first (a dropped inner note matters less than a lost siren or bird call). */
  admit(velocity: number, now: number, end: number, bus: Bus = 'sfx'): Admission | null {
    for (const [id, s] of this.slots) if (s.end <= now) this.slots.delete(id);
    let steal: number | null = null;
    if (this.slots.size >= this.cap) {
      steal = this.victim(velocity, bus);
      if (steal === null) return null;
      this.slots.delete(steal);
    }
    const id = this.nextId++;
    this.slots.set(id, { bus, velocity, start: now, end, released: false });
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

  private victim(velocity: number, bus: Bus): number | null {
    if (bus !== 'music') {
      // the city first: any music voice gives way, released first, then quietest, then oldest
      const m = this.pick((s) => s.bus === 'music');
      if (m !== null) return m;
    }
    // music only ever displaces music; otherwise the old rule — released, or no louder than the newcomer
    return this.pick((s) => (bus !== 'music' || s.bus === 'music') && (s.released || s.velocity <= velocity));
  }

  private pick(ok: (s: Slot) => boolean): number | null {
    let best: number | null = null;
    let bestSlot: Slot | null = null;
    for (const [id, s] of this.slots) {
      if (!ok(s)) continue;
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
