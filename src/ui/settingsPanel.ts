// Settings panel: the interactive DOM shell (toggled by the ',' key). Like techPanel/restorationPanel
// it owns DOM only — all data + clamping live in the pure settings.ts (presets, bounds), so there is
// no logic here worth unit-testing. Two setting classes, mirroring the determinism split:
//   • Performance (live caps) — applied INSTANTLY via onLiveChange (no regen);
//   • World (map size) — persisted via onWorldChange and applied on the NEXT load (regenerate), behind
//     an explicit confirm because reloading discards the in-progress city (there is no save).
//   • Audio (master / music / effects / ambience + mute) — applied INSTANTLY via onAudioChange while dragging.

import { soundStartNote } from './controlsContent';
import { touchScreen } from './touch';
import {
  type AudioSettings,
  CAP_PRESETS,
  MAP_SIZES,
  type LiveCaps,
  type MapSizeKey,
  type PresetTier,
  type RendererMode,
  type Settings,
  type WorldSettings,
} from './settings';
import { panelVisibility, type PanelHandle } from './panelHandle';
import { nowPlaying, pickerRows, type MusicControl } from './musicPickerContent';

export interface SettingsPanelCallbacks {
  /** The current (already-clamped) settings, read fresh each time the panel opens. */
  getSettings(): Settings;
  /** A live-cap change to apply IMMEDIATELY (and persist). No world regen. */
  onLiveChange(live: LiveCaps): void;
  /** A world-setting change to persist; it takes effect on the next world load (regenerate). */
  onWorldChange(world: WorldSettings): void;
  /** A render-path change (cpu ⇄ gpu) to apply IMMEDIATELY (mount/unmount the WebGL layer) and persist. */
  onRendererChange(renderer: RendererMode): void;
  /** A sound-level change to apply IMMEDIATELY (engine buses) and persist. */
  onAudioChange(audio: AudioSettings): void;
  /** Disasters on/off (takes effect at once: nothing new starts). */
  onDisastersChange(on: boolean): void;
  /** The music player, for the picker (null until the sound system is up). */
  music?(): MusicControl | null;
  /** Fired on every open/close, so the dock's button can follow. */
  onToggle?(open: boolean): void;
}

const PRESET_TIERS: PresetTier[] = ['low', 'medium', 'high'];
const MAP_KEYS: MapSizeKey[] = ['small', 'medium', 'large', 'huge'];

/** Which cap preset (if any) the live caps currently equal — drives the active-button highlight. */
function activeTier(live: LiveCaps): PresetTier | null {
  return PRESET_TIERS.find((t) => keysEqual(CAP_PRESETS[t], live)) ?? null;
}
function keysEqual(a: LiveCaps, b: LiveCaps): boolean {
  return (Object.keys(a) as (keyof LiveCaps)[]).every((k) => a[k] === b[k]);
}
/** The map-size key for a square width, or null when it's a custom/non-preset size. */
function mapKeyFor(width: number): MapSizeKey | null {
  return MAP_KEYS.find((k) => MAP_SIZES[k] === width) ?? null;
}

/** Build and mount the (hidden) settings panel. */
export function mountSettingsPanel(
  container: HTMLElement,
  cb: SettingsPanelCallbacks,
): PanelHandle {
  const panel = document.createElement('div');
  panel.className = 'settings-panel';
  // four sections no longer fit a short viewport centred — scroll inside the frame rather than off-screen
  panel.style.maxHeight = 'calc(100vh - var(--topbar-h) - var(--status-h) - 1rem)'; // inside the chrome
  panel.style.boxSizing = 'border-box'; // the cap includes the frame and padding
  panel.style.overflowY = 'auto';

  // Rebuilt from the current settings each open, so the controls always reflect live state.
  const render = (): void => {
    const s = cb.getSettings();
    panel.replaceChildren();

    const close = document.createElement('div');
    close.className = 'settings-panel__close';
    close.textContent = '✕';
    close.title = 'Close (,)';
    close.addEventListener('click', () => handle.close());
    panel.appendChild(close);

    const title = document.createElement('div');
    title.className = 'settings-panel__title';
    title.textContent = 'Settings';
    panel.appendChild(title);

    panel.appendChild(performanceSection(s));
    panel.appendChild(worldSection(s));
    panel.appendChild(rendererSection(s));
    panel.appendChild(audioSection(s));
    panel.appendChild(musicSection());
    panel.appendChild(disastersSection(s));
  };

  // — Audio (levels + mute, instant) —
  const LEVELS: [string, 'master' | 'music' | 'effects' | 'ambience'][] = [
    ['Master', 'master'],
    ['Music', 'music'],
    ['Effects', 'effects'],
    ['Ambience', 'ambience'],
  ];
  const audioSection = (s: Settings): HTMLElement => {
    const sec = section('Sound — applies instantly');
    for (const [label, key] of LEVELS) {
      const r = row(label);
      const wrap = document.createElement('span');
      wrap.style.display = 'flex';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '0.4rem';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.step = '1';
      slider.value = String(Math.round(s.audio[key] * 100));
      // a range track, not a framed field: drop the button frame the other inputs wear
      slider.style.border = 'none';
      slider.style.borderImage = 'none';
      slider.style.padding = '0';
      slider.style.width = '8rem';
      slider.style.accentColor = 'var(--ui-accent)';
      const pct = document.createElement('span');
      pct.style.minWidth = '2.6rem';
      pct.style.textAlign = 'right';
      pct.textContent = `${slider.value}%`;
      slider.addEventListener('input', () => {
        pct.textContent = `${slider.value}%`;
        cb.onAudioChange({ ...cb.getSettings().audio, [key]: Number(slider.value) / 100 });
      });
      wrap.append(slider, pct);
      r.appendChild(wrap);
      sec.appendChild(r);
    }
    const r = row('Mute all');
    const mute = document.createElement('input');
    mute.type = 'checkbox';
    mute.checked = s.audio.muted;
    mute.style.border = 'none';
    mute.style.borderImage = 'none';
    mute.style.width = '1.1rem';
    mute.style.height = '1.1rem';
    mute.style.accentColor = 'var(--ui-accent)';
    mute.addEventListener('change', () => cb.onAudioChange({ ...cb.getSettings().audio, muted: mute.checked }));
    r.appendChild(mute);
    sec.appendChild(r);
    const note = document.createElement('div');
    note.className = 'settings-panel__note';
    note.textContent = soundStartNote(touchScreen());
    sec.appendChild(note);
    return sec;
  };

  // — Music: what's playing, Next, and every piece to pick from (it plays now; the rotation carries on after) —
  const musicSection = (): HTMLElement => {
    const sec = section('Music');
    const control = cb.music?.() ?? null;
    if (!control) {
      sec.appendChild(row('Music starts with your first click'));
      return sec;
    }
    const current = control.current();
    const head = row(nowPlaying(control.tracks, current));
    const next = document.createElement('button');
    next.className = 'settings-panel__btn';
    next.textContent = 'Next';
    next.addEventListener('click', () => {
      control.next();
      setTimeout(render, 400); // the next piece loads, then the panel shows it
    });
    head.appendChild(next);
    sec.appendChild(head);
    // a scrolling list of pieces (Maddy: a list, not buttons) — click a row, or Tab to it and press Enter
    const list = document.createElement('ul');
    list.className = 'settings-panel__tracks';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Music');
    let playingRow: HTMLElement | null = null;
    for (const r of pickerRows(control.tracks, current)) {
      const li = document.createElement('li');
      li.className = 'settings-panel__track' + (r.playing ? ' settings-panel__track--playing' : '');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(r.playing));
      li.tabIndex = 0;
      li.title = `Plays at: ${r.when}`;
      const name = document.createElement('span');
      name.textContent = (r.playing ? '♪ ' : '') + r.label;
      const when = document.createElement('span');
      when.className = 'settings-panel__track-when';
      when.textContent = r.when;
      li.append(name, when);
      const pick = (): void => {
        control.play(r.id);
        setTimeout(render, 400);
      };
      li.addEventListener('click', pick);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation(); // the game's keys stay out of it
          pick();
        }
      });
      if (r.playing) playingRow = li;
      list.appendChild(li);
    }
    sec.appendChild(list);
    // keep the playing piece in view
    if (playingRow) requestAnimationFrame(() => playingRow?.scrollIntoView({ block: 'nearest' }));
    return sec;
  };

  // — Disasters on/off, instant —
  const disastersSection = (s: Settings): HTMLElement => {
    const sec = section('Disasters');
    const r = row('Fires, spills, floods…');
    const on = document.createElement('input');
    on.type = 'checkbox';
    on.checked = s.disasters;
    on.style.border = 'none';
    on.style.borderImage = 'none';
    on.style.width = '1.1rem';
    on.style.height = '1.1rem';
    on.style.accentColor = 'var(--ui-accent)';
    on.addEventListener('change', () => cb.onDisastersChange(on.checked));
    r.appendChild(on);
    sec.appendChild(r);
    return sec;
  };

  // — Renderer (GPU hybrid shader ⇄ CPU), instant —
  const webgl2 = (): boolean => {
    try {
      return document.createElement('canvas').getContext('webgl2') !== null;
    } catch {
      return false;
    }
  };
  const rendererSection = (s: Settings): HTMLElement => {
    const sec = section('Renderer — applies instantly');
    const r = row('Mode');
    const select = document.createElement('select');
    const has = webgl2();
    for (const [val, label] of [['gpu', 'GPU shader (WebGL2)'], ['cpu', 'CPU (Canvas2D)']] as const) {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = label + (val === 'gpu' && !has ? ' — unavailable' : '');
      o.selected = s.renderer === val;
      if (val === 'gpu' && !has) o.disabled = true;
      select.appendChild(o);
    }
    select.addEventListener('change', () => cb.onRendererChange(select.value as RendererMode));
    r.appendChild(select);
    sec.appendChild(r);
    const note = document.createElement('div');
    note.className = 'settings-panel__note';
    note.textContent = has
      ? 'GPU lights the pixel art: day/night, soft building shadows and headlight glow. CPU is the fallback.'
      : 'WebGL2 unavailable in this browser — using the CPU renderer.';
    sec.appendChild(note);
    return sec;
  };

  // — Performance (live caps, instant) —
  const performanceSection = (s: Settings): HTMLElement => {
    const sec = section('Performance — applies instantly');
    const active = activeTier(s.live);

    const presetRow = row('Preset');
    for (const tier of PRESET_TIERS) {
      const b = document.createElement('button');
      b.textContent = tier[0]!.toUpperCase() + tier.slice(1);
      if (tier === active) b.classList.add('is-active');
      b.addEventListener('click', () => {
        cb.onLiveChange({ ...CAP_PRESETS[tier] });
        render();
      });
      presetRow.appendChild(b);
    }
    sec.appendChild(presetRow);

    // Two most-impactful caps as direct inputs (the rest follow the preset).
    sec.appendChild(capInput('Pedestrians', 'pedCap', s.live));
    sec.appendChild(capInput('Cars', 'carCap', s.live));

    const note = document.createElement('div');
    note.className = 'settings-panel__note';
    note.textContent = 'Higher = busier streets, heavier on slow machines. Low/Med/High set sensible bundles.';
    sec.appendChild(note);
    return sec;
  };

  const capInput = (label: string, key: 'pedCap' | 'carCap', live: LiveCaps): HTMLElement => {
    const r = row(label);
    const input = document.createElement('input');
    input.type = 'number';
    input.value = String(live[key]);
    input.style.width = '5rem';
    const commit = (): void => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      cb.onLiveChange({ ...cb.getSettings().live, [key]: v });
      render(); // re-clamp + refresh the active-preset highlight
    };
    input.addEventListener('change', commit);
    r.appendChild(input);
    return r;
  };

  // — World (map size, regenerate on next load) —
  const worldSection = (s: Settings): HTMLElement => {
    const sec = section('World — new game');
    const r = row('Map size');
    const select = document.createElement('select');
    for (const k of MAP_KEYS) {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = `${k[0]!.toUpperCase() + k.slice(1)} (${MAP_SIZES[k]}²)`;
      if (mapKeyFor(s.world.mapWidth) === k) o.selected = true;
      select.appendChild(o);
    }
    r.appendChild(select);
    sec.appendChild(r);

    const apply = document.createElement('button');
    apply.textContent = 'Apply & regenerate';
    apply.addEventListener('click', () => {
      const k = select.value as MapSizeKey;
      const size = MAP_SIZES[k];
      cb.onWorldChange({ mapWidth: size, mapHeight: size });
      // Reload discards the in-progress city (no save) — make that explicit.
      if (window.confirm('Generate a new world at this size? The current city will be lost.')) {
        window.location.reload();
      }
    });
    const applyRow = row('');
    applyRow.appendChild(apply);
    sec.appendChild(applyRow);

    const note = document.createElement('div');
    note.className = 'settings-panel__note';
    note.textContent = 'A new size is a different (still seeded) world — it regenerates on apply.';
    sec.appendChild(note);
    return sec;
  };

  const section = (heading: string): HTMLElement => {
    const sec = document.createElement('div');
    sec.className = 'settings-panel__section';
    const h = document.createElement('div');
    h.className = 'settings-panel__heading';
    h.textContent = heading;
    sec.appendChild(h);
    return sec;
  };
  const row = (label: string): HTMLElement => {
    const r = document.createElement('div');
    r.className = 'settings-panel__row';
    const l = document.createElement('span');
    l.textContent = label;
    r.appendChild(l);
    return r;
  };

  container.appendChild(panel);

  // Rebuilt from the current settings on each open (and on refresh while open).
  const handle = panelVisibility(panel, { render, onToggle: cb.onToggle });
  return handle;
}
