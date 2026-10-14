// The one keyboard table (PURE — no DOM). Every game toggle key lives here; main.ts installs ONE keydown
// listener that resolves through it and dispatches. The gate is uniform: nothing matches with Cmd / Ctrl /
// Alt held (so Cmd+L, Cmd+G, Cmd+, … reach the browser), nothing matches while the opening overlay is up, and
// nothing matches while the user is typing in a text field (the Settings number box, …).
// Keys the camera owns (arrows and WASD — panFor —, I/X/Escape) stay in input.ts; the help text lives in controlsContent.ts.

import type { OverlayKind } from './overlayRegistry';

export type KeyAction =
  | `overlay:${OverlayKind}`
  | 'budget'
  | 'saves'
  | 'life'
  | 'restore'
  | 'settings'
  | 'help'
  | 'tech';

export interface KeyBindingEntry {
  /** Exact `KeyboardEvent.key` values (list both cases for letters). */
  keys: string[];
  action: KeyAction;
}

export const KEY_BINDINGS: readonly KeyBindingEntry[] = [
  { keys: ['e', 'E'], action: 'overlay:eco' },
  { keys: ['c', 'C'], action: 'overlay:civic' },
  { keys: ['r', 'R'], action: 'overlay:redline' },
  { keys: ['p', 'P'], action: 'overlay:police' },
  { keys: ['v', 'V'], action: 'overlay:coverage' },
  { keys: ['u', 'U'], action: 'overlay:power' },
  { keys: ['b', 'B'], action: 'budget' },
  { keys: ['o', 'O'], action: 'saves' }, // S pans (WASD, Maddy 2026-10-13)
  { keys: ['l', 'L'], action: 'life' },
  { keys: ['g', 'G'], action: 'restore' },
  { keys: [','], action: 'settings' },
  { keys: ['?', 'h', 'H'], action: 'help' },
  { keys: ['t', 'T'], action: 'tech' },
];

/** Screen pixels a panning key moves the map. */
export const KEY_PAN_PX = 48;
const PAN_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [KEY_PAN_PX, 0],
  ArrowRight: [-KEY_PAN_PX, 0],
  ArrowUp: [0, KEY_PAN_PX],
  ArrowDown: [0, -KEY_PAN_PX],
  a: [KEY_PAN_PX, 0],
  d: [-KEY_PAN_PX, 0],
  w: [0, KEY_PAN_PX],
  s: [0, -KEY_PAN_PX],
};

/** The camera pan (screen px) a key asks for — the arrows, and WASD either case (Maddy 2026-10-13) — or null. */
export function panFor(key: string): readonly [number, number] | null {
  return PAN_KEYS[key] ?? PAN_KEYS[key.toLowerCase()] ?? null;
}

/** Screen px a second the map moves while panning keys are held (Maddy 2026-10-13: smooth, not jumpy). */
export const KEY_PAN_SPEED = 720;
const DIAGONAL = 0.7071067811865476; // 1/√2: two keys at once go no faster

/** The pan velocity (screen px/s) of the keys held — the arrows and WASD, a key and its twin counted once, opposite
 *  keys cancelling, a diagonal at the same speed. */
export function panVelocity(held: ReadonlySet<string>): [number, number] {
  let sx = 0;
  let sy = 0;
  const seen = new Set<string>();
  for (const k of held) {
    const p = panFor(k);
    if (!p) continue;
    const dir = `${Math.sign(p[0])},${Math.sign(p[1])}`;
    if (seen.has(dir)) continue;
    seen.add(dir);
    sx += Math.sign(p[0]);
    sy += Math.sign(p[1]);
  }
  sx = Math.sign(sx);
  sy = Math.sign(sy);
  const k = sx !== 0 && sy !== 0 ? KEY_PAN_SPEED * DIAGONAL : KEY_PAN_SPEED;
  return [sx * k + 0, sy * k + 0];
}

/** Seconds the glide takes to reach full speed from rest, and to stop from full speed (Maddy 2026-10-13: accel/decel). */
export const PAN_ACCEL_S = 0.25;
export const PAN_DECEL_S = 0.2;

/** One frame of the glide: each axis eases toward the held keys' velocity — speeding up at full-speed-per-PAN_ACCEL_S,
 *  slowing (let go, or reversing) at full-speed-per-PAN_DECEL_S — and lands on it exactly, never creeping. */
export function easePan(v: readonly [number, number], target: readonly [number, number], dt: number): [number, number] {
  const axis = (cur: number, want: number): number => {
    const speedingUp = want !== 0 && Math.sign(want) === Math.sign(cur || want) && Math.abs(want) > Math.abs(cur);
    const step = (KEY_PAN_SPEED / (speedingUp ? PAN_ACCEL_S : PAN_DECEL_S)) * dt;
    if (Math.abs(want - cur) <= step) return want;
    return cur + Math.sign(want - cur) * step;
  };
  return [axis(v[0], target[0]) + 0, axis(v[1], target[1]) + 0];
}

export interface KeyPress {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  /** The event target (a `KeyboardEvent` passes as-is); typing into an editable one resolves nothing. */
  target?: unknown;
}

// <input> types that take no typed text — keys pressed while one has focus are still game keys.
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** True when `target` takes typed text: a text-like <input>, <textarea>, <select>, or contenteditable. Duck-typed (no DOM). */
export function isEditableTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const t = target as { tagName?: unknown; type?: unknown; isContentEditable?: unknown };
  if (t.isContentEditable === true) return true;
  const tag = typeof t.tagName === 'string' ? t.tagName.toUpperCase() : '';
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = typeof t.type === 'string' ? t.type.toLowerCase() : 'text';
  return !NON_TEXT_INPUT_TYPES.has(type);
}

/** The action a key press triggers, or null (modifier held, opening overlay up, typing in a field, or unbound). */
export function resolveKey(
  ev: KeyPress,
  overlayActive: boolean,
  bindings: readonly KeyBindingEntry[] = KEY_BINDINGS,
): KeyAction | null {
  if (overlayActive || ev.metaKey || ev.ctrlKey || ev.altKey || isEditableTarget(ev.target)) return null;
  for (const b of bindings) if (b.keys.includes(ev.key)) return b.action;
  return null;
}

const OVERLAY_PREFIX = 'overlay:';

/** The overlay dimension an `overlay:*` action cycles, else null. */
export function overlayKindOf(action: KeyAction): OverlayKind | null {
  return action.startsWith(OVERLAY_PREFIX) ? (action.slice(OVERLAY_PREFIX.length) as OverlayKind) : null;
}
