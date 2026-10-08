# Disasters and events

Status: **decided, 2026-10-08; building fire first.** Source: Maddy's Bodhgaia notes (Disasters/Events). Builds on the death mechanic,
the live event feed and the CCTV inset (bodhgaia-opening.md), and on the rain cycle (pollution-weather.md).

## Principle

Every disaster comes out of conditions the city's history produced and the player can change. Decayed buildings
burn, old works leak, paved floodplains flood, crowded roads crash. Each one:

- is a live-layer event (renderer-side, seeded from the ambient stream);
- shows in the CCTV inset and the news;
- is mourned like any death (approval, goodwill, effort, belonging, grief).

The player's repairs are what make disasters rarer and smaller.

## The five

| Event | Where it starts (likelier with…) | What it does | What the player's work changes |
|---|---|---|---|
| **Fire** | a building, likelier in low condition, on distressed (redlined) ground, abandoned (emptied of its people), ruins and industry | burns for a while and spreads to neighbours; a building that burns out becomes a ruin; occupied homes can lose people | **a fire station dispatches a truck**, a live agent that drives the road network to the fire and puts it out on arrival; fire coverage means a short drive; healing commons cover too |
| **Industrial spill** | an industrial works, likelier in poor condition and redlined | ground and water pollution at the works; a **toxic cloud** that rides the wind and harms (and can kill) people under it | worker-owned industry and wastewater works; fewer, cleaner works |
| **Heavy rain → flood** | a rain event (the existing cycle) | low tiles near water flood for a while: buildings lose condition, residents are displaced, roads are impassable | greens, gardens and rewilded land soak up the water; paving makes it worse |
| **Traffic accident** | a jammed road | a crash: a car stops, a person can die | fewer cars: mode shift, road diets, quiet streets, drone deliveries |
| **Violent crime** | despair: unhoused people, decay, no gathering places, police violence | a death on the street | community: belonging, healing commons, circles, gathering places. **Policing does not reduce it** (Maddy: conditions, not cops); it adds to the despair |

## Shared machinery

- **`src/live/disasters/*`**, one module per event: ignition chance per hour from conditions, spread, resolution.
- **`LiveEvent` gains kinds** (`fire`, `spill`, `flood`, `crash`, `crime`) and the CCTV inset shows them; a fire's
  frame grows with the fire.
- **Fire trucks** reuse the car mover (`roadPath`); toxic clouds reuse the wind advection of smog.
- **Art:** in the game's own pipeline — palette pixel sprites at the one art scale, vehicles as movers with 8-way frames and the lights cruisers have, emissive things drawn after the lighting pass, haze through the smog field and overlay. Flames are frames; smoke is smog; a spill's cloud is toxic smog (its own field, greenish-yellow in the overlay).
- **A setting:** Disasters on/off (as in the classic city-builder). Default on.

## Order (each a stacked branch into `bodhgaia`)

1. Fire and fire trucks.
2. Industrial spills and toxic clouds.
3. Floods.
4. Traffic accidents.
5. Violent crime.

## Decisions (Maddy, 2026-10-08)

- **Crime:** conditions, not cops (above).
- **Frequency:** rare and driven by conditions, measured in real play time (a game day is ~2.6 min): the inherited
  city sees a fire every ~10 minutes of play, a healing one far fewer; spills and floods rarer still, accidents in
  jams. A Disasters on/off setting.
- **Order:** fire, spills, floods, accidents, crime.
- **The opening's toll stays** (the night's deaths cost approval and trust).

## Architecture note: fire

The live layer may not write the world, but a fire that burns a building to a ruin does. So:

- **The fire** is a simulation-side module, like revival: ignition from conditions, spread, burnout to a ruin, the
  dead and displaced. It is deterministic in (world, its rng fork, inputs), and the host steps it.
- **The trucks and flames** live in the live layer: a truck drives from the nearest fire station along roadPath,
  sprays, and the host puts the fire out.

## Architecture note: spills

A spill changes no hashed state, so it lives wholly in the live layer (`live/spills.ts`): once a game hour each
industrial works may spill (decay, redline grade, Collective Ownership ×0.25); it bursts the existing ground and
water pollution fields (a wastewater works near the water halves it) and sends a `ToxicCloud` along `state.wind`
that lays smog and kills a few people outdoors (one roll each, at most 3). Rate measured 2026-10-08: lotus's
one works spills about once in half an hour of play.
