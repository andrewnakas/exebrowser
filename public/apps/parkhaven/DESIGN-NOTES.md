# Parkhaven: design notes

Decisions taken while building Parkhaven from the functional spec, and every place where
the spec left a gap that we filled ourselves. "Spec" means `cleanroom/parkhaven/SPEC.md`.

## Architecture

| Module | Role |
|---|---|
| `js/sim.js` | `Game`: calendar, money, weather, park rating, guest generation, research, marketing, objectives, notices, save/load |
| `js/guests.js`, `js/guestlogic.js` | guest movement and needs; the decision rules are pure functions in `guestlogic.js` |
| `js/rides.js`, `js/track.js` | ride placement, operation, test runs, breakdowns; track pieces, geometry and vehicle physics |
| `js/ratings.js` | rating formulas, ride value, upkeep, park rating, spawn probability (pure) |
| `js/staff.js`, `js/build.js`, `js/world.js`, `js/scenario.js` | staff, construction actions, the tile world, starting maps |
| `js/gfx/*` | WebGL 2 renderer and procedural models |
| `js/ui.js`, `js/input.js`, `js/audio.js`, `js/main.js` | DOM interface, input, synthesised sound, game loop |

The simulation never touches the DOM or WebGL and runs unchanged in node (the tests in
`cleanroom/parkhaven/tests/` drive it headlessly). All simulation randomness goes through one
seeded PRNG (`js/rng.js`, sfc32 seeded by splitmix32) whose state is saved, so a loaded game
continues identically to the original (there is a test for this).

## Rendering and camera

- Spec 9.1 option 1: an orthographic WebGL 2 camera at 30 degrees elevation, rotatable in
  90 degree steps (Q / E or the HUD buttons, animated), wheel / pinch zoom, right-drag, Look
  tool drag, one-finger drag, WASD / arrow keys and optional edge scrolling.
- The world is x-east / y-south / z-up, which is left-handed; the view matrix folds in a
  mirror so the picture is not reflected (a "right" curve turns right on screen).
- A single static world mesh (terrain, paths, scenery, stalls, ride bases, track) is rebuilt
  when the world changes (about 30 ms); guests, staff and litter are GPU-instanced; ride motion
  and vehicles are drawn per frame with model matrices. People on flat rides are drawn in their
  seats; coaster riders appear as heads in the cars.
- All art is procedural low-poly geometry with flat colours (no textures, no image files).
- Picking ray-marches the height map; elevated track is picked by its projected position.

## World

- **Terrain is a vertex height map** (one height per tile corner) rather than the spec's 19
  per-tile slope shapes. This gives smooth hills and no cliffs; it keeps paths and pieces simple.
- Map 64 x 64; the outer ring is unusable. Heights are stored in hu and move in 2 hu steps.
- **Paths auto-fit the terrain**: flat, a one-step ramp, or (on awkward corners) flat at the
  highest corner with a support. One path per tile; no bridges or tunnels (track may pass over
  paths). Path cost 12 cr + 5 cr per step of support.
- **Terraforming** raises or lowers a whole tile (flattening first if it is uneven) at 2.50 cr
  per corner per hu. Because corners are shared, it is refused when any of the 8 neighbouring
  tiles holds a path or structure. No water tool in v1 (scenario water only).
- Land: buy land / construction rights on tiles marked for sale (ownership overlay shown while
  the Land tool is active, or from Menu > View).

## Guests (spec 6)

Implemented as specified, with these tunings (all flagged [D] in the spec or gaps):

- Hunger falls 4 per needs update (the spec's recommended value).
- **Thirst also falls 2 per needs update** for everyone (the spec only drains thirst in heat,
  on benches and while eating, which left guests almost never thirsty in cool months).
- The random ride-choice roll is doubled (2 x 2184 / 65536, or 2 x 8192 with a map) so small
  parks feel alive; guests passing a queue consider rides they have not ridden (2 in 3) or
  have ridden (1 in 5). Rejections only cost happiness when the guest set out for the ride.
- A guest who has found nothing to ride after 5 x 2048 ticks loses 64 happiness (spec: 128)
  and heads home, but only if at least one ride is open.
- Guests caught in rain without an umbrella lose 2 happiness target per needs update; with an
  umbrella they are unaffected and may ride unsheltered rides.
- Guest **pathfinding uses breadth-first distance fields** from each destination, recomputed
  when paths change, instead of the bounded junction-depth search. To keep confusing networks
  meaningful, guests without a map take a random turn 3% of the time when heading somewhere;
  the 200-decision "can't find ride" countdown and the lost counter work as specified. The 2 x 2
  "plaza" rule is not needed with distance fields.
- A guest who is leaving but cannot reach the exit for a very long time (900 attempts) is
  removed so the park cannot fill with stuck guests.
- Weekly guest warnings count a thought as "fresh" for 1024 ticks (the spec's 220-tick window
  almost never coincides with the weekly check).
- Queues: guests stand in slots 0.33 tiles apart along the queue line; capacity follows from the
  queue length (minimum 3 at a bare entrance). Queue time, "waited too long" and giving up
  follow spec 6.7.
- Benches seat 4; vandals break benches, bins and lamps. **Handymen mend broken furniture**
  when they pass it (spec 6.11 left this choice open).

## Economy, rating, objectives

- Money is integer cents. Finance table, loan, weekly interest, fortnightly upkeep, wages,
  research cost, park value, company value and the park rating follow spec 3 and 4.
- **Upkeep length term**: `len_mult x L / 1024` is read in the reference's 0.10-cr units
  (x10 in cents), because that is the only reading that reproduces the spec's own worked
  example (12.96 cr per fortnight).
- The turn-rating table values are applied literally as hundredths, as the spec states.
- Three scenarios, one per objective type, plus a sandbox:
  Willowmere Green (attendance 400, rating 600, end of year 2, pay-per-ride),
  Copperhill Quarry (park value 30,000 cr by end of year 3, pay-at-gate),
  Saltmarsh Bay (3,000 cr of ride tickets in a month before end of year 3), Open Meadow (sandbox).
  The global "rating under 200 for 4 weeks" failure applies after the first month.
- Success and failure both offer to continue as a sandbox.

## Rides

- Flat rides: Carousel, Teacup Twirl (spinning cups), Swingboat (ship; 3 x 5 footprint
  including its clearance), Sky Drop (drop tower, 32 hu), Lookout Tower (observation tower,
  40 hu). Tower heights are fixed per type in v1. Ratings use the spec's base + option + scenery
  (+ proximity score 0 for flat rides). The Lookout Tower counts as sheltered for rain; the
  spec's "E/4 when 5/8 sheltered" tower rule is not applied (it would only penalise an
  enclosed cabin).
- Flat rides sit on a level platform at the highest ground under them (ground may vary by up to
  one land step). Entrances and exits go on any tile beside the footprint.
- **Steel Coaster** with a piece-by-piece builder (spec 8.7.2 piece set: station, straight,
  brakes, lift flag, gentle and steep slopes and transitions, small/large flat and banked
  curves, bank transitions, sloped small curves, vertical loop left/right). The builder takes a
  *target* (direction, slope, bank, special) and automatically places the next transition piece
  toward it. Coaster banking, steep slopes and the loop are researched.
  - Geometry: tile = 3 m, hu = 0.75 m. Curves are true circular arcs (radius 1.5 / 2.5 tiles);
    slopes use cubic Hermite profiles so pitch is continuous; the loop is a 3 x 2 piece that rises
    12 hu and exits one tile to the side.
  - Physics: gravity along the averaged pitch of all cars, `-0.02 v - 0.0045 v|v|` drag (a 30 m
    drop gives about 22 m/s), lift and brakes as specified, 2 m/s station launch. A train that
    runs out of speed fails its test and the ride closes with an explanation.
  - G-forces use the spec's linear "game g" model with per-piece factors, smoothed per tick;
    drops, airtime, inversions, turns, lifts and shelter are measured or derived as in 8.7.3.
  - **One train per coaster** (no block sections, so no crashes). Cars per train 1-8, limited
    to what the station length holds.
  - Proximity score implements a subset of 8.7.5: water above/at/near surface, track on the
    ground, queue/footpath under and over, own/other track close or stacked, scenery beside,
    path beside, cutting. Loop-threading and interlocking-loop bonuses are omitted.
- **Go-Karts**: powered karts (9 m/s flat, 6 up, 12 max), 1-12 karts, laps 1-10, piece set
  plus a 1-tile tight curve; no S-bend. Karts run continuously; the race bonus applies when 4 or
  more karts run.
- **Splash Flume**: boats on a channel, rising pieces act as a 5 m/s conveyor, a gentle current
  keeps boats moving on the flat, a splash-down is the first flat piece after a steep descent.
- Vehicles: during a test only one vehicle runs; afterwards all of them run, each queueing
  behind the one ahead.
- **Breakdowns** follow 8.10 (reliability, weights, downtime, mechanic calls, inspections).
  Simplified effects: a safety cut-out halts vehicles on lifts / leaving the station, others
  finish their lap; restraint and vehicle faults behave like a cut-out; brake failure makes a
  coaster sail through the station until fixed; control failure doubles spinner speed and adds
  nausea. Flat rides freeze mid-cycle.

## Stalls, staff, research, marketing

- Eight stall types from 7.1 (two foods, drink, gifts, information kiosk, restrooms, first aid,
  cash point). Optional items (frozen treat, hot drink, on-ride photo) are omitted. A stall turns
  to face an adjacent path when placed.
- Staff: handyman, mechanic, security guard, entertainer, with duty toggles, Move, Follow and
  Fire. **No patrol areas** in v1 (everyone patrols the whole park).
- Research and marketing follow spec 11 and 5.3 (all six campaign types).

## Sound

All sound is synthesised with Web Audio (clicks, placing, coins, notices, rain bed, thunder,
splashes, laughs, flush, vomit, repairs, fanfare, and a generative music-box tune near an open
carousel). The OpenSFX / OpenMusic packs were not used, so nothing needs a licence notice.

## Saving

localStorage, wrapped in try/catch: an autosave at the start of every game month, three manual
slots, options. Saves are versioned (`parkhaven.v3.*`).

## Not implemented (v1)

Crashes and multi-train block sections; awards; day/night; snow; patrol areas; picking up and
dropping guests; water raising/lowering; terraforming of single corners or edges; scenery
rotation; path styles; queue entertainment screens; on-ride photos; ride-measurement graphs;
the guest list's thought filters (a grouped summary is shown instead); positional stereo audio.
