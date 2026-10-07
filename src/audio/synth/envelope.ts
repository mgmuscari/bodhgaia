// The S-DSP ADSR (PURE). The hardware envelope rises LINEARLY in attack, falls EXPONENTIALLY in decay toward the
// sustain level, and releases LINEARLY to silence. `envelopeAt` is the curve itself; `envelopeSchedule` is the
// same curve as WebAudio AudioParam automation (set / linearRamp / setTarget), so the engine shell only replays
// events and can compute the exact level at any moment (to release from it, or to steal a voice cleanly).

export interface Envelope {
  /** Seconds, linear 0 → peak. */
  attack: number;
  /** Time constant (s) of the exponential fall from peak toward sustain. */
  decay: number;
  /** Sustain level as a fraction of the peak (0 = a struck/plucked sound that dies away). */
  sustain: number;
  /** Seconds, linear from the gate-off level to 0. */
  release: number;
}

export type EnvEvent =
  | { kind: 'set'; t: number; v: number }
  | { kind: 'linear'; t: number; v: number }
  | { kind: 'target'; t: number; v: number; tau: number };

/** Shortest attack/release — a hard edge on a looped sample clicks. */
const MIN_EDGE = 0.003;
const edge = (s: number): number => Math.max(MIN_EDGE, s);

/** The level `t` seconds after note-on, for a note of `peak` gain, gated off at `off` (seconds after note-on). */
export function envelopeAt(env: Envelope, t: number, peak: number, off?: number): number {
  if (off !== undefined && t >= off) {
    const lvl = held(env, off, peak);
    const r = edge(env.release);
    return t - off >= r - 1e-9 ? 0 : lvl * (1 - (t - off) / r); // (ε: float time arithmetic)
  }
  return held(env, t, peak);
}

/** The level while the gate is held. */
function held(env: Envelope, t: number, peak: number): number {
  if (t <= 0) return 0;
  const a = edge(env.attack);
  if (t < a) return (peak * t) / a;
  const sus = peak * env.sustain;
  return sus + (peak - sus) * Math.exp(-(t - a) / Math.max(1e-4, env.decay));
}

/** The note's whole envelope as automation, from note-on at `start` (engine time), with an optional gate-off. */
export function envelopeSchedule(env: Envelope, start: number, peak: number, stopAt?: number): EnvEvent[] {
  const a = edge(env.attack);
  const ev: EnvEvent[] = [{ kind: 'set', t: start, v: 0 }];
  if (stopAt !== undefined && stopAt - start < a) {
    ev.push({ kind: 'linear', t: stopAt, v: held(env, stopAt - start, peak) });
  } else {
    ev.push({ kind: 'linear', t: start + a, v: peak });
    ev.push({ kind: 'target', t: start + a, v: peak * env.sustain, tau: Math.max(1e-4, env.decay) });
  }
  if (stopAt !== undefined) ev.push(...releaseSchedule(env, start, peak, stopAt));
  return ev;
}

/** Gate-off at `stopAt`: hold the current level, then ramp linearly to 0. */
export function releaseSchedule(env: Envelope, start: number, peak: number, stopAt: number): EnvEvent[] {
  return [
    { kind: 'set', t: stopAt, v: held(env, stopAt - start, peak) },
    { kind: 'linear', t: releaseEnd(env, stopAt), v: 0 },
  ];
}

/** When a note gated off at `stopAt` falls silent. */
export function releaseEnd(env: Envelope, stopAt: number): number {
  return stopAt + edge(env.release);
}
