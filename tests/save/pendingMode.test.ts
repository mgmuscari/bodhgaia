// New city's choice (Maddy 2026-10-21 "Sandbox + difficulty"): the Saves window's New city picks a difficulty and
// sandbox, then reloads; the choice waits in storage for the boot to take — once.
import { describe, it, expect } from 'vitest';
import { setPendingMode, takePendingMode } from '../../src/save/pendingMode';
import { STANDARD_MODE } from '../../src/engine/mode';

function mem(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
}

describe('the pending new-city mode', () => {
  it('is taken once at boot, then gone', () => {
    const s = mem();
    setPendingMode({ difficulty: 'hard', sandbox: true }, s);
    expect(takePendingMode(s)).toEqual({ difficulty: 'hard', sandbox: true });
    expect(takePendingMode(s)).toBeUndefined();
  });
  it('nothing chosen (a first launch): undefined, so the city is standard', () => {
    expect(takePendingMode(mem())).toBeUndefined();
    expect(STANDARD_MODE.difficulty).toBe('standard');
  });
  it('blocked or corrupt storage never throws', () => {
    const bad = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); }, removeItem: () => {} } as unknown as Storage;
    expect(() => setPendingMode(STANDARD_MODE, bad)).not.toThrow();
    expect(takePendingMode(bad)).toBeUndefined();
    const s = mem();
    s.setItem('bodhgaia.newCityMode', '{oops');
    expect(takePendingMode(s)).toBeUndefined();
  });
});
