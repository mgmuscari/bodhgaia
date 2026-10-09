# Re-homing: the unhoused as people, voice as the welcome

Status: **built, 2026-10-07** (branch `feat/tech-effects`, ahead of tech-tree batch 3).
Maddy's decisions: only big roads divide neighbourhoods; displacement empties real homes; voice
protects and welcomes; a tiny-home village. No Housing First practice.

## What's wrong today

- **The unhoused count is a vacancy figure**: Σ max(0, census baseline − occupancy) per home.
  - A new home is seeded full, so **building housing never lowers it**.
  - Demolishing a half-empty home **lowers** it.
- **Rent displacement is a separate counter** (`EconomyState.displaced`), only ever summed and
  never coming back down. It isn't attached to any home, so rent protection can't be seen on the
  map.
- **Voice's only effect** is a third of the civic term in wellbeing (about 2–3% at most).
- **Neighbourhoods are street blocks**: every street is a wall. That gives a median of 6–7 lot
  tiles, and about 20% are 2 tiles or fewer (lotus/harbor/oak at 128²).

## The model

**The unhoused are a stock**, `AmbientState.unhoused` (people), saved with the city.

| Flow | In / out | Mechanism |
|---|---|---|
| Conditions worsen (smog, decay) | in | a home's occupancy drop goes to the pool |
| Rent displacement | in | each hour the economy's displaced share leaves real unprotected homes, the most valuable land first, down to each home's floor |
| Demolition | in | an occupied home torn down puts its residents in the pool |
| Arrest | — | the arrested are taken, not unhoused (their home gains room) |
| Conditions improve | out | a home's occupancy rise is drawn from the pool first, then from migration |
| Re-homing | out | each pass, homes with room below their baseline take people from the pool at a rate set by the neighbourhood's **voice** (the welcome) |
| New homes | out | a player-built home opens **empty** and fills from the pool first, then from migration |

- The city opens with the inherited pool: Σ (baseline − seeded occupancy), the same number shown
  today.
- With no voice and no building, the pool only moves on change, which keeps
  [homelessness-inherited] intact.

**Voice:**
- "Organised" means voice **above the opening level** (`SEED_VOICE` 40), on a 0..1 scale:
  `(voice − 40) ÷ 215`. The seeded voice is nobody's organising yet; counting it re-homed about 100
  people in 40 s with no action.
- **Tenant organising**: a home's displacement protection is the larger of its kind/Land-Trust
  protection and how organised its neighbourhood is.
- **Welcome**: re-homing into a home runs at `REHOME_WELCOME × organised`.

The host publishes per-home voice to live (`state.welcome`) and to the economy (`voiceAt`) after
each civic tick.

**Neighbourhoods:** for the civic layer, only avenues, highways, ramps and heavy rail divide.
Ecology's wildlife barriers are unchanged.

**Tiny-home village** (a new building, Restorative Justice, after the Healing Commons):
- Residential, 2×2, holds 12 people, no growth headroom.
- Fills **only** from the unhoused pool, never from migration.
- Tended by effort.

## Save compatibility

- A save without `unhoused` derives the pool from its vacancies, plus any legacy `displaced`
  count.
- The economy's `displaced` stays as a running total for stats only.

## Where the unhoused live (2026-10-08)

Maddy: "unhoused people must go to encampments … tents must correspond to unhoused people who are living in
them." The pool lives in **camps** (`live/camps.ts`, `AmbientState.camps`: tile → people), always summing to it:

- Someone put out of a home joins the nearest camp with room within CAMP_REACH (6), else starts one on the
  nearest open land. Someone re-housed leaves the camp nearest their new home. Deaths are taken at their camp;
  anything else that moves the pool is reconciled (losses from the largest camps; gains by the emptiest homes).
- A camp holds three tents of four (CAMP_CAP 12); a camp built over or flooded moves on.
- **Tents are drawn from the camps only** — desire-path wear keeps its beaten earth and junk but grows no tents.
  Exposure deaths, despair (crime), grievance (protests) and the tutorial read the camps.
- Saved with the city; an older save's pool camps by its emptiest homes on the first settle.
- Measured on lotus: 669 unhoused in 130 camps, 221 tents.

