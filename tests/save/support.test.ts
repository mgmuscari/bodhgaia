import { describe, it, expect } from 'vitest';
import { checkSaveSupport, saveSupport, unavailableLine } from '../../src/save/support';
import { CURRENT, readSlot, writeSlot, deleteSlot, listSlots } from '../../src/save/store';
import type { SaveV1 } from '../../src/save/snapshot';

const fn = (): void => {};

describe('checkSaveSupport: the one feature check behind saving', () => {
  it('is ok when IndexedDB and both compression streams exist', () => {
    expect(checkSaveSupport({ indexedDB: {}, CompressionStream: fn, DecompressionStream: fn })).toEqual({ ok: true });
  });

  it('names exactly what is missing', () => {
    expect(checkSaveSupport({ CompressionStream: fn, DecompressionStream: fn })).toEqual({ ok: false, missing: ['IndexedDB'] });
    expect(checkSaveSupport({ indexedDB: {}, DecompressionStream: fn })).toEqual({ ok: false, missing: ['CompressionStream'] });
    expect(checkSaveSupport({})).toEqual({ ok: false, missing: ['IndexedDB', 'CompressionStream', 'DecompressionStream'] });
  });

  it('treats an accessor that throws (a sandboxed frame blocking storage) as missing', () => {
    const env = {
      get indexedDB(): unknown {
        throw new Error('SecurityError');
      },
      CompressionStream: fn,
      DecompressionStream: fn,
    };
    expect(checkSaveSupport(env)).toEqual({ ok: false, missing: ['IndexedDB'] });
  });

  it('saveSupport checks the real globals once and caches the answer', () => {
    const a = saveSupport();
    expect(saveSupport()).toBe(a); // same object: checked once
    expect(a.ok).toBe(false); // the node test env has no IndexedDB
  });

  it('unavailableLine is one plain line naming what is missing', () => {
    const line = unavailableLine({ ok: false, missing: ['IndexedDB'] });
    expect(line).toMatch(/IndexedDB/);
    expect(line).not.toMatch(/\n/);
    expect(line.length).toBeLessThanOrEqual(90);
  });
});

// The node env has no IndexedDB, so the browser store runs its unavailable path for real here.
describe('the store with no storage: the autosave slot is a silent sink, the rest refuse plainly', () => {
  const save = { name: 'x', savedAt: 1 } as unknown as SaveV1;

  it('reads the game in progress as empty (boot starts a fresh city, no warning)', async () => {
    await expect(readSlot(CURRENT)).resolves.toBeNull();
  });

  it('swallows autosave writes and new-city clears of CURRENT', async () => {
    await expect(writeSlot(CURRENT, save)).resolves.toBeUndefined();
    await expect(deleteSlot(CURRENT)).resolves.toBeUndefined();
  });

  it('lists no slots', async () => {
    await expect(listSlots()).resolves.toEqual([]);
  });

  it('refuses a named-slot write with the plain unavailable line', async () => {
    await expect(writeSlot('slot-1', save)).rejects.toThrow(/IndexedDB/);
  });
});
