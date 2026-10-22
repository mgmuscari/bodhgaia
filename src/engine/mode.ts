// A city's mode (interdependence §10, Maddy 2026-10-21): its difficulty — gentle, standard, hard — and whether it is
// a sandbox, both chosen at New city and saved with the city. Difficulty scales three existing knobs: what building
// costs, how often disasters are drawn, and how much damage the history stage leaves. A sandbox has no money or effort
// limits and the whole tech tree open. Standard reproduces the game exactly. Pure; integer math.

export type Difficulty = 'gentle' | 'standard' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['gentle', 'standard', 'hard'];

export interface CityMode {
  difficulty: Difficulty;
  sandbox: boolean;
}

export const STANDARD_MODE: CityMode = { difficulty: 'standard', sandbox: false };

/** Build costs, percent of standard. */
const COST_PCT: Record<Difficulty, number> = { gentle: 75, standard: 100, hard: 130 };
/** The history stage's damage (decay, displacement), percent of standard. */
const HISTORY_PCT: Record<Difficulty, number> = { gentle: 60, standard: 100, hard: 140 };
/** Disasters: gentle draws in half the hours; hard draws a second time in 60% of them. */
const GENTLE_DRAW_PCT = 50;
const HARD_EXTRA_PCT = 60;

/** A price under this mode: scaled and rounded, never below 1 if it had one; nothing in a sandbox. */
export function scaleCost(cost: number, mode: CityMode): number {
  if (mode.sandbox || cost <= 0) return mode.sandbox ? 0 : cost;
  return Math.max(1, Math.floor((cost * COST_PCT[mode.difficulty] + 50) / 100));
}

/** How many disaster draws this hour gets, for a roll 0..99 drawn for the hour. */
export function disasterDraws(mode: CityMode, roll: number): number {
  if (mode.difficulty === 'gentle') return roll < GENTLE_DRAW_PCT ? 1 : 0;
  if (mode.difficulty === 'hard') return roll < HARD_EXTRA_PCT ? 2 : 1;
  return 1;
}

/** The history stage's damage, percent of standard. */
export function historyPct(mode: CityMode): number {
  return HISTORY_PCT[mode.difficulty];
}

/** A mode read from a save or storage: an unknown difficulty is standard; only `sandbox: true` is a sandbox. */
export function parseMode(raw: unknown): CityMode {
  const r = raw && typeof raw === 'object' ? (raw as { difficulty?: unknown; sandbox?: unknown }) : {};
  const difficulty = DIFFICULTIES.find((d) => d === r.difficulty) ?? 'standard';
  return { difficulty, sandbox: r.sandbox === true };
}
