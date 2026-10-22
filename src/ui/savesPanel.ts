// The Saves window (Maddy 2026-10-02: save/load): save the city into a new slot, load / export / delete a
// slot, import a `.bodhi` file, or start a new city. The game in progress also autosaves and resumes on a
// reload. A thin DOM shell — storage comes in through deps (save/store.ts), the save itself from the host.

import type { SlotInfo } from '../save/store';
import { saveSupport, unavailableLine, type SaveSupport } from '../save/support';
import { panelVisibility, type PanelHandle } from './panelHandle';
import { DIFFICULTIES, STANDARD_MODE, type CityMode } from '../engine/mode';

export interface SavesPanelDeps {
  list(): Promise<SlotInfo[]>;
  /** Save the city as it is now into a new slot. */
  saveNew(): Promise<void>;
  load(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Export the city as it is now (no id) or a stored slot. */
  exportSave(id?: string): Promise<void>;
  importFile(file: File): Promise<void>;
  /** Start a new city with this mode (difficulty, sandbox) — New city's chooser. */
  newCity(mode: CityMode): Promise<void>;
  /** The current city's mode, named in the window. Optional. */
  mode?(): CityMode;
  onToggle?(open: boolean): void;
  /** Can this browser save? Default: the real feature check (save/support.ts). When it can't, the window
   *  says so in one line and disables Save / Import / Export. */
  support?: SaveSupport;
}

const when = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function mountSavesPanel(container: HTMLElement, deps: SavesPanelDeps): PanelHandle {
  const panel = document.createElement('div');
  panel.className = 'budget-panel saves-panel'; // the Budget window's frame and type
  container.appendChild(panel);
  let status = '';
  /** New city's chooser, while it's open: the mode being picked (Maddy 2026-10-21 "Sandbox + difficulty"). */
  let choosing: CityMode | null = null;
  const modeName = (m: CityMode): string => `${m.difficulty[0]!.toUpperCase()}${m.difficulty.slice(1)}${m.sandbox ? ' · Sandbox' : ''}`;
  const support = deps.support ?? saveSupport();
  const cantSave = unavailableLine(support); // '' when saving works

  const button = (label: string, run: () => Promise<void>, cls = 'budget-borrow'): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', () => {
      if (b.disabled) return;
      run()
        .then(() => render())
        .catch((e: unknown) => {
          status = e instanceof Error ? e.message : String(e);
          void render();
        });
    });
    return b;
  };
  /** A button that needs storage (or compression): disabled when this browser can't save. */
  const storageButton = (label: string, run: () => Promise<void>): HTMLButtonElement => {
    const b = button(label, run);
    if (cantSave) b.disabled = true;
    return b;
  };
  const div = (cls: string, text = ''): HTMLDivElement => {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text;
    return d;
  };

  async function render(): Promise<void> {
    const head = div('budget-head');
    const title = document.createElement('span');
    title.className = 'budget-title';
    title.textContent = 'Saves';
    const close = button('✕', async () => handle.close(), 'budget-close');
    close.setAttribute('aria-label', 'Close saves');
    head.append(title, close);

    const actions = div('budget-section');
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = '.bodhi,.json,application/gzip,application/json';
    file.hidden = true;
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (!f) return;
      deps
        .importFile(f)
        .then(() => {
          status = `Imported ${f.name}`;
          return render();
        })
        .catch((e: unknown) => {
          status = e instanceof Error ? e.message : String(e);
          void render();
        });
    });
    actions.append(
      storageButton('Save', async () => {
        await deps.saveNew();
        status = 'Saved';
      }),
      storageButton('Export', () => deps.exportSave()),
      storageButton('Import…', async () => file.click()),
      button('New city', async () => {
        choosing = { ...STANDARD_MODE };
      }),
      file,
    );

    const slots = div('budget-section');
    slots.append(div('budget-heading', 'Saved cities'));
    let infos: SlotInfo[] = [];
    try {
      infos = await deps.list();
    } catch (e) {
      status = e instanceof Error ? e.message : String(e);
    }
    if (cantSave) slots.append(div('budget-note', cantSave));
    else if (infos.length === 0) slots.append(div('budget-note', 'None yet — the city in progress autosaves.'));
    for (const s of infos) {
      const row = div('saves-row');
      row.append(
        div('budget-line', `${s.name} · ${when(s.savedAt)} · ${Math.max(1, Math.round(s.bytes / 1024))} KB`),
        button('Load', () => deps.load(s.id)),
        storageButton('Export', () => deps.exportSave(s.id)),
        button('Delete', () => deps.remove(s.id)),
      );
      slots.append(row);
    }

    // New city's chooser: how hard the century was on the city, and whether it's a sandbox
    const chooser: HTMLElement[] = [];
    if (choosing) {
      const pick = choosing;
      const sec = div('budget-section');
      sec.append(div('budget-heading', 'New city'));
      const diff = div('saves-row');
      for (const d of DIFFICULTIES) {
        const b = button(`${d[0]!.toUpperCase()}${d.slice(1)}`, async () => {
          choosing = { ...pick, difficulty: d };
        });
        if (pick.difficulty === d) b.classList.add('is-selected');
        b.setAttribute('aria-pressed', String(pick.difficulty === d));
        diff.append(b);
      }
      const sandbox = button('Sandbox', async () => {
        choosing = { ...pick, sandbox: !pick.sandbox };
      });
      if (pick.sandbox) sandbox.classList.add('is-selected');
      sandbox.setAttribute('aria-pressed', String(pick.sandbox));
      diff.append(sandbox);
      sec.append(
        diff,
        div(
          'budget-note',
          (pick.difficulty === 'gentle' ? 'Gentle: building costs less, disasters are rarer, and the century left less damage.' : pick.difficulty === 'hard' ? 'Hard: building costs more, disasters come oftener, and the century left more damage.' : 'Standard: the city as the century left it.') +
            (pick.sandbox ? ' Sandbox: every practice open, and money and effort never run short.' : ''),
        ),
      );
      const go = div('saves-row');
      go.append(
        button('Start', async () => {
          choosing = null;
          await deps.newCity(pick);
        }),
        button('Cancel', async () => {
          choosing = null;
        }),
      );
      sec.append(go);
      chooser.push(sec);
    }
    const current = deps.mode ? [div('budget-note', `This city: ${modeName(deps.mode())}`)] : [];

    panel.replaceChildren(head, ...current, actions, ...chooser, slots, ...(status ? [div('budget-note', status)] : []));
  }

  // each open starts with a clean status line and a fresh slot list; refresh re-lists while open
  const handle = panelVisibility(panel, {
    render: () => {
      status = '';
      void render();
    },
    refresh: () => void render(),
    onToggle: deps.onToggle,
  });
  return handle;
}
