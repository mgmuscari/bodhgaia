# Tech tree balance pass: every tech does something exact

Status: **proposed, 2026-10-07.** Follows [tech-tree-audit.md](tech-tree-audit.md). Maddy's
decision: keep all 39 nodes and give each one a mechanic. No pruning, and the prereq graph is
unchanged.

## The rule

Every node is one of two things, and the panel states its effect in numbers:

1. **A building with a distinctive area or resource effect**: something within *r* tiles changes,
   or it produces or consumes something nothing else does.
2. **A practice that switches a sim mechanic on or off or changes a coefficient**: from X to Y,
   named.

## The missing abstraction: `TechEffects`

Today each capability that does anything is hand-wired: `hasCapability('circles')` in
`economy.ts`, a `walkable` callback in `main.ts`, booleans in `civic/compose.ts`. Eleven
capabilities are wired nowhere, and the panel can't say what any of them do.

**New pure module `src/tech/effects.ts`:**

- `TechEffects` is one flat record of named coefficients, and `NEUTRAL_EFFECTS` holds today's
  values. Example fields: `walkStretch: 1`, `bikeRange: 1`, `occFloor: 0.4`, `taxPain: 1`,
  `soilRecovery: 1`, `arrestRelease: 0`.
- Each node declares `effects: Effect[]`, where an Effect is
  `{ key, op: 'set' | 'mul' | 'add', value }`. Building nodes declare their area effects the same
  way, through the kind's own tables.
- `resolveEffects(tree, state)` folds the unlocked nodes over `NEUTRAL_EFFECTS` and returns the
  record.
- The host resolves the record once per unlock (and on load), then hands plain numbers to:
  - live (replaces `state.walkable`)
  - economy (the `ECON` overrides)
  - civic (replaces `CivicCaps`)
  - power
  - ecology

  None of these layers imports `tech`; the architecture guard stays as it is.
- `effectLines(node)` renders each Effect as an exact sentence ("Walk range: 10 → 15 tiles"). It
  reads the same constants the sim reads, so the text can't drift. Building nodes get a
  `kindEffectLines(kind)` built from the same tables (radius, output, headroom).

**Contract tests:**

- **Every node has at least one effect line.** This test lands first, listing every currently
  vapid node in an allowlist, and passes. The allowlist must reach empty before the pass is done.
- **Every `TechEffects` key is read** by a behaviour test in its own system (the key changes a
  probe's output).
- **Neutral is a no-op.** With nothing unlocked, the golden live digest and `hashWorld` are
  byte-identical.

## Every node, exactly

✅ = already real (gets its effect text); ✳️ = new mechanic.

### New Urbanism

| Node | Effect | Seam |
|---|---|---|
| Walkable Streets ✅ | Walk range 10 → 15 tiles | `chooseMode` |
| Road Diets ✅ | Unlocks road conversions (avenue ↔ street, planted median) | tools |
| Parklets ✳️ | 1×1 green on a kerb that **removes the parking spaces within r2**. Homes within r3 drive 25% fewer trips (their cars find no stall, so people walk) | `ensureOwnedCar`, drive choice |
| Quiet Streets ✅ | No through traffic; foot cost 0.5 (preferred walking route) | network, pathing |
| Urban Promenades ✅ | Car-free; foot cost 0.3; lifts land value of neighbours | pathing, land value |
| Streetcar Revival ✅ | Streetcar travel mode, 3.5× walking speed between stops | modes |
| Pocket Parks ✅ | Turns any building into a park: gathering place, police refuge r3, heals ground r2 | civic, police, pollution |

### Green Development

| Node | Effect | Seam |
|---|---|---|
| Soil and Soul ✳️ | Soil recovery on open land ×2; paved soil ceiling 40 → 60 | `ecologyTick` |
| Urban Composting ✳️ | Compost Hub: **gardens and vertical farms within r4 need half the tending effort**; soil +4 | economy tending |
| Community Gardens ✅ | Strongest soil boost; gathering place; refuge r3; heals ground r2 | ecology, civic, police |
| Vertical Farming ✳️ | **Fresh food**: homes within r6 hold their residents (+0.05 occupancy pull) | `occupancySignal` |
| Wastewater Recycling ✅ | Cleans contaminated water within its radius; the only source of water repair | pollution |
| Rewilding ✅ | Turns any building into wild land: ecology boost, tends itself (0.02 effort) | ecology |

### Restorative Justice

| Node | Effect | Seam |
|---|---|---|
| Circles ✳️ | **Half of all police stops go to a circle instead of an arrest** (no arrest, no violence mark); voice +1/tick | `police.ts` sweep, civic |
| Community Land Trust ✳️ | **Homes within r4 of a co-op, commune or healing commons are rent-protected** (counted in protected share, so they are not displaced by land value) | `readings.ts` protectedShare |
| Healing Commons ✅ | Fire/health coverage r6; refuge r3; gathering place; best destination (+4); calm night music | land value, police, civic |
| Participatory Budgeting ✳️ | **Taxes cost half the approval** (tax pain 1.2 → 0.6); voice +2/tick | `ECON.taxPain`, civic |

### Intentional Communities

| Node | Effect | Seam |
|---|---|---|
| Shared Table ✳️ | Burnout heals ×2 (0.002 → 0.004/tick) | `ECON.burnoutHeal` |
| Accessory Dwellings ✳️ | Placed **beside a house**: that house's growth headroom rises 1.5 → 2.0 (densify without demolition). Its own headroom becomes 2.0 | occupancy capacity |
| Co-op Housing ✅ | Rent-protected; headroom 2.5 | economy, occupancy |
| Maker Spaces ✳️ | **Fix-it shop: buildings within r4 regain condition** (+1 per revival pass) | `growth/revival.ts` |

### Gift Economy

| Node | Effect | Seam |
|---|---|---|
| Gift Circles ✳️ | Commons tending −25% effort; voice +1/tick | economy tending, civic |
| Urban Bazaars ✳️ | **Shops within r4 are assessed +25%** (the bazaar draws a crowd), plus its own gathering place | `readings.ts` base.c |
| Craft Fairs ✳️ | Each Maker Space and Bazaar adds +2 effort capacity | economy socialInfra |
| Bike Shares ✳️ | Bike range 18 → 27 tiles | `chooseMode` |

### Solarpunk

| Node | Effect | Seam |
|---|---|---|
| Sun and Wire ✳️ | Rooftop solar: **daytime home power demand −25%** (07:00–18:00) | `demandAt` |
| Renewable Energy ✳️ | Hydro, wind and solar output +25% | `plantOutput` |
| Local Grids ✳️ | **Homes within r4 of an Energy Node are never shed** in rolling blackouts | power shed order |
| Community Energy Nodes ✅ | 168 clean power, 1×1 (with Local Grids: a blackout island) | power |
| Bike Paths ✅ | Bike travel mode 2.5× on the path; non-fragmenting | modes |
| Elevated Rail ✳️ | Rail mode 4.5×, plus **tiles within r2 of the line gain land value** (station effect) | land value |
| Drone Deliveries ✳️ | Half of shopping trips by car don't happen (delivered) | trip choice |
| Wind Power ✳️ | Output **gusts hour to hour, ×0.4–1.6, strongest at night** (hash, deterministic) | `computePowerGrid` clock |
| Solar Arrays ✳️ | Output **follows the sun**: full at noon, 0 at night, so the evening peak needs wind, nodes or storage | `computePowerGrid` clock |
| Fusion Power ✅ | 3,500 steady clean power (capstone) | power |

### Anarcho-Communism

| Node | Effect | Seam |
|---|---|---|
| Mutual Aid ✳️ | **Neighbours take people in**: occupancy floor 0.4 → 0.5 of a home's baseline | `OCC_FLOOR` |
| Collective Ownership ✳️ | Worker-owned industry: a day at the plant costs −1 wellbeing instead of −4 | `plotWellbeing` |
| Communes ✳️ | Residents **own no cars**; their effort regeneration ×2 | `ensureOwnedCar`, economy |
| Community AI Nodes ✳️ | Scheduling: **car trips within r8 evaporate twice as readily in a jam** | `tripEvaporates` |

**Duplicates resolved:**

- **Bazaar vs Maker Space:** Bazaar is the commerce catalyst (tax radius); Maker Space is the
  repair shop (condition radius).
- **Co-op vs Commune:** Co-op is rent protection and density; Commune is car-free and
  effort-rich.
- **Streetcar vs Elevated Rail:** the rail line adds a station land-value effect.

**Already real:** 14 ✅. **New mechanics:** 25 ✳️ (14 practices, 11 buildings).

## Batches (each pausable, each an atomic set of commits)

1. **The abstraction.**
   - `effects.ts`, `resolveEffects`, `effectLines`, and an "Effects" block in the panel detail.
   - Migrate the five existing capabilities onto it; the neutral-is-a-no-op test.
   - The allowlist test, starting with the vapid list.
2. **Practices (capabilities).** The 11 vapid capabilities plus the three voice-only ones; each
   is TDD'd in its own system. The allowlist shrinks.
3. **Buildings.** Area effects for Parklet, Compost Hub, Vertical Farm, ADU, Maker Space, Bazaar,
   Commune, AI Node, Elevated Rail; wind and solar curves.
4. **Live check in her browser, then tune** costs and magnitudes from play. Every magnitude above
   is a starting value.

## Risks / one-way doors

- **Wind and solar curves change the power balance** of any city already running those plants.
  Saves load fine (the effects come from the unlocked set), but a city leaning on solar will see
  evening shortfalls appear. That is intended; flag it in the release note.
- **Effects that write the hashed world** (Soil and Soul via ecology, Maker Space via condition)
  are player-driven, like tools. Determinism holds because the effects are a pure function of the
  saved tech state.
