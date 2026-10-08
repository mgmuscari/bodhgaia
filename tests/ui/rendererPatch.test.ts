import { describe, it, expect, vi } from 'vitest';
import { GameMap, Water } from '../../src/engine/map';
import { ParcelStore } from '../../src/engine/fabric';
import { Camera } from '../../src/ui/camera';
import { createAmbientState } from '../../src/live/types';

// P5b: the slow-cadence refresh of the live marks baked into the cached base (desire-path wear, junk, tents,
// murky water) patches ONLY the tiles whose baked mark changed — each under a clip to its own device rect — and
// reports those rects so the GPU re-uploads just them, instead of redrawing + re-uploading the whole base every
// 2 s. Pixel parity is the browser frame-diff; these pin the patch LOGIC behind a recording 2D context.

type Call = [string, ...unknown[]];
function makeFakeContext(log: Call[] | null): unknown {
  const rec = (name: string) => (...args: unknown[]) => void log?.push([name, ...args]);
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    imageSmoothingEnabled: true,
    setTransform: rec('setTransform'),
    fillRect: rec('fillRect'),
    drawImage: rec('drawImage'),
    beginPath: rec('beginPath'),
    rect: rec('rect'),
    clip: rec('clip'),
    moveTo() {},
    lineTo() {},
    stroke() {},
    save: rec('save'),
    restore: rec('restore'),
    clearRect: rec('clearRect'),
    createImageData(w: number, h: number) {
      return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    },
    putImageData() {},
  };
}

let nextLog: Call[] | null = null;
function makeFakeCanvas(): unknown {
  const ctx = makeFakeContext(nextLog);
  nextLog = null;
  return { width: 0, height: 0, style: {}, getContext: () => ctx };
}

vi.stubGlobal('document', {
  createElement(tag: string) {
    if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`);
    return makeFakeCanvas();
  },
});

const { Renderer } = await import('../../src/ui/renderer');
const { materializeSkin } = await import('../../src/ui/tilesetLoader');
const { paintSnesSkin } = await import('../../src/ui/snesTileset');
const SKIN = materializeSkin(paintSnesSkin());

function setup() {
  const map = new GameMap(16, 16);
  for (let x = 0; x < 16; x++) map.water[map.idx(x, 15)] = Water.Lake; // a lake along the bottom row
  const world = { map, parcels: new ParcelStore(), seed: 'patch', log: [] as string[] };
  const camera = new Camera({ mapWidth: 16, mapHeight: 16, viewportWidth: 320, viewportHeight: 240, zoom: 2 });
  const visible = makeFakeCanvas();
  const r = new Renderer(visible as never, SKIN);
  // the base canvas was the renderer's first createElement → re-point its context at a recording one
  const baseLog: Call[] = [];
  const base = r.baseCanvas() as unknown as { getContext: () => unknown };
  const recorded = makeFakeContext(baseLog);
  (r as unknown as { baseCtx: unknown }).baseCtx = recorded;
  void base;
  r.resize(320, 240, 1);
  const ambient = createAmbientState();
  return { r, world, camera, ambient, baseLog, map };
}

const tileOf = (map: GameMap, x: number, y: number): number => map.idx(x, y);

describe('renderer live-mark patches', () => {
  it('a refresh with nothing changed redraws nothing and keeps the base version', () => {
    const h = setup();
    h.ambient.wear.set(tileOf(h.map, 3, 3), 60);
    h.r.renderFrame(h.world as never, h.camera, h.ambient);
    const v = h.r.baseVersion();
    h.baseLog.length = 0;
    h.r.refreshLiveMarks();
    h.r.renderFrame(h.world as never, h.camera, h.ambient);
    expect(h.baseLog).toEqual([]);
    expect(h.r.baseVersion()).toBe(v);
  });

  it('a tile whose wear crosses a level is redrawn under a clip to its own rect, and reported for upload', () => {
    const h = setup();
    const t = tileOf(h.map, 3, 3);
    h.ambient.wear.set(t, 60);
    h.r.renderFrame(h.world as never, h.camera, h.ambient);
    const v = h.r.baseVersion();
    const p0 = h.r.basePatch().version;
    h.ambient.wear.set(t, 130); // level 1 → 2
    h.ambient.wear.set(tileOf(h.map, 5, 5), 20); // still level 0: no mark, no patch
    h.baseLog.length = 0;
    h.r.refreshLiveMarks();
    h.r.renderFrame(h.world as never, h.camera, h.ambient);
    expect(h.r.baseVersion()).toBe(v); // no full rebuild
    const ts = h.camera.tileSize;
    const o = h.camera.tileOrigin(3, 3);
    const clips = h.baseLog.filter((c) => c[0] === 'rect');
    expect(clips).toEqual([['rect', o.dx, o.dy, ts, ts]]);
    const patch = h.r.basePatch();
    expect(patch.version).not.toBe(p0);
    expect(patch.rects).toEqual([{ x: o.dx, y: o.dy, w: ts, h: ts }]);
    // and once baked, the next refresh is quiet again
    h.baseLog.length = 0;
    h.r.refreshLiveMarks();
    h.r.renderFrame(h.world as never, h.camera, h.ambient);
    expect(h.baseLog).toEqual([]);
    expect(h.r.basePatch().version).toBe(patch.version);
  });

  it('a mark that disappears (wear decayed away) is patched back to bare ground', () => {
    const h = setup();
    const t = tileOf(h.map, 4, 2);
    h.ambient.wear.set(t, 210);
    h.r.renderFrame(h.world as never, h.camera, h.ambient);
    h.ambient.wear.delete(t);
    h.r.refreshLiveMarks();
    h.r.renderFrame(h.world as never, h.camera, h.ambient);
    const o = h.camera.tileOrigin(4, 2);
    expect(h.r.basePatch().rects).toEqual([{ x: o.dx, y: o.dy, w: h.camera.tileSize, h: h.camera.tileSize }]);
  });

  it('murk that shifts through a neighbour (the 3×3 average) is patched, even when no tile changes level', () => {
    const h = setup();
    // a camera at y = 8 shows rows 8..15 at zoom 2 (240 / 32) — the lake is in view
    const cam = new Camera({ mapWidth: 16, mapHeight: 16, viewportWidth: 320, viewportHeight: 240, zoom: 2, x: 0, y: 8 });
    h.ambient.waterPollution.set(tileOf(h.map, 6, 15), 120); // level 2 on its own; its 3×3 water average is lower
    h.r.renderFrame(h.world as never, cam, h.ambient);
    const v = h.r.baseVersion();
    h.ambient.waterPollution.set(tileOf(h.map, 7, 15), 95); // a new entry → the murk signature moves → full
    h.r.refreshLiveMarks();
    h.r.renderFrame(h.world as never, cam, h.ambient);
    expect(h.r.baseVersion()).toBe(v + 1);
    // the same per-entry levels, different averages ((6,15) and (7,15) cross 90): only a patch can catch it
    const v2 = h.r.baseVersion();
    h.ambient.waterPollution.set(tileOf(h.map, 7, 15), 160); // still level 2
    h.r.refreshLiveMarks();
    h.r.renderFrame(h.world as never, cam, h.ambient);
    expect(h.r.baseVersion()).toBe(v2);
    const o6 = cam.tileOrigin(6, 15);
    const o7 = cam.tileOrigin(7, 15);
    const h15 = 240 - o6.dy; // the bottom row is cut by the canvas edge: the patch rect is clamped to it
    expect(h15).toBeLessThan(cam.tileSize);
    const rects = h.r.basePatch().rects;
    expect(rects).toEqual(expect.arrayContaining([
      { x: o6.dx, y: o6.dy, w: cam.tileSize, h: h15 },
      { x: o7.dx, y: o7.dy, w: cam.tileSize, h: h15 },
    ]));
    // and their neighbours, whose edges blend toward them (murkEdge) — nothing else
    const near = new Set<string>();
    for (const [x, y] of [[6, 15], [7, 15]] as const) for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, -1]] as const) {
      const o = cam.tileOrigin(x + dx, y + dy);
      near.add(`${o.dx},${o.dy}`);
    }
    for (const r of rects) expect(near.has(`${r.x},${r.y}`), `${r.x},${r.y}`).toBe(true);
  });

  it('with a base overlay up (it may read live fields) the refresh is a full rebuild, as before', () => {
    const h = setup();
    h.r.setOverlay({ tint: () => [10, 20, 30, 0.5] });
    h.r.renderFrame(h.world as never, h.camera, h.ambient);
    const v = h.r.baseVersion();
    h.r.refreshLiveMarks();
    h.r.renderFrame(h.world as never, h.camera, h.ambient);
    expect(h.r.baseVersion()).toBe(v + 1);
  });

  it('a wide change falls back to one full rebuild', () => {
    const h = setup();
    h.r.renderFrame(h.world as never, h.camera, h.ambient);
    const v = h.r.baseVersion();
    for (let y = 0; y < 7; y++) for (let x = 0; x < 10; x++) h.ambient.wear.set(tileOf(h.map, x, y), 80);
    h.r.refreshLiveMarks();
    h.r.renderFrame(h.world as never, h.camera, h.ambient);
    expect(h.r.baseVersion()).toBe(v + 1);
  });
});
