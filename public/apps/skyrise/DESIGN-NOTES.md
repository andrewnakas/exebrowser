# Skyrise: design notes

Skyrise was built from one functional specification (`cleanroom/skyrise/SPEC.md`) and nothing else. This file records the decisions the implementation team made, especially where the spec left a gap, gave values marked [D], or gave numbers that did not fit together.

## Architecture

- Plain ES modules, no build step, no dependencies. Everything loads relative to `index.html`.
- The simulation is separate from rendering and has no DOM access, so it runs headless in Node (see `cleanroom/skyrise/tests/`).
  - `data.js`: the data-driven facility, transport, price and limit tables (spec 4.0 and 14).
  - `clock.js`: the uneven clock (spec 3.2).
  - `world.js`: slabs, footprints and the placement rules.
  - `route.js`: route finding.
  - `elevator.js`: shafts, cars and the dispatcher.
  - `people.js`: agents, travel, stress and daily schedules.
  - `game.js`: economy, tenancy, hotels, demands, stars, save and load.
  - `events.js`: crowds, trains, fire, bomb threats, the VIP, treasure and weather.
- Presentation: `art.js` (procedural drawing), `render.js` (camera, scene, mini-map), `ui.js` (DOM, input, panels), `audio.js` (WebAudio synthesis) and `main.js` (loop, save/load).
- The sim emits events (`msg`, `sound`, `dialog`, `star`, `day`). The UI listens and never pokes sim internals, except through game methods.

## World and scale

- The world is 400 units wide. Levels run from B10 to floor 100, and the sky chapel rises four storeys above floor 100.
- Rendering: 1 unit is 8 px and 1 floor is 36 px (4.5 units). Zoom runs from 0.25× to 2×.
- Internal level 0 is floor 1 (ground). Negative levels are basements. There is no floor 0 in the UI.
- Bare floor cannot be laid on the ground floor; only lobby sections create ground-floor slab. That makes the ground lobby's span the tower's footprint, as the width rule intends.
- The upper storeys of a 2- or 3-storey ground lobby are not walkable floors, so lifts do not stop there.

## Time

- One tick is 70 ms at ×1, so a day takes about 3 minutes. The speeds are pause, ×1, ×2, ×4 and ×8.
- All motion is integrated per tick. The renderer only interpolates between the last two ticks with a frozen alpha, so pausing freezes cars, people, clouds and animations. The browser test confirms that the frame is pixel-identical while paused.
- A new game starts at midnight before WD1. Nobody has a schedule until the first midnight, except tenants who move in that day.

## Lifts

The spec's motion profile gives cars about 1 floor per real second. That conflicts with its own stress rule (+1 per tick waited, giving up after 300 ticks, with ticks at about 70 ms). At that speed even a small tower would fail. We tuned the motion per tick instead:

| | Standard / service | Express |
|---|---|---|
| Cruise speed | 0.5 floors/tick | 1.5 floors/tick |
| Acceleration | 0.06 floors/tick² | 0.15 floors/tick² |
| Doors | 2 ticks to open or close | same |
| Boarding / alighting | 2 people per tick | 3 per tick |
| Minimum dwell | 3 ticks | same |

- The dispatcher follows spec 5.8. Assignments are re-validated every tick, so a call is unassigned again if its car fills up, overshoots it, or turns away. An idle car can be sent to an opposite-direction call (the "turnaround" stop).
- Express-up and express-down modes: idle cars park at the lowest (or highest) served floor. On the express run they ignore hall calls in that direction. Idle cars can still be sent anywhere.
- The departure delay slider runs from 0 to 40 ticks and is shown in seconds at ×1.
- An extra car costs $50,000 ($100,000 for express). Resizing a shaft is free apart from any bare floor it creates.
- Removing a car is allowed only when it is empty. That is a small addition; the spec has no removal.
- **Preview (spec 5.7.7):** the whole simulation is deep-copied (`structuredClone`, with prototypes re-attached) and the copy is fast-forwarded 520 ticks. Only the chosen shaft, its queues and its future riders are drawn. "Resume" throws the copy away. The real tower is never touched.
- Parallel shafts: routes are cached, but just before a person walks to a lift they compare nearby equivalent shafts (same floors served, same walkway, within 30 units) on walking distance plus queue length. That spreads riders across a bank.

## Routes and walking

- Dijkstra runs over transport access points, with state (legs used, current mode, run length). Stair runs are capped at 4 flights and escalator runs at 7. A trip has at most two vertical legs. A lift-to-lift change is allowed only where both shafts open onto the same continuous lobby. Costs follow spec 5.9.
- **Street entry:** the whole ground-lobby frontage is treated as street. Arriving visitors appear at the ground-lobby point nearest their first lift or stairs, and leaving visitors exit there. Without this, wide lobbies would make every trip a long walk from two doors. The doors are still drawn at both ends.
- Walking speed is 0.6 units per tick. Stairs take 6 ticks per flight and escalators 4 ticks per floor.
- People never choose a route with more than 120 units of walking in total.

## Stress and evaluation

- Waiting adds +1 per tick, scaled by lobby height on the ground floor (1.0, 0.75 or 0.5). Riding adds +0.2 per tick, stairs +10 per flight, and walking more than 60 units on one floor adds +20. These follow the spec.
- **Walking stress is +0.15 per unit (the spec suggests 0.5).** At 0.5, walking alone pushed ordinary offices into the poor tier.
- **Evaluation is the mean of per-trip samples.** When a person completes a trip, their stress is added to their home facility's daily samples. While they rest at a destination, their stress halves before the next trip. Evaluation = 300 − mean sample − price offset − penalties. Without this, stress summed over 4–6 trips a day saturated at 300 and whole towers emptied every night.
- **Noise** adds +40 stress when a resident or guest arrives home in a noisy unit, not +40 per hour. Per hour would make any noisy apartment unlivable within one evening. The placement ghost warns about noisy neighbours.
- Giving up after 300 ticks in one queue: the person returns to where they came from (or leaves the building), and their home facility records a 300-stress sample and a 20-point penalty.
- Facilities are judged at midnight, and only if they were occupied for the whole day. Offices are not judged on weekends.
- Shops, snack bars and restaurants are judged on their customers' stress, with a penalty below 15% (−140) or 35% (−50) of daily capacity. That gives "traffic is low, the shop leaves".

## Economy and tenancy

- Rent for offices and shops is booked only at the start of each quarter, as in the spec. Condo sales are booked on move-in and refunded if the owners move out or the player bulldozes the unit.
- **Fire and bomb damage do not refund condo sales** (treated as insured).
- Move-in checks run every 26 ticks:
  - Offices: 6% on weekdays from 07:00 to 17:00.
  - Apartments: 5% from 07:00 to 21:00, halved from 3★ so they matter less late in the game.
  - Shop, snack-bar and restaurant operators: 8%.
  - Each is multiplied by the price factor, and a facility must be reachable from the lobby.
- Snack bars earn $100 per customer, minus $1,000 per day. Restaurants earn $200 per customer, minus $2,000 per day. Daily capacity is 48 for snack bars, 60 for restaurants and 40 for shops.
- Hotel bookings run from 17:00 to 22:00, at 5% per 13 ticks per free room × price factor × 0.25 if the room is in the poor tier × 0.85 when it rains.
  - A suite needs a free, linked parking bay.
  - Revenue is booked when the last guest checks out, and the room is then dirty.
  - A room is infested after 3 dirty nights; infestation spreads to a touching dirty room with a 30% chance each night.
- Housekeepers work 10:00–17:00. They use stairs and service lifts only, and spend 1 game hour of absolute time per room.
- **Banquets need at least 10 hotel rooms in the tower.** They run every day, with up to 50 guests, and earn up to $20,000.
- **Cinema:** up to 110 people per screening, $60 a ticket, more at weekends. A new film costs $150,000 (draw 1.0) and a classic $30,000 (draw 0.5). Draw decays 10% every 3 days. All film titles are invented.
- **Parking:** car ramps must form one column at the same x from B1 downward. A bay works if it is chained through touching bays to a ramp on its floor, and the ramp floor is reachable from the lobby. From 4★, each office and apartment needs a bay.
- **Metro station:** it can be dug at any depth as long as nothing exists below it, and afterwards nothing can be built below it. People use its top concourse.
  - Trains run every 30 game minutes from 07:00 to 23:00, bringing up to 40 visitors to basement shops and food.
  - 30% of office workers commute by train once a station exists.
- **Recycling:** one plant is needed per 1,000 population above 2,000. Touching plants form a group, and a group counts if any plant in it shares a walkway with a service lift stop.
- **Medical:** from 2,000 population, the tower needs max(1, workers ÷ 1,500) clinics, and every occupied office must be within 10 floors of one. Each day, 1% of highly stressed office workers visit a clinic.
- Maintenance follows spec 8.3 per shaft, plus $100 per lobby unit.
- **Bankruptcy:** construction is frozen while funds are negative. Four negative quarter-ends in a row end the game, with an offer to load the last save or start over.

## Stars

- The thresholds and conditions come from spec 7. "Security offices present" means at least two.
- "More than one suite" means two or more built suites.
- From 3★, only permanent population counts toward stars. That is workers, residents, staff and commercial customers, with hotel guests excluded.
- Commercial "daily customers" use the larger of today's and yesterday's count, so population does not collapse at midnight.
- **VIP:** from 3★, with a suite and the VIP not yet passed, a VIP is announced at midnight and books the first free suite that evening. They pass if their own stress plus the suite's price offset is below 80 and the suite is not in the poor tier. A new VIP comes every 5 days until one passes.

## Events

- **Fire:** checked each day from 3★ (if there is a security post) with a 1-in-300 chance. Facilities touched by the fire are destroyed whole and become "burnt-out shells" that must be bulldozed. Shells block walking while the fire burns.
  - Guards travel 20 ticks per floor up the drawn emergency stairs, and each guard puts out 1 unit per 10 ticks.
  - The helicopter costs $500,000 and finishes the fire within 60 ticks.
- **Bomb:** a 1-in-400 chance per day from 3★, between 08:00 and 16:30. The ransom is $300,000 × stars.
  - If refused, floors are shared among the security posts by distance, at 10 ticks per floor travelled plus 30 ticks per sweep.
  - Explosion damage destroys whole facilities.
- **Treasure:** a 1-in-50 chance when a facility is placed underground, once per game, worth $50,000–$500,000.
- **Weather:** 20% of days are rainy. Rain means a grey sky, rain sound, random thunder flashes, 30% fewer outside visitors, and slightly fewer hotel bookings.
- **Seasonal:** throughout Q4, facilities wear twinkling string lights. On the Q4 weekend, from 18:00 to 23:00, lanterns drift up over the city, and a jingle plays at 19:00. There is no gameplay effect.
- **Wedding:** every weekend at 13:00, if the sky chapel is built and reachable. Its guests count as the wedding taking place.

## Interface

- **Desktop:**
  - Left-drag places items. Lobby, floor and parking-bay rows are dragged sideways; lift shafts and ramp columns are dragged up or down.
  - Right/middle-drag, Space+drag, or left-drag with a non-drag tool pans the view.
  - The wheel scrolls (Shift for sideways), and Ctrl/⌘+wheel zooms.
  - Keys: 1–4 set the speed, Space pauses, Esc cancels or closes, +/− zoom, and the arrow keys pan.
- **Touch:**
  - One finger pans and two fingers pinch-zoom.
  - A tap places a single item.
  - Rows and shafts use two taps: the first tap anchors, the second commits. Tapping the same spot twice builds a single piece.
- **Replace:** hold Shift, or tick "Replace what is there" in the tool options.
- **Snapping:** a placed room is nudged up to 3 units so it sits flush against existing floor or rooms. Accidental 1-unit gaps would otherwise cut walkways.
- Opening a panel pauses the game, and closing it resumes. The Mood, Rent and Hotel overlays also pause.
- The pricing overlay colours each unit by its price level (premium = "too high", standard = "fair", budget and bargain = "cheap").
- **Saves:**
  - An autosave is made each game day, and there is one manual slot, both in `localStorage`. Every storage access is wrapped in try/catch.
  - People in transit are not saved. On load, everyone is placed where their schedule says they should be, and the rest of the day is re-planned.

## Visual style

The art is an original modern-flat cutaway drawn entirely with Canvas 2D shapes in code. There are no image files.

- **Facilities:** each has its own interior (desks and monitors, sofas and lamps, beds, menu boards, shelves, chandeliers, a screen with posters, bins and a conveyor, a platform and train, and so on) and a few colour variants.
- **Lighting** follows occupancy and the clock. Rooms show lit, dark and sleeping states, and shops and food outlets show shutters when closed.
- **People** are about 1 unit wide. Their clothing shows stress: navy when calm, amber when tense, red when stressed. Accessories mark the kind of person: a briefcase for sales staff, an apron for housekeepers, a cap for guards, and a gold star and halo for the VIP.
- **Lift cars** show five load states, and their doors open.

## Sound

All sound is synthesised at run time with WebAudio oscillators, filtered noise and envelopes. There are no sample files.

- Lift bells and departures play only for on-screen shafts, with at most one every 180 ms.
- Ambience plays one quiet cue every half second. It picks a visible facility, weighted by area, or a time-of-day cue: birds at dawn, crickets at night, traffic in the day, and wind in the rain.
- Rain is a looped filtered noise.
- The spec specifies no music, so there is none.

## Not implemented or simplified

- People are not drawn walking inside rooms. Interiors show seated or standing figures instead.
- Clinic visits are a simple trip, not an illness model.
- Fire destroys whole facilities, not single units.
- A shaft has no "what-if" history graph. The preview is visual only.
- Basement shops are not limited to train visitors; anyone may use them.
