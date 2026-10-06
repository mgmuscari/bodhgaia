import { describe, it, expect } from 'vitest';
import { createSaves, type SaveStore } from '../../src/app/saves';
import { GameMap } from '../../src/engine/map';
import { ParcelStore } from '../../src/engine/fabric';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';
import { computeNeighborhoods } from '../../src/civic/neighborhoods';
import { createCivicState } from '../../src/civic/state';
import { createEconomy } from '../../src/economy/model';
import { DEFAULT_LEVERS } from '../../src/economy/run';
import { createAmbientState } from '../../src/live/types';
import { createRng } from '../../src/engine/rng';
import { CURRENT, type SlotInfo } from '../../src/save/store';
import type { SaveV1, GameParts } from '../../src/save/snapshot';
import type { SavesPanelDeps } from '../../src/ui/savesPanel';
import { panelVisibility } from '../../src/ui/panelHandle';

// The saves wiring: capture the running game, autosave it into the CURRENT slot (hourly via the economy, and on
// tab-hide / pagehide), and back the Saves window. Loading a slot or starting a new city blanks autosave first,
// so a last autosave can never overwrite the slot being loaded.

/** An in-memory store; writes settle only when `flush()` runs (to observe the one-write-at-a-time guard). */
function memStore() {
  const slots = new Map<string, SaveV1>();
  const calls: string[] = [];
  const pending: Array<() => void> = [];
  let failNext = false;
  const store: SaveStore = {
    writeSlot: (id, save) =>
      new Promise<void>((resolve, reject) => {
        calls.push(`write ${id}`);
        const fail = failNext;
        failNext = false;
        pending.push(() => {
          if (fail) return reject(new Error('disk full'));
          slots.set(id, save);
          resolve();
        });
      }),
    readSlot: async (id) => slots.get(id) ?? null,
    deleteSlot: async (id) => {
      slots.delete(id);
    },
    listSlots: async (): Promise<SlotInfo[]> => [],
    loadSlot: async (id) => {
      calls.push(`load ${id}`);
    },
    newCity: async () => {
      calls.push('new');
    },
    exportFile: async (save) => {
      calls.push(`export ${save.savedAt}`);
    },
    importFile: async () => ({ ...(slots.get('a') as SaveV1), savedAt: 0 }),
  };
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) {
      while (pending.length) pending.shift()!();
      await Promise.resolve();
    }
  };
  return { store, slots, calls, flush, failOnce: () => (failNext = true) };
}

function setup() {
  const map = new GameMap(8, 8);
  const parcels = new ParcelStore();
  const parts: Omit<GameParts, 'savedAt'> = {
    seed: 'lotus',
    name: 'Flet',
    world: { map, parcels },
    tech: createTechState(TECH_TREE),
    civic: createCivicState(computeNeighborhoods(map)),
    econ: { state: createEconomy(1000), projects: [], levers: DEFAULT_LEVERS },
    live: createAmbientState(createRng('lotus').fork('ambient-wind')),
    tick: 7,
    camera: { x: 1, y: 2, zoom: 2 },
  };
  const mem = memStore();
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const win = new EventTarget();
  let actions: SavesPanelDeps | null = null;
  let toggles = 0;
  const warnings: unknown[] = [];
  let clock = 1000;
  const saves = createSaves({
    parts: () => parts,
    store: mem.store,
    lifecycle: { document: doc, window: win },
    mountPanel: (a) => {
      actions = a;
      return panelVisibility({ hidden: true }, { onToggle: a.onToggle }); // the real state machine every panel uses
    },
    onToggle: () => toggles++,
    now: () => clock,
    warn: (...a) => warnings.push(a),
  });
  return { saves, parts, mem, doc, win, actions: () => actions!, toggles: () => toggles, warnings, tick: () => (clock += 1000) };
}

describe('createSaves', () => {
  it('captureNow reads the parts at call time and stamps savedAt', () => {
    const { saves, parts, tick } = setup();
    const a = saves.captureNow();
    expect(a).toMatchObject({ seed: 'lotus', name: 'Flet', savedAt: 1000, tick: 7, camera: { x: 1, y: 2, zoom: 2 } });
    parts.tick = 9;
    tick();
    expect(saves.captureNow()).toMatchObject({ savedAt: 2000, tick: 9 });
  });

  it('autosave writes the CURRENT slot, one write at a time', async () => {
    const { saves, mem } = setup();
    saves.autosave();
    saves.autosave(); // dropped: the first is still writing
    expect(mem.calls).toEqual([`write ${CURRENT}`]);
    await mem.flush();
    expect(mem.slots.get(CURRENT)?.seed).toBe('lotus');
    saves.autosave();
    expect(mem.calls).toEqual([`write ${CURRENT}`, `write ${CURRENT}`]);
  });

  it('a failed autosave warns and frees the guard', async () => {
    const { saves, mem, warnings } = setup();
    mem.failOnce();
    saves.autosave();
    await mem.flush();
    expect(warnings).toHaveLength(1);
    saves.autosave();
    expect(mem.calls).toHaveLength(2);
  });

  it('autosaves when the tab is hidden, not when it becomes visible', () => {
    const { mem, doc } = setup();
    doc.dispatchEvent(new Event('visibilitychange')); // visible
    expect(mem.calls).toEqual([]);
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(mem.calls).toEqual([`write ${CURRENT}`]);
  });

  it('pagehide autosaves', () => {
    const { mem, win } = setup();
    win.dispatchEvent(new Event('pagehide'));
    expect(mem.calls).toEqual([`write ${CURRENT}`]);
  });

  it('loading a slot blanks autosave first — a last pagehide cannot overwrite the slot being loaded', async () => {
    const { saves, mem, win, actions } = setup();
    await actions().load('slot-5');
    expect(mem.calls).toEqual(['load slot-5']);
    win.dispatchEvent(new Event('pagehide'));
    saves.autosave();
    expect(mem.calls).toEqual(['load slot-5']);
  });

  it('a new city blanks autosave too', async () => {
    const { saves, mem, doc, actions } = setup();
    await actions().newCity();
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    saves.autosave();
    expect(mem.calls).toEqual(['new']);
  });

  it('the Saves window saves into a new slot, exports the city or a slot, and imports a file', async () => {
    const { mem, actions, tick } = setup();
    const p = actions().saveNew();
    await mem.flush();
    await p;
    expect(mem.slots.get('slot-1000')?.savedAt).toBe(1000);
    tick();
    await actions().exportSave(); // the city as it is now
    await actions().exportSave('slot-1000');
    expect(mem.calls.slice(-2)).toEqual(['export 2000', 'export 1000']);
    mem.slots.set('a', mem.slots.get('slot-1000')!);
    const q = actions().importFile(new File([], 'x.bodhi'));
    await mem.flush();
    await q;
    expect(mem.slots.get('slot-2000')?.savedAt).toBe(2000); // a file with no savedAt is stamped now
  });

  it('the controller IS the panel handle (toggle/isOpen/open/close/refresh); the panel reports its toggles', () => {
    const { saves, toggles } = setup();
    expect(saves.isOpen()).toBe(false);
    expect(saves.toggle()).toBe(true);
    expect(saves.isOpen()).toBe(true);
    expect(toggles()).toBe(1);
    saves.close();
    expect(saves.isOpen()).toBe(false);
    expect(toggles()).toBe(2);
  });
});
