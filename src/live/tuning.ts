// Live-layer TUNING (leaf module): the numeric knobs and kind tables of the ambient agent layer —
// speeds, caps, cadences, field bounds/rates, penalties. Cut-and-pasted verbatim from
// ui/ambientContent.ts; imports only the engine fabric (for the BuiltKind tables), so every live
// module can read it at import time without a cycle. Only the constants ambientContent exported
// before the split are re-exported through its barrel; the rest are live-internal.

import { BuiltKind } from '../engine/fabric';

/** Maximum elapsed time honoured in a single stepAmbient call, mirroring
 *  FixedTickLoop.maxFrameMs (loop.ts): a GC pause / debugger break / OS sleep /
 *  missed visibility reset can never spiral into a synchronous hang. */
export const AMBIENT_MAX_FRAME_MS = 1000;

/** Fixed substep size — the simulation cadence for ambient motion. */
export const SUBSTEP_MS = 50;

// Police cruisers patrol the redlined districts from their precincts (the visible
// face of the over-policing the civic layer models). One per precinct, capped.
export const CRUISER_CAP = 8;
export const CRUISER_LIFE = 400; // substeps a patrol runs before recycling back to its precinct (~20s)
export const HUNT_RADIUS = 8; // a cruiser homes in on an on-foot citizen within this Manhattan distance
export const AMBUSH_LEAD = 4; // tiles AHEAD of a citizen's heading an ambush (Pinky) cruiser aims for
export const SHY_RADIUS = 4; // a shy (Clyde) cruiser only pounces when the citizen is this close, else patrols
// Community safe-zones (the abolitionist "power pellet"): cruisers will not enter — and make no
// arrests in — the bubble around community power, so the player carves out refuge by BUILDING it.
export const SAFE_RADIUS = 3;
export const REFUGE_KINDS = new Set<number>([
  BuiltKind.HealingCommons,
  BuiltKind.CommunityGarden,
  BuiltKind.Bazaar,
  BuiltKind.MakerSpace,
  BuiltKind.Civic,
  BuiltKind.Park,
]);

// Scatter/chase cadence (the Pac-Man ghost rhythm): the fleet alternates between SCATTER (patrol the
// redlined streets, ignore people) and CHASE (hunt pedestrians + sweep arrests). Mostly chase, with
// a periodic scatter lull — so the redlined streets pulse between tense calm and active sweeps.
export const SCATTER_LEN = 140; // substeps of scatter (~7s)
export const CHASE_LEN = 400; // substeps of chase (~20s)

// Arrests: a cruiser in a redlined zone takes a nearby citizen off the street FOR NOTHING and
// drains a person from their household — the violence of over-policing, made tangible. Only in
// redlined zones (the disparity); the player ends it by defunding (no precinct → no cruisers).
export const ARREST_CADENCE = 40; // substeps between arrest sweeps (~2s)
export const ARREST_CHANCE_MAX = 0.5; // per cruiser per sweep on FULLY redlined ground (grade 255)
export const ARREST_RADIUS = 4; // a cruiser seizes an on-foot citizen within this Manhattan distance
export const ARREST_DRAIN = 1; // people removed from the household per arrest
export const ARREST_TRAUMA = 60; // wellbeing (buildingHealth) ripped from the household per arrest (heavy:
//                           half the ±HEALTH_MAX range — an arrest devastates a home, it doesn't nudge it)
// Police-violence record: each arrest stains its tile; it lingers and decays slowly (the memory of
// the harm). This is the data behind the Police Violence overlay — the inverse of a crime map.
export const POLICE_VIOLENCE_MAX = 255;
export const POLICE_VIOLENCE_LAY = 50; // stain laid at an arrest
export const POLICE_VIOLENCE_DECAY = 0.05; // per substep (~1/s) — fades slowly, so a hot zone accumulates

// Rejection-sampling budget per substep per kind: sample K random tiles and test
// the spawn predicate, never an O(mapArea) full-map scan (CRITIC-YP1).
export const SAMPLES_PER_SUBSTEP = 8;

// Float tiles travelled per 50ms substep. Cars are quicker than pedestrians.
export const CAR_SPEED = 0.12;
export const PED_SPEED = 0.05;

// Trains (Maddy feature: rails need trains). An ambient agent that rides the RAIL network as a snake
// of cells — the head advances tile to tile, each arrival shifts a new tile onto the head and drops
// the tail, so the cars follow the exact track (including its curves). It shuttles: at a dead-end the
// rail step returns the U-turn, so the train runs back the other way. Live layer, never hashed.
export const TRAIN_SPEED = 0.16; // tiles/substep — a touch faster than a car
export const TRAIN_LEN = 4; // cars per train (head + 3)
export const TRAIN_CAP = 6; // hard ceiling on concurrent trains
export const TRAIN_RAIL_PER = 26; // one train per this many rail tiles (so a longer network runs more)

// Traffic pileups (Maddy): cars sharing a tile SLOW DOWN, so congestion becomes physical — bunching,
// crawling bottlenecks — not just the lingering `traffic` field. Each car beyond the first on a tile
// adds PILEUP_K to the speed-divisor; the multiplier floors at PILEUP_MIN so a jam crawls but never
// deadlocks. Rational only (no transcendental — this file is on the pure-ui allowlist).
export const PILEUP_K = 0.7; // slowdown weight per extra car sharing the tile — a STRONG drag (Maddy: pileups
//                       should bite). Two cars ~0.59×, four ~0.32×, six ~0.22×.
export const PILEUP_MIN = 0.15; // a fully jammed tile crawls at 15% speed — dramatic bunching, but floored
//                          above 0 so it never deadlocks (cars still filter through; staggered real
//                          traffic clears, only artificially-stacked cars lockstep). Playtest knob.

/** Chebyshev radius searched around a parked car for the building its pedestrian walks
 *  to/from. Lots/curbs sit next to the demand they serve, so this stays small. */
export const LASTMILE_RADIUS = 4;

/** How close (tile radius) a parking lot's centre must be to a trip-car's destination for
 *  the car to pull in and park. Lots sit by the zones they serve, so this stays modest. */
export const PARK_RADIUS = 6;
// When the lots around a car's destination are FULL, it doesn't curb-dump on the spot (which piled
// cars up at a popular lot — Maddy) — it DRIVES to the nearest lot with a free stall within this
// (generous) radius and re-checks on arrival, circling up to MAX_PARK_SEEKS times.
export const LOT_REROUTE_RADIUS = 64;
// A lot stall only wins over a nearer STREET curb when it's within this many tiles of the curb's
// distance (lots ABSORB cars when comparably close), so a car never drives to a lot several tiles off
// when there's a free kerb stall the next tile over (Maddy). A car AT a lot still fills it (the stall
// is the nearest spot); the margin only bites when a street curb is notably closer.
export const LOT_ABSORB_MARGIN = 3;
export const PARK_CLAIM_DIST = 2; // close enough to the chosen stall → claim it now instead of driving further
export const MAX_PARK_SEEKS = 6; // circle this many times for a free stall before settling (claim nearest / curb)

/** When no lot is free, a car parks at the nearest free curb (drivable tile) within this
 *  Chebyshev radius of its destination. Crowding (near curbs taken) pushes it farther out —
 *  a longer walk for its pedestrian. */
export const CURB_RADIUS = 10;

/** Safety cap (substeps) on how long a parked car waits for its pedestrian before leaving
 *  anyway — normally the returning ped releases it sooner. ~30s at 50ms/substep. */
export const PARK_MAX_WAIT = 600;

/** Bounds + decay for the live per-building HEALTH signal: each completed citizen visit
 *  deposits the destination plot's visitValue at the citizen's home, and health eases back
 *  toward neutral (0) so it reflects RECENT trips, not all-time. Live, not hashed. */
export const HEALTH_MAX = 120;
// Slow decay so health ACCUMULATES across a home's repeated trips into a persistent,
// readable signal (a fast decay left most homes flickering back to neutral between visits).
export const HEALTH_DECAY = 0.02;

/** Transport-MODE threshold: a citizen trip whose committed path is at most this many tiles
 *  is walked (a pedestrian routes the whole way); longer trips drive. So as destinations come
 *  closer / streets calm, citizens shift out of cars — the heart of the congestion→bloom loop. */
export const WALK_RANGE = 10;

/** How far a citizen on a daily round will look for the next stop's plot (a workplace, shop, or
 *  third place). A citizen ranges across the city for a far stop (a commute) — wider than BIKE_RANGE
 *  so the longest legs genuinely warrant driving/transit, exercising the full mode spectrum. The
 *  FUEL economy still bounds reach: a stop too far to reach burns the citizen out. */
export const CITIZEN_TRIP_RADIUS = 40;

/** Mode choice: a leg up to BIKE_RANGE tiles can be cycled (bikes need no special infra — bike
 *  paths just speed them); a transit/road mode is "available" only when its network is within
 *  MODE_INFRA_RADIUS of BOTH ends of the leg. So building a tram/rail line lets the citizens whose
 *  trips it serves ride it instead of driving — the road-diet → mode-shift → bloom loop. */
export const BIKE_RANGE = 18;
export const MODE_INFRA_RADIUS = 6;

/** How long a citizen's car lingers "parked at home" after the owner's round ends, before it clears
 *  — a brief visible beat, short enough that retired cars don't pile up into a backlog. */
export const RETIRED_CAR_LINGER = 90;

/** Live, AGENT-DRIVEN traffic density (0..TRAFFIC_MAX), keyed by road tile: laid by cars as they
 *  actually drive, decayed when they don't. It IS the traffic — the macro pattern emerges from the
 *  agents, not from an aggregate field the sim paints. Cars route AROUND it (CONGESTION_WEIGHT in
 *  the pathfinder) and peds shun it; so building a bypass or calming a street shifts where cars go. */
export const TRAFFIC_MAX = 255;
export const TRAFFIC_LAY = 10; // a car adds this to its tile's live traffic per substep it drives there
export const TRAFFIC_DECAY = 1; // live traffic eases back this much per substep when no car is passing
export const CONGESTION_WEIGHT = 3; // how strongly the pathfinder/peds avoid a fully-congested tile
/** A* search bound — a car-agent's route is the committed least-cost path; abandon past this. */
export const ROAD_PATH_MAX_ITERS = 4000;

/** Live, AGENT-DRIVEN air pollution (0..POLL_MAX), keyed by tile: cars EMIT it on the tiles they
 *  drive (heavier on freeways and where they idle in congestion), and it lingers as smog, decaying
 *  slower than traffic clears. Peds shun it (a term in pedCost); its human cost reaches the city
 *  through land value (it drags a tile down). Live layer, never hashed — the smog is emergent from
 *  the actual vehicles, not an aggregate field. */
export const POLL_MAX = 255;
export const POLL_LAY_BASE = 6; // a car emits this on a surface road per substep it drives there
export const POLL_FREEWAY_MULT = 2; // a freeway carries faster, heavier traffic → twice the emission
export const POLL_CONGEST = 8; // up to this much MORE on a fully-jammed tile (idling smog)
export const POLL_DECAY = 0.4; // smog lingers — eases back slower than traffic (TRAFFIC_DECAY = 1) clears
export const PED_POLL_WEIGHT = 2.5; // a fully-smoggy tile costs about as much as a stroad to walk

// Prevailing wind: the city has one dominant wind, so smog DRIFTS downwind into plumes instead of
// only diffusing/lingering in place — the haze streaks away from its source (the freeway, the coal
// plant) across the neighbourhoods downwind. The eight compass directions as integer (dx,dy) unit
// vectors (no transcendental Math — the field is on the pure-ui allowlist).
export const WIND_DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // N
  [1, -1], // NE
  [1, 0], // E
  [1, 1], // SE
  [0, 1], // S
  [-1, 1], // SW
  [-1, 0], // W
  [-1, -1], // NW
];
export const WIND_CADENCE = 8; // substeps between drift passes (~0.4s) — the plume streaks, never teleports
export const WIND_FRACTION = 0.34; // share of a tile's smog carried one tile downwind each drift pass
export const POLL_DIFFUSE_COEFF = 0.12; // share of a tile's smog that diffuses out (isotropic) each pass
// Rain (Maddy): an occasional storm washes smog→ground→water, each conversion DILUTED (<1) so the
// pollution relocates toward the low/redlined banks rather than vanishing. Cadence/dilution are
// playtest-feel knobs. Deterministic (a fixed cadence, no rng) — stays on the pure-ui allowlist.
export const RAIN_CADENCE = 560; // substeps between storms (~28s) — "occasional"
export const RAIN_SMOG_DILUTION = 0.4; // fraction of airborne smog rained down onto the land
export const RAIN_RUNOFF_DILUTION = 0.5; // fraction of ground pollution mobilised toward water per storm

/** Live DERIVED land value (0..LV_MAX), keyed by inhabited PLOT tile (zoneTypeOf !== None): a tile's
 *  desirability, recomputed on a slow cadence from the healed land + amenity neighbours MINUS the
 *  live nuisances (pollution, traffic, decay). Unlike traffic/pollution it isn't laid by agents —
 *  it's a readout over the other layers, so it follows the water-runoff cadence pattern, not layField.
 *  Steers where citizens go and (next) how households grow. Live layer, never hashed. */
export const LV_MAX = 255;
export const LV_BASE = 90; // a bare inhabited tile, before greenery / amenities / nuisances
export const LV_FLORA = 50; // + full flora vitality on the tile (the healed land lifts value)
export const LV_FAUNA = 35; // + full fauna presence on the tile
export const LV_AMENITY = 25; // + per nearby amenity, weighted by a linear falloff over LV_RADIUS
export const LV_RADIUS = 4; // how far amenities lift / nuisances drag a plot (Manhattan)
export const LV_POLL_PEN = 70; // − the worst nearby smog (distance-weighted), the dominant nuisance
export const LV_TRAFFIC_PEN = 50; // − the worst nearby congestion (noise / danger of a jammed road)
export const LV_WEAR_PEN = 30; // − the worst nearby trampled, littered ground (decay)
export const LV_WATER_PEN = 60; // − the worst nearby contaminated water (the poisoned creek on the banks)
export const LV_ROAD_PEN = 25; // − the worst nearby crumbling road (disinvested infrastructure); bounded so
//                          the LV↔road feedback settles rather than death-spiralling
export const LV_COVERAGE_PEN = 30; // − an inhabited plot with NO fire/health station in reach (under-served)
export const COVERAGE_RADIUS = 6; // a fire station / healing commons covers tiles within this Manhattan radius
export const LV_CADENCE = 20; // recompute every N substeps (~1s) — a slow, whole-map readout
export const LV_PULL = 10; // tiles of extra distance a max-value destination can justify over a drab one

/** The green / healing / civic-green kinds that lift a neighbour's land value (the goods the player
 *  builds while healing the city). Amenity GREENS (park, garden, rewilded, parklet, promenade) are
 *  zoneTypeOf None so they don't get their own value — they raise the plots around them. */
export const AMENITY_KINDS: ReadonlySet<number> = new Set([
  BuiltKind.Park,
  BuiltKind.CommunityGarden,
  BuiltKind.RewildedLand,
  BuiltKind.Parklet,
  BuiltKind.Promenade,
  BuiltKind.PlantedMedian, // the road-diet green strip lifts the corridor it calms
  BuiltKind.HealingCommons,
  BuiltKind.VerticalFarm,
  BuiltKind.Civic,
  BuiltKind.CompostHub,
]);

/** Hard CAP on itinerary citizens out at once (perf): the live spawn target tracks total occupancy
 *  but never exceeds this. Below the ped cap, so there's still room for ambient wanderers, last-mile
 *  walkers, and respawned citizens. liveCaps.spawnPerSubstep tops up gently rather than all at once. */
// The citizen target SCALES with the city: a THIRD of the live residents are out on a round at once
// (Maddy: "cap should be sum(citizens) / 3"). No flat ceiling — busier cities put proportionally more
// people on the street; a declining one empties. liveCaps.pedCap is the only hard ceiling (perf
// safety). The divisor + per-substep top-up are settings-tunable (liveCaps), not fixed consts.

/** AGENT-EMERGENT POPULATION (live, never hashed). Each residential home carries a live OCCUPANCY —
 *  how many people actually live there now — seeded from the deterministic census baseline, then
 *  drifting on a slow cadence: toward its building's capacity where the land is prized/clean/healthy,
 *  toward empty where it's decayed/smoggy. The seeded worldgen fixes the building STOCK (hashed);
 *  only how many inhabit it is live. Total occupancy drives the spawn target + home weighting, closing
 *  the loop: more people → more trips → more traffic/pollution → lower land value → decline; healing
 *  reverses it. (Buildings actually appearing/disappearing is the deferred deterministic-growth seam.) */
export const OCC_CADENCE = 20; // re-evaluate occupancy every ~1s (a slow demographic drift)
export const OCC_RATE = 0.25; // people/cadence occupancy moves toward the ceiling / floor at a full signal (gentle)
// LAND VALUE is the ANCHOR of occupancy (it self-corrects: fewer people → less traffic → higher value).
// Neutral sits at the decayed car-city's live equilibrium so the start is metastable, not free-falling.
export const OCC_LV_NEUTRAL = 60;
export const OCC_POLL_W = 0.5; // how strongly local smog pushes residents out
// Building health is a MINOR nudge, not the driver: in the decayed start most homes carry negative
// health (unpleasant trips), so an unbounded health term death-spirals the city to empty. Cap it small.
export const OCC_HEALTH_SCALE = 120; // building-health magnitude mapped before the cap (HEALTH_MAX)
export const OCC_HEALTH_CAP = 0.15; // max ± the health term can contribute to the signal (a nudge, not a collapse)
// A city loses people but never fully empties: occupancy floors at this fraction of its seeded baseline.
export const OCC_FLOOR = 0.4;
// EXPECTATIONS (Maddy 2026-10-01: the inherited city emptied before you could act). Residents move on the
// GAP between their home's conditions and what they're used to, not on an absolute bar — an absolute bar
// drifted out of calibration every time a new nuisance (road decay, coverage…) joined land value, and the
// opening free-fell to the floor in ~3 min. For the opening OCC_SETTLE_PASSES the live fields are only
// materialising the inherited state (wear, road decay, smog ramp up from zero), so expectation simply IS the
// current signal; after that it adapts at OCC_EXPECT_RATE a pass (~10 min of play). Occupancy is the stock,
// so a gain is kept once expectations catch up. There is NO constant pull from the absolute signal (Maddy
// 2026-10-06): it made the unhoused count climb forever whatever the player did — people move on change only.
export const OCC_SETTLE_PASSES = 180;
export const OCC_EXPECT_RATE = 1 / 600;
// The INHERITED housing crisis (Maddy 2026-10-06: "we do expect high homeless population in distressed cities"):
// the city opens with each home emptied by this fraction × its redline grade (0..1) — disinvestment's displaced,
// there before the player arrives (~20% unhoused on lotus/harbor/oak, whose homes average grade ≈ 0.4) — floored
// at OCC_FLOOR. Repairs and housing then win people back; harms push more out.
export const INHERITED_VACANCY = 0.5;
/** Re-homing (docs/design/rehoming.md): a home built since the opening fills this share of its baseline per
 *  occupancy pass (~50 s to fill), from the unhoused first; any home with room below its baseline takes the
 *  unhoused back at REHOME_WELCOME × its neighbourhood's voice (0..1) of its baseline per pass (~3½ min to
 *  refill at full voice). No voice, no welcome: the inherited crisis holds until the city organises or builds. */
export const REHOME_FRESH = 0.02;
export const REHOME_WELCOME = 0.005;
/** Per-kind growth HEADROOM: how far above its seeded baseline a home's occupancy can climb when it
 *  thrives. A single house barely densifies; apartments / projects / co-ops / communes hold far more. */
export const OCC_HEADROOM: ReadonlyMap<number, number> = new Map([
  [BuiltKind.HouseSingle, 1.5],
  [BuiltKind.ADU, 2], // = ADU_HOUSE_HEADROOM: a backyard cottage is room for elders, kids and newcomers
  [BuiltKind.Apartments, 3],
  [BuiltKind.Projects, 3],
  [BuiltKind.CoopHousing, 2.5],
  [BuiltKind.Commune, 2.5],
  [BuiltKind.TinyHomes, 1], // a shelter holds its cabins' worth, no more
]);

/** Wellbeing a walking citizen loses per substep spent trudging along a road/stroad — a long
 *  road walk brings home less (the unpleasant commute). Promenades/quiet streets/green cost
 *  nothing. Subtracted from the home deposit on arrival. */
export const ROAD_WALK_PENALTY = 0.04;

/** Terrain-aware foot routing over WILD ground (empty land): lush growth is hard to push through
 *  (higher cost), a beaten desire path is easy going (lower cost) — so foot traffic self-reinforces
 *  desire paths over time. PED_GROUND_MIN floors the beaten cost well ABOVE every sidewalk (even a
 *  jammed stroad), so any street link — and a promenade the player lays — wins the route and keeps
 *  peds off the wild. Flora term adds with lushness; wear term subtracts with beaten-ness (both 0..1). */
// People keep to the sidewalk unless the street network fails them (Maddy 2026-10-02: walkers were cutting
// through every lot; 2026-10-06: "demand pathing is still way too strong" — ~1 in 5 walkers stood on bare
// ground): bare ground is no-sidewalk going — ~2× a JAMMED STROAD sidewalk (2.0 + 2·1 = 4.0), ~15× a calm
// street — and even a fully beaten path stays well above the jammed stroad, so a street detour wins unless
// it is several times longer. Desire paths form where no street connects, not because a street is busy or
// a corner can be shaved. (Wear still lowers the cost, so where paths must form they self-reinforce.)
export const PED_GROUND_BASE = 8.0; // a bare empty tile (no flora, no wear)
export const PED_LUSH = 3.0; // added to ground cost at full floraVitality
export const PED_BEATEN = 1.5; // subtracted from ground cost at full wear
export const PED_GROUND_MIN = 6.5; // floor: a fully-beaten path, still well above a jammed stroad (4.0)
/** Crossing a parking lot on foot: no sidewalk, cars backing out. */
export const PED_LOT = 1.5;

/** A worn desire path is convenient underfoot but DEGRADED (brown, littered): a citizen walking it
 *  brings home less wellbeing. A wearable tile counts as wellbeing-degrading once its wear reaches
 *  WORN_DEGRADE_MIN; each such substep taxes the home deposit by WORN_WALK_PENALTY. */
export const WORN_DEGRADE_MIN = 128; // half of WEAR_MAX — clearly a beaten path, not incidental trampling
export const WORN_WALK_PENALTY = 0.04;

/** Wellbeing a home loses when one of its citizens can't reach its destination on foot — the
 *  pathing dead-ends (e.g. blocked by a freeway) and the citizen gives up: a lost resident. */
export const FAILED_TRIP_PENALTY = 10;

/** A walking citizen's FUEL is a persistent ENERGY tank, not a per-leg budget: it is SPENT crossing
 *  terrain (a beaten path is cheap, lush wild ground dear — see `fuelBurn`) and REFILLED by visiting
 *  good plots (`refuelFor`, scaled by the plot's status/use). A citizen that chases an UNREACHABLE
 *  destination — looping without ever closing the distance — burns the tank down and gives out; this
 *  catches limit cycles LONGER than the `recent` window (RECENT_CAP), which `advanceMover`'s box-in
 *  check alone misses. On burnout mid-trip it turns back home on a small FUEL_LIMP_HOME reserve,
 *  losing GIVE_UP_PENALTY wellbeing; if even that runs out it respawns at home (FAILED_TRIP_PENALTY).
 *  Live-pass tunable. */
// A full tank — extended +250% (3.5x the old 600) so travelers reach far more of the city before
// burning out (Maddy): long multi-stop rounds and cross-town trips complete instead of giving up.
export const FUEL_TANK = 2100;
export const FUEL_LIMP_HOME = 200; // the reserve granted on give-up, just enough to drag itself home
export const FUEL_BURN_BASE = 1; // fuel spent per substep on a paved/built/bare tile
export const FUEL_BURN_LUSH = 0.8; // extra burn at full floraVitality — lush ground is tiring
export const FUEL_BURN_BEATEN = 0.7; // burn saved on a fully-beaten path — easy underfoot
export const FUEL_BURN_MIN = 0.3; // floor on per-substep burn
export const FUEL_REFUEL_BASE = 120; // base fuel a visit hands back
export const FUEL_REFUEL_PER_VALUE = 30; // × the plot's visitValue (−4..+6): healing refuels lots, industry ~none
export const GIVE_UP_PENALTY = 4;

/** Desire-path WEAR: pedestrians beat a path through WILD-GREEN ground (empty land whose flora
 *  is at least WEAR_FLORA_MIN). Each ped on such a tile adds WEAR_RATE per substep up to
 *  WEAR_MAX; unused wear decays by WEAR_DECAY so a path regrows once foot traffic reroutes
 *  (e.g. onto a promenade the player lays down). Live/cosmetic — the deterministic ecology
 *  layers are read, never written. */
export const WEAR_MAX = 255;
export const WEAR_RATE = 1.5;
// Slow decay so repeated crossings ACCUMULATE into a bold, persistent desire line instead of
// a single faint crossing fading at once; the path still regrows over minutes if foot traffic
// reroutes (e.g. onto a promenade the player lays down).
export const WEAR_DECAY = 0.02;

/** Water-runoff pollution: water tiles are impassable and instead collect runoff from the
 *  ground around them, growing heavily polluted over time. Computed every WATER_RUNOFF_CADENCE
 *  substeps; each ground 4-neighbour sheds RUNOFF_* into the water tile (paved/built/worn ground
 *  sheds most, wild ground least), accumulating toward WATER_POLL_MAX. Live/cosmetic. */
export const WATER_POLL_MAX = 255;
export const WATER_RUNOFF_CADENCE = 20;
export const RUNOFF_URBAN = 2; // a paved/built ground neighbour
export const RUNOFF_WILD = 0.4; // a wild/empty ground neighbour
export const RUNOFF_WORN = 2; // extra when that ground is a beaten desire path
export const RUNOFF_INDUSTRY = 4; // an industrial neighbour (the toxic source), grade-scaled up to 2x
export const WATER_FLOW_FRACTION = 0.25; // share of a tile's pollution that flows downstream per cadence
export const WATER_TREAT_RADIUS = 6; // a wastewater works cleans water within this Manhattan radius
export const WATER_TREAT_AMOUNT = 30; // pollution removed at the works per cadence (falls off with distance)

/** Ground pollution: the LAND analogue of water runoff. Industry + dirty power + the litter/wear of
 *  demand paths poison the ground they sit on and the land around them, accumulating toward
 *  GROUND_POLL_MAX and clearing slowly once the source is gone (a lingering toxic legacy the player
 *  heals). The real source that then runs off into the creeks. Whole-map scan on a slow cadence;
 *  live/cosmetic, never hashed. */
export const GROUND_POLL_MAX = 255;
export const GROUND_RUNOFF_CADENCE = 20; // substeps between ground-contamination passes (matches water)
export const GROUND_INDUSTRY = 5; // an industrial tile poisons its own ground, grade-scaled up to 2x
export const GROUND_PLANT = 6; // a dirty power plant poisons the ground under it
export const GROUND_SEEP = 1.5; // an industrial/plant NEIGHBOUR seeps into adjacent ground (the plume)
export const GROUND_LITTER = 3; // demand-path litter/wear leaches in, scaled by the tile's wear
export const GROUND_DECAY = 0.8; // lingers — contaminated land is slow to recover (but reparable)

// Abandoned cars: an arrested citizen is removed from the game, so their car is left a DERELICT —
// dumped on an empty tile (not driven home), where it slowly RUSTS into ground pollution and then
// disappears, leaving a contaminated patch the player must heal (the toxic legacy of the apparatus).
export const ABANDONED_DEGRADE_TIME = 2400; // substeps a wreck sits before it has fully rusted away (~2 min)
export const ABANDONED_GROUND_POLL = 0.35; // ground pollution it leaks per substep (outpaces GROUND_DECAY)

/** Road decay: redlined roads crumble (the city won't maintain the disinvested districts), while
 *  roads in a CARED-FOR neighborhood (land value at/above ROAD_CARED_LV) recover. Crumbling
 *  scales with the road tile's redline grade, so greenlined roads stay sound. Live/non-hashed. */
export const ROAD_DECAY_MAX = 255;
export const ROAD_CADENCE = 30; // recompute road decay every N substeps (a slow infrastructure clock)
export const ROAD_CRUMBLE_RATE = 6; // decay added per cadence to a fully redlined, uncared road
export const ROAD_RECOVER_RATE = 24; // decay removed per cadence where cared-for — recovery clearly
//                               outpaces crumbling so a healed district's roads visibly mend
export const ROAD_CARED_LV = 100; // local land value at/above which roads get maintained (recover)

/** Substeps a pedestrian spends INSIDE its destination building before walking back to the
 *  car: a base plus a seeded spread so visitors don't all return together. ~3–13s. */
export const INSIDE_DWELL_MIN = 60;
export const INSIDE_DWELL_SPAN = 200;

/** How strongly a car prefers to continue straight through a junction vs. turn (the
 *  weight of the straight-ahead option against each side option). High enough that
 *  cars read as through-traffic running a vertical/horizontal road block, low enough
 *  that they still occasionally turn. With 4 ways open: straight ~8/10, each turn
 *  ~1/10. Live-pass tunable. Peds keep uniform choice (weight 1). */
export const CAR_STRAIGHT_WEIGHT = 8;

/** How many recently-visited tiles a car remembers for loop avoidance. Big enough to
 *  span the perimeter of a small block (a 2x2 ring is 4, a 3x3 ring is 8), so a car
 *  that has been all the way round is boxed in and despawns rather than circling. */
export const RECENT_CAP = 8;

/** Minimum faunaPresence (0..255) for a bird flock to consider a tile. */
export const FAUNA_THRESHOLD = 96;

export const FLOCK_MIN = 3;
export const FLOCK_MAX = 7;

// Boids tuning (sqrt-normalized — no trig). Gentle so a flock stays cohesive.
export const BIRD_MAX_SPEED = 0.08;
export const BIRD_COHESION = 0.012;
export const BIRD_ALIGN = 0.04;
export const BIRD_SEPARATION = 0.02;
export const BIRD_SEP_RADIUS2 = 1.0; // squared tile distance under which separation kicks in

/** Substeps (50 ms each) a held vehicle waits before re-planning its route round the blockage (~2 s). */
export const STUCK_REPATH = 40;
/** Substeps before a held vehicle turns back the way it came and re-plans from there (~4 s). */
export const STUCK_UTURN = 80;
/** Substeps before a jammed agent gives up on its current stop and moves on (~6 s). */
export const STUCK_GIVE_UP = 120;
/** Wellbeing a household loses when one of its citizens abandons a stop to a traffic jam (small). */
export const JAM_SKIP_PENALTY = 3;
/** Substeps before a held vehicle squeezes through anyway — breaks circular deadlocks (~8 s). */
export const STUCK_ESCAPE = 160;

/** Per-direction cap when measuring a same-kind run: widths are 2–3, so a short cap
 *  ranks the two axes (the shorter run is the road's width) without scanning a whole
 *  freeway's length, and classifies end tiles the same as mid tiles. */
export const LANE_SCAN_CAP = 3;

/** How far (Manhattan) a trip end reads congestion. */
export const JAM_RADIUS = 2;
/** The share of driving trips that evaporate in a full jam. */
export const EVAPORATION = 0.25;

/** Player GREENS whose presence heals the soil around them (mirrors the renderer's de-pave set):
 *  parks, gardens, rewilded land, parklets. The player restores by greening, never "redeveloping". */
export const GREEN_HEAL_KINDS: ReadonlySet<number> = new Set([
  BuiltKind.Parklet,
  BuiltKind.CommunityGarden,
  BuiltKind.Park,
  BuiltKind.RewildedLand,
]);
export const GREEN_HEAL_RADIUS = 2;
export const GROUND_GREEN_HEAL = 0.6; // extra decay multiplier on ground pollution within reach of a green

// ── Tech-tree buildings' area effects (docs/design/tech-tree-balance.md, batch 3) ───────────────────────────
/** Parklets take parking: homes within PARKLET_RADIUS of one drive PARKLET_SHIFT fewer of their trips (they walk). */
export const PARKLET_RADIUS = 3;
export const PARKLET_SHIFT = 0.25;
/** Community AI Nodes schedule trips: a car trip starting within AI_NODE_RADIUS evaporates AI_EVAPORATION_BOOST×
 *  as readily in a jam (errands combined, shared, moved off the peak). */
export const AI_NODE_RADIUS = 8;
export const AI_EVAPORATION_BOOST = 2;
/** Vertical farms: fresh food within FRESH_FOOD_RADIUS adds FRESH_FOOD_PULL to a home's occupancy signal. */
export const FRESH_FOOD_RADIUS = 6;
export const FRESH_FOOD_PULL = 0.05;
/** Accessory dwellings: a house beside one (8-neighbour) can fill to this × its first residents (was 1.5). */
export const ADU_HOUSE_HEADROOM = 2;
