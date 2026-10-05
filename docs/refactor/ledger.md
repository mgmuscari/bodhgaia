# Cleanup & refactor ledger

The broad cleanup pass (started 2026-10-05). Goal: a codebase ready to publish as a static "artifact" on
Maddy's site (weird art projects) — smaller, clearer, faster, no dev-only scaffolding in the shipped build.

## Protocol (how this pass stays pausable)

- **This file is the source of truth.** Every unit of work is a row below: `todo` → `in-progress` → `done`
  (with its commit) or `dropped` (with why). If the machine sleeps mid-run, resume from here.
- **Units are small and atomic**: ~15–30 min, behaviour-preserving unless the row says otherwise, tests green
  before and after, ONE commit per unit, each on its own branch/worktree. Never leave a unit half-edited.
- **Pause**: the file `.refactor-pause` at the repo root (gitignored). Every agent checks it before starting a
  unit and after each commit. If present: finish or revert the current unit, update this ledger, stop. No new
  units launch while it exists. Resume = delete the file.
- **Batches of 2–3 agents**, reported between batches. Nothing runs for hours unattended.
- Rule of the house still holds: TDD; never weaken a test to get green; "blight"-family language rule.

## Units

| # | Area | Unit | Status | Branch / commit |
|---|------|------|--------|-----------------|
| 0 | survey | Map the giant files, dead code, consistency, perf and release readiness → rank units | done | e0133b22 |
| L0 | live split | `src/live/` as a fail-closed scanned dir; move `LiveCaps` type to `live/caps.ts` | todo | — |
| L1 | live split | tuning constants → `live/tuning.ts` | todo | — |
| L2 | live split | geometry (DIR tables, lane/curb offsets) → `live/geometry.ts` | todo | — |
| L3 | live split | types + `createAmbientState` + setters → `live/types.ts` | todo | — |
| L4 | live split | poses → `live/poses.ts` | todo | — |
| L5 | live split | network predicates → `live/network.ts` | todo | — |
| L6 | live split | motion & collision → `live/motion.ts` | todo | — |
| L7 | live split | pathing & mode choice → `live/pathing.ts` | todo | — |
| Lg | live split | GOLDEN determinism test (N substeps → digest of agents + field maps) — before L8 | todo | — |
| L8a | live split | fields: pollution/wind/rain/water/ground + seedDecay → `live/fields/pollution.ts` | todo | — |
| L8b | live split | fields: coverage, land value, road decay → `live/fields/landValue.ts` | todo | — |
| L8c | live split | fields: occupancy → `live/fields/occupancy.ts` | todo | — |
| L9 | live split | birds + trains → `live/birds.ts`, `live/trains.ts` | todo | — |
| L10 | live split | police → `live/police.ts` | todo | — |
| L11 | live split | parking, owned cars, citizens → `live/agents.ts` | todo | — |
| L12 | live split | `substep`/`stepAmbient` → `live/step.ts`; ambientContent becomes a barrel | todo | — |
| L13 | live split | migrate importers, delete the barrel, drop it from the allowlist | todo | — |
| L14 | live split | (optional) split agents → parking / citizens | todo | — |
| L15 | live split | (rewrite) lift the inline ped state machine into `stepPed`/`stepCar` | todo | — |
| M1 | main split | favicon + dev handle → `app/devHandle.ts` | todo | — |
| M2 | main split | opening mount → `app/opening.ts` | todo | — |
| M3 | main split | pure `inspectReadout` out of `applyAt` (+ unit test) | todo | — |
| M4 | main split | power controller → `app/power.ts` | todo | — |
| M5 | main split | live-layer setup → `app/live.ts` | todo | — |
| M6 | main split | overlay controller → `app/overlays.ts` | todo | — |
| M7 | main split | economy controller → `app/economy.ts` | todo | — |
| M8 | main split | saves wiring → `app/saves.ts` | todo | — |
| M9 | main split | panels → `app/panels.ts` | todo | — |
| M10 | main split | one keyboard map → `app/keys.ts` | todo | — |
| M11 | main split | tool controller → `app/tools.ts` | todo | — |
| M12 | main split | sim tick + frame loop → `app/loop.ts`; `main()` ≈ 100 lines of wiring | todo | — |
| S1 | release | `vite base: './'` — assets load under a subpath of the site (BLOCKER) | todo | — |
| S2 | release | credits: GPL-3.0+, Micropolis © 1989–2007 EA notice + §7 additional terms, source link; ship COPYING (BLOCKER) | todo | — |
| S3 | release | dev hooks (`window.bodhitropolis`) in prod — decision pending | todo | — |
| S4 | release | phones/touch: support or say "desktop only" — decision pending | todo | — |
| S5 | release | feature-check IndexedDB/CompressionStream; disable Saves with a note | todo | — |
| S6 | release | page metadata: description, Open Graph, theme-color, static favicon + preview image | todo | — |
| D1 | dead code | fix stale O-D traffic comments (main.ts, ambientContent, map.ts) | todo | — |
| D2 | dead code | delete uncalled fns (`isPlantedMedian`, `dirVector`, `pedCurbOffset`, `clearPx`) | todo | — |
| D3 | dead code | drop `?shader` param (GPU is the default) | todo | — |
| D4 | dead code | delete the retired O-D traffic module (`src/traffic/generate`, `density`, most of `trip`) + its tests | todo | — |
| D5 | dead code | remove compose's traffic plumbing (`TRAFFIC_CADENCE`, `trips`, `trafficTicked`) + `ingestTrips` | todo | — |
| D6 | dead code | retire the always-zero `map.traffic` layer — SAVE v2 + migration; decision pending | todo | — |
| D7 | dead code | remove the test-only `effortAccrual: 'tick'` branch (rewrite those tests deliberately) | todo | — |
| C1 | consistency | one money formatter | todo | — |
| C2 | consistency | one clamp family (keep floor / no-floor variants; hash-sensitive) | todo | — |
| C3 | consistency | one 4-neighbour direction table (iteration order preserved) | todo | — |
| C4 | consistency | overlay constants + `lerp` shared | todo | — |
| C5 | consistency | overlay registry: one dispatch instead of main's if-chains/ternaries | todo | — |
| C6 | consistency + BUG | one keyboard table; fixes Cmd+L / Cmd+G / Cmd+, being swallowed | todo | — |
| C7 | consistency | one panel handle shape (`toggle`/`isOpen`/`refresh`, one visibility mechanism) | todo | — |
| C8 | consistency | settle `reconcile.ts` (wire it in or delete it) | todo | — |
| P1 | perf | cull before posing; one pose array per frame for both renderers | todo | — |
| P2 | perf | `snapPose` stops copying whole agents | todo | — |
| P3 | perf | reachability: reuse the found path; component labels for O(1) "can't reach" | todo | — |
| P4 | perf | A*: binary heap + typed arrays (same tie order) | todo | — |
| P5 | perf | warm headlight silhouettes; dirty-tile base refresh instead of the 2 s full redraw | todo | — |

## Survey notes (2026-10-05)

- Desktop perf is not a blocker: 60 fps, main thread ~88% idle, ~1.5 ms JS/frame. At 4× CPU throttle (phone proxy)
  the hot spots are drawSprites 27%, stepAmbient 20%, pedPose 10%, the reachability chain ~13%.
- Bundle: 99 KB gzip JS, 344 KB dist total; all art code-painted. No-WebGL falls back to CPU at 60 fps.
- Licence: the upstream Micropolis GPL carries §7 additional terms — any conveyance must include the EA copyright
  notice and those terms; no "SimCity" trademark (the bundle has none). The repo is public (github.com/mgmuscari/bodhitropolis).
- Main-side hazard: closures over reassigned `let`s (econ, autosave, overlayActive) — extract as factories with getters.
- Live-side hazard: the live layer is not hashed; add the golden determinism test (Lg) before the field/agent moves.
