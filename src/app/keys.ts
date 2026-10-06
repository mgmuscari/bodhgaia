// App shell: the key dispatch. ONE keydown listener for every game toggle, resolved through the pure key table
// (src/ui/keyMap.ts): it never fires with Cmd/Ctrl/Alt held (browser shortcuts — Cmd+L, Cmd+R, Cmd+, … — pass
// through), nor under the opening overlay, nor while typing in a text field (resolveKey reads `event.target`).
// Each action calls the same closure its dock button does. preventDefault only on a match.

import { resolveKey, overlayKindOf, type KeyPress } from '../ui/keyMap';
import type { OverlayKind } from '../ui/overlayRegistry';
import { isPanelId, type PanelId } from './panels';

/** Where the listener goes (`window` in the browser). */
export interface KeyTarget {
  addEventListener(type: 'keydown', listener: (event: KeyPress & { preventDefault(): void }) => void): void;
}

export interface KeysDeps {
  target: KeyTarget;
  /** Whether the opening overlay is up (read at key time — it is dismissed later). */
  openingUp: () => boolean;
  /** A map overlay key — the same body the dock's overlay buttons call. */
  cycleOverlay: (kind: OverlayKind) => void;
  /** The L key — the same toggle the dock's [Life] button calls. */
  toggleLife: () => void;
  /** A panel key — the same registry call its dock button makes. */
  togglePanel: (id: PanelId) => void;
}

export function installKeys(deps: KeysDeps): void {
  deps.target.addEventListener('keydown', (event) => {
    const action = resolveKey(event, deps.openingUp()); // `event` carries its target → editable fields are skipped
    if (action === null) return;
    event.preventDefault();
    const overlay = overlayKindOf(action);
    if (overlay !== null) deps.cycleOverlay(overlay);
    else if (action === 'life') deps.toggleLife();
    else if (isPanelId(action)) deps.togglePanel(action);
  });
}
