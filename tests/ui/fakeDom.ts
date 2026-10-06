// A minimal stand-in DOM for mounting the thin panel shells under the node test env (no jsdom): elements are
// property bags with children, listeners, a style object and a class list — enough for the panels to build
// themselves and for a test to find an element by class and click it.

import { vi } from 'vitest';

export class FakeEl {
  children: FakeEl[] = [];
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  hidden = false;
  className = '';
  textContent = '';
  [key: string]: unknown;
  private listeners: Record<string, Array<(e: unknown) => void>> = {};
  readonly classList = {
    add: (c: string) => {
      this.className = `${this.className} ${c}`.trim();
    },
  };
  constructor(readonly tagName: string) {}
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
  append(...cs: FakeEl[]): void {
    this.children.push(...cs);
  }
  insertBefore(c: FakeEl): FakeEl {
    this.children.unshift(c);
    return c;
  }
  replaceChildren(...cs: FakeEl[]): void {
    this.children = [...cs];
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  dispatch(type: string, event: unknown = { target: this }): void {
    for (const fn of this.listeners[type] ?? []) fn(event);
  }
  click(): void {
    this.dispatch('click');
  }
  getContext(): null {
    return null;
  }
  /** Depth-first: this element and every descendant. */
  all(): FakeEl[] {
    return [this, ...this.children.flatMap((c) => c.all())];
  }
  /** The first element (self included) whose class list has `cls`. */
  find(cls: string): FakeEl | undefined {
    return this.all().find((e) => e.className.split(/\s+/).includes(cls));
  }
  /** `.class` selectors only. */
  querySelector(sel: string): FakeEl | null {
    return this.children.flatMap((c) => c.all()).find((e) => e.className.split(/\s+/).includes(sel.slice(1))) ?? null;
  }
  /** All text below this element, in document order. */
  text(): string {
    return this.all()
      .map((e) => e.textContent)
      .join('\n');
  }
}

/** Stub `document` (and a listener-only `window`) for the duration of a test; returns the container. */
export function installFakeDom(): FakeEl {
  vi.stubGlobal('document', {
    createElement: (tag: string) => new FakeEl(tag.toUpperCase()),
    createElementNS: (_ns: string, tag: string) => new FakeEl(tag),
  });
  vi.stubGlobal('window', { addEventListener: () => {}, confirm: () => false });
  return new FakeEl('BODY');
}
