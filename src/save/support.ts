// Can this browser save at all? Saving needs IndexedDB (the slots) and CompressionStream /
// DecompressionStream (slots and `.bodhi` files are gzipped). Checked ONCE: the Saves window disables
// what can't work and says so in one line, and the store turns the autosave slot into a silent sink —
// so a browser without storage plays fine instead of warning on every tab switch.
//
// checkSaveSupport is pure (it reads only the env it is handed); saveSupport binds it to the real
// globals and caches the answer.

export type SaveSupport = { readonly ok: true } | { readonly ok: false; readonly missing: readonly string[] };

/** The globals saving needs, by the name a player would recognise. */
const NEEDS = [
  ['indexedDB', 'IndexedDB'],
  ['CompressionStream', 'CompressionStream'],
  ['DecompressionStream', 'DecompressionStream'],
] as const;

/** Which of the needed globals `env` lacks. An accessor that throws (storage blocked) counts as missing. */
export function checkSaveSupport(env: object): SaveSupport {
  const missing: string[] = [];
  for (const [key, label] of NEEDS) {
    let present = false;
    try {
      present = (env as Record<string, unknown>)[key] != null;
    } catch {
      present = false;
    }
    if (!present) missing.push(label);
  }
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

let cached: SaveSupport | undefined;

/** The real browser's answer, checked once. */
export function saveSupport(): SaveSupport {
  return (cached ??= checkSaveSupport(globalThis));
}

/** The one line the Saves window shows (and the store throws) when saving can't work. */
export function unavailableLine(s: SaveSupport): string {
  return s.ok ? '' : `Saving isn't available in this browser (no ${s.missing.join(', ')}).`;
}
