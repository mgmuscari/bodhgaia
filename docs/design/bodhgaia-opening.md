# Bodhgaia: the rename, the opening and the death mechanic

Status: **planned, 2026-10-07.** Source: Maddy's notes (Exposition / Introduction / Tutorial /
Disasters). Decisions: full rename; a resident's death lies down and leaves a memorial; unhoused
residents can die at night in normal play; the Moses-century indictment answers "How did things get
this bad??" in the tutorial. Disasters come after, in a separate design.

## 1. Rename: Bodhitropolis → Bodhgaia

Everything: page title, opening, credits, README, CLAUDE.md, docs, the package name and the GitHub
repo (GitHub redirects the old URL). Not the local folder `~/esoterica/bodhitropolis`, which tooling
and memory paths point at. The `bodhitropolis` dev handle on `window` becomes `bodhgaia`.

## 2. Death and memorial (a mechanic, reused by disasters)

- **The death mechanic: `residentDies(state, ped)`** (live layer). The walker stops and lies down;
  a short animation plays; then the walker is removed.
  - An unhoused resident leaves the unhoused stock.
  - A housed one leaves their home's occupancy.
  - A memorial (candle and flowers) stays on that tile for a while, drawn by the renderer.
- **Exposure deaths:** at night only, a rare chance per hour scaled by how many are unhoused,
  lowered within reach of shelter (a healing commons, a tiny-home village). Deterministic in the
  live rng. The news ticker reports them.
- The scripted opening death uses the same mechanic.

## 3. The opening, in three acts (skippable: Esc, `?nointro`)

1. **Night.**
   - Epigraph cards: the Heart Sutra lines, then Dōgen on firewood and ash.
   - The clock opens at night. The camera follows one unhoused resident through the streets until
     they die.
   - "GATÉ, GATÉ, PĀRAGATÉ, PĀRASAMGATÉ, BODHI! SVĀHĀ!", then "The City is Awakening!!" as dawn
     breaks.
2. **Introduction.** The camera drifts across the city while the vows appear in turn, ending
   "Homage to the future Maitreya Buddha!"
3. **Tutorial.**
   - "Greetings Planner / You do not live here / You don't even live in this reality / Look at
     this place! What a mess."
   - The camera visits the worst spots in turn: heaviest smog, police violence, the densest
     unhoused, deepest decay, contaminated water.
   - "How did things get this bad??" is answered by the city's statistics and chronicle (the old
     opening).
   - "There is a lot of work to do here…", then a guided walkthrough of every panel and tool.

The copy lives in a pure content module; quotes are credited in the credits panel.

## 4. Disasters and events (separate design, later)

- Fires, with trucks dispatched.
- Violent crime.
- Traffic accidents.
- Heavy rain and floods.
- Industrial spills: they kill residents, pollute the land, and send toxic clouds on the wind.

## Order of PRs

1. The rename.
2. Death and memorial, with exposure deaths.
3. Act one, night.
4. Act two, the introduction.
5. Act three, the tutorial.
