# Interdependence — one design for the next features

Status: **decided 2026-10-13 — building.** Source: Maddy's feature list (maker spaces × industry, AI nodes, drones, local
governance, resident narratives, neighbourhood health, sideshows, fireworks, food pantries and banks, distribution
logistics, lane adjacencies, A* traffic costs, economic indicators, car policy, sandbox and difficulty). Arcologies are
backlog only. The bugs in the same list are in `docs/bug-queue.md`.

## The idea

Today most buildings act **alone, by radius**: a maker space mends what's within 4 tiles, a vertical farm holds homes
within its reach, a bazaar lifts nearby shops. The list asks for the opposite: a city where **things depend on each
other, and you can see them do it**. Goods move between places. Neighbourhoods hold together or fray. Residents
remember what happened to them and organise.

This design is one loop, and everything on the list hangs off it:

```
   producers ──goods──▶ distributors ──goods──▶ households
 (farms, gardens,     (food bank, pantries,        │
  industry, makers)    AI-node drone hubs)         ▼
        ▲                                  NEIGHBOURHOOD HEALTH
        │                                   (the hub: food, repair,
   lane pairings                            work, belonging, ecology)
  (who sits next to whom)                          │
        ▲                                          ▼
        └──── policy ◀── council ◀── committees & petitions ◀── residents (narratives)
```

**Neighbourhood health is the hub.** It already half-exists: belonging, voice and trust per neighbourhood, plus
ecology per tile. This design adds what a neighbourhood *gets* (food, repairs, work, deliveries) and makes health the
condition the rest reads: events, petitions and narrative modifiers.

---

## 1. Neighbourhood health (the hub)

One composite per neighbourhood, shown as an overlay and in the inspect readout:

| Part | From | Notes |
|---|---|---|
| Belonging, voice, trust | civic values (existing) | unchanged |
| Ground | soil and flora means (existing ecology) | |
| **Food access** | §2: share of homes served by a pantry, or within reach of a garden or farm | new |
| **Repair** | share of buildings in a maker space's reach, and their mean condition | from the existing condition stock |
| **Work** | §8: jobs near home ÷ working residents | new |
| Care | clinic, fire and library coverage (existing coverage field) | |

- **Health gates events.** Block parties already arise from belonging and trust; they'll read health, and they'll raise
  it (they already raise belonging). Sideshows appear at block parties in healthy neighbourhoods (§6).
- **A fraying neighbourhood shows it.** Low health means more decay and more petitions (§4). It lands harder in
  redlined districts because their inputs start low. That is the existing "damage produced by policy" direction made
  measurable.

## 2. Provisioning: food, from field to table

A real chain over the real network. These are new kinds unless noted.

- **Producers:** community gardens, vertical farms (existing), and a new **farm** plot (Green Development lane).
- **Food bank** (new civic building) collects from producers in its catchment and **distributes to pantries**. Its
  deliveries are visible as van trips on the road network, or drone legs if an AI node is in reach (§3).
- **Food pantry** (new, small, a 1×1 corner plot) serves homes within walking reach. Residents walk there as an
  itinerary stop, like a shop.
- **Adjacency bonuses** (Maddy): a garden or farm beside a pantry or bank lifts its stock. "Beside" means sharing an
  edge or within 1 tile. The bonus is a stock multiplier, not a radius change, so it reads simply: *this pantry is
  well supplied*.
- **Food access** feeds health (§1) and holds residents, as the vertical farm's "fresh food" pull does today, which
  this generalises. Where homes have no food access, the unhoused count grows a little: the existing
  homelessness-is-inherited rule gets a new cause.

**Logistics generalised:** the same shape serves repairs (§3) and parcels (drones). A **producer** has a stock and
sends it along the network to **distributors**, which serve **households** in reach. One `flows` module, three
goods: food, repair, parcels. That is the "more logistics of distribution" item, built once.

## 3. Making and delivering

### Maker spaces × industry
- **Industry supplies the makers.** A maker space within reach of industry gets materials: its repair range
  (`MAKER_RADIUS` 4) grows to 6 and its repair rate doubles.
- **The makers clean up industry.** An industrial plot with a maker space in reach turns some of its scrap into
  repairs: its ground pollution falls by a share. That makes it a circular economy you can see, as the condition
  ticks up and the smog thins.
- With **Collective Ownership**, worker-owned industry beside a maker space adds jobs (§8).

### AI nodes: dispatch, routing, drones
AI nodes today only cut evening power draw nearby. They become the city's **dispatch hubs**:
- **Routing:** *(already in the base game — every car route weighs live congestion, `driveTileCost`; nothing for the
  AI node to add here.)*
- **Drone delivery radius:** with Drone Deliveries, an AI node serves deliveries within its radius (proposed 12 tiles).
  Today `droneShopDrop` silently deletes a share of shopping trips city-wide. Instead, trips are **delivered only
  inside a hub's radius**, and the drones are drawn (next point).
- **Drones fly.** Small pixel movers fly hub → shop/bank → home and back, at roof height, with no roads and no A*: a
  straight line with a gentle arc, through the existing mover/pose pipeline. At night they carry one lit pixel. Their
  count is the deliveries in flight, capped.

## 4. Local governance

Three layers that are already implied by voice, trust and protests:

1. **Resident committees** form in a neighbourhood once its voice crosses a threshold. A small sign appears at its
   civic hall or a park.
2. **Petitions:** a committee raises one when health is low on a part it can name: *"we need a pantry"*, *"calm
   traffic on Elm"*, *"the freeway splits us"*, *"no more evictions"*. A petition is a concrete, located request
   with a deadline, shown as a pin on the map and a line in the news.
   - Answered (the thing is built, or a policy is set): trust rises, and the committee's voice carries further.
   - Ignored past its deadline: trust falls, and an unheard petition is one of the paths to a **protest**, which
     already exists.
3. **City council:** each committee sends a delegate. The council **weighs policies** (§7): car tax, parking fees,
   car-free zones, and the budget split once Participatory Budgeting is unlocked. A policy always passes, but costs
   council support (and approval) in proportion to the delegates whose neighbourhoods would lose by it — the
   political cost, separate from money.

The player never commands residents. Its work changes conditions, conditions produce petitions, and answering them is
how the player governs well. That matches the community-events rule: *events emerge from conditions*.

## 5. Resident narratives

A small cast of **named residents** (one per few hundred people, drawn deterministically) whose lives the sim
already produces:

- **Life events** are recorded from what happens: saved by an ambulance, lost a home to fire, displaced, went to a
  block party, got work at a maker space, rehoused at a tiny-home village.
- **Combinations become permanent traits** (Maddy: "certain combinations of interactions change modifiers"):

  | Events | Trait | Effect |
  |---|---|---|
  | displaced + joined a protest | **Organiser** | their committee forms sooner and its petitions carry more voice |
  | saved by an ambulance + lives near a clinic | **Volunteer medic** | their block's collapse window is longer |
  | worked at a maker space ×3 | **Fixer** | their home and neighbours mend faster |
  | lost a home + rehoused | **Survivor** | belonging recovers faster in their neighbourhood |

- They appear in the CCTV caption and the news (*"Ana, who lost her home in the March fire, now runs the pantry on 4th"*),
  and in the inspect readout of their home.
- Traits are a property of the person and stay with them through moves, so you watch someone's story across the city.

## 6. Festivity

- **Sideshows** (built 2026-10-21; Maddy: car sideshows, *"due to community stress"*, *"at intersections, … more likely
  and bigger in bigger intersections"*, *"leave tire marks"*): at night, in a neighbourhood whose health is low, cars
  take over its biggest crossing and spin donuts while the neighbours ring it. The crossing is closed to through
  traffic while it runs. Likelier the harder pressed and the bigger the junction box; a bigger box draws more cars and
  a bigger crowd. The tire marks are a saved live stock baked with the ground marks, fading over game days; the
  neighbourhood belongs a little more after. Not tied to block parties.
- **Police at sideshows** (built 2026-10-22; Maddy: "we can send police to sideshows … a boost to community stats but
  also create pollution and can injure residents, also lead to arrests with hurt trust"):
  - **The response:** a precinct within 30 tiles sends up to 2 cruisers. On the scene the crowd breaks up and they
    arrest at the full rate, staining police violence.
  - **The night out:** a sideshow lifts belonging (+4) and voice (+3). Broken up by the police, it also costs trust
    (−8).
  - **Its costs:** each hour, each car has a 4% chance of hitting a watcher, who collapses. The tire smoke is heavier.
  - **The lever:** defunding the precinct ends the response.
- **Fireworks** (built 2026-10-21): a festival still on at 20:00 puts on one show — sparks on the art grid over the
  place, drawn additively after the lighting pass, a soft pop per burst on screen. The city belongs a little more
  (so wellbeing rises) and the smoke lays a whisper of smog, so even joy has a cost.

## 7. Mobility policy

These are levers the **council** passes (§4), not toggles:

- **Car tax:** households pay per car owned. It lowers ownership and raises funds, and costs approval where transit
  is poor.
- **Parking fees** on lots and the kerb shift trips to walking, cycling and transit. The money goes to the treasury.
- **Car-free zones:** a painted area (like the block-party closure, but standing) where cars don't drive or park.
  Walking and cycling grow there, and so does nearby shops' pull.
- **Residents park extra cars on the street** (bug list): a household with more cars than its driveway parks the rest
  at the kerb near home, which makes car ownership visible and gives parking fees and car taxes something to act on.

## 8. Indicators

A small **indicators** pane in the Budget window, each a number with a trend arrow:

- **Employment:** jobs (commercial, industrial, maker, civic, each with jobs per unit) against working residents,
  city-wide and per neighbourhood. The economy already prices these plots per unit (`BASE_PER_UNIT`), so this is a
  reading, not a new simulation.
- **Food security:** the share of homes with food access (§2).
- **Repair:** the mean building condition.
- **Mode share:** trips by walking, cycling, transit and car (from the agents).
- **Neighbourhood health:** the city mean and the worst neighbourhood.

## 9. Lane pairings (civic buildings join the tech lanes)

Each civic and commons building belongs to a lane, and **pairs** with neighbours. One table, one rule:

> Two buildings that pair, **sharing an edge or within 2 tiles**, each get the pairing's bonus.

| Building | Lane | Pairs with | Bonus |
|---|---|---|---|
| Library | Anarcho-communism | Maker space | **maker range ×2** (Maddy's example) |
| Library | Anarcho-communism | School | school coverage +2 tiles |
| Community garden | Green development | Pantry / food bank | stock ×1.5 (§2) |
| Compost hub | Green development | Garden / farm | yield ×1.25 |
| Healing commons | Restorative justice | Clinic | collapse window +15 s |
| Bazaar | Gift economy | Maker space | craft fairs twice as likely |
| AI node | Solarpunk | Food bank | its deliveries go by drone |
| Co-op housing | Intentional communities | Pantry | that pantry serves +2 tiles |

- **The footprint preview shows it** (bug list: "update building footprint preview"): while placing, draw the
  building's reach ring and a faint line to each building it would pair with, plus the bonus in the tooltip. Placing
  becomes the puzzle.
- The tech panel shows each building's lane colour, so lanes mean something after you unlock them.

## 10. Sandbox and difficulty

Built 2026-10-21 (`engine/mode.ts`; chosen in the Saves window's New city, saved with the city; older saves are
standard, and standard is byte-identical to the game before it).

- **Difficulty** (gentle / standard / hard) scales three existing knobs:
  - **build costs:** 75 / 100 / 130%. The money price is scaled to the dollar; cost units (effort, a site's bill)
    are scaled and rounded;
  - **disaster rates:** crashes, violent crime and spills are drawn in half the hours on gentle, and twice in 60% of
    hours on hard. Fire's ignition chance and the share of heavy (flooding) storms are 50 / 100 / 160%;
  - **the history stage's damage:** the decay of the redline era and the inner-city decline, and the inherited
    displacement (the opening's unhoused), at 60 / 100 / 140%.
- **Sandbox:** the whole tech tree is granted at the start. Money and effort never run short (topped up each hour,
  shown as ∞). Prices stand, so a site still takes its hours to rise. Disasters are optional through the existing
  setting. The sandbox can be set only at New city.

## Order of work

Each step lands on its own and is playable. Dependencies are named.

| # | Step | Needs | Size |
|---|---|---|---|
| 0 | Bugs: elevated rail, street parking for extra cars, footprint preview (rings) | — | small each |
| 1 | **Indicators + employment** | — | small |
| 2 | **Neighbourhood health** (overlay + readout; events read it) | 1 | medium |
| 3 | **`flows` module + food chain** (bank, pantry, farm, adjacency) | 2 | large |
| 4 | **Maker × industry**; **AI-node routing (traffic cost) + drone radius + drones drawn** | 3 (flows) | medium |
| 5 | **Lane pairings** + preview lines | 3 | medium |
| 6 | **Committees, petitions, council**; **car tax / parking fees / car-free zones** | 2 | large |
| 7 | **Resident narratives** (cast, events, traits) | 2, 6 | large |
| 8 | **Sideshows, fireworks** — built 2026-10-21 | 2 | small |
| 9 | **Sandbox + difficulty** — built 2026-10-21 | — | small–medium |
| — | Arcologies | — | backlog |

## Decisions (Maddy, 2026-10-13)

1. **Neighbourhood health is the hub:** one composite per neighbourhood (§1), the parts still shown in the readout.
2. **Petitions:** answer or ignore only — no open decline.
3. **Council:** policies always pass; they **cost council support** (and approval) in proportion to the opposition.
4. **Narratives:** named residents in the news, the CCTV caption and the inspect readout — no People panel.

Status: **building**, step by step in the order above, from step 1.
