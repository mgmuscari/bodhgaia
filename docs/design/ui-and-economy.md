# classic UI + a Civ-style economy — inquiry (2026-09-30)

Maddy: *"fixing the menus and tech tree, they don't match up well with the pixel art and don't feel like
the classic city-builder or any other classic classic game. we also need info maps, and modals for other things. this game
needs more economy."* — and: *"take inspiration from 4x like civ for the economy … monetary budget,
probably also taxes, but new resources like community effort and goodwill, and approval rating unlocking
things like eminent domain."*

## Where we are

- **UI:** raw-DOM panels styled by one `<style>` block in `index.html` (Courier New, hard-coded hex,
  dark translucent cards, emoji tool icons). It reads as a web app laid over SNES pixel art.
- **Tech tree:** cards overlap and connector lines tangle.
- **Overlays:** six data overlays (eco, civic, redline, police, coverage, power) live behind letter keys.
  There is no minimap and no maps window. Land value, traffic and population have no overlay.
- **Modals:** only the opening modal exists — no messages, events or advisor.
- **Economy:** one currency, **communal effort**. It accrues from wellbeing every tick and is spent on tech
  nodes and builds. There is no money, upkeep or demand, and spending carries no tension.
- **Foundation PRD:** the fork dropped the classic city-builder's police budgets and growth as a win condition. A money
  economy is a deliberate departure from that, so the design must say how it stays honest to it (below).

## A. The UI language: 16-bit console city-builders, in our palette

One **window kit** for everything, built from the skin's pixels rather than CSS-drawn chrome:

- **Frames.** Bevelled 9-slice frames painted from `snesPalette` and served as CSS `border-image` data URLs.
- **Title bars and buttons.** Pixel title bars and buttons with pressed/disabled states.
- **Font.** A pixel font — self-hosted, OFL-licensed (no CDN dependency), or a small code-painted bitmap
  font if no licensed one matches.
- **Theme.** Colours as CSS variables generated from the palette, so UI and map share one palette.

The layout follows the 16-bit console city-builders screen:

- **Tool palette:** a vertical strip of pixel icons on the left, painted like the status icons, with a
  flyout per category. This replaces the emoji dock.
- **Top bar:** city name · date · funds · effort · goodwill · approval, each a pixel icon + number.
  Clicking one opens its window. This replaces the pulse pill.
- **Message bar:** a ticker under the top bar, where the advisor (our Dr. Wright) speaks.
- **Windows** (draggable, one kit): Budget, Maps, Graphs, Commons (the tech tree), Inspect, Settings, Help.

**Tech tree ("Commons")** relayout:

- the 7 branches become rows and the depths become columns;
- cards are fixed size, carrying an icon, name and cost only;
- connectors are routed orthogonally;
- the selected card's full text and "Needs" go in a detail pane, so text never overlaps.

## B. Info maps

A **Maps window**, modelled on the classic city-builder's:

- **Minimap:** the whole city, one pixel per tile, drawn from each tile's average colour, with the camera
  viewport outlined. Click to jump.
- **Map types:**
  - city form, power grid, transport, population density, traffic;
  - pollution (air, ground and water);
  - land value, wellbeing, ecology, coverage, redlining, police violence.
- **Main view:** the selected type also tints the main view, using the existing overlay machinery. The
  letter keys stay as shortcuts.
- **New data overlays:** land value, traffic, population density and building condition.

## C. Messages, events, advisor

- **Message queue + ticker.** Unlocks, blackouts, milestones, unhoused spikes and budget warnings. Each
  message can jump to its location.
- **Decision modals (Civ-style events).** An occasional choice with resource trade-offs and visible
  consequences. For example: *"Developers want the waterfront rezoned."* Taking the deal brings in funds,
  costs goodwill and displaces residents; refusing gains goodwill and costs money.
- **Advisor.** One recurring voice explains what is happening and why. The opening modal moves into the
  window kit and its clipping is fixed.

## D. Economy: four resources that pull against each other

| Resource | Earned by | Spent on | Feels like |
|---|---|---|---|
| **Funds** (money) | taxes; later grants, fees, bonds | building, **upkeep** of roads, transit, plants and services | the classic city-builder's budget |
| **Communal effort** | wellbeing (exists) — neighbours with time and trust | the commons tech tree; community-built works (gardens, parklets, repair) | Civ culture / science |
| **Goodwill** | keeping people housed, repairing harm, responsiveness, honouring commitments | contentious acts (rezoning, takings, raising taxes) | Civ diplomatic favour |
| **Approval** (0–100%, a level not a stock) | wellbeing, services, fairness of taxes, goodwill | gates powers: bonds, ballot measures, special powers (eminent domain …) | Civ legitimacy / governments |

**The central loop: the money economy pulls toward displacement, and the commons pushes back.**

1. Amenities raise land value, which raises the tax base.
2. Higher land value also raises rents. Without protection, residents are displaced into the unhoused
   count, and goodwill falls.
3. Community land trusts and co-op housing (existing tech) lock land out of that loop. They cost tax base
   and win goodwill.

The player can always choose growth. The game counts its human cost in the same units the player has to
spend. That keeps the foundation PRD honest: growth is never the win condition, but money is a real
constraint.

**Honest to the foundation:**
- Upkeep makes overbuilding (highways above all) expensive, as it was in reality.
- Funds running out degrades services but never ends the game.
- Approval rises with wellbeing, not with population.

## E. Phasing (each phase its own PR, pipelined)

1. **Window kit + restyle.**
   - Pixel font, 9-slice frames, palette variables.
   - Tool palette and top bar.
   - Fix the intro clipping and the dock running off-screen.
   - No game-logic change, so this phase is independent of the economy decisions.
2. **Commons (tech tree) relayout** in the kit, with the detail pane.
3. **Maps window:** minimap, map types, and the four new data overlays.
4. **Economy core** (headless `src/economy/`, under the fail-closed scans):
   - funds ledger, taxes, upkeep, goodwill, approval;
   - Budget window and top-bar readouts;
   - tool costs split between funds and effort.
5. **Messages + decision events + advisor.**
6. **Approval-gated powers** (bonds, ballot measures, eminent domain …) per the decisions below.

## Open decisions (Maddy's)

1. **Eminent domain.** It is the tool urban renewal used, and the opening indicts it.
   - Offer it as an approval-gated *taking* that visibly displaces and costs goodwill?
   - Offer only consent-based acquisition (a CLT buyout)?
   - Offer both, as distinct tools?
2. **Police in the budget.** The fork dropped police budgets.
   - Keep the police apparatus outside the player's ledger (it acts on the city)?
   - Or make it a budget line the player can cut and redirect to Circles?
3. **Tax model.**
   - the classic city-builder per-class R/C/I rate sliders on property value?
   - A single rate?
   - A land-value tax: tax land, not buildings, which discourages speculation and fits the city's politics?
4. **Stakes.** Is there a fail state (a recall when approval stays low), or soft consequences only?
