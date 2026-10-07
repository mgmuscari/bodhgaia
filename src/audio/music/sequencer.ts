// The sequencer's pure timing and gentleness rules (no clock, no engine): which notes fall due before a horizon,
// how loud background music may be, and how many notes may sound at once.
import type { MidiNote } from './midi';

/** The notes from `cursor` whose onset (piece seconds) is before `horizon`; and the advanced cursor. `notes` must be
 *  time-sorted (parseMidi guarantees it). Each note is returned exactly once across successive calls. */
export function dueNotes(
  notes: readonly MidiNote[],
  cursor: number,
  horizon: number,
): { due: MidiNote[]; cursor: number } {
  const due: MidiNote[] = [];
  let i = cursor;
  while (i < notes.length && notes[i]!.time < horizon) due.push(notes[i++]!);
  return { due, cursor: i };
}

/** MIDI velocity (0..1) → engine velocity: compressed into a quiet band (0.12..0.57) that keeps the dynamics'
 *  order — a contemplative city game, not a concert hall. */
export function soften(velocity: number): number {
  const v = Math.min(1, Math.max(0, velocity));
  return 0.12 + 0.45 * v;
}

/** A voice budget: admit a note only while fewer than `max` admitted notes still sound at its onset. */
export class Polyphony {
  private ends: number[] = [];
  readonly max: number;
  constructor(max: number) {
    this.max = max;
  }
  admit(at: number, end: number): boolean {
    this.ends = this.ends.filter((e) => e > at);
    if (this.ends.length >= this.max) return false;
    this.ends.push(end);
    return true;
  }
  clear(): void {
    this.ends = [];
  }
}
