import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installFakeDom, type FakeEl } from './fakeDom';
import { mountSavesPanel, type SavesPanelDeps } from '../../src/ui/savesPanel';
import type { SaveSupport } from '../../src/save/support';

const deps = (support: SaveSupport, calls: string[] = []): SavesPanelDeps => ({
  list: async () => [{ id: 's1', name: 'Oakland', savedAt: 0, bytes: 2048 }],
  saveNew: async () => void calls.push('save'),
  load: async () => {},
  remove: async () => {},
  exportSave: async () => void calls.push('export'),
  importFile: async () => {},
  newCity: async () => {},
  support,
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const buttons = (root: FakeEl): Map<string, FakeEl[]> => {
  const m = new Map<string, FakeEl[]>();
  for (const e of root.all()) if (e.tagName === 'BUTTON') (m.get(e.textContent) ?? m.set(e.textContent, []).get(e.textContent)!).push(e);
  return m;
};

describe('Saves window when the browser cannot save', () => {
  let body: FakeEl;
  beforeEach(() => {
    body = installFakeDom();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('says so in one line and disables Save / Import / Export', async () => {
    const calls: string[] = [];
    const h = mountSavesPanel(body as unknown as HTMLElement, deps({ ok: false, missing: ['IndexedDB'] }, calls));
    h.open();
    await flush();
    const panel = body.find('saves-panel')!;
    expect(panel.text()).toMatch(/IndexedDB/);
    const b = buttons(panel);
    for (const label of ['Save', 'Import…', 'Export']) {
      expect(b.get(label)?.length, label).toBeGreaterThan(0);
      for (const el of b.get(label)!) expect(el.disabled, label).toBe(true);
    }
    expect(b.get('New city')![0]!.disabled).not.toBe(true); // a fresh city needs no storage
    b.get('Save')![0]!.click();
    await flush();
    expect(calls).toEqual([]); // a disabled button does nothing even if a click is dispatched
  });

  it('leaves everything enabled (and silent) when saving works', async () => {
    const h = mountSavesPanel(body as unknown as HTMLElement, deps({ ok: true }));
    h.open();
    await flush();
    const panel = body.find('saves-panel')!;
    expect(panel.text()).not.toMatch(/isn.t available/);
    for (const els of buttons(panel).values()) for (const el of els) expect(el.disabled).not.toBe(true);
  });
});
