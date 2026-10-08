# Community events

Status: **decided, 2026-10-08; queued after the disasters** (floods, accidents, crime). Source: Maddy's list —
craft fairs, block parties, festivals, parades, protests, riots.

## Decisions (Maddy, 2026-10-08)

- **All events emerge from conditions.** Nothing is called by the player: a well, organised neighbourhood throws
  parties on its own; a harmed one protests. The player's work changes the conditions.
- **Riots are framed as an uprising after police violence:** they come from police violence and displacement when
  protest goes unheard; fires break out; sending police escalates; voice, refuges and healing commons calm it.
- **Art goes through the game's own pipeline** (palette pixel sprites at the one art scale, crowds are the existing
  people sprites, lights after the lighting pass, smoke through the smog field). **Festivities hang tiny prayer-flag
  strings, single-pixel style** — one art pixel per flag, the five colours in order (blue, white, red, green, yellow),
  strung between poles across a street or round a green, two frames of flutter.

## The six (defaults — to confirm in play)

| Event | Arises where (per neighbourhood, drawn hourly) | What is seen | What it does |
|---|---|---|---|
| **Craft fair** | a maker space or bazaar, Craft Fairs practised, belonging high | stalls (tiny awnings) at the bazaar, a crowd, prayer flags | money from trade; social infrastructure |
| **Block party** | high belonging and trust, a quiet street | the street closed to cars, tables, a crowd, prayer flags | belonging and trust up |
| **Festival** | city-wide: approval and trust high, a park or civic hall | a big crowd in the park, flags round the green, lanterns at night | wellbeing and approval up |
| **Parade** | a festival day | a procession along an avenue with flags; cars wait | as the festival; traffic held |
| **Protest** | displacement, police violence or deaths in the neighbourhood, and some voice to speak with | a crowd with placards (1–2 art px) at the civic hall, precinct or centre | voice up; approval falls while the cause stands |
| **Uprising** | protests that went unheard (the grievance persists) and police violence | crowds, fires (the fire module), smoke | damage; cruisers sent escalate it; voice, refuges and healing commons calm it |

## Shared machinery

- `live/events/*`: an hourly draw per neighbourhood from civic + live conditions; an event has a place, a crowd
  (people drawn from the neighbourhood's homes, walking there with `walkPath`), a duration and its effects.
- `LiveEvent` kinds for the camera and the news; the CCTV inset shows a protest or an uprising, not a party.
- Art: prayer-flag strings, stalls, tables, placards — palette sprites in `snesAgents`/a sibling module; crowds are
  `@sprite/ped`; an uprising's fires and smoke are the fire module's.
