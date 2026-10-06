import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installFakeDom, type FakeEl } from './fakeDom';
import { panelVisibility, type PanelHandle } from '../../src/ui/panelHandle';
import { mountTechPanel } from '../../src/ui/techPanel';
import { mountBudgetPanel } from '../../src/ui/budgetPanel';
import { mountSavesPanel } from '../../src/ui/savesPanel';
import { mountSettingsPanel } from '../../src/ui/settingsPanel';
import { mountHelpPanel } from '../../src/ui/helpPanel';
import { mountRestorationPanel } from '../../src/ui/restorationPanel';
import { DEFAULT_SETTINGS } from '../../src/ui/settings';
import type { BudgetView } from '../../src/ui/budgetContent';
import { TECH_TREE } from '../../src/tech/tree';
import { createTechState } from '../../src/tech/state';
import { techLayout } from '../../src/ui/techLayout';
import { effortLine } from '../../src/ui/techContent';

// C7: every toggled window returns the SAME handle — toggle/isOpen/open/close/refresh — shows/hides through
// the `hidden` attribute alone, reports each open/close, and ignores refresh while closed (inside the panel,
// not guarded by the host).

describe('panelVisibility: the state machine behind every panel', () => {
  it('starts closed and hidden; open/close are idempotent; toggle returns the new state', () => {
    const el = { hidden: false };
    const toggles: boolean[] = [];
    let renders = 0;
    const h = panelVisibility(el, { render: () => renders++, onToggle: (o) => toggles.push(o) });
    expect(h.isOpen()).toBe(false);
    expect(el.hidden).toBe(true);
    h.open();
    h.open();
    expect(h.isOpen()).toBe(true);
    expect(el.hidden).toBe(false);
    expect(renders).toBe(1);
    expect(h.toggle()).toBe(false);
    expect(el.hidden).toBe(true);
    h.close();
    expect(toggles).toEqual([true, false]);
    expect(h.toggle()).toBe(true);
    expect(renders).toBe(2); // every open is a fresh render
  });

  it('refresh runs only while open, and uses the refresh hook over render when given', () => {
    const calls: string[] = [];
    const h = panelVisibility({ hidden: true }, { render: () => calls.push('render'), refresh: () => calls.push('refresh') });
    h.refresh();
    expect(calls).toEqual([]);
    h.open();
    h.refresh();
    expect(calls).toEqual(['render', 'refresh']);
  });
});

interface Mounted {
  handle: PanelHandle;
  /** How many times the panel has read its content from the host. */
  reads: () => number;
}

const view = (): BudgetView => ({
  classes: [{ id: 'r', label: 'Residential', rate: 0.07, perHour: 10 }],
  revenue: 10,
  upkeep: 4,
  police: 5,
  repayments: 0,
  net: 1,
  loans: [],
  offer: { limit: 1000, ratePerDay: 0.01, hours: 240 } as BudgetView['offer'],
  borrow: [500],
  relief: null,
  waysOut: [],
});

const PANELS: Record<string, { cls: string; mount: (c: FakeEl, onToggle: (o: boolean) => void) => Mounted }> = {
  tech: {
    cls: 'tech-panel',
    mount: (c, onToggle) => {
      let n = 0;
      const tech = createTechState(TECH_TREE);
      const handle = mountTechPanel(c as unknown as HTMLElement, {
        getContent: () => {
          n++;
          return { effort: effortLine(tech), layout: techLayout(TECH_TREE, tech) };
        },
        art: () => undefined,
        onUnlock: () => false,
        onToggle,
      });
      return { handle, reads: () => n };
    },
  },
  budget: {
    cls: 'budget-panel',
    mount: (c, onToggle) => {
      let n = 0;
      const handle = mountBudgetPanel(c as unknown as HTMLElement, {
        getView: () => {
          n++;
          return view();
        },
        onTax: () => {},
        onPolice: () => {},
        onBorrow: () => {},
        onToggle,
      });
      return { handle, reads: () => n };
    },
  },
  saves: {
    cls: 'saves-panel',
    mount: (c, onToggle) => {
      let n = 0;
      const handle = mountSavesPanel(c as unknown as HTMLElement, {
        list: async () => {
          n++;
          return [];
        },
        saveNew: async () => {},
        load: async () => {},
        remove: async () => {},
        exportSave: async () => {},
        importFile: async () => {},
        newCity: async () => {},
        onToggle,
      });
      return { handle, reads: () => n };
    },
  },
  settings: {
    cls: 'settings-panel',
    mount: (c, onToggle) => {
      let n = 0;
      const handle = mountSettingsPanel(c as unknown as HTMLElement, {
        getSettings: () => {
          n++;
          return DEFAULT_SETTINGS;
        },
        onLiveChange: () => {},
        onWorldChange: () => {},
        onRendererChange: () => {},
        onToggle,
      });
      return { handle, reads: () => n };
    },
  },
  help: {
    cls: 'help-panel',
    mount: (c, onToggle) => ({ handle: mountHelpPanel(c as unknown as HTMLElement, { onToggle }), reads: () => 0 }),
  },
  restoration: {
    cls: 'restoration-panel',
    mount: (c, onToggle) => {
      let n = 0;
      const handle = mountRestorationPanel(c as unknown as HTMLElement, {
        read: () => {
          n++;
          return ['Land value: 1 →'];
        },
        onToggle,
      });
      return { handle, reads: () => n };
    },
  },
};

describe('every panel returns the one handle shape', () => {
  let body: FakeEl;
  beforeEach(() => {
    body = installFakeDom();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  for (const [name, spec] of Object.entries(PANELS)) {
    it(`${name}: toggle/isOpen/open/close/refresh through \`hidden\`, with onToggle on each change`, async () => {
      const toggles: boolean[] = [];
      const { handle, reads } = spec.mount(body, (o) => toggles.push(o));
      const el = body.find(spec.cls)!;
      expect(el, `${name} mounts a .${spec.cls}`).toBeDefined();
      expect(handle.isOpen()).toBe(false);
      expect(el.hidden).toBe(true);
      expect(el.style.display ?? '').toBe(''); // one visibility mechanism: no inline display
      expect(reads()).toBe(0); // nothing read before it opens

      handle.refresh(); // closed → no-op inside the panel
      expect(reads()).toBe(0);

      handle.open();
      await Promise.resolve();
      expect(handle.isOpen()).toBe(true);
      expect(el.hidden).toBe(false);
      handle.open(); // idempotent
      expect(handle.toggle()).toBe(false);
      expect(el.hidden).toBe(true);
      handle.close(); // idempotent
      expect(handle.toggle()).toBe(true);
      expect(toggles).toEqual([true, false, true]);

      handle.close();
      const before = reads();
      handle.refresh();
      await Promise.resolve();
      expect(reads()).toBe(before);
    });
  }

  it("help: the panel's own ✕ closes it through the handle (the dock hears it)", () => {
    const toggles: boolean[] = [];
    const help = mountHelpPanel(body as unknown as HTMLElement, { onToggle: (o) => toggles.push(o) });
    help.open();
    body.find('help-panel__close')!.click();
    expect(help.isOpen()).toBe(false);
    expect(toggles).toEqual([true, false]);
  });

  it("settings: the panel's own ✕ closes it through the handle (the dock hears it)", () => {
    const toggles: boolean[] = [];
    const settings = mountSettingsPanel(body as unknown as HTMLElement, {
      getSettings: () => DEFAULT_SETTINGS,
      onLiveChange: () => {},
      onWorldChange: () => {},
      onRendererChange: () => {},
      onToggle: (o) => toggles.push(o),
    });
    settings.open();
    body.find('settings-panel__close')!.click();
    expect(settings.isOpen()).toBe(false);
    expect(toggles).toEqual([true, false]);
  });

  it('restoration (N4): opening shows a FRESH reading at once, however it is opened; refresh trends it', () => {
    const reads: boolean[] = [];
    const panel = mountRestorationPanel(body as unknown as HTMLElement, {
      read: (fresh) => {
        reads.push(fresh);
        return [fresh ? 'fresh' : 'trend'];
      },
    });
    const text = () => body.find('restoration-panel__body')!.textContent;
    panel.toggle(); // the key path and the dock path both land here
    expect(reads).toEqual([true]);
    expect(text()).toBe('fresh');
    panel.refresh(); // the civic cadence
    expect(reads).toEqual([true, false]);
    expect(text()).toBe('trend');
    panel.close();
    panel.refresh();
    expect(reads).toEqual([true, false]);
    panel.open();
    expect(reads).toEqual([true, false, true]);
  });
});
