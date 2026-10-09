// Dock meta content: the pure view-model for the dock's [Tech][Eco][Civic] meta
// buttons — the keyboard-only depth (T/E/C) surfaced as always-visible controls.
// No DOM, no transcendental Math (the architecture guard's pure-ui allowlist scans
// this file). Keeping the active-state derivation here, not in the toolbar shell,
// lets it be unit-tested rather than left to manual QA — and gives main ONE pure
// source of truth that the dock and the keyboard paths both feed.

import { OVERLAY_KINDS, type OverlayKind } from './overlayRegistry';

/** One dock meta button: which control it is, its label, and whether it's active. */
export interface MetaButton {
  id: 'budget' | 'tech' | OverlayKind | 'life' | 'restore' | 'saves' | 'settings' | 'help';
  label: string;
  /** The pixel icon drawn as the button face (uiIcons.ts); the label becomes its tooltip. */
  art: string;
  active: boolean;
}

/** Fixed labels — the bracketed key echoes the hotkey the button mirrors. */
const META_LABELS: Record<MetaButton['id'], string> = {
  budget: 'Budget (B)',
  tech: 'Tech (T)',
  eco: 'Eco (E)',
  civic: 'Civic (C)',
  redline: 'Redline (R)',
  police: 'Police (P)',
  coverage: 'Coverage (V)',
  power: 'Power (U)',
  life: 'Life (L)',
  restore: 'Restoration (G)',
  saves: 'Saves (S)',
  settings: 'Settings (,)',
  help: 'Help (?)',
};

/**
 * The dock meta buttons in fixed order (budget, tech, the overlays in OVERLAY_KINDS
 * order, life, restore, saves, settings, help), with their active flags derived from
 * the live UI state: Tech is active iff the tech panel is open; an overlay button is
 * active iff the single composite overlay is of that kind (mutually exclusive, so at
 * most one is ever active); Life is active
 * iff ambient animation is on. Pure — main passes (techPanel.isOpen(), the active
 * overlay's kind or null, the ambientOn flag).
 */
export function metaButtons(
  panelOpen: boolean,
  activeOverlay: { kind: OverlayKind } | null,
  ambientOn: boolean,
  open: { restore?: boolean; settings?: boolean; help?: boolean; budget?: boolean; saves?: boolean } = {},
  /** Show each button's hotkey in its label; false on a touch screen, which has no keys (Maddy 2026-10-08). */
  keys = true,
): MetaButton[] {
  const label = (id: MetaButton['id']): string => (keys ? META_LABELS[id] : META_LABELS[id].replace(/ \([^)]{1,3}\)$/, ''));
  const b = (id: MetaButton['id'], active: boolean): MetaButton => ({ id, label: label(id), art: `@ui/${id}`, active });
  return [
    b('budget', open.budget ?? false),
    b('tech', panelOpen),
    ...OVERLAY_KINDS.map((kind) => b(kind, activeOverlay?.kind === kind)),
    b('life', ambientOn),
    b('restore', open.restore ?? false),
    b('saves', open.saves ?? false),
    b('settings', open.settings ?? false),
    b('help', open.help ?? false),
  ];
}
