// App shell: the saves wiring (src/save). The city autosaves into the CURRENT slot — every few in-game hours
// (the economy calls autosave), and whenever the tab is hidden or closed — and a reload resumes it. The Saves
// window (S, or the palette's disk) saves into new slots, loads, exports and imports `.bodhi` files.
//
// Loading a slot or starting a new city reloads the page through the store; autosave is blanked FIRST so a
// last autosave (the pagehide of that very reload) can never overwrite the slot being loaded.

import { captureGame, type GameParts, type SaveV1 } from '../save/snapshot';
import * as browserStore from '../save/store';
import { CURRENT, type SlotInfo } from '../save/store';
import type { SavesPanelDeps, SavesPanelHandle } from '../ui/savesPanel';

/** The storage the wiring drives (save/store.ts in the browser). */
export interface SaveStore {
  writeSlot(id: string, save: SaveV1): Promise<void>;
  readSlot(id: string): Promise<SaveV1 | null>;
  deleteSlot(id: string): Promise<void>;
  listSlots(): Promise<SlotInfo[]>;
  /** Copy a slot into CURRENT and reload. */
  loadSlot(id: string): Promise<void>;
  /** Forget CURRENT and reload. */
  newCity(): Promise<void>;
  exportFile(save: SaveV1): Promise<void>;
  importFile(file: File): Promise<SaveV1>;
}

export interface SavesDeps {
  /** The running game's parts, read at capture time (the economy run and the tick are replaced as it plays). */
  parts: () => Omit<GameParts, 'savedAt'>;
  /** Where the tab's lifecycle events arrive (document: visibilitychange; window: pagehide). */
  lifecycle: { document: EventTarget & { readonly hidden: boolean }; window: EventTarget };
  /** Mount the Saves window over these actions. */
  mountPanel: (actions: SavesPanelDeps) => SavesPanelHandle;
  /** The window opened or closed (the dock's active-state). */
  onToggle: () => void;
  store?: SaveStore;
  /** Wall-clock ms for savedAt and slot ids (default Date.now). */
  now?: () => number;
  warn?: (...args: unknown[]) => void;
}

export interface SavesController {
  captureNow(): SaveV1;
  /** Write the game into CURRENT (dropped while a write is in flight, or once a load / new city began). */
  autosave(): void;
  toggle(): boolean;
  visible(): boolean;
}

export function createSaves(deps: SavesDeps): SavesController {
  const store = deps.store ?? browserStore;
  const now = deps.now ?? Date.now;
  const warn = deps.warn ?? ((...a: unknown[]) => console.warn(...a));

  const captureNow = (): SaveV1 => captureGame({ ...deps.parts(), savedAt: now() });

  let saving = false;
  let blanked = false; // a load / new city is underway: the slot being loaded must not be overwritten
  const autosave = (): void => {
    if (blanked || saving) return; // one write at a time
    saving = true;
    store
      .writeSlot(CURRENT, captureNow())
      .catch((e: unknown) => warn('[save] autosave failed:', e))
      .finally(() => {
        saving = false;
      });
  };

  const { document: doc, window: win } = deps.lifecycle;
  doc.addEventListener('visibilitychange', () => {
    if (doc.hidden) autosave(); // leaving the tab (or closing it) keeps the city
  });
  win.addEventListener('pagehide', () => autosave());

  const panel = deps.mountPanel({
    list: () => store.listSlots(),
    saveNew: async () => {
      const snap = captureNow();
      await store.writeSlot(`slot-${snap.savedAt}`, snap);
    },
    load: async (id) => {
      blanked = true; // don't let a last autosave overwrite the slot being loaded
      await store.loadSlot(id);
    },
    remove: (id) => store.deleteSlot(id),
    exportSave: async (id) => {
      const snap = id ? await store.readSlot(id) : captureNow();
      if (snap) await store.exportFile(snap);
    },
    importFile: async (file) => {
      const snap = await store.importFile(file);
      await store.writeSlot(`slot-${now()}`, { ...snap, savedAt: snap.savedAt || now() });
    },
    newCity: async () => {
      blanked = true;
      await store.newCity();
    },
    onToggle: () => deps.onToggle(),
  });

  return {
    captureNow,
    autosave,
    toggle: () => panel.toggle(),
    visible: () => panel.visible(),
  };
}
