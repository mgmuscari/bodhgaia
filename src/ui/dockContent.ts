// Dock meta content: the pure view-model for the dock's [Tech][Eco][Civic] meta
// buttons — the keyboard-only depth (T/E/C) surfaced as always-visible controls.
// No DOM, no transcendental Math (the architecture guard's pure-ui allowlist scans
// this file). Keeping the active-state derivation here, not in the toolbar shell,
// lets it be unit-tested rather than left to manual QA — and gives main ONE pure
// source of truth that the dock and the keyboard paths both feed.

/** One dock meta button: which control it is, its label, and whether it's active. */
export interface MetaButton {
  id: 'tech' | 'eco' | 'civic' | 'redline' | 'police' | 'coverage' | 'power' | 'life' | 'restore' | 'settings' | 'help';
  label: string;
  /** The pixel icon drawn as the button face (uiIcons.ts); the label becomes its tooltip. */
  art: string;
  active: boolean;
}

/** Fixed labels — the bracketed key echoes the hotkey the button mirrors. */
const META_LABELS: Record<MetaButton['id'], string> = {
  tech: 'Tech (T)',
  eco: 'Eco (E)',
  civic: 'Civic (C)',
  redline: 'Redline (R)',
  police: 'Police (P)',
  coverage: 'Coverage (V)',
  power: 'Power (U)',
  life: 'Life (L)',
  restore: 'Restoration (G)',
  settings: 'Settings (,)',
  help: 'Help (?)',
};

/**
 * The five dock meta buttons in fixed tech/eco/civic/redline/life order, with their
 * active flags derived from the live UI state: Tech is active iff the tech panel is
 * open; Eco/Civic/Redline are active iff the single composite overlay is of that
 * kind (they are mutually exclusive, so at most one is ever active); Life is active
 * iff ambient animation is on. Pure — main passes (techPanel.isOpen(), the active
 * overlay's kind or null, the ambientOn flag).
 */
export function metaButtons(
  panelOpen: boolean,
  activeOverlay: { kind: 'eco' | 'civic' | 'redline' | 'police' | 'coverage' | 'power' } | null,
  ambientOn: boolean,
  open: { restore?: boolean; settings?: boolean; help?: boolean } = {},
): MetaButton[] {
  const b = (id: MetaButton['id'], active: boolean): MetaButton => ({ id, label: META_LABELS[id], art: `@ui/${id}`, active });
  return [
    b('tech', panelOpen),
    b('eco', activeOverlay?.kind === 'eco'),
    b('civic', activeOverlay?.kind === 'civic'),
    b('redline', activeOverlay?.kind === 'redline'),
    b('police', activeOverlay?.kind === 'police'),
    b('coverage', activeOverlay?.kind === 'coverage'),
    b('power', activeOverlay?.kind === 'power'),
    b('life', ambientOn),
    b('restore', open.restore ?? false),
    b('settings', open.settings ?? false),
    b('help', open.help ?? false),
  ];
}
