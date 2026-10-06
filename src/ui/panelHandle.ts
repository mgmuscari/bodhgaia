// The one panel handle (PURE — no DOM globals). Every toggled window — Tech, Budget, Saves, Restoration,
// Settings, Help — returns this same shape, and shows/hides the same way: the `hidden` attribute (index.html
// carries `[hidden] { display: none !important }`). Refresh is a no-op while closed, inside the panel, so the
// host never guards it.

export interface PanelHandle {
  /** Open if closed, close if open; returns the new state. */
  toggle(): boolean;
  isOpen(): boolean;
  /** Open (no-op if already open). Opening renders fresh content. */
  open(): void;
  /** Close (no-op if already closed). */
  close(): void;
  /** Re-read the content — no-op while closed. */
  refresh(): void;
}

export interface PanelVisibilityHooks {
  /** Build the content on open (a fresh read). */
  render?(): void;
  /** Update the content while open (defaults to `render`). */
  refresh?(): void;
  /** Fired on every open/close, so the dock's button can follow. */
  onToggle?(open: boolean): void;
}

/** The open/closed state machine behind every panel, over the element whose `hidden` it drives. Starts closed. */
export function panelVisibility(el: { hidden: boolean | string }, hooks: PanelVisibilityHooks = {}): PanelHandle {
  let open = false;
  el.hidden = true;
  const set = (next: boolean): void => {
    if (next === open) return;
    open = next;
    el.hidden = !open;
    if (open) hooks.render?.();
    hooks.onToggle?.(open);
  };
  return {
    toggle: () => {
      set(!open);
      return open;
    },
    isOpen: () => open,
    open: () => set(true),
    close: () => set(false),
    refresh: () => {
      if (open) (hooks.refresh ?? hooks.render)?.();
    },
  };
}
