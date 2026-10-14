// Ambulances (Maddy 2026-10-12: "clinics dispatch ambulances that can save residents from dying"). A collapsed resident
// (death.ts residentCollapses) calls the nearest clinic that has a route to them; its ambulance drives out — the roads
// and the car-free ways, like a fire truck (emergencyPath) — takes them aboard (LOAD_SUBSTEPS), and drives back. On
// arrival the patient goes back where they belong (rescueResident). If the minute runs out first, they die where
// they lie and the ambulance turns back. Live layer: reads the map, writes only its own state.

import type { GameMap } from '../engine/map';
import { BuiltKind } from '../engine/fabric';
import type { Ambulance, AmbientState, Dying } from './types';
import { emergencyPath } from './pathing';
import { board, drive, roadNear } from './trucks';
import { mapEpoch } from './network';
import { rescueResident } from './death';
import { HEALING_PAIR_EXTRA, LOAD_SUBSTEPS } from './tuning';
import { pairedWith } from '../engine/pairings';

/** How many of the nearest clinics a collapse tries before giving up (each try is a route search). */
const CLINIC_TRIES = 3;

/** The map's clinic tiles, by its epoch (cached until something is built). */
const clinicCache = new WeakMap<GameMap, { epoch: number; tiles: number[] }>();
function clinicsOf(map: GameMap): number[] {
  const epoch = mapEpoch(map);
  let c = clinicCache.get(map);
  if (!c || c.epoch !== epoch) {
    const tiles: number[] = [];
    for (let i = 0; i < map.built.length; i++) if (map.built[i] === BuiltKind.Clinic) tiles.push(i);
    c = { epoch, tiles };
    clinicCache.set(map, c);
  }
  return c.tiles;
}

/** Send an ambulance to `d` from the nearest clinic with a route; false if none can reach them. */
function dispatch(state: AmbientState, map: GameMap, d: Dying): boolean {
  const to = roadNear(map, d.x, d.y, 1, 1);
  if (!to) return false;
  const W = map.width;
  const clinics = clinicsOf(map)
    .map((t) => ({ t, dist: Math.abs((t % W) - d.x) + Math.abs(Math.floor(t / W) - d.y) }))
    .sort((a, b) => a.dist - b.dist || a.t - b.t);
  const tried = new Set<string>();
  for (const { t } of clinics) {
    const from = roadNear(map, t % W, Math.floor(t / W), 1, 1);
    if (!from) continue;
    const key = `${from.x},${from.y}`;
    if (tried.has(key)) continue; // a clinic's tiles share their door
    if (tried.size >= CLINIC_TRIES) break;
    tried.add(key);
    const path = emergencyPath(map, from.x, from.y, to.x, to.y, state.traffic);
    if (!path) continue;
    const a: Ambulance = { x: from.x, y: from.y, dir: 1, tx: from.x, ty: from.y, call: 'to-patient', patient: d, home: from, load: 0 };
    if (path.length < 2 || !board(a, path, map)) {
      a.call = 'loading'; // the clinic is at their side
      a.load = LOAD_SUBSTEPS;
    }
    // a clinic paired with a healing commons: the patient holds on longer (lane pairing, interdependence §9)
    if (pairedWith(map, { x: t % W, y: Math.floor(t / W), w: 1, h: 1 }, BuiltKind.HealingCommons)) d.t -= HEALING_PAIR_EXTRA;
    (state.ambulances ??= []).push(a);
    return true;
  }
  return false;
}

/** Head an ambulance back to its clinic; false if it is already there (or can't get there). */
function headHome(state: AmbientState, map: GameMap, a: Ambulance): boolean {
  const back = emergencyPath(map, Math.round(a.x), Math.round(a.y), a.home.x, a.home.y, state.traffic);
  if (!back || !board(a, back, map)) return false;
  a.call = 'home';
  return true;
}

/** One substep: call ambulances to new collapses, and move the ones on a call. */
export function stepAmbulances(state: AmbientState, map: GameMap): void {
  for (const d of state.dying ?? []) {
    if (d.called || d.carried) continue;
    d.called = true; // one call per collapse — no ambulance able to reach them is the clinic network's answer
    dispatch(state, map, d);
  }
  if (!state.ambulances?.length) return;
  const still: Ambulance[] = [];
  for (const a of state.ambulances) {
    const alive = a.patient.carried || (state.dying ?? []).includes(a.patient);
    if (a.call === 'to-patient') {
      if (!alive) {
        if (headHome(state, map, a)) still.push(a); // too late: back to the clinic
        continue;
      }
      if (drive(a, map)) {
        a.call = 'loading';
        a.load = LOAD_SUBSTEPS;
      }
      still.push(a);
    } else if (a.call === 'loading') {
      if (!alive) {
        if (headHome(state, map, a)) still.push(a);
        continue;
      }
      if (--a.load > 0) {
        still.push(a);
        continue;
      }
      a.patient.carried = true; // aboard: their minute stops (stepDeaths lets them go)
      if (headHome(state, map, a)) still.push(a);
      else rescueResident(state, map, a.patient); // already at the clinic's door
    } else if (drive(a, map)) {
      if (a.patient.carried) rescueResident(state, map, a.patient); // at the clinic: they go home
    } else still.push(a);
  }
  state.ambulances = still;
}
