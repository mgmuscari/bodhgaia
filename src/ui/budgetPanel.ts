// The Budget window: the thin DOM shell over ui/budgetContent.ts (pure, tested). Tax sliders per class, the
// police line, the hourly ledger (revenue, upkeep, police, loan repayments, net), and loans — borrow buttons
// with their terms, and the loans being repaid. Toggled by the palette's Budget button, the B key, or a
// click on the funds in the top bar. ZERO game imports: content arrives as plain data, changes leave as
// callbacks.

import type { BudgetView } from './budgetContent';
import { money, perHour } from './moneyFormat';

export interface BudgetPanelDeps {
  getView(): BudgetView;
  onTax(cls: 'r' | 'c' | 'i', rate: number): void;
  onPolice(perHour: number): void;
  onBorrow(amount: number): void;
  /** Fired on every open/close, so the palette button can follow. */
  onToggle?(open: boolean): void;
}

export interface BudgetPanelHandle {
  /** Open it (no-op if already open) — e.g. the moment a relief grant arrives. */
  open(): void;
  toggle(): boolean;
  visible(): boolean;
  /** Re-read the view (the economy ticked) — no-op while hidden. */
  refresh(): void;
}


export function mountBudgetPanel(container: HTMLElement, deps: BudgetPanelDeps): BudgetPanelHandle {
  const panel = document.createElement('div');
  panel.className = 'budget-panel';
  panel.hidden = true;

  const head = document.createElement('div');
  head.className = 'budget-head';
  const title = document.createElement('span');
  title.className = 'budget-title';
  title.textContent = 'Budget';
  const close = document.createElement('button');
  close.className = 'budget-close';
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Close the budget');
  close.addEventListener('click', () => setOpen(false));
  head.append(title, close);

  const taxes = document.createElement('div');
  taxes.className = 'budget-section';
  const ledger = document.createElement('div');
  ledger.className = 'budget-section';
  const loans = document.createElement('div');
  loans.className = 'budget-section';
  panel.append(head, taxes, ledger, loans);
  container.appendChild(panel);

  let open = false;
  // a slider updates only its own readout and the ledger/loans while it's dragged — rebuilding its section
  // would replace the slider under the pointer mid-drag
  const sliderRow = (label: string, value: number, max: number, step: number, show: (v: BudgetView) => string, onInput: (v: number) => void, view: BudgetView): HTMLElement => {
    const row = document.createElement('label');
    row.className = 'budget-row';
    const name = document.createElement('span');
    name.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const out = document.createElement('span');
    out.className = 'budget-value';
    out.textContent = show(view);
    input.addEventListener('input', () => {
      onInput(Number(input.value));
      const next = deps.getView();
      out.textContent = show(next);
      renderLedger(next);
      renderLoans(next);
    });
    row.append(name, input, out);
    return row;
  };
  const line = (label: string, value: string, cls = ''): HTMLElement => {
    const row = document.createElement('div');
    row.className = `budget-line ${cls}`;
    const a = document.createElement('span');
    a.textContent = label;
    const b = document.createElement('span');
    b.textContent = value;
    row.append(a, b);
    return row;
  };
  const note = (text: string): HTMLElement => {
    const p = document.createElement('div');
    p.className = 'budget-note';
    p.textContent = text;
    return p;
  };
  const heading = (text: string): HTMLElement => {
    const h = document.createElement('div');
    h.className = 'budget-heading';
    h.textContent = text;
    return h;
  };

  function renderTaxes(v: BudgetView): void {
    taxes.replaceChildren(
      heading('Taxes'),
      ...v.classes.map((c, k) =>
        sliderRow(
          c.label,
          Math.round(c.rate * 100),
          20,
          1,
          (nv) => `${Math.round(nv.classes[k]!.rate * 100)}% · ${perHour(nv.classes[k]!.perHour)}`,
          (pct) => deps.onTax(c.id, pct / 100),
          v,
        ),
      ),
      sliderRow('Police', Math.round(v.police), 60, 5, (nv) => perHour(-nv.police), (h) => deps.onPolice(h), v),
    );
  }

  function renderLedger(v: BudgetView): void {
    ledger.replaceChildren(
      heading('Each hour'),
      line('Taxes in', perHour(v.revenue)),
      line('Upkeep', perHour(-v.upkeep)),
      line('Police', perHour(-v.police)),
      line('Loan repayments', perHour(-v.repayments)),
      line('Net', perHour(v.net), v.net >= 0 ? 'budget-good' : 'budget-bad'),
    );
  }

  function renderLoans(v: BudgetView): void {
    const terms = `${v.offer.hours / 24} days at ${(v.offer.ratePerDay * 100).toFixed(1)}% a day (your approval sets the rate)`;
    loans.replaceChildren(
      heading('Loans'),
      line('You can borrow', money(v.offer.limit)),
      line('Terms', terms, 'budget-note'),
      ...v.borrow.map((amount) => {
        const b = document.createElement('button');
        b.className = 'budget-borrow';
        b.textContent = `Borrow ${money(amount)}`;
        b.addEventListener('click', () => {
          deps.onBorrow(amount);
          render();
        });
        return b;
      }),
      ...v.loans.map((l) => line(`Owed ${money(l.principalLeft)}`, `${perHour(-l.payment)} · ${Math.ceil(l.hoursLeft / 24)} days left`, 'budget-note')),
      ...(v.relief ? [note(v.relief)] : []),
      ...(v.net < 0 ? [heading('Ways out'), ...v.waysOut.map(note)] : []),
    );
  }

  function render(): void {
    const v = deps.getView();
    renderTaxes(v);
    renderLedger(v);
    renderLoans(v);
  }

  function setOpen(next: boolean): void {
    open = next;
    panel.hidden = !open;
    if (open) render();
    deps.onToggle?.(open);
  }

  return {
    open: () => {
      if (!open) setOpen(true);
    },
    toggle: () => {
      setOpen(!open);
      return open;
    },
    visible: () => open,
    refresh: () => {
      // the economy ticked: the ledger and loans move; the sliders keep their place
      if (!open) return;
      const v = deps.getView();
      renderLedger(v);
      renderLoans(v);
    },
  };
}
