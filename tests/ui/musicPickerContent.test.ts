// The in-game music picker (Maddy 2026-10-08): every piece, by title and composer, when it plays in the rotation,
// and which is playing now.
import { describe, it, expect } from 'vitest';
import { pickerRows, nowPlaying } from '../../src/ui/musicPickerContent';
import { MUSIC_TRACKS } from '../../src/audio/music/tracks';

describe('the music picker', () => {
  const rows = pickerRows(MUSIC_TRACKS, 'st-louis-blues');

  it('lists every ensemble piece, by title and composer, marking the one playing', () => {
    expect(rows).toHaveLength(MUSIC_TRACKS.filter((t) => !t.sacred).length);
    const st = rows.find((r) => r.id === 'st-louis-blues')!;
    expect(st.label).toBe('St. Louis Blues — W. C. Handy');
    expect(st.playing).toBe(true);
    expect(rows.filter((r) => r.playing)).toHaveLength(1);
  });

  it('says when each plays in the rotation', () => {
    expect(rows.find((r) => r.id === 'kyabdro-night')!.when).toBe('night');
    expect(rows.find((r) => r.id === 'satie-gymnopedie-1')!.when).toBe('day · night · calm');
  });

  it('does not offer the recitations (Maddy 2026-10-08)', () => {
    expect(rows.some((r) => r.id.startsWith('pali-'))).toBe(false);
  });

  it('names what is playing, or says it is quiet', () => {
    expect(nowPlaying(MUSIC_TRACKS, 'st-louis-blues')).toBe('Now playing: St. Louis Blues — W. C. Handy');
    expect(nowPlaying(MUSIC_TRACKS, null)).toBe('Between pieces');
  });
});
