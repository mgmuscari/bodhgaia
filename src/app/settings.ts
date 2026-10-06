// App shell: the settings controller — the persisted settings blob (loaded once at boot; defaults reproduce the
// 128² medium-preset game byte-for-byte) and the Settings window's callbacks. Live caps apply at once (the perf
// ceilings the agent layer reads); the world size persists for the next load (a different size is a different
// seeded world — apply-on-restart); the renderer switches at once. Every change clamps the merged blob so
// applied == persisted == shown (an input could be out of range), and re-persists the whole blob.

import { clampSettings, type LiveCaps, type RendererMode, type Settings } from '../ui/settings';
import { loadSettings, saveSettings } from '../ui/settingsStore';
import type { SettingsPanelCallbacks } from '../ui/settingsPanel';

export interface SettingsDeps {
  /** Where the blob persists (localStorage in the browser; undefined = the ambient store). */
  storage?: Storage;
  applyLive: (caps: LiveCaps) => void;
  setRenderer: (mode: RendererMode) => void;
}

export interface SettingsController {
  current(): Settings;
  /** The Settings window's callbacks (mountPanels' `settings`). */
  readonly panel: Omit<SettingsPanelCallbacks, 'onToggle'>;
}

export function createSettingsController(deps: SettingsDeps): SettingsController {
  let settings = loadSettings(deps.storage);
  const update = (next: Partial<Settings>): void => {
    settings = clampSettings({ ...settings, ...next });
    saveSettings(settings, deps.storage);
  };
  return {
    current: () => settings,
    panel: {
      getSettings: () => settings,
      onLiveChange: (caps) => {
        update({ live: { ...settings.live, ...caps } });
        deps.applyLive(settings.live);
      },
      onWorldChange: (world) => update({ world: { ...world } }), // takes effect on the next load (regenerate)
      onRendererChange: (mode) => {
        update({ renderer: mode });
        deps.setRenderer(mode);
      },
    },
  };
}
