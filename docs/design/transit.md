# Transit: stops and vehicles

Status: **agreed, 2026-10-08** (Maddy: "agree"). Source: her playtest notes —
pedestrians walk on train and streetcar tracks; they don't go to the line to wait for a vehicle to pick
them up; there are no animated streetcars.

## What it is today

- Track tiles (Rail, Streetcar, ElevatedRail) are walkable, because `isWalkable` admits any non-building
  tile.
- "Riding" is walking: a Streetcar or ElevatedRail leg is a walker whose speed multiplies (3.5× / 4.5×)
  on the line's tiles, so riders run along the track.
- Trains (`live/trains.ts`) spawn on Rail and Streetcar tiles, one per 26 tiles, so small lines never
  get one. ElevatedRail has none, and nobody boards them.
- At-grade Rail is not a passenger mode at all.

## What it becomes

1. **Lines and stops (pure).** A line is a connected run of track of one family: the tram family
   (Streetcar) or the rail family (Rail ∪ ElevatedRail). Stops sit along each line every STOP_SPACING
   tiles, at a track tile with a walkable non-track neighbour. That neighbour is the stop's platform.
   They are recomputed when the fabric changes. They are deterministic and never hashed.
2. **Vehicles.** Every line runs vehicles: trams on tram lines (a short two-car sprite) and trains on
   rail lines, elevated included. They use the existing shuttle mover (`stepTrain`), give at least one
   vehicle per line, and **dwell** at each stop.
3. **Riders.** Mode choice offers a line when a stop is within reach of both ends of the leg, replacing
   "track nearby". A rider's leg:
   - walks to the boarding platform (`walkPath`);
   - **waits** there, standing and visible;
   - boards when a vehicle of that line dwells at that stop (vehicles have a capacity);
   - rides hidden, carried by the vehicle;
   - gets off at the stop nearest their destination and walks on.

   If no vehicle comes within WAIT_MAX, they give up and walk, so nobody is stranded.
4. **Tracks closed to walkers,** except where a road crosses (a level crossing). People cross the line;
   they don't walk along it.
5. **Art** in the game's pipeline:
   - a tram sprite (8-way frames, lit at night like the other vehicles);
   - a small stop sign at each platform;
   - waiting riders shown as people standing.

The golden live digest moves: walker routes and trips change by design.
