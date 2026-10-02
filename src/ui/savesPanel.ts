// The Saves window (Maddy 2026-10-02: save/load): save the city into a new slot, load / export / delete a
// slot, import a `.bodhi` file, or start a new city. The game in progress also autosaves and resumes on a
// reload. A thin DOM shell — storage comes in through deps (save/store.ts), the save itself from the host.

import type { SlotInfo } from '../save/store';

export interface SavesPanelDeps {
  list(): Promise<SlotInfo[]>;
  /** Save the city as it is now into a new slot. */
  saveNew(): Promise<void>;
  load(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Export the city as it is now (no id) or a stored slot. */
  exportSave(id?: string): Promise<void>;
  importFile(file: File): Promise<void>;
  newCity(): Promise<void>;
  onToggle?(open: boolean): void;
}

export interface SavesPanelHandle {
  toggle(): boolean;
  visible(): boolean;
}

const when = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function mountSavesPanel(container: HTMLElement, deps: SavesPanelDeps): SavesPanelHandle {
  const panel = document.createElement('div');
  panel.className = 'budget-panel saves-panel'; // the Budget window's frame and type
  panel.hidden = true;
  container.appendChild(panel);
  let open = false;
  let status = '';

  const button = (label: string, run: () => Promise<void>, cls = 'budget-borrow'): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', () => {
      run()
        .then(() => render())
        .catch((e: unknown) => {
          status = e instanceof Error ? e.message : String(e);
          void render();
        });
    });
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
    const close = button('✕', async () => setOpen(false), 'budget-close');
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
      button('Save', async () => {
        await deps.saveNew();
        status = 'Saved';
      }),
      button('Export', () => deps.exportSave()),
      button('Import…', async () => file.click()),
      button('New city', () => deps.newCity()),
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
    if (infos.length === 0) slots.append(div('budget-note', 'None yet — the city in progress autosaves.'));
    for (const s of infos) {
      const row = div('saves-row');
      row.append(
        div('budget-line', `${s.name} · ${when(s.savedAt)} · ${Math.max(1, Math.round(s.bytes / 1024))} KB`),
        button('Load', () => deps.load(s.id)),
        button('Export', () => deps.exportSave(s.id)),
        button('Delete', () => deps.remove(s.id)),
      );
      slots.append(row);
    }

    panel.replaceChildren(head, actions, slots, ...(status ? [div('budget-note', status)] : []));
  }

  function setOpen(next: boolean): void {
    open = next;
    panel.hidden = !open;
    status = '';
    if (open) void render();
    deps.onToggle?.(open);
  }

  return {
    toggle: () => {
      setOpen(!open);
      return open;
    },
    visible: () => open,
  };
}
