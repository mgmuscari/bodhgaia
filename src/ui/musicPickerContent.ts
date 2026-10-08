// The in-game music picker (PURE — pure-ui allowlist; Maddy 2026-10-08): the rows the Settings window lists —
// every piece by title and composer, when it plays in the time-of-day rotation, which is playing — and the control
// the sound system hands it. Picking a piece plays it now; when it ends the rotation carries on.

export interface PickerTrack {
  id: string;
  title: string;
  composer: string;
  moods: readonly string[];
  sacred?: boolean;
}

/** What the picker drives (the sound system's music player). */
export interface MusicControl {
  tracks: readonly PickerTrack[];
  current(): string | null;
  play(id: string): void;
  next(): void;
}

export interface PickerRow {
  id: string;
  label: string;
  /** When it plays in the rotation: 'day · night', 'calm'… */
  when: string;
  playing: boolean;
}

const label = (t: PickerTrack): string => `${t.title} — ${t.composer}`;

/** Every ensemble piece, in the manifest's order. The sacred recitations aren't offered (Maddy 2026-10-08) — they
 *  keep to their calm moments in the rotation. */
export function pickerRows(tracks: readonly PickerTrack[], current: string | null): PickerRow[] {
  return tracks
    .filter((t) => !t.sacred)
    .map((t) => ({ id: t.id, label: label(t), when: t.moods.join(' · '), playing: t.id === current }));
}

/** The line over the list. */
export function nowPlaying(tracks: readonly PickerTrack[], current: string | null): string {
  const t = current ? tracks.find((x) => x.id === current) : undefined;
  return t ? `Now playing: ${label(t)}` : 'Between pieces';
}
