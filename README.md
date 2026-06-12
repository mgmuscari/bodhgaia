# Bodhitropolis

A dharmapunk browser city-builder — a deterministic, procedurally-generated
world atop the GPL-3 the old simulator lineage (the open-sourced the classic city-builder Classic by
the original designer / classic). This repository hosts the modern TypeScript engine in
the root `src/` / `tests/`; the original the old simulator ports live in their legacy
subtrees (`legacy-activity/`, `LegacyCore/`, `legacy-java/`) and
are reference-only.

## Quickstart

```bash
npm install        # install the toolchain (Vite + TypeScript + Vitest)
npm run dev        # serve the app at http://localhost:5173
npx vitest run     # run the test suite
npm run build      # production build (tsc typecheck + vite bundle)
npm run typecheck  # type check only (tsc --noEmit)
```

Open `http://localhost:5173/?seed=<anything>` to generate a specific world.
The same seed always produces the same world — reload to confirm.

## Architecture

Code is split into three layers with a strict, test-enforced purity rule
(`tests/architecture.test.ts`):

- **`src/engine/`** — the deterministic simulation core: a seeded PRNG
  (`rng.ts`, sfc32 with `fork`-by-label streams), a fixed-tick loop
  (`loop.ts`), the layered typed-array tile map (`map.ts`), and the
  built-environment model (`fabric.ts`: the `BuiltKind` taxonomy, the
  `ParcelStore`, placement functions, and connectivity queries). Imports
  nothing from `worldgen` or `ui`.
- **`src/worldgen/`** — value noise / fBm (`noise.ts`), the staged generation
  pipeline (`pipeline.ts`), the terrain stage (`terrain.ts`: elevation,
  ocean/lake/river, moisture, biomes), and the placeholder `fabric-demo`
  stage (`fabricdemo.ts`). May import `engine`.
- **`src/ui/`** — a Canvas2D pixel-art renderer (terrain plus an autotiled
  road/rail and footprint-aware building overlay), pan/zoom camera, and input.
  Only this layer and `src/main.ts` touch the DOM.

**Determinism is load-bearing.** `engine` and `worldgen` use only integer math
and exactly-rounded float ops (`+ - * / sqrt`, `Math.imul/floor`) — no
transcendental `Math` (`exp`/`pow`/`log`/`sin`/`cos`/`tan`) and no
`Math.random`, because their results vary across JS engines and would break
"same seed → same world" between browsers. The seeded `rng` is the only
randomness source. This is what makes shared-seed worlds (and the planned
historical simulation) reproducible.

### Built environment (fabric)

The map carries two tile layers for the built world — `built` (a `BuiltKind`:
roads, rail, or a Moses-era building) and `parcel` (the id of the owning
building footprint). Building *attributes* that don't fit in a tile — kind,
density, and condition — live in a parallel-array `ParcelStore` on the
`WorldState`. Because attributes sit outside the map, `hashWorld(world)` (map
snapshot + parcel bytes), not `map.snapshot()` alone, is the canonical
determinism hash for stage tests.

The placement functions in `fabric.ts` (`placeParcel`, `placeTransport`) are
the **single writers** of those layers — everything else queries. Transport
placement merges same-category junctions (road-on-road, rail-on-rail) to the
higher-capacity kind so two roads can share a crossing tile; road↔rail
crossings are rejected. `transportMask` drives renderer autotiling and
`parcelTouchesRoad` answers frontage queries.

`fabric-demo` is a **placeholder** worldgen stage: it lays one deterministic
test town (a crossroads and one of each building kind) so the renderer and
fabric model have something to draw. It is not settlement logic — the planned
Moses-century history simulation replaces this stage with a city grown from
real history.

## Methodology

This project is built with the Dialectic development methodology. See
[`dialectic.md`](dialectic.md) for the methodology spec and `CLAUDE.md` for
project conventions.

---

# Open Source the old simulator, based on the original the classic city-builder Classic from classic, by the original designer. #

This is the source code for the old simulator (based on [the classic city-builder](http://en.wikipedia.org/wiki/the classic city-builder_(1989_video_game))), released under the GPL. the old simulator is based on the original the classic city-builder from the original publisher / classic, and designed and written by the original designer.

## [Description](../wiki/Description.md) ##
A description of the the old simulator project source code release.

## [News](../wiki/News.md) ##
The latest news about recent development.

## [DevelopmentPlan](../wiki/DevelopmentPlan.md) ##
The development plan, and a high level description of tasks that need to be done.

## [ThePlan](../wiki/ThePlan.md) ##
Older development plan for the TCL/Tk version of the old simulator and the C++/Python version too.

## [Assets](../wiki/Assets.md) ##
List of art and text assets, and work that needs to be done for the old simulator.

## Documentation ##

This is the old documentation of the HyperLook version of the classic city-builder, converted to wiki text.
It needs to be brought up to date and illustrated.

  * [Introduction](../wiki/Introduction.md)
  * [Tutorial](../wiki/Tutorial.md)
  * [User Reference](../wiki/UserReference.md)
  * [Inside The Simulator](../wiki/InsideTheSimulator.md)
  * [History Of Cities And City Planning](../wiki/History.md)
  * [Bibliography](../wiki/Bibliography.md)
  * [Credits](../wiki/Credits.md)

## [License](../wiki/License.md) ##
The the old simulator GPL license.

## Tools ##
[![](http://wingware.com/images/coded-with-logo-129x66.png)](http://wingware.com/)
