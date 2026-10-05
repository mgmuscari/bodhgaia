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
| L0 | live split | `src/live/` as a fail-closed scanned dir; move `LiveCaps` type to `live/caps.ts` | in-progress | refactor/b2-live |
| L1 | live split | tuning constants → `live/tuning.ts` | in-progress | refactor/b2-live |
| L2 | live split | geometry (DIR tables, lane/curb offsets) → `live/geometry.ts` | in-progress | refactor/b2-live |
| L3 | live split | types + `createAmbientState` + setters → `live/types.ts` | in-progress | refactor/b2-live |
| L4 | live split | poses → `live/poses.ts` | todo | — |
| L5 | live split | network predicates → `live/network.ts` | todo | — |
| L6 | live split | motion & collision → `live/motion.ts` | todo | — |
| L7 | live split | pathing & mode choice → `live/pathing.ts` | todo | — |
| Lg | live split | GOLDEN determinism test (N substeps → digest of agents + field maps) — before L8 | in-progress | refactor/b2-live |
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
| M1 | main split | favicon + dev handle → `app/devHandle.ts` | in-progress | refactor/b2-main |
| M2 | main split | opening mount → `app/opening.ts` | in-progress | refactor/b2-main |
| M3 | main split | pure `inspectReadout` out of `applyAt` (+ unit test) | in-progress | refactor/b2-main |
| M4 | main split | power controller → `app/power.ts` | todo | — |
| M5 | main split | live-layer setup → `app/live.ts` | todo | — |
| M6 | main split | overlay controller → `app/overlays.ts` | todo | — |
| M7 | main split | economy controller → `app/economy.ts` | todo | — |
| M8 | main split | saves wiring → `app/saves.ts` | todo | — |
| M9 | main split | panels → `app/panels.ts` | todo | — |
| M10 | main split | one keyboard map → `app/keys.ts` | todo | — |
| M11 | main split | tool controller → `app/tools.ts` | todo | — |
| M12 | main split | sim tick + frame loop → `app/loop.ts`; `main()` ≈ 100 lines of wiring | todo | — |
| S1 | release | `vite base: './'` — assets load under a subpath of the site (BLOCKER) | done | 204f8c5c |
| S2 | release | credits: GPL-3.0+, the old simulator © 1989–2007 EA notice + §7 additional terms, source link; ship COPYING (BLOCKER) | done | 979e2bb0 |
| S3 | release | dev hooks (`window.bodhitropolis`) — DECIDED: dev builds only (`import.meta.env.DEV`) | done | bea50446 |
| S4 | release | phones — DECIDED: a gentle "best on a desktop browser" note on small screens; touch later | done | 1bc3908e |
| S5 | release | feature-check IndexedDB/CompressionStream; disable Saves with a note | todo | — |
| S6 | release | page metadata: description, Open Graph, theme-color, static favicon + preview image | done | ac219a9a |
| D1 | dead code | fix stale O-D traffic comments (main.ts, ambientContent, map.ts) | done | a8c37222 + 394f5ae9 |
| D2 | dead code | delete uncalled fns (`isPlantedMedian`, `dirVector`, `pedCurbOffset`, `clearPx`) | done | 9a5eed4a |
| D3 | dead code | drop `?shader` param (GPU is the default) | done | a68548bb |
| D4 | dead code | delete the retired O-D traffic module (`src/traffic/generate`, `density`, most of `trip`) + its tests | done | 7002ee94 |
| D5 | dead code | remove compose's traffic plumbing (`TRAFFIC_CADENCE`, `trips`, `trafficTicked`) + `ingestTrips` | done | 59eeb502 (ingestTrips kept → D8) |
| D6 | dead code | retire the always-zero `map.traffic` layer — DECIDED: yes, SAVE v2 + v1→v2 migration | in-progress | refactor/b2-save |
| D7 | dead code | remove the test-only `effortAccrual: 'tick'` branch (rewrite those tests deliberately) | todo | — |
| C1 | consistency | one money formatter | done | c4418c14 |
| C2 | consistency | one clamp family (keep floor / no-floor variants; hash-sensitive) | todo | — |
| C3 | consistency | one 4-neighbour direction table (iteration order preserved) | todo | — |
| C4 | consistency | overlay constants + `lerp` shared | done | 6e667a62 |
| C5 | consistency | overlay registry: one dispatch instead of main's if-chains/ternaries | todo | — |
| C6 | consistency + BUG | one keyboard table; fixes Cmd+L / Cmd+G / Cmd+, being swallowed | done | 77a0b240 |
| C7 | consistency | one panel handle shape (`toggle`/`isOpen`/`refresh`, one visibility mechanism) | todo | — |
| C8 | consistency | settle `reconcile.ts` (wire it in or delete it) | todo | — |
| P1 | perf | cull before posing; one pose array per frame for both renderers | todo | — |
| P2 | perf | `snapPose` stops copying whole agents | todo | — |
| P3 | perf | reachability: reuse the found path; component labels for O(1) "can't reach" | todo | — |
| P4 | perf | A*: binary heap + typed arrays (same tie order) | todo | — |
| P5 | perf | warm headlight silhouettes; dirty-tile base refresh instead of the 2 s full redraw | todo | — |
| C9 | consistency + BUG | keys fire while typing in an input (Settings number box): skip editable targets | in-progress | refactor/b2-main |
| C10 | consistency | Help's controls list is missing B (Budget) and S (Saves) | in-progress | refactor/b2-main |
| D8 | dead code | replace the `ingestTrips` fixture behind ~23 live-layer tests, then delete it | todo | — |
| D9 | dead code | `SimDeps.seed` unread by simTick; `shouldTogglePanel` test-only | todo | — |
| S7 | release | `og:image` + `og:url` once the site URL is known | todo | — |
| S8 | release | ship `COPYING.txt` too (extensionless files may download, not display) | in-progress | refactor/b2-save |
| S9 | release | Help's ✕ scrolls away with the credits — pin the panel header | in-progress | refactor/b2-save |

- **Batch 2** (started 2026-10-05): live split part 1 (Lg, L0–L3) · main.ts part 1 (C9, C10, M1–M3) · save v2 + help polish (D6, S8, S9).

## Survey notes (2026-10-05)

- Desktop perf is not a blocker: 60 fps, main thread ~88% idle, ~1.5 ms JS/frame. At 4× CPU throttle (phone proxy)
  the hot spots are drawSprites 27%, stepAmbient 20%, pedPose 10%, the reachability chain ~13%.
- Bundle: 99 KB gzip JS, 344 KB dist total; all art code-painted. No-WebGL falls back to CPU at 60 fps.
- Licence: the upstream the old simulator GPL carries §7 additional terms — any conveyance must include the EA copyright
  notice and those terms; no "the classic city-builder" trademark (the bundle has none). The repo is public (github.com/mgmuscari/bodhitropolis).
- Main-side hazard: closures over reassigned `let`s (econ, autosave, overlayActive) — extract as factories with getters.
- Live-side hazard: the live layer is not hashed; add the golden determinism test (Lg) before the field/agent moves.

## Batch plan

- **Batch 1** (started 2026-10-05; DONE — integrated on `refactor/batch-1`, 1,767 tests, verified served from a subpath):
  1. release: S1, S2, S6 (+ S3 dev-hook guard if it doesn't touch main.ts beyond one line — else batch 2)
  2. keys: C6 (one keyboard table + Cmd regression test), D3, D1's main.ts comment
  3. dead code: D1 (non-main files), D2, D4, D5, C1, C4
  No file overlap between the three; each in its own worktree; one commit per unit.
