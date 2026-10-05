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
| 0 | survey | Map the giant files, dead code, consistency, perf and release readiness → rank units | in-progress | — |
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
