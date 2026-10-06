// Pulse dock: the thin always-on DOM shell that mounts the top bar's line.
// A renderer-style shell mirroring mountToolbar — no logic worth unit-testing
// (the line is composed by app/panels.ts createPulse from the pure pulseContent
// and tested there), and ZERO game imports: the line arrives as a plain string
// via set(). It touches the DOM only inside mountPulseDock, which main() calls
// only when `document` exists.
//
// It is its OWN dedicated dock element (not the shared toolbar.setStatus
// transient, which inspect/legend already clobber) so the always-on pulse never
// flickers — it is refreshed on the civic cadence and the economy's hour only.

export interface PulseDockHandle {
  /** Replace the pulse line text. */
  set(line: string): void;
}

export interface PulseDockDeps {
  /** A click on the bar (the funds and the rest) — the host opens the Budget window. */
  onClick?(): void;
}

/** Build and mount the always-on pulse dock into `container`. */
export function mountPulseDock(container: HTMLElement, deps: PulseDockDeps = {}): PulseDockHandle {
  const dock = document.createElement('div');
  dock.className = 'pulse-dock';
  if (deps.onClick) dock.addEventListener('click', () => deps.onClick?.());
  container.appendChild(dock);
  return {
    set(line: string): void {
      dock.textContent = line;
    },
  };
}
