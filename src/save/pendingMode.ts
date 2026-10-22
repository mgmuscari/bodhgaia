// New city's choice (Maddy 2026-10-21): the Saves window's New city sets a difficulty and sandbox, then reloads; the
// choice waits in localStorage until the boot takes it — once. Storage is injectable and every access best-effort.

import { parseMode, type CityMode } from '../engine/mode';

const KEY = 'bodhgaia.newCityMode';

function ambient(): Storage | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

/** Remember the mode for the next new city (New city, before its reload). */
export function setPendingMode(mode: CityMode, storage: Storage | undefined = ambient()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(mode));
  } catch {
    /* best-effort: the new city is standard */
  }
}

/** The mode New city chose, removed as it's read; undefined if none (or unreadable). */
export function takePendingMode(storage: Storage | undefined = ambient()): CityMode | undefined {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return undefined;
    storage?.removeItem(KEY);
    return parseMode(JSON.parse(raw));
  } catch {
    return undefined;
  }
}
