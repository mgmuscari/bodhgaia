# Tech tree audit (2026-10-07)

What each of the 43 nodes in `src/tech/tree.ts` actually does in the simulation, traced to the
code that reads it. The standard (Maddy): **every tech is either a building with a distinctive
area or resource effect, or a mechanic that switches a sim system on/off or changes its
coefficients — and the panel says exactly what.**

Verdicts: **Good** — distinctive and real. **Thin** — real, but generic or a duplicate of
another node. **Vapid** — no effect on the simulation at all.

## Headline

- **11 of 16 capability techs are vapid**: `hasCapability` is never called for them. They act only
  as gates in the prereq graph (Renewable Energy, for instance, does nothing but unlock wind,
  solar and the streetcar).
- **Four pairs of buildings are near-duplicates**, with identical entries in every table.
- **Accessory Dwelling is worse than the free classic house** (growth headroom 1.3 vs 1.5).
- **The panel cannot explain effects**: the detail pane shows flavour plus `Grants: Soil care`,
  a label derived from the capability id. There is no effect data to show.

## Capabilities (16)

| Tech | Read by | Effect today | Verdict |
|---|---|---|---|
| Walkable Streets | `main.ts` → live | Walk range ×1.5 | Good |
| Road Diets | `tools.ts` | Unlocks the road conversions (street↔avenue, planted median) | Good |
| Circles | civic dynamics, economy | +1 voice/tick everywhere; +2 social infrastructure | Thin |
| Participatory Budgeting | civic dynamics, economy | +2 voice/tick; +2 social infrastructure | Thin (same lever as Circles) |
| Gift Circles | civic dynamics | +1 voice/tick | Thin (same lever again) |
| Soil and Soul | — | nothing | **Vapid** |
| Community Land Trust | — | nothing (co-op and commune rent protection is keyed on building kind, not this) | **Vapid** |
| Shared Table | — | nothing | **Vapid** |
| Craft Fairs | — | nothing | **Vapid** |
| Bike Shares | — | nothing (bike mode needs only a bike path) | **Vapid** |
| Sun and Wire | — | nothing | **Vapid** |
| Renewable Energy | — | nothing | **Vapid** |
| Local Grids | — | nothing | **Vapid** |
| Drone Deliveries | — | nothing | **Vapid** |
| Mutual Aid | — | nothing | **Vapid** |
| Collective Ownership | — | nothing | **Vapid** |

## Buildings and transport (23 nodes, 23 kinds)

| Tech → kind | What it does | Verdict |
|---|---|---|
| Healing Commons | Fire/health coverage (r6, a land-value drag otherwise); police refuge (r3); gathering (belonging); best destination (+4 plus a buff); calm night music | **Good**, the model node |
| Wastewater Recycling → Works | The only thing that cleans contaminated water (radius) | **Good** |
| Community Gardens | Strongest soil boost; gathering; refuge; heals ground pollution r2; land-value amenity | **Good** |
| Bike Paths | Bike travel mode (2.5×); quiet ped route; non-fragmenting | **Good** |
| Streetcar Revival | Streetcar mode (3.5×) | **Good** |
| Elevated Rail | Rail mode (4.5×); otherwise the streetcar again | Thin vs Streetcar |
| Quiet Streets | Cars can't use it; ped cost 0.5; mild ecology | **Good** |
| Urban Promenades | Car-free; ped cost 0.3 (preferred route); land-value amenity | **Good** |
| Pocket Parks → Park rezone | Depaves a building; gathering; refuge; heals ground; amenity | **Good** |
| Rewilding → Rewilded rezone | Depave; ecology; nearly free to tend; not social | **Good** (a wild-vs-social contrast with the park) |
| Wind Power | 56 power, clean, 1×1 | Thin: ignores the prevailing wind its flavour names |
| Solar Arrays | 210 power, clean, 3×3 | Thin: no day/night, just a bigger number |
| Fusion Power | 3,500 power, clean | Thin: capstone by size alone |
| Community Energy Nodes | 168 power, clean, 1×1 | Thin: a better wind turbine; "resilience" isn't modelled |
| Parklets | 1×1 green: ecology, heals ground, leisure stop | Thin: a small park |
| Urban Composting → Compost Hub | Soil +4; lifestyle stop | Thin: overlaps the garden |
| Vertical Farming | Destination (+3 plus a buff); amenity. There is no food system | **Vapid** in substance |
| Bazaar / Maker Space | **Identical** in every table (commerce, gathering, refuge, +3, tending 0.08) | Duplicate pair |
| Co-op Housing / Communes | **Identical** (headroom 2.5, rent-protected); the commune is just 3×3 | Duplicate pair |
| Accessory Dwellings | Headroom 1.3, below a plain house's 1.5 | **Worse than nothing** |
| Community AI Nodes | Destination (+2), upkeep 1.5; exists to gate Drone Deliveries, which is vapid | **Vapid** |

## Tally

| | Good | Thin | Vapid / duplicate |
|---|---|---|---|
| Capabilities (16) | 2 | 3 | 11 |
| Buildings (23) | 10 | 8 | 5 (VF, AI, ADU, plus one of each duplicate pair) |

## Directions (for the design pass, not decided)

Each vapid node gets a lever on a system that already exists, so the work is mostly wiring
and coefficients, not new systems:

- **Land Trust**: becomes the source of rent protection, extending it to *every* home in a
  neighbourhood with a co-op (displacement off land value).
- **Mutual Aid**: lowers the threshold at which harms push people out of housing (the
  homelessness response coefficient).
- **Renewable Energy / Local Grids**: wind output follows the prevailing wind; solar follows the
  day; Local Grids lets an Energy Node keep its neighbourhood lit when the plant link breaks.
- **Bike Shares**: bike mode without owning a bike (raises the bike share of mode choice);
  **Drone Deliveries**: removes a share of commercial car trips (evaporation).
- **Soil and Soul**: ecology recovery rate ×; **Shared Table / Craft Fairs**: effort or wellbeing
  coefficients.
- **Split the duplicates**: Bazaar (commerce, taxed lightly, draws shoppers off strips) vs
  Maker Space (jobs, effort); Co-op (rent protection) vs Commune (pooled effort, low car
  ownership).
- **ADU**: an infill tool placed beside an existing house, raising its headroom instead of
  competing with it.
- **Panel**: add an `effects` list to each node, generated from the same constants the sim
  reads, so the text can't drift; a test fails any node whose effects are empty.
