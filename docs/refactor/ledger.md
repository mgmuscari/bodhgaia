# Cleanup & refactor ledger

The broad cleanup pass (started 2026-10-05). Goal: a codebase ready to publish as a static "artifact" on
Maddy's site (weird art projects) — smaller, clearer, faster, no dev-only scaffolding in the shipped build.

## Status — CLOSED 2026-10-05 (Maddy: "stop the pass here")

Six batches, 77 units done, merged via PRs #133–#138. The live layer (once one 4,600-line file) is ~20 modules
under `src/live/`; `main()` is 186 lines of wiring over tested controllers in `src/app/`; the page is ready to
publish from a subpath with its GPL credits. The remaining `todo` rows are optional (deeper perf, the ped
state-machine rewrite) or wait on outside facts (the site URL for og:url/og:image). Pick them up as ordinary work.

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
| L0 | live split | `src/live/` as a fail-closed scanned dir; move `LiveCaps` type to `live/caps.ts` | done | 7c29016e |
| L1 | live split | tuning constants → `live/tuning.ts` | done | 91c1b0ae |
| L2 | live split | geometry (DIR tables, lane/curb offsets) → `live/geometry.ts` | done | 85472718 |
| L3 | live split | types + `createAmbientState` + setters → `live/types.ts` | done | 29e3dae8 (+ live/wind.ts) |
| L4 | live split | poses → `live/poses.ts` | done | 6b543905 |
| L5 | live split | network predicates → `live/network.ts` | done | f7cf458f |
| L6 | live split | motion & collision → `live/motion.ts` | done | fb4cccfc |
| L7 | live split | pathing & mode choice → `live/pathing.ts` | done | b6098ddb |
| Lg | live split | GOLDEN determinism test (N substeps → digest of agents + field maps) — before L8 | done | d4f91255 |
| L8a | live split | fields: pollution/wind/rain/water/ground + seedDecay → `live/fields/pollution.ts` | done | 8c620d8d (+ layTraffic) |
| L8b | live split | fields: coverage, land value, road decay → `live/fields/landValue.ts` | done | 70d4d570 |
| L8c | live split | fields: occupancy → `live/fields/occupancy.ts` | done | 23f22def |
| L9 | live split | birds + trains → `live/birds.ts`, `live/trains.ts` | done | 24795acd |
| L10 | live split | police → `live/police.ts` | done | b85ffef6 (stepArrests waits for L11 → L10b) |
| L11 | live split | parking, owned cars, citizens → `live/agents.ts` | done | 9caa4dac |
| L12 | live split | `substep`/`stepAmbient` → `live/step.ts`; ambientContent becomes a barrel | done | 0f715969 |
| L13 | live split | migrate importers, delete the barrel, drop it from the allowlist | done | 5290d463 + dfb1dd69 (barrel deleted) |
| L14 | live split | (optional) split agents → parking / citizens | todo | — |
| L15 | live split | (rewrite) lift the inline ped state machine into `stepPed`/`stepCar` | todo | — |
| M1 | main split | favicon + dev handle → `app/devHandle.ts` | done | 0e6546b2 |
| M2 | main split | opening mount → `app/opening.ts` | done | 7e128874 |
| M3 | main split | pure `inspectReadout` out of `applyAt` (+ unit test) | done | e1a8f4db |
| M4 | main split | power controller → `app/power.ts` | done | 74f0912c |
| M5 | main split | live-layer setup → `app/live.ts` | done | d22976e7 |
| M6 | main split | overlay controller → `app/overlays.ts` | done | 7e8b1b1e |
| M7 | main split | economy controller → `app/economy.ts` | done | 69ce0869 |
| M8 | main split | saves wiring → `app/saves.ts` | done | 5994352b |
| M9 | main split | panels → `app/panels.ts` | done | 7ef1fdf9 |
| M10 | main split | one keyboard map → `app/keys.ts` | done | e914aae9 |
| M11 | main split | tool controller → `app/tools.ts` | done | abc2773d |
| M12 | main split | sim tick + frame loop → `app/loop.ts`; `main()` ≈ 100 lines of wiring | done | daf84c94 + fcd3db74 (main() 186 lines) |
| S1 | release | `vite base: './'` — assets load under a subpath of the site (BLOCKER) | done | 204f8c5c |
| S2 | release | credits: GPL-3.0+, source link; ship COPYING (BLOCKER) | done | 979e2bb0 |
| S3 | release | dev hooks (`window.bodhitropolis`) — DECIDED: dev builds only (`import.meta.env.DEV`) | done | bea50446 |
| S4 | release | phones — DECIDED: a gentle "best on a desktop browser" note on small screens; touch later | done | 1bc3908e |
| S5 | release | feature-check IndexedDB/CompressionStream; disable Saves with a note | done | ea749939 |
| S6 | release | page metadata: description, Open Graph, theme-color, static favicon + preview image | done | ac219a9a |
| D1 | dead code | fix stale O-D traffic comments (main.ts, ambientContent, map.ts) | done | a8c37222 + 394f5ae9 |
| D2 | dead code | delete uncalled fns (`isPlantedMedian`, `dirVector`, `pedCurbOffset`, `clearPx`) | done | 9a5eed4a |
| D3 | dead code | drop `?shader` param (GPU is the default) | done | a68548bb |
| D4 | dead code | delete the retired O-D traffic module (`src/traffic/generate`, `density`, most of `trip`) + its tests | done | 7002ee94 |
| D5 | dead code | remove compose's traffic plumbing (`TRAFFIC_CADENCE`, `trips`, `trafficTicked`) + `ingestTrips` | done | 59eeb502 (ingestTrips kept → D8) |
| D6 | dead code | retire the always-zero `map.traffic` layer — DECIDED: yes, SAVE v2 + v1→v2 migration | done | eaacba1c (save v2) |
| D7 | dead code | remove the test-only `effortAccrual: 'tick'` branch (rewrite those tests deliberately) | done | ab475997 + 2f4978ff |
| C1 | consistency | one money formatter | done | c4418c14 |
| C2 | consistency | one clamp family (keep floor / no-floor variants; hash-sensitive) | done | a601eac1 |
| C3 | consistency | one 4-neighbour direction table (iteration order preserved) | done | 64924e86 |
| C4 | consistency | overlay constants + `lerp` shared | done | 6e667a62 |
| C5 | consistency | overlay registry: one dispatch instead of main's if-chains/ternaries | done | 9fa1a047 |
| C6 | consistency + BUG | one keyboard table; fixes Cmd+L / Cmd+G / Cmd+, being swallowed | done | 77a0b240 |
| C7 | consistency | one panel handle shape (`toggle`/`isOpen`/`refresh`, one visibility mechanism) | done | 1914fc23 |
| C8 | consistency | settle `reconcile.ts` (wire it in or delete it) | done | 9454bd13 |
| P1 | perf | cull before posing; one pose array per frame for both renderers | done | 5f46378d |
| P2 | perf | `snapPose` stops copying whole agents | done | f50ebc22 |
| P3 | perf | reachability: reuse the found path; component labels for O(1) "can't reach" | todo | — |
| P4 | perf | A*: binary heap + typed arrays (same tie order) | done | 2e6467af |
| P5a | perf | warm headlight silhouettes in idle time | done | cdf325fd |
| P5b | perf | dirty-tile base refresh instead of the 2 s full redraw (touches main.ts) | done | d3642de2 (pixel-identical) |
| C9 | consistency + BUG | keys fire while typing in an input (Settings number box): skip editable targets | done | b1e3edc3 + 1c98f904 (input.ts) |
| C10 | consistency | Help's controls list is missing B (Budget) and S (Saves) | done | 79940c8a |
| D8 | dead code | replace the `ingestTrips` fixture behind ~23 live-layer tests, then delete it | done | 7a84d20b (fixture in tests/live/tripFixture.ts) |
| D9 | dead code | `SimDeps.seed` unread by simTick; `shouldTogglePanel` test-only | done | 20467501 + 2f4978ff |
| S7 | release | `og:image` + `og:url` once the site URL is known | todo | — |
| S8 | release | ship `COPYING.txt` too (extensionless files may download, not display) | done | a82a1e60 |
| S9 | release | Help's ✕ scrolls away with the credits — pin the panel header | done | d5179303 |

- **Batch 2** (started 2026-10-05; DONE — integrated on `refactor/batch-2`, 1,802 tests, golden digest unchanged, verified served from a subpath): live split part 1 (Lg, L0–L3) · main.ts part 1 (C9, C10, M1–M3) · save v2 + help polish (D6, S8, S9).
| N1 | notes | L8a: fold `live/wind.ts` (prevailingWind) into `fields/pollution.ts` | done | 8c620d8d (wind folded into fields/pollution) |
| N2 | notes | L13: `inspectContent.ts` imports `liveInspectLine` from the ambientContent barrel — migrate with the rest | done | 1225f37a |
| N3 | notes | M5 (live setup in main) lands after L13 or imports only via the barrel; keep restoreLive after seedDecay | done | resolved in M5 (d22976e7) |

- **Batch 3** (started 2026-10-05; DONE — integrated on `refactor/batch-3`, 1,848 tests, golden unchanged, 9 frames pixel-identical, verified from a subpath at 60 fps): live split part 2 (L4–L7) · power + overlay registry (M4, C5/M6) · render culling (P1, P5a).
| B1 | bug | power overlay froze at the grid it was opened with — now refreshes on the civic tick | done | 8120bf9d |
| C11 | consistency | dockContent hardcodes the six overlay kinds — iterate OVERLAY_KINDS | done | 1af41c22 |
| D10 | dead code | `compositeKeyFor` (civic), `cycleOverlay`/`shouldCycleOverlay` (eco) are test-only | done | 665ac315 |
| N4 | notes | C7: one `{id → handle}` panel registry collapses onMeta + keydown switches; the restoration toggle's open-time sample runs on the key path only (dock path skips it) | done | 1914fc23 (restoration open samples) |
| N5 | notes | L8: decide whether `layTraffic` moves with the fields; L11: `stopReachable` moves with parking | done | resolved: layTraffic → fields/pollution; stopReachable → agents |

- **Batch 4** (started 2026-10-05; DONE — integrated on `refactor/batch-4`, 1,887 tests, golden unchanged, 10 frames pixel-identical, A* paths oracle-identical, verified from a subpath at 60 fps): live split part 3 (L8a–c, L9, L10, N1) · economy + saves out of main (M7, M8) · agent-copy + A* perf (P2, P4).
| L10b | live split | move `stepArrests` into police.ts once the owned-car chain is out (with/after L11); `depositHealth` may sit in fields/occupancy | done | d9f30220 |
| P6 | perf | A*'s cost is now the per-neighbour predicates (pedCost, isWalkable, canDrive/freewayLane/sameRun): precomputed walk/drive masks rebuilt on built-layer change | done | 2e9bf8ab (road 3.5–4× faster) |
| P7 | perf | `moverPose` still allocates a profile + closure per call for numeric laterals | done | f5f249f1 |
| N6 | notes | M9: one shared `pulse()` (budget onBorrow and economy's ui.pulse both build it); budgetPanel needs refresh/open in the C7 shape · M12: loop exposes a tick getter (saves reads currentTick) · L13: tests/app/saves.test.ts imports createAmbientState via the barrel | done | resolved in M9/M8; tick getter → M12 |

- **Batch 5** (started 2026-10-05; DONE — integrated on `refactor/batch-5`, 1,917 tests, golden unchanged, verified from a subpath): agents/arrests/step out of ambientContent (L11, L10b, L12) · panel registry + live setup (C7, M9, M5, N4 fix) · path masks + consistency (P6, P7, C11, D10).
| P8 | perf | walkPath: a static per-tile base-cost table beside the masks (pedCost dominates; 176² hits the iteration cap) | todo | — |
| P9 | perf | a revision counter on GameMap → O(1) mask freshness (engine change) | todo | — |
| N7 | notes | L13 importer list: 9 src + 14 tests (+ tests/app/live.test.ts), inline `import('…ambientContent').Car/Ped` types in ambientContent.test.ts; allowlist line + 2 comments | done | 5290d463 |

- **Batch 6** (started 2026-10-05, the finishing batch; DONE — integrated on `refactor/batch-6`, 1,972 tests, golden + hash unchanged, verified from a subpath at 60 fps): retire the barrel (N2, L13, D8) · finish main.ts (M10–M12, P5b) · consistency + storage check (S5, C2, C3, C8, D7, D9).
| D11 | dead code | ~5 tests in tests/live/live.test.ts now exercise only the trip FIXTURE's own spawn logic (walk/drive, freeway, tint) — retire? (Maddy's call) | done | 488e892a (5 retired, Maddy's call) |
| P10 | perf | power-hour / civic-tick `markDirty` triggers full base rebuilds though power never changes base pixels — a collect-only refresh | todo | — |
| N8 | notes | S5's no-storage guard lives in the store (CURRENT is a silent sink) — could move into app/saves.ts `autosave()` via `saveSupport()` | todo | — |
| N9 | notes | CLAUDE.md's 2026-06-19 gotcha still says `import('/src/ui/ambientContent.ts')` for live checks — now `src/live/*` (Maddy's file) | done | 488e892a |

## Survey notes (2026-10-05)

- Desktop perf is not a blocker: 60 fps, main thread ~88% idle, ~1.5 ms JS/frame. At 4× CPU throttle (phone proxy)
  the hot spots are drawSprites 27%, stepAmbient 20%, pedPose 10%, the reachability chain ~13%.
- Bundle: 99 KB gzip JS, 344 KB dist total; all art code-painted. No-WebGL falls back to CPU at 60 fps.
- Licence: GPL-3.0-or-later — every conveyance names the licence, ships COPYING and links the source. The repo is
  public (github.com/mgmuscari/bodhgaia).
- Main-side hazard: closures over reassigned `let`s (econ, autosave, overlayActive) — extract as factories with getters.
- Live-side hazard: the live layer is not hashed; add the golden determinism test (Lg) before the field/agent moves.

## Batch plan

- **Batch 1** (started 2026-10-05; DONE — integrated on `refactor/batch-1`, 1,767 tests, verified served from a subpath):
  1. release: S1, S2, S6 (+ S3 dev-hook guard if it doesn't touch main.ts beyond one line — else batch 2)
  2. keys: C6 (one keyboard table + Cmd regression test), D3, D1's main.ts comment
  3. dead code: D1 (non-main files), D2, D4, D5, C1, C4
  No file overlap between the three; each in its own worktree; one commit per unit.
