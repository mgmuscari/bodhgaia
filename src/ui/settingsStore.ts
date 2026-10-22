// Settings persistence (the ONLY localStorage touch — deliberately isolated from the pure store so
// settings.ts stays headless/allowlisted). Storage is dependency-injected (defaults to the real
// localStorage when present) so it round-trips in headless tests and tolerates SSR / private-mode /
// quota-blocked storage by falling back to the clamped defaults. Every read runs through
// clampSettings, so a corrupt or stale-schema blob can never poison the running game.

import { clampSettings, MAP_SIZES, type Settings } from './settings';

/** localStorage key (versioned so a future schema change can migrate rather than silently mis-merge). */
export const SETTINGS_KEY = 'bodhipolis.settings.v1';

/** The ambient localStorage if the platform exposes one, else undefined (SSR / blocked). */
function ambientStorage(): Storage | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined; // some browsers throw on access in privacy modes
  }
}

/** Load + sanitize the persisted settings. Absent/corrupt/blocked storage → the clamped defaults — on a `touch` screen
 *  (a phone) with a tiny map: a 128² city is mostly off a phone's screen (Maddy 2026-10-21). */
export function loadSettings(storage: Storage | undefined = ambientStorage(), touch = false): Settings {
  const fresh = (): Settings => clampSettings(touch ? { world: { mapWidth: MAP_SIZES.tiny, mapHeight: MAP_SIZES.tiny } } : undefined);
  if (!storage) return fresh();
  let raw: string | null = null;
  try {
    raw = storage.getItem(SETTINGS_KEY);
  } catch {
    return fresh(); // read blocked → defaults
  }
  if (!raw) return fresh();
  try {
    return clampSettings(JSON.parse(raw) as Partial<Settings>);
  } catch {
    return clampSettings(); // corrupt JSON → defaults (never throw into the game boot)
  }
}

/** Persist the (clamped) settings. Best-effort: a blocked/quota-full store just doesn't persist —
 *  the in-memory settings still drive the session, so this swallow is the intended degraded mode. */
export function saveSettings(settings: Settings, storage: Storage | undefined = ambientStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(clampSettings(settings)));
  } catch {
    /* private mode / quota exceeded — persistence is best-effort, the session keeps the in-memory value */
  }
}
