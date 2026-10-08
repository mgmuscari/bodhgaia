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
- **A setting:** Disasters on/off (as in SimCity). Default on.

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

## Architecture note: floods (2026-10-08)

There is no visible rain yet: the "rain" is an invisible smog→ground→water wash every ~28 s (`applyRain`), and the
audio's rain bed is never on. Floods need weather first.

1. **Storms** (live): a seeded schedule from the ambient stream — a storm every couple of game days, lasting a few
   game hours, some of them heavy. While one lasts, rain falls on screen (pixel streaks on the art grid, palette
   glass colours, after the lighting pass like other weather), the sky dims a little, and the rain bed plays. The
   28 s wash stays as it is (it is the smog balance); a storm adds washes.
2. **The flood** (sim-side, `growth/flood.ts`, like fire — it damages buildings): the flood plain is the land
   connected to water and lying low (elevation within FLOOD_RISE of the sea level). During a heavy storm the water
   climbs the plain hour by hour, faster where the ground is paved and slower where greens, gardens, rewilded land
   and forest soak it up; after the storm it recedes. A building under water loses condition each hour; its people
   leave for the duration (into the unhoused, re-homed as the water goes).
3. **Roads under water are impassable:** new routes for cars, trucks and walkers go round flooded tiles.
4. **Art:** flooded tiles are drawn with the skin's own shallow-water art (murky), translucent over what they
   cover, with the water's wave pixels; the camera shows the flood; the news says so.

## Architecture note: traffic accidents (2026-10-08)

Live layer (`live/accidents.ts`), drawn hourly by the host with its own rng fork: each car on the move (in this
city every moving car is driven by its owner) may crash on the jam under it — nothing below CRASH_JAM of
TRAFFIC_MAX, likelier the worse it is. The car just ahead is wrecked too. A wreck is nobody's to drive: its driver
gets out and walks on (or dies at the wheel); it blocks the lane ~30 s, then it's towed. A quarter of crashes
kill someone — the driver, or a walker beside the road. Drawn spun a frame round with its hazards flashing, glass
on the road, an amber pool on the GPU. Measured on lotus: one crash in ~5 minutes of play at the opening's jams.

## Architecture note: violent crime (2026-10-08)

Live layer (`live/crime.ts`), drawn hourly by the host with its own rng fork. Despair at a spot = encampments
within 3 tiles + decayed buildings within 2 + the police-violence record under it (0 where nothing harms it);
belonging (`civic/voice.ts` neighborhoodBelonging, above the opening level) takes up to 60% off, and a refuge in
reach (the same REFUGE_KINDS police respect) cuts it to 35%. Policing is never a protection: cruisers are not in
the formula, their violence is. At most one person out on the street is killed an hour, twice as likely at night;
mourned like any death (the death camera, the news). Measured on lotus: ~one life in 10 minutes of play.
