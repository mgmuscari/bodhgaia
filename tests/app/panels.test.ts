import { describe, it, expect } from 'vitest';
import { createPanelRegistry, createPulse, isPanelId, PANEL_IDS, trendReader } from '../../src/app/panels';
import { panelVisibility, type PanelHandle } from '../../src/ui/panelHandle';
import { KEY_BINDINGS } from '../../src/ui/keyMap';
import { metaButtons } from '../../src/ui/dockContent';

// The panel registry: ONE {id → handle} map the key dispatch, the dock's onMeta and the dock's active flags
// all read — so a panel opened by its key and by its button is the same call.

const handles = (): Record<(typeof PANEL_IDS)[number], PanelHandle> =>
  Object.fromEntries(PANEL_IDS.map((id) => [id, panelVisibility({ hidden: true })])) as Record<(typeof PANEL_IDS)[number], PanelHandle>;

describe('createPanelRegistry', () => {
  it('reports everything closed before the panels mount (the dock reads it at its own mount)', () => {
    const reg = createPanelRegistry();
    expect(Object.values(reg.openFlags()).every((o) => o === false)).toBe(true);
    expect(reg.isOpen('tech')).toBe(false);
  });

  it('toggles by id and reports open flags keyed like the dock wants them', () => {
    const reg = createPanelRegistry();
    reg.attach(handles());
    expect(reg.toggle('restore')).toBe(true);
    expect(reg.get('restore').isOpen()).toBe(true);
    expect(reg.openFlags()).toMatchObject({ restore: true, budget: false, tech: false });
    // the dock's active flags come straight from the registry
    const meta = metaButtons(reg.isOpen('tech'), null, true, reg.openFlags());
    expect(meta.find((m) => m.id === 'restore')!.active).toBe(true);
    expect(reg.toggle('restore')).toBe(false);
  });
});

describe('panel ids: the key table, the dock and the registry agree', () => {
  it('every panel id is a dock button', () => {
    const dockIds = metaButtons(false, null, true).map((m) => m.id as string);
    for (const id of PANEL_IDS) expect(dockIds).toContain(id);
  });
  it('every non-overlay, non-life key action is a panel id', () => {
    for (const b of KEY_BINDINGS) {
      if (b.action.startsWith('overlay:') || b.action === 'life') continue;
      expect(isPanelId(b.action), b.action).toBe(true);
    }
  });
  it('overlays and life are not panels', () => {
    expect(isPanelId('eco')).toBe(false);
    expect(isPanelId('life')).toBe(false);
  });
});

describe('createPulse: the top bar — the economy readout · the civic pulse (N6: one closure)', () => {
  const setup = () => {
    const lines: string[] = [];
    const city = { funds: 100, wb: 50, unhoused: 3, wbReads: 0 };
    const pulse = createPulse({
      set: (l) => lines.push(l),
      readout: () => `$${city.funds}`,
      wellbeing: () => {
        city.wbReads++;
        return city.wb;
      },
      unhoused: () => city.unhoused,
    });
    return { pulse, lines, city };
  };

  it('writes a flat first line at once', () => {
    const { lines } = setup();
    expect(lines).toEqual(['$100  ·  Wellbeing 50 →  ·  Unhoused 3']);
  });

  it('the civic tick trends unhoused vs the previous sample and wellbeing vs the previous TICK', () => {
    const { pulse, lines, city } = setup();
    city.wb = 60;
    city.unhoused = 1;
    pulse.tick(); // the first line's wellbeing is not a prior (as before the move)
    expect(lines.at(-1)).toBe('$100  ·  Wellbeing 60 →  ·  Unhoused 1 ↓');
    city.wb = 55;
    pulse.tick();
    expect(lines.at(-1)).toBe('$100  ·  Wellbeing 55 ↘  ·  Unhoused 1');
  });

  it('refresh rewrites the readout over the last civic line, without re-sampling the city', () => {
    const { pulse, lines, city } = setup();
    const reads = city.wbReads;
    city.funds = 250;
    city.wb = 10;
    pulse.refresh();
    expect(lines.at(-1)).toBe('$250  ·  Wellbeing 50 →  ·  Unhoused 3');
    expect(city.wbReads).toBe(reads);
  });
});

describe('trendReader: a fresh reading on open, trended readings after', () => {
  it('a fresh read compares to nothing; each later read compares to the one before', () => {
    let n = 0;
    const read = trendReader(
      () => ++n,
      (cur, prev) => [`${cur} vs ${prev ?? '—'}`],
    );
    expect(read(true)).toEqual(['1 vs —']);
    expect(read(false)).toEqual(['2 vs 1']);
    expect(read(false)).toEqual(['3 vs 2']);
    expect(read(true)).toEqual(['4 vs —']); // reopened: no stale arrow against the last session
    expect(read(false)).toEqual(['5 vs 4']);
  });
});
