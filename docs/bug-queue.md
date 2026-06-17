# Bug queue & active direction

Maddy reports bugs as she playtests; Claude **records them here** (need not fix immediately) and
**checks this list when touching related code** — fix opportunistically since the code overlaps.

Status: 🔴 open · 🟡 in progress · ✅ fixed (note the PR)

## ACTIVE DIRECTION

**Agent-driven simulation.** Mutate from the classic city-builder's 1989 aggregate/cellular-automata layers into an
AGENT-DRIVEN sim with the same kinds of layers (traffic, pollution, land value…), emergent from the
actual travelers. **Determinism: "seeded world, live dynamics"** — worldgen/ecology/civic stay seeded
+ reproducible (N=120 gate over the seeded starting world); dynamic layers live in the live agent
layer (non-deterministic).

- ✅ **Traffic is now agent-driven** (PR pending): the deterministic O-D generator (`generateTraffic`)
  is retired; cars lay a live `state.traffic` field as they drive, the A\* car pathfinder routes
  AROUND congestion, and peds shun it. `map.traffic` stays 0 (out of the dynamic loop; seeded-world
  determinism unaffected).
- 🔴 **Next layers:** pollution from actual traffic (cars emit on the tiles they drive); land value;
  population — all agent-emergent.

## Open

(none currently — see Fixed)

## Fixed

- ✅ **Owned cars: no freeway 2× speed / didn't prefer freeways** (PR pending) — cars now follow a
  committed A\* `roadPath` whose `driveTileCost` makes freeways cheap, and the `driving` handler runs
  2× on `RoadHighway`.
- ✅ **Owned cars parked on freeways** (PR pending) — they park at a free non-freeway spot
  (`findParkingNear`/`findCurbSpot` exclude `RoadHighway`).
- ✅ **Owned cars stacked in street parking** (PR pending) — `findCurbSpot` excludes occupied tiles,
  so a car parks at a free spot down the block instead of on top of another.
- ✅ **Owned cars drove in circles** (PR pending) — they follow a COMMITTED least-cost path, which
  cannot circle (replaced greedy step-by-step routing).
- ✅ **No cyclists** (PR pending) — a medium leg cycles again; bike-friendly infra now just lowers the
  routing cost rather than gating the mode.
- ✅ **Cars vanish at plots / when the rider gets out** (PR #44) — citizens own persistent cars that
  park and are walked to; sim-car visualization retired.

> **Root-cause theme (resolved):** PR #41–44 hardened the sim-car path; the v2 owned-car driving was
> a separate greedy reimplementation. Fix was architectural — make car-agents follow committed
> least-cost paths + park in real free spots (one abstraction, not per-symptom patches).
