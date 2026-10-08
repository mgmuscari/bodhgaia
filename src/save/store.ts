// The browser half of save/load (the format is save/snapshot.ts, pure): named slots in IndexedDB, gzipped,
// plus a `.bodhi` file to export and import (Maddy 2026-10-02: browser slots + a file you own). One slot is
// special — CURRENT, the game in progress: autosave writes it, boot resumes from it, and loading any other slot
// copies that slot into CURRENT and reloads the page (one restore path, the boot path). "New city" clears it.
//
// A browser that can't save (save/support.ts) gets no storage at all, and says so plainly: CURRENT becomes a
// silent sink (it reads empty, writes and clears succeed doing nothing — autosave and boot just carry on),
// every slot list is empty, and any other write throws the one-line reason. The Saves window disables its
// Save / Import / Export buttons on the same check.

import { parseSave, type SaveV1 } from './snapshot';
import { saveSupport, unavailableLine } from './support';

// The game was Bodhitropolis until 2026-10-07; the database keeps that name so saved cities survive the rename.
const DB_NAME = 'bodhitropolis';
const STORE = 'saves';
/** The slot the running game autosaves into and boot resumes from. */
export const CURRENT = 'current';

export interface SlotInfo {
  id: string;
  name: string;
  savedAt: number;
  bytes: number;
}

interface SlotRecord extends SlotInfo {
  data: Uint8Array; // gzipped JSON
}

/** True when saving can't work here; throws the plain reason for anything but the CURRENT sink. */
function noStorage(id?: string): boolean {
  const s = saveSupport();
  if (s.ok) return false;
  if (id !== undefined && id !== CURRENT) throw new Error(unavailableLine(s));
  return true;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
const gzip = (text: string): Promise<Uint8Array> => pipe(new TextEncoder().encode(text), new CompressionStream('gzip'));
/** gzip or plain JSON (an exported file may have been unzipped by hand). */
async function gunzip(bytes: Uint8Array): Promise<string> {
  const zipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
  return new TextDecoder().decode(zipped ? await pipe(bytes, new DecompressionStream('gzip')) : bytes);
}

/** Write a save into a slot. */
export async function writeSlot(id: string, save: SaveV1): Promise<void> {
  if (noStorage(id)) return;
  const data = await gzip(JSON.stringify(save));
  const rec: SlotRecord = { id, name: save.name, savedAt: save.savedAt, bytes: data.byteLength, data };
  await tx('readwrite', (s) => s.put(rec));
}

/** Read a slot (null if empty); throws if it isn't a save this build can read. */
export async function readSlot(id: string): Promise<SaveV1 | null> {
  if (noStorage(id)) return null;
  const rec = (await tx('readonly', (s) => s.get(id))) as SlotRecord | undefined;
  return rec ? parseSave(await gunzip(rec.data)) : null;
}

export async function deleteSlot(id: string): Promise<void> {
  if (noStorage(id)) return;
  await tx('readwrite', (s) => s.delete(id));
}

/** Every slot but CURRENT, newest first. */
export async function listSlots(): Promise<SlotInfo[]> {
  if (noStorage()) return [];
  const recs = (await tx('readonly', (s) => s.getAll())) as SlotRecord[];
  return recs
    .filter((r) => r.id !== CURRENT)
    .map(({ id, name, savedAt, bytes }) => ({ id, name, savedAt, bytes }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

/** Make a slot the game in progress and reload into it. */
export async function loadSlot(id: string): Promise<void> {
  const save = await readSlot(id);
  if (!save) throw new Error('that save is empty');
  await writeSlot(CURRENT, save);
  window.location.reload();
}

/** Start a fresh city: forget the game in progress and reload. */
export async function newCity(): Promise<void> {
  await deleteSlot(CURRENT);
  window.location.reload();
}

/** Download a save as a `.bodhi` file (gzipped JSON). */
export async function exportFile(save: SaveV1): Promise<void> {
  const data = await gzip(JSON.stringify(save));
  const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/gzip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${save.name.replace(/[^\w-]+/g, '-').toLowerCase()}-${new Date(save.savedAt).toISOString().slice(0, 10)}.bodhi`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read a `.bodhi` (or plain JSON) file into a save; throws if it isn't one this build can read. */
export async function importFile(file: File): Promise<SaveV1> {
  return parseSave(await gunzip(new Uint8Array(await file.arrayBuffer())));
}
