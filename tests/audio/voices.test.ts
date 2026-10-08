import { describe, it, expect } from 'vitest';
import { VoicePool, MAX_VOICES } from '../../src/audio/synth/voices';

// The voice budget. The S-DSP had 8 voices; WebAudio can afford more, but not unboundedly (an ambience bed plus
// a busy MIDI file plus click cues would otherwise pile up). Over budget, the pool steals: a releasing voice
// first, else the quietest (oldest on a tie) — but never a voice louder than the newcomer; then it refuses.

describe('VoicePool', () => {
  it('has a sane default budget (more than the SNES 8, bounded)', () => {
    expect(MAX_VOICES).toBeGreaterThanOrEqual(16);
    expect(MAX_VOICES).toBeLessThanOrEqual(32);
  });

  it('admits freely under the cap, with unique ids', () => {
    const p = new VoicePool(3);
    const a = p.admit(0.5, 0, Infinity);
    const b = p.admit(0.5, 0, Infinity);
    expect(a?.steal).toBeNull();
    expect(b?.steal).toBeNull();
    expect(a!.id).not.toBe(b!.id);
    expect(p.size).toBe(2);
  });

  it('frees voices whose end time has passed (prune at admit)', () => {
    const p = new VoicePool(2);
    p.admit(0.5, 0, 1);
    p.admit(0.5, 0, 3);
    const c = p.admit(0.5, 2, Infinity);
    expect(c?.steal).toBeNull();
    expect(p.size).toBe(2);
  });

  it('over budget, steals a releasing voice before a sounding one', () => {
    const p = new VoicePool(2);
    const quiet = p.admit(0.1, 0, Infinity)!;
    const loud = p.admit(0.9, 1, Infinity)!;
    p.release(loud.id, 5);
    const c = p.admit(0.5, 2, Infinity);
    expect(c?.steal).toBe(loud.id);
    expect(p.has(quiet.id)).toBe(true);
    expect(p.has(loud.id)).toBe(false);
  });

  it('otherwise steals the quietest, oldest on a tie', () => {
    const p = new VoicePool(3);
    const a = p.admit(0.4, 0, Infinity)!;
    const b = p.admit(0.2, 1, Infinity)!;
    const c = p.admit(0.2, 2, Infinity)!;
    expect(p.admit(0.5, 3, Infinity)?.steal).toBe(b.id);
    expect(p.has(a.id) && p.has(c.id)).toBe(true);
  });

  it('refuses (null) rather than steal a voice louder than the newcomer', () => {
    const p = new VoicePool(2);
    p.admit(0.8, 0, Infinity);
    p.admit(0.9, 0, Infinity);
    expect(p.admit(0.3, 1, Infinity)).toBeNull();
    expect(p.size).toBe(2);
  });

  it('remove() frees a slot (a voice that ended on its own)', () => {
    const p = new VoicePool(1);
    const a = p.admit(0.9, 0, Infinity)!;
    p.remove(a.id);
    expect(p.admit(0.1, 0, Infinity)?.steal).toBeNull();
  });
});

describe('the shared pool gives way to the city (Maddy 2026-10-08: music must not crowd out birds or sirens)', () => {
  it('music never takes a voice from the soundscape or the effects — it gives way to them', () => {
    const p = new VoicePool(3);
    const siren = p.admit(0.2, 0, Infinity, 'ambience')!;
    const bird = p.admit(0.1, 0, 5, 'sfx')!;
    const m1 = p.admit(0.3, 0, 5, 'music')!;
    expect(siren && bird && m1).toBeTruthy();
    // a loud music note finds the pool full: it may not steal the siren or the bird, only music
    const m2 = p.admit(0.6, 1, 5, 'music');
    expect(m2?.steal).toBe(m1.id);
    expect(p.has(siren.id) && p.has(bird.id)).toBe(true);
  });

  it('a quiet bird call takes a music voice rather than go unheard', () => {
    const p = new VoicePool(2);
    const m1 = p.admit(0.5, 0, 5, 'music')!;
    p.admit(0.5, 0, 5, 'music');
    const bird = p.admit(0.08, 1, 2, 'sfx');
    expect(bird).not.toBeNull();
    expect([m1.id]).toContain(bird!.steal);
  });

  it('with no music to give way, the old rule holds: released first, then quieter', () => {
    const p = new VoicePool(1);
    p.admit(0.5, 0, 5, 'sfx');
    expect(p.admit(0.1, 1, 2, 'sfx')).toBeNull(); // a quieter effect doesn't cut a louder one
  });
});
