# CLAUDE.md

Project-specific guidance for Bodhgaia. Process and methodology come from the
global config; this file covers only what is particular to this repo.

## What this is

Bodhgaia is a dharmapunk browser city-builder: a deterministic, procedurally
generated world in TypeScript (Vite + Vitest), GPL-3.0-or-later.

- **Code is `src/` / `tests/`.**
- **`README.md` is the architecture doc** — layers, fabric, the Moses-century
  history stage, the live agent layer. Read it before touching an unfamiliar
  subsystem. Design notes live in `docs/design/`, decisions in `docs/decisions/`.

```bash
npm run dev        # http://localhost:5173/?seed=<anything>  (?nointro=1 skips the opening)
npx vitest run     # tests
npm run typecheck
npm run build      # tsc + vite bundle; `vite preview` serves it on :4173
```

## Architectural invariants

- **Determinism is load-bearing.** `engine`, `worldgen`, `tech`, `tools` use only
  integer math and exactly-rounded float ops — no transcendental `Math`, no
  `Math.random`; the seeded `rng` (fork-by-label streams) is the only randomness.
  Same seed → same world across browsers. `hashWorld(world)` is the canonical hash.
- **Layer purity is test-enforced** (`tests/architecture.test.ts`): `engine` imports
  nothing upward; pure `ui/*Content.ts` modules are allowlisted and headless-tested;
  only DOM shells and `src/main.ts` touch the DOM.
- **The live agent layer** (`src/citizens/`, `src/live/` — split out of the old `ui/ambientContent.ts`
  in the 2026-10 refactor; scanned fail-closed by the architecture guard) reads the
  world but writes only its own renderer-side state on a wall clock, so it never
  touches the world hash.
- **Fabric placement functions are the single writers** of the `built`/`parcel`
  layers; everything else queries.

## How work runs here

**The playtest loop is the default.** Maddy plays the running game and reports what
she sees; fix → live-verify → ship a small PR, fast. Bigger non-playtest features
get heavier process per the global config.

**Program like the architect.** Several bugs in one subsystem usually mean one
missing abstraction — build it rather than patching symptom by symptom.

**Bug queue.** One consolidated backlog: `docs/bug-queue.md` → "THE BACKLOG" (it also
tracks the active direction). `docs/playtest-log.md` is the raw capture stream only.
Check the queue when touching related code, fix opportunistically, mark fixed with
the PR. Never call an active direction "deferred".

**"Defer" means log-and-continue, not freeze.** It's an anti-distraction
instruction: write it into the backlog and keep going. Deferred items are normal
backlog and get done in turn.

**Branch immediately after syncing main.** After `gh pr merge --delete-branch &&
git checkout main && git pull`, create the next branch before any edit. If work
lands on local `main` anyway: `git branch <feature> && git branch -f main origin/main`.

## Language: planning euphemisms

**"Blight" is a loaded term, not a neutral descriptor.** It was the legal pretext
(the redevelopment "blight finding" under CA Community Redevelopment Law) for
racialized clearance and eminent-domain displacement — West Oakland / Alameda County
urban renewal (Cypress Freeway/I-880, I-980, BART, the Acorn project) razed a
thriving Black community under it. The same holds for the whole family:
"redevelopment", "urban renewal" (Baldwin's "Negro removal"), "revitalization",
"slum clearance".

1. Use **"decay"** for the neutral, player-facing damaged state (`seedDecay`, etc.).
2. Use the loaded terms **only critically**, named as the apparatus's euphemisms and
   scoped to the Moses / oppressive-planning modes (the worldgen `BlightReport`,
   the opening's indictment, era 3 "urban renewal & highways").
3. **Never** for what the player does. The player **repairs / restores / makes
   reparation / heals / stewards / rewilds**.

Companion direction: worldgen places burdens (dirty power, industry, highways,
decay) per historically oppressive policy — redlining is discrimination-first,
terrain as cover — so damage reads as *produced by policy*, not natural.

## Live verification

- **The browser is Maddy's real Chrome.** Since 2026-10-02 the city autosaves (every
  6 in-game hours and when the tab hides) and a reload RESUMES it, so a reload or an
  HMR full-reload no longer wipes her session — but `?new` (or New city) does start
  fresh and the next autosave overwrites the city in progress. Don't navigate her tab
  to `?new`; to show a fresh city, serve a build on another port (its own storage).
  Reading `window.bodhgaia` is fine — it exists in DEV builds only (stripped from
  the published page).
- **Drive live logic via dynamic import.** In a page `evaluate`,
  `await import('/src/live/pathing.ts')` (or `/src/live/agents.ts`,
  `/src/live/fields/*.ts`, …) exposes exported internals
  (`walkPath`, `stopReachable`, `prevailingWind`, `abandonOwnedCar`,
  `routeToParking`…) against the real running `world`/`ambient` state. Set up a
  scenario by mutating `ambient` then calling the fn; measure with two-snapshot
  position diffs; toggle overlays with
  `window.dispatchEvent(new KeyboardEvent('keydown',{key:'c'}))`; probe FPS with a
  1–2 s `requestAnimationFrame` counter. Export the seam you want to confirm.

## Known gotchas

**Sprite/tile re-bakes.** Don't delete-then-rebake PNGs while Maddy is playing —
loaders fetch once, so a re-fetch in the delete window 404s and the renderer falls
back (peds → white `MODE_COLOR` boxes, cars → `CAR_COLORS` squares), which looks like
a code regression. Bake to a temp name and swap atomically, and rebuild the :4173
preview afterwards. (A sprite baked *as* a solid white box is a different bug; the
bake rejects it via `overallOpacity < 0.85`.)

**White→alpha floodfill (`whiteToAlpha`)** used to leak through narrow channels into
interior white (bus windows, clinic roof, light cars). Current mask: white-mask →
erode by `neck` (severs channels ≤ ~2·neck px) → flood from an added white border →
regrow into the eroded ring. Guards: `isIntact` (center survives) and
`overallOpacity < 0.85`. `TS_NECK` tunes the radius. Tents, peds, and long vehicles
are high-risk — re-validate them after every bake.

**Nearest-of scans bias to the upper-left.** Row-major iteration with strict `<`
breaks ties toward low indices, and ties are rampant with integer distances on flat
early-game land value. Break ties with `tieHash` (direction-neutral hash of the tile
index), not scan order.

**Greedy grid stepping dithers at barriers.** Pedestrian legs follow a committed A*
route (`walkPath`, twin of `roadPath`), recomputed per leg, not per step.

**Destination choice must check reachability, not radius.** Gate trip-stop selection
on `stopReachable` (a `walkPath`, or a `roadPath` to parking near the stop); drop
the trip at spawn if none, or isolated citizens spawn-and-despawn forever. Open
follow-up: satellite/bridge freeways need ramps so exurb citizens can commute.

**Overlay legibility.** Direct-tint overlays (civic/eco/redline/power/coverage) use
`OverlaySource.dimBase: true` plus ~0.92 fill alpha; faint alpha without a dim base
makes sparse overlays vanish.
