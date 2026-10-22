// Input handling: pointer → pan / tool-apply, wheel → zoom-at-cursor, arrows →
// pan, hotkeys for tools. A thin DOM shell: it reads pointer events, calls the
// pure geometry (classifyPointer / lineTiles) and Camera, and dispatches to the
// host's tool hooks — it holds NO geometry of its own. All the determinism-
// sensitive logic lives in src/tools/inputGeometry.ts (tested) and the engine.
//
// Pan-vs-tool precedence (resolves the "drag still pans" vs "transport drag
// paints" tension): with no tool — or a non-line tool — selected, a drag PANS and
// a click applies at the tile; with a LINE tool (transport build / convert, bulldoze)
// selected, a drag PAINTS lineTiles (pan suppressed) and a click applies one tile.
// To pan with a line tool held, use WASD / the arrows, hold the middle button, or drop the tool (Escape, a right
// click, a long press on a touch screen).
//
// On a touch screen (Maddy 2026-10-21: building collided with scrolling) one finger with a build tool never pans: a
// line tool draws, anything else AIMS — its ghost follows the finger — and builds where the finger lifts. Two fingers
// always scroll and pinch. With no tool, or Inspect (passive), one finger pans as with the mouse.

import { Camera } from './camera';
import { easePan, isEditableTarget, panFor, panVelocity } from './keyMap';
import { classifyPointer, lineTiles, pinchZoom, wheelZoom } from '../tools/inputGeometry';

/** A wheel pause longer than this starts a fresh zoom gesture. */
const WHEEL_IDLE_MS = 250;
const MIDDLE_BUTTON = 1;
const RIGHT_BUTTON = 2;
/** A finger held this long without moving drops the tool — a touch screen's right click (Maddy 2026-10-13). */
const LONG_PRESS_MS = 500;

export interface InputHandlers {
  /** Mark the view dirty after a pan/zoom. */
  onChange(): void;
  /** True iff a tool is currently selected (so clicks apply / hovers preview). */
  hasTool(): boolean;
  /** True iff the selected tool paints transport lines (drag paints, pan suppressed). */
  isLineTool(): boolean;
  /** True iff the selected tool only looks (Inspect): one finger still pans with it on a touch screen. */
  isPassiveTool?(): boolean;
  /** Preview a line-tool drag's tiles as it is drawn. */
  previewLine?(tiles: readonly { x: number; y: number }[]): void;
  /** Apply the selected tool at world tile (tx, ty). */
  applyAt(tx: number, ty: number): void;
  /** Preview the selected tool at the hovered world tile. */
  hover(tx: number, ty: number): void;
  /** Clear any hover preview (pointer left the canvas / tool deselected). */
  clearHover(): void;
  /** A tool hotkey was pressed (i = inspect, x = bulldoze, Escape = deselect). */
  onHotkey(action: 'inspect' | 'bulldoze' | 'deselect'): void;
}

export function attachInput(canvas: HTMLCanvasElement, camera: Camera, handlers: InputHandlers): void {
  let dragging = false;
  let suppressPan = false; // true during a line-tool drag (paint, don't pan) — or a touch aim
  let aiming = false; // a touch drag with a placing tool: the ghost follows the finger, it builds where it lifts
  // The whole captured drag/click path is sourced from clientX/clientY, NOT
  // offsetX/offsetY: at pointerup the event is DISPATCHED while the pointer is
  // still captured (releasePointerCapture runs after, in-handler), and WebKit's
  // offset-under-capture behavior is the exact untested Safari risk — a mis-read
  // there would place a parcel on the WRONG tile, not just mis-pan. clientX/Y are
  // populated regardless of capture; classification needs only a delta (origin
  // cancels) and tile resolution converts client→canvas via getBoundingClientRect.
  // offsetX/Y survive only in the non-captured paths — the hover branch of
  // pointermove and the wheel handler — neither of which runs under pointer
  // capture, so offset is reliable there. downClientX/Y is the press anchor;
  // lastClientX/Y is the running pan reference.
  let downClientX = 0;
  let downClientY = 0;
  let lastClientX = 0;
  let lastClientY = 0;
  let hoverX = Number.NaN;
  let hoverY = Number.NaN;

  // Touch (Maddy 2026-10-08, mobile): the browser leaves touches on the map to the game — no page zoom or scroll —
  // and two fingers pinch the map's own zoom (whole levels, like the wheel) round the point between them, panning as
  // they move together. Once a second finger lands, the gesture is a pinch until every finger lifts: no tool applies
  // and a lone remaining finger doesn't pan.
  if (canvas.style) canvas.style.touchAction = 'none';
  const touches = new Map<number, { x: number; y: number }>();
  let pinching = false;
  let pinchBase = 0;
  let pinchMidX = 0;
  let pinchMidY = 0;
  const pinchNow = (): { spread: number; mx: number; my: number } => {
    const [a, b] = [...touches.values()];
    return { spread: Math.hypot(b!.x - a!.x, b!.y - a!.y), mx: (a!.x + b!.x) / 2, my: (a!.y + b!.y) / 2 };
  };

  const tileUnder = (sx: number, sy: number): { tx: number; ty: number } => {
    const { wx, wy } = camera.screenToWorld(sx, sy);
    return { tx: Math.floor(wx), ty: Math.floor(wy) };
  };

  // A right click drops the tool (Maddy 2026-10-13) — never the browser's menu over the map.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  let longPress: ReturnType<typeof setTimeout> | null = null;
  const cancelLongPress = (): void => {
    if (longPress !== null) clearTimeout(longPress);
    longPress = null;
  };
  const dropTool = (): void => {
    cancelLongPress();
    dragging = false; // the press that dropped the tool applies nothing when it lifts
    suppressPan = false;
    aiming = false;
    hoverX = Number.NaN;
    hoverY = Number.NaN;
    handlers.clearHover();
    handlers.onHotkey('deselect');
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === RIGHT_BUTTON) {
      dropTool();
      return;
    }
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cancelLongPress();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* best-effort */
    }
    if (touches.size >= 2) {
      // a second finger: the gesture is a pinch — whatever the first finger began (a tool, a pan) is dropped
      pinching = true;
      dragging = false;
      suppressPan = false;
      aiming = false;
      const p = pinchNow();
      pinchBase = p.spread;
      pinchMidX = p.mx;
      pinchMidY = p.my;
      handlers.clearHover();
      return;
    }
    if (pinching) return;
    dragging = true;
    // Anchor both the press point (for click/drag classification + the line-tool
    // start tile) and the pan reference in client space — pointerdown is pre-capture
    // here, but keeping the pair client-relative makes classification compare like
    // with like against the (captured) pointerup point.
    downClientX = e.clientX;
    downClientY = e.clientY;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    // a finger held still drops the tool (a touch screen has no right click)
    if (e.pointerType === 'touch' && handlers.hasTool()) longPress = setTimeout(dropTool, LONG_PRESS_MS);
    // A line tool paints on drag (pan suppressed); the middle button always pans.
    suppressPan = handlers.isLineTool() && e.button !== MIDDLE_BUTTON;
    aiming = e.pointerType === 'touch' && handlers.hasTool() && !handlers.isLineTool() && !(handlers.isPassiveTool?.() ?? false);
    if (aiming) {
      suppressPan = true;
      const rect = canvas.getBoundingClientRect();
      const t = tileUnder(e.clientX - rect.left, e.clientY - rect.top);
      hoverX = t.tx;
      hoverY = t.ty;
      handlers.hover(t.tx, t.ty); // the ghost shows where the finger is, before it moves
    }
    // Pointer capture can throw (e.g. an invalid/stale pointerId in some browsers);
    // a failed capture must not abort the drag — pan still works off clientX/Y.
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort; the drag proceeds regardless */
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    cancelLongPress();
    touches.delete(e.pointerId);
    if (pinching) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* best-effort */
      }
      if (touches.size === 0) pinching = false;
      return;
    }
    if (!dragging) return;
    dragging = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* release is best-effort (capture may never have been granted) */
    }

    if (handlers.hasTool()) {
      // Classify from raw client deltas (origin-invariant, so capture can't skew it)
      // and resolve tiles from client→canvas coordinates via the bounding rect —
      // NOT offsetX/offsetY, which is unreliable while the pointer is still captured
      // at pointerup dispatch (the WebKit wrong-tile risk).
      const kind = classifyPointer(downClientX, downClientY, e.clientX, e.clientY);
      const rect = canvas.getBoundingClientRect();
      const end = tileUnder(e.clientX - rect.left, e.clientY - rect.top);
      if (kind === 'click' || aiming) {
        handlers.applyAt(end.tx, end.ty); // a touch aim builds where the finger lifts
      } else if (suppressPan) {
        // Line-tool drag: paint every tile from the down tile to the up tile.
        const start = tileUnder(downClientX - rect.left, downClientY - rect.top);
        for (const t of lineTiles(start.tx, start.ty, end.tx, end.ty)) handlers.applyAt(t.x, t.y);
      }
      // A non-line tool drag was a pan (handled live in pointermove); nothing to apply.
    }
    suppressPan = false;
    aiming = false;
  });

  // Safety net: a window-level release clears the drag even if the canvas pointerup is missed (capture
  // not granted + released off-canvas). Fires AFTER the canvas handler for captured pointers, so it's a
  // no-op in the normal case and never applies a tool on its own.
  const endDrag = (e: PointerEvent): void => {
    cancelLongPress();
    dragging = false;
    suppressPan = false;
    aiming = false;
    touches.delete(e.pointerId); // a finger lifted off the canvas, or cancelled
    if (touches.size === 0) pinching = false;
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinching) {
      if (touches.size < 2) return; // the last finger of a pinch: no pan, no tool
      const p = pinchNow();
      camera.pan(p.mx - pinchMidX, p.my - pinchMidY);
      pinchMidX = p.mx;
      pinchMidY = p.my;
      const r = pinchZoom(pinchBase, p.spread);
      pinchBase = r.base;
      const rect = canvas.getBoundingClientRect();
      for (let i = 0; i < Math.abs(r.steps); i++) camera.zoomAt(p.mx - rect.left, p.my - rect.top, Math.sign(r.steps));
      handlers.onChange();
      return;
    }
    if (longPress !== null && classifyPointer(downClientX, downClientY, e.clientX, e.clientY) === 'drag') cancelLongPress();
    if (dragging) {
      // If a move arrives with NO button held, the pointerup was missed (capture failed + released
      // off-canvas) — stop the drag instead of panning forever with the cursor (Maddy playtest bug). Only
      // when the pointer isn't captured: a captured pointer's pointerup still comes, and ending the drag
      // here would swallow it — a build click placing nothing.
      if (e.buttons === 0 && !canvas.hasPointerCapture(e.pointerId)) {
        dragging = false;
        suppressPan = false;
        return;
      }
      if (suppressPan) {
        // no pan: a touch aim moves the ghost; a line drag previews the line so far
        const rect = canvas.getBoundingClientRect();
        const end = tileUnder(e.clientX - rect.left, e.clientY - rect.top);
        if (aiming) {
          if (end.tx !== hoverX || end.ty !== hoverY) {
            hoverX = end.tx;
            hoverY = end.ty;
            handlers.hover(end.tx, end.ty);
          }
        } else if (handlers.previewLine && (end.tx !== hoverX || end.ty !== hoverY)) {
          hoverX = end.tx;
          hoverY = end.ty;
          const start = tileUnder(downClientX - rect.left, downClientY - rect.top);
          handlers.previewLine(lineTiles(start.tx, start.ty, end.tx, end.ty));
        }
        return;
      }
      // Capture-stable pan: delta from the last clientX/Y (NOT e.movementX/Y, which
      // is unreliable under capture in WebKit). camera.pan takes screen-pixel deltas.
      const dx = e.clientX - lastClientX;
      const dy = e.clientY - lastClientY;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      camera.pan(dx, dy);
      // Drop the stale hover tint while panning — the world is sliding under the
      // cursor, so the last hovered tile is no longer where the pointer is. It
      // re-previews on the next (non-drag) move. Resetting hoverX/Y forces that
      // recompute even if the pointer lands back on the pre-pan tile.
      handlers.clearHover();
      hoverX = Number.NaN;
      hoverY = Number.NaN;
      handlers.onChange();
      return;
    }
    // Hover preview while a tool is selected, throttled to tile changes.
    if (!handlers.hasTool()) return;
    const { tx, ty } = tileUnder(e.offsetX, e.offsetY);
    if (tx !== hoverX || ty !== hoverY) {
      hoverX = tx;
      hoverY = ty;
      handlers.hover(tx, ty);
    }
  });

  canvas.addEventListener('pointerleave', () => {
    hoverX = Number.NaN;
    hoverY = Number.NaN;
    handlers.clearHover();
  });

  // Wheel/pinch movement accumulates; a zoom level changes per notch's worth (wheelZoom), and a pause starts the
  // next gesture fresh.
  let wheelAcc = 0;
  let wheelAt = 0;
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (e.timeStamp - wheelAt > WHEEL_IDLE_MS) wheelAcc = 0;
      wheelAt = e.timeStamp;
      const r = wheelZoom(wheelAcc, e.deltaY, e.deltaMode);
      wheelAcc = r.acc;
      if (r.steps === 0) return;
      for (let i = 0; i < Math.abs(r.steps); i++) camera.zoomAt(e.offsetX, e.offsetY, r.steps);
      handlers.onChange();
    },
    { passive: false },
  );

  // Held panning keys (the arrows and WASD) glide the map every frame (Maddy 2026-10-13: "WASD scrolling should be
  // smooth, not jumpy") — easing up to speed and easing to a stop when let go ("accel/decel"), not a hop per repeat.
  const held = new Set<string>();
  let panFrame = 0;
  let panAt = 0;
  let vel: [number, number] = [0, 0];
  const glide = (t: number): void => {
    const dt = Math.min(0.05, (t - panAt) / 1000); // a stalled frame doesn't throw the view
    panAt = t;
    vel = easePan(vel, panVelocity(held), dt);
    const [vx, vy] = vel;
    if (vx === 0 && vy === 0 && held.size === 0) {
      panFrame = 0;
      return;
    }
    camera.pan(vx * dt, vy * dt);
    handlers.onChange();
    panFrame = requestAnimationFrame(glide);
  };
  const release = (key: string): void => {
    held.delete(key);
    held.delete(key.toLowerCase());
  };
  window.addEventListener('keyup', (e) => release(e.key));
  window.addEventListener('blur', () => held.clear()); // a key let go in another window

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return; // don't shadow browser/OS shortcuts
    if (isEditableTarget(e.target)) return; // typing in a field isn't panning or picking a tool
    if (panFor(e.key)) {
      e.preventDefault(); // the arrows would scroll the page
      held.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
      if (panFrame === 0) {
        panAt = performance.now();
        panFrame = requestAnimationFrame(glide);
      }
      return;
    }
    switch (e.key) {
      case 'i':
      case 'I':
        handlers.onHotkey('inspect');
        return;
      case 'x':
      case 'X':
        handlers.onHotkey('bulldoze');
        return;
      case 'Escape':
        handlers.onHotkey('deselect');
        return;
      default:
        return;
    }
    handlers.onChange();
  });
}
