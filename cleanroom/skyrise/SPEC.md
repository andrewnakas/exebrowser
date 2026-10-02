# Skyrise — Functional Game Specification (clean-room)

Status: reviewed and sanitised for the clean room, version 1, 2026-10-02.
Audience: the clean-room implementation team. This document is the only input you get.
Scope: a single-player, side-on (cross-section) tower construction and management game for the browser.

How to read this document

- Numbers marked **[V]** were verified against the reference games' own rule data (the in-game help text, the shipped readme, or rule tables inside the original program).
- **[R]** means the number comes from a third-party reimplementation or save-format notes. It is probably right but was not checked against the original program.
- **[D]** means a design value that we chose to fill a gap. Treat it as a tuning default, not a fact.
- "Unit" means one horizontal grid cell. "Floor" means one storey.
- Money is in whole dollars as shown to the player. (Internally the originals kept money at 1/100 of the displayed value. You may do the same or not.)
- Facility names are generic on purpose. Name things however you like in your own UI. Do not reuse names or text from any existing game.

---

## 1. Core loop in one paragraph

The player starts with an empty plot and some cash. They place a ground-floor lobby, extend floors upward and downward, and rent the floors out. Offices pay rent each quarter, condos are sold once, and hotel rooms pay per night. Shops and restaurants earn from customers. People live, work and visit on a daily schedule, and they must get between floors using stairs, escalators and elevators. Bad transport, noise, high prices and dirty rooms build up **stress**. Stressed tenants leave and take their income with them. Growing the population, together with a few service requirements, raises the tower's **star rating** (1 to 5 stars, then a final "landmark tower" rank). Each new star unlocks new facility types. Random events such as fires, bomb threats, VIP visits and pests force short-term decisions. In practice the core skill is designing the elevators.

Recommended ruleset: follow the first game's core loop (sections 2 to 11). Add the selected second-game features listed in section 14 where they are cheap.

---

## 2. World model

### 2.1 Grid

| Property | Value | Note |
|---|---|---|
| Horizontal cell ("unit") | 1 unit | All footprints below are in units. |
| Proportion | A floor is roughly 4–5 units tall | [D] Pick your own pixel scale; keep footprints readable. |
| Floors above ground | 1 to 100 | [V] (100-storey limit; the final building sits on floor 100) |
| Floors below ground | B1 to B10 | [R]. Normal construction is allowed to B9. B10 is used only by the transit station (see 4.18). [R] |
| Floor numbering | Ground = floor 1. There is no floor 0. The first basement is B1. | [V] |
| World width | about 375–400 units | [D]. The original's exact world width was not verified. Choose a fixed width that fits a wide lobby. |

### 2.2 Lobby rules

- The first thing the player must build is a **lobby on floor 1**. Nothing else may be built until it exists. [V]
- Only lobbies (and transport) may occupy floor 1. [R]
- Lobbies may exist only on floor 1 and on the **sky-lobby floors 15, 30, 45, 60, 75 and 90**, that is, every 15 floors. [V] (The rule data says "every 15 floors". One reimplementation used 16, 31 and so on, but the original readme's worked examples use 15 and 30.)
- The lobby is placed in 4-unit sections, at **$5,000 per unit**, so one placement costs $20,000. Any missing floor under the placement is charged on top. [V]
- The ground lobby can be 1, 2 or 3 floors tall (a modifier key when placing the first section). A taller lobby costs 2× or 3× per section. [V] A taller lobby reduces the stress that people build up while waiting in it. [R] (The second game's code scales lobby stress by lobby height.)
- **Width rule:** above ground, no floor may extend beyond the left and right edges of the floor directly below it. Below ground, no floor may extend beyond the floor directly above it. So the ground lobby's span is the tower's maximum footprint. [V]
- Lobbies cannot be bulldozed. [V]
- A lobby counts as **continuous** only if its sections touch. A gap of bare floor splits a lobby into two separate lobbies. People cannot transfer between elevators across a gap. [V]

### 2.3 Bare floor

- Bare floor costs **$500 per unit**. [V] Placing any facility where no floor exists auto-builds the floor under it and charges for it. [V]
- Bare floor cannot be bulldozed. Bulldozing a facility leaves its floor in place. [V]

### 2.4 Construction

- Construction is instant in terms of money (paid at placement), but a facility shows a short "under construction" state before it opens. [R] [D: about 1–2 game hours]
- Placement is refused, with a reason shown in the message line, if any of these is true: the player cannot afford it; the star rating is too low; it overlaps another facility; it breaks the width rule; it is on the wrong floor type; or a facility limit is reached (section 4.20).
- **Replace:** with a modifier key, placing a facility over an existing one bulldozes the old one and builds the new one in one step. [V]
- **Bulldozing** is free. [V] These facilities cannot be bulldozed: lobby, security office, housekeeping room, recycling centre, transit station, top-floor landmark. [V]

---

## 3. Time

### 3.1 Calendar

| Unit | Rule |
|---|---|
| Day | Weekday 1, Weekday 2, Weekend. |
| Quarter | 3 days (WD1, WD2, WE). [V] |
| Year | 4 quarters (12 days). [V] |
| Display | clock, then "WD1 / WD2 / WE", quarter number, year number. |
| Day boundary | The date advances at midnight. [V] |
| Start | A new game starts at midnight before WD1, Q1, Year 1. [R] |

### 3.2 Simulation ticks and the uneven clock

One day is **2,600 simulation ticks**, and **tick 0 is 07:00**. The clock does not run at an even rate. It slows sharply over lunch, so the midday rush gets more simulation time. [V] (from save-format research; matches the original elevator scheduler's time slots)

| Slot | Ticks | Clock time | Game time per tick |
|---|---|---|---|
| 1 Morning | 0–399 | 07:00–12:00 | 45 s |
| 2 Lunch A | 400–799 | 12:00–12:30 | 4.5 s |
| 3 Lunch B | 800–1199 | 12:30–13:00 | 4.5 s |
| 4 Afternoon | 1200–1599 | 13:00–17:00 | 36 s |
| 5 Evening | 1600–1999 | 17:00–21:00 | 36 s |
| 6 Night | 2000–2399 | 21:00–01:00 | 36 s (midnight = tick 2300) |
| 7 Late night | 2400–2599 | 01:00–07:00 | 108 s |

- Use these 7 slots as the "periods" in the elevator schedule (section 5.7). The original merged slot 7 into slot 6 in the UI, which gives 6 user-visible periods. [R]
- **Real-time speed** [D]: at "normal" speed one tick is about 70 ms, so a day takes about 3 minutes. Provide pause, normal, fast (×2–×4) and very fast. All movement (people, cars) must scale with the tick so that pausing freezes everything. One reimplementation had a bug where elevators kept moving while paused. Avoid it.

### 3.3 When money is booked

| Item | When | Basis |
|---|---|---|
| Construction | At placement | [V] |
| Office rent | Once per quarter (start of WD1), per occupied office | [R]. The help says leases run a minimum of one quarter. |
| Retail shop rent | Once per quarter, per occupied shop | [V] (rent levels exist) [R timing] |
| Condo sale | Once, when a buyer moves in. **Refunded (deducted) if the buyers move out or the condo is bulldozed.** | [V] |
| Hotel rooms | Per night, at check-out | [R] |
| Fast food / restaurant | Daily, at closing, from that day's customers | [R] |
| Cinema | Per screening day, from tickets | [R] |
| Party hall | Per party | [V] |
| Maintenance | Once per quarter (table in 8.3) | [V] amounts; [R] timing |
| Starting funds | $2,000,000 | [R]. The original readme uses $2 million as its example balance, and there was a hidden trick that doubled the starting funds. |

The finance view shows quarter-to-date totals by category (section 12.4) and resets each quarter.

---

## 4. Facilities

### 4.0 Master table

Footprint is width × height in units × floors. Cost excludes bare floor. "Pop" is the permanent population the facility adds while it is occupied (used for star thresholds).

| # | Facility (generic name) | Footprint | Cost [V] | Unlock ★ [V] | Pop | Income model | Removable |
|---|---|---|---|---|---|---|---|
| 1 | Lobby section | 4×1 per placement (1, 2 or 3 floors tall) | $5,000 / unit | 1 | – | – | No |
| 2 | Bare floor | 1×1 | $500 / unit | 1 | – | – | No |
| 3 | Stairs | 8×2 (joins floor f and f+1) | $5,000 | 1 | – | – | Yes |
| 4 | Escalator | 8×2 (joins f and f+1) | $20,000 | 3 | – | – | Yes |
| 5 | Standard elevator shaft | 4 wide × N floors (N ≤ 30) | $200,000 | 1 | – | – | Yes |
| 6 | Express elevator shaft | 6 wide × N floors | $400,000 | 3 | – | – | Yes |
| 7 | Service elevator shaft | 4 wide × N floors (N ≤ 30 [D]) | $100,000 | 2 | – | – | Yes |
| 8 | Office | 9×1 | $40,000 | 1 | 6 [V] | Quarterly rent | Yes |
| 9 | Condo (sold apartment) | 16×1 | $80,000 | 1 | 3 adults [V] (children are drawn but not counted) | One-time sale | Yes (sale refunded) |
| 10 | Fast-food outlet | 16×1 | $100,000 | 1 | daily customers [R] | Per customer | Yes |
| 11 | Single hotel room | 4×1 | $20,000 | 2 | 1 [V] | Per night | Yes |
| 12 | Twin hotel room | 6×1 | $50,000 | 3 | 2 [V] | Per night | Yes |
| 13 | Hotel suite | 10×1 | $100,000 | 3 | 2 [V] | Per night | Yes |
| 14 | Housekeeping room | 15×1 | $50,000 | 2 | 6 staff [V] | Cost centre | No |
| 15 | Security office | 16×1 | $100,000 | 2 | 6 guards [D] | Cost centre | No |
| 16 | Restaurant (sit-down) | 24×1 | $200,000 | 3 | evening customers [R] | Per customer | Yes |
| 17 | Retail shop | 12×1 | $100,000 | 3 | daily customers [R] | Quarterly rent | Yes |
| 18 | Party/banquet hall | 24×2 | $100,000 | 3 | 50 guests per party [V] | Per party | Yes |
| 19 | Cinema (2 storeys) | 31×2 | $500,000 | 3 | audience [R] | Per ticket | Yes |
| 20 | Medical clinic | 26×1 | $500,000 | 3 | – | Cost/requirement | Yes |
| 21 | Recycling centre | 25×2 | $500,000 | 3 | – | Cost/requirement | No |
| 22 | Parking space | 4×1 (underground only) | $3,000 | 3 | – | Requirement | Yes |
| 23 | Parking ramp | 16×1 per floor [V from asset width; R as footprint] | $50,000 | 3 | – | Requirement | Yes |
| 24 | Transit (metro) station | 30×3 (lowest basements) | $1,000,000 | 4 | brings visitors | Requirement | No |
| 25 | Top-floor landmark (ceremony venue) | 28×5 [R, from asset size] | $3,000,000 | 5 | – | Final goal | No |

That makes 25 buildable types: 7 structural or transport types and 18 tenant or service types. The bulldozer, the elevator-adjust tool and the inspector tool are free tools, not facilities.

Visual variety [D]: give occupied tenants a few cosmetic variants of your own design (count is your choice). Pick one at random when the facility is occupied.

### 4.1 Rent and price levels [V]

Every rented, sold or nightly facility has a **price level** from 1 (highest) to 4 (lowest). The default is level 2. The player can change it in the facility's info panel, except that a condo's price is locked while it is occupied.

| Facility | L1 (high) | L2 (default) | L3 | L4 (low) | Per |
|---|---|---|---|---|---|
| Office | $15,000 | $10,000 | $5,000 | $2,000 | quarter |
| Retail shop | $20,000 | $15,000 | $10,000 | $4,000 | quarter |
| Condo | $200,000 | $150,000 | $100,000 | $40,000 | one-time sale |
| Single room | $3,000 | $2,000 | $1,500 | $500 | night |
| Twin room | $4,500 | $3,000 | $2,000 | $800 | night |
| Suite | $9,000 | $6,000 | $4,000 | $1,500 | night |

How price level affects people [D, shape from the originals' help text]: a higher level adds a constant to the occupants' evaluation penalty, and a lower level subtracts it. Suggested evaluation offsets: L1 +30, L2 0, L3 −20, L4 −40 (on the 0–300 stress scale in 6.2). Prospective tenants also judge price. The chance of moving in is multiplied by L1 0.5, L2 1.0, L3 1.3, L4 1.6. The "pricing" overlay (12.3) shows each tenant's verdict: too high, fair, or cheap.

### 4.2 Office
- Holds 6 workers. [V] Some of the 6 are "sales" workers who leave mid-morning on an errand and come back in the afternoon. [R] (2 of 6)
- Open on weekdays only. It is empty at weekends. [R]
- Daily schedule: section 6.1.
- Move-in: a vacant office is offered to new tenants only if it is reachable from the ground lobby. During weekday business hours (07:00–17:00), each check has a small chance of the office being let. [R] (about 10% per 1/500 of a day, so roughly half a game day on average)
- Move-out: if the office's **evaluation stays in the bad tier for a full game day**, the tenants leave. [V] Rent stops. The original refunded nothing to the departing tenant. [D]
- Also uses: fast food at lunch, the medical clinic (6.4), and parking at 4★ and above [D].

### 4.3 Condo
- 3 adult residents. [V] Children may be generated for flavour (0 to 2× the adult count, up to 6 in total) [R]. They do not count toward population.
- **Sold, not rented.** Income is booked when the buyers move in. If they leave (bad evaluation for a full day) or the player bulldozes the condo, the **sale price is deducted** from funds. [V]
- Schedule: adults leave in the morning (07:30–09:30) and return in the evening (17:30–19:30). Children leave at 07:30 and return at 15:30 or 17:30. [R] At weekends residents visit shops, fast food and restaurants. [D]
- Noise-sensitive (4.21).
- The original designer's note says condos matter most early in the game and much less after 3★. Keep them weak late in the game. [V]

### 4.4 Hotel rooms (single / twin / suite)
- Occupants: single 1, twin 2, suite 2. [V]
- Nightly cycle [R]:
  - From 17:00, rooms get booked. Guests arrive at the ground lobby and head to their room.
  - About 30 game minutes after arriving, guests go out to dinner (a restaurant or fast food in the tower, or they leave the building) and come back.
  - Sleep falls between 23:00 and 01:30. Guests wake between 06:00 and 08:00 and check out between 08:00 and 10:00.
  - Revenue is booked at check-out. The room is then **dirty**.
- Booking chance depends on the room's last evaluation, its price level, and the transport time from the lobby. [D]
- Noise-sensitive (4.21). Twin rooms may share a floor with commercial facilities. [V] Single rooms placed next to commercial facilities get the noise penalty. [D]
- **Suite**: when occupied, it **requires a free parking space** in the tower. If none is available the suite cannot be booked. [V] This is the only room a VIP will use (9.3).
- **Housekeeping and pests**: a dirty room cannot be re-let until it is cleaned. A room that stays dirty too long becomes **infested**: it can never be let again, it can spread to an adjacent dirty room, and the only cure is to bulldoze and rebuild it. [V] [D: infested after 3 consecutive nights dirty; spreads to an adjacent dirty room with 30% chance per night]

### 4.5 Housekeeping room
- Houses 6 housekeepers. [V] Each housekeeper walks or uses **service elevators** only. [V] They go to the nearest dirty room, clean it for a fixed amount of absolute game time (the time is not stretched by the slow lunch clock), then move on to the next room. [R] [D: 1 game hour per room; they start at 10:00 and stop at 17:00]
- Not removable. [V]
- A rule of thumb to communicate: about 1 housekeeping room per 15–20 hotel rooms. [D]

### 4.6 Security office
- Its guards respond to **fires** and **bomb threats** (section 9). Guards use only the **external emergency stairs** that run up the side of the building, never elevators. [V] So the vertical distance between the nearest security office and the incident sets the response time. [V]
- Not removable. [V] Limit 10. [V]
- Required for the 3★ rating (section 7).

### 4.7 Fast-food outlet
- Opening hours 10:00–21:00. [R] Customers: office workers at lunch, residents, hotel guests, outside visitors and cinema-goers. [V]
- Income: per customer, minus a daily running cost. [D: $100 per customer; daily running cost $1,000] The original help describes it as low income and hard to keep unstressed. [V]
- Customer capacity per day: up to 48 people. [R] (The save format allots 48 person slots.)
- Bad evaluation for a full day: the business closes and becomes vacant. A new operator moves in later if conditions improve. [D]

### 4.8 Restaurant
- Dinner trade, 17:00–23:00. [R] Customers stay longer than at fast food. [V] Income per customer is higher. [D: $200 per customer, daily cost $2,000]
- Used by hotel guests and residents in the evening. [V]

### 4.9 Retail shop
- Opening hours 10:00–21:00. [D] It pays **quarterly rent** at its price level. If the rent is too high or traffic is low, the shop leaves. [V]
- Customers: residents, cinema-goers (within ±5 floors, 4.11), outside visitors, and transit-station visitors (basement shops only). [V]

### 4.10 Party/banquet hall
- 2 floors tall. When the tower has enough hotel rooms, it fills with **50 guests in the afternoon** (one party per day). [V] Income is per party. [V] [D: $20,000 per full party, scaled by guests who actually arrive]
- Suggested schedule: open 13:00, guests arrive 13:00–15:00, leave at 17:00. [R] Weekends only, or every day. [D: every day]

### 4.11 Cinema
- 2 floors tall. The **audience enters on the upper floor and exits on the lower floor**. [V] Treat the access floor as the upper one when routing.
- Two screenings a day: doors open 13:00 and 19:00, the film starts 15:00 and 21:00, and it ends 17:00 and 23:00. [R]
- Ticket income is modest. The real value is that the cinema **draws outside crowds, who afterwards visit shops and food outlets within 5 floors above or below the cinema**. [V]
- **Programme choice**: the player picks the current film from a catalogue. A newer film draws more people but costs more to book. A "classic" costs less and draws fewer. Attendance decays the longer a film runs. [V shape] [D: new film $150,000, draw factor 1.0, decaying 10% per week; classic $30,000, draw 0.5]

### 4.12 Medical clinic
- Treats on-site illness and injury. It is used mostly by office workers, so place it near offices. [V]
- It is a **demand** facility. Once the population is large enough, tenants start demanding medical care, and meeting that demand is required for 4★. [V] [D: demand = 1 clinic per 1,500 office workers, minimum 1 from 2,000 total population; a demand is "met" when every office is within 10 floors of a clinic. Limit 10. [V]]

### 4.13 Recycling centre
- 2 floors tall. Large towers need one, and they need more as they grow. **Recycling centres must be placed touching each other (stacked or side by side) to work as a group.** [V] **Service elevators must stop at them.** [V] Required for 4★. [V]
- Not removable. [V]
- [D: demand = 1 centre per 1,000 population above 2,000. A centre reached by no service elevator counts as zero.]

### 4.14 Parking (spaces + ramp)
- **Underground only.** [V] Spaces are drag-placed in horizontal rows. A space is usable only if it is connected through adjacent spaces to a ramp on that floor. [V]
- **Ramp**: one vertical column of ramps per tower. There must be a ramp on every parking floor, and the column must connect up to the ground-floor lobby. [V] The parking floors must also be reachable by stairs or an elevator. [V]
- Demand: suites need a space while occupied. [V] At higher star levels, residents and office tenants also demand parking. [V] [D: from 4★, each office and condo needs 1 space within reach, or its evaluation gets a penalty]
- Limit: 512 spaces. [V]

### 4.15 Transit (metro) station
- Underground only, at the lowest basement levels, and **nothing may be built below it**. [V] One per tower. [V] Not removable. [V]
- It brings many visitors. **Visitors who arrive by train shop and eat only on underground floors**, but people who live or work above ground may arrive by train. [V]
- Runs 07:00–23:00, with trains on a regular absolute-time interval. [R] [D: every 30 game minutes]
- Required for 5★. [V]

### 4.16 Top-floor landmark (ceremony venue)
- Can be placed **only on floor 100** of a 5★ tower. It must be reachable. [V] Not removable. [V] Limit 1. [V]
- A wedding takes place there **at a weekend**. With 15,000 permanent population, that wedding grants the final rank (7). [V]

### 4.17 Unused types
The original program also contains an office-like "security-company" tenant and a few other unused type slots. Do not implement them.

### 4.18 Underground rules summary
- Allowed underground: everything except the lobby (basements have none), hotel rooms [D], condos [D] and the landmark. Parking spaces and the transit station are underground-only. [V]
- Construction is allowed down to B9. The transit station may reach B10. [R]

### 4.19 Population counting
- Population = the sum of the occupants of every occupied facility, plus the commercial facilities' daily customer counts. [R]
- **From 3★ upward, only permanent population counts toward the next star.** Hotel guests are excluded. [V]

### 4.20 Facility limits [V]

| Item | Limit |
|---|---|
| Elevator shafts (all kinds) | 24 |
| Cars per shaft | 8 |
| Stairs + escalators | 64 total |
| Fast food + restaurants + shops | 512 total |
| Parking spaces | 512 |
| Medical clinics | 10 |
| Security offices | 10 |
| Cinemas + party halls | 16 total |
| Transit station | 1 |
| Landmark | 1 |
| Named people | 20 |
| Named facilities | 20 |
| Name length | 15 characters |

### 4.21 Noise and adjacency
- Noise-sensitive: condos and hotel rooms. [V]
- Noise sources [D]: fast food, restaurant, retail shop, party hall, cinema, recycling centre, the transit station's floors, and elevator shafts and escalators that touch the unit. Offices are quiet.
- Rule [D]: on the same floor, if a sensitive unit's edge lies within **4 units** of a noise source's edge, the occupants get +40 stress per hour while they are at home (6.2). The second game had a formal left/right placement-compatibility check between neighbouring tenants. A cheap way to do the same is to show a warning while the player places the facility.

---

## 5. Transport

### 5.1 General
- People walk horizontally along a floor. Floors must be continuous: a gap or missing slab blocks walking.
- Stairs and escalators join exactly two adjacent floors (f and f+1). Elevators join every floor their shaft covers, except floors the player has switched off.
- **Transport placement**: shafts and stairs may not overlap each other. An elevator shaft also keeps one free floor above its top and below its bottom (that is where its machinery sits), and other transport may not occupy those floors. [R] Stairs and escalators need floor width on both floors they touch. [R]
- Transport items may sit "in front of" tenants. They do not use tenant floor space. [R] (The save format stores them separately from tenants.)

### 5.2 Stairs
- $5,000. Uses no power and costs no maintenance. [V]
- People will climb **at most 4 flights in a row** in one trip. [V]
- Transit time per flight [D]: about 1.5 game minutes at the normal tick rate. It adds stress like walking does.

### 5.3 Escalator
- Only on floors that hold commercial or public facilities (fast food, restaurant, shop, lobby, cinema, party hall). [V]
- No waiting. People prefer escalators over everything else. [V]
- Up to **7 escalators in a row** per trip. [V]
- Maintenance $5,000 per quarter. [V]

### 5.4 Standard elevator
- Shaft 4 units wide. A shaft spans at most **30 floors**. [V] It starts with 1 car. The player adds cars (up to 8) by clicking the elevator tool on a floor of the existing shaft. [V]
- **Car capacity 21.** [V]
- Used by ordinary tenants and visitors only, not staff or guards. [V]
- Each floor can be switched in or out of service with the adjust ("finger") tool. [V] The shaft can be lengthened or shortened by dragging its top or bottom machinery with the same tool. [V] Lengthening auto-builds bare floor where it is needed. [R]
- Cost of each additional car: [D] $50,000 for standard and service, $100,000 for express. (The original's per-car price was not verified.) Lengthening a shaft is free. [D]

### 5.5 Express elevator
- Shaft 6 units wide. **Car capacity 42.** [V]
- It stops **only on lobby-eligible floors (1, 15, 30, 45, 60, 75, 90) and on every underground floor**, whether or not a lobby has been built there. [V] The player cannot change those stops or the express cars' home floors. [V]
- Ordinary people only. [V] It may span the whole tower height. [D]
- In the original, people **prefer standard elevators over express ones** when both would work. [V]

### 5.6 Service elevator
- Shaft 4 units wide. **Car capacity 17.** [V]
- Used **only by staff** (housekeepers, the recycling crew, maintenance). [V] It does not need to stop at lobbies or parking floors. [V] It **must** stop at recycling centres. [V]

### 5.7 Elevator control panel (per shaft)
Opened by inspecting the shaft's machinery. Functions [V]:
1. **Schedule mode per period**: for each of the day's periods (3.2) and separately for weekdays and weekends, choose **Local**, **Express-to-top** or **Express-to-bottom** (definitions in 5.8).
2. **Response distance** (an integer number of floors, default [D] 4): how far a *moving* car may be from a call and still take it, in preference to an idle car. See 5.8.
3. **Departure delay** (seconds, default 0) [V]: how long a car holds its doors open at a stop before leaving. A longer hold lets more people board at busy floors.
4. **Home floor** for each car (where it parks when idle). Not available for express shafts. [V]
5. **Floor service map**: shows which floors are served and what each car is doing. Floors with service switched off are marked. [V]
6. **Show or hide shaft**: purely visual. [V]
7. **Preview**: a "what-if" mode. The game pauses, everything except this shaft and its future riders is hidden, and a short slice of upcoming time is fast-simulated so the player can see queues building. Resume restores the view. [V]

### 5.8 Dispatch algorithm (our own design, matching the original's observable behaviour)

Data per car: position (floors, fractional), direction (up, down or idle), state (idle, moving, doors-opening, loading, doors-closing), passengers (each with a target floor), the set of assigned hall calls, and a home floor.
Data per shaft: one hall-call queue per (floor, direction). Each queue has its waiting people in arrival order, a call timestamp, and an assigned car (or none).

```
on person arrives at shaft floor F wanting direction D:
    append person to queue(F, D)
    if queue(F, D) has no assigned car: try_assign(F, D)

try_assign(F, D):
    R = shaft.responseDistance
    # 1. a car already heading our way, close enough, with room
    candidates = cars where state is moving or loading
                 and car.direction == D
                 and F is ahead of the car in direction D
                 and |car.pos - F| <= R
                 and car is not full
    if candidates not empty: assign nearest; return
    # 2. otherwise the nearest idle car
    idle = cars where state == idle
    if idle not empty: assign nearest idle car; set its direction toward F; return
    # 3. otherwise wait; re-run try_assign for the oldest unassigned call
    #    every tick, so the longest-waiting call is served first

choose_next_stop(car):
    ahead_drop = nearest passenger target ahead in car.direction
    ahead_pick = nearest assigned or unassigned same-direction call ahead
                 (only if car not full)
    stop = whichever of ahead_drop / ahead_pick is nearer
    if no stop ahead:
        if any call or passenger behind: reverse direction, recompute
        else: car becomes idle and returns to its home floor (if one is set)

at_stop(car):
    open doors (short fixed time)
    unload everyone whose target is this floor (one at a time, fixed time each)
    load people from queue(floor, car.direction) in arrival order until full
    hold doors for max(departureDelay, minimum dwell); if the car fills, leave early
    if the queue still has people when the car leaves full: the call stays open,
        unassigned, and goes back to try_assign

schedule modes (applied to the current period):
    Local: the rules above.
    Express-to-top: idle cars return to the shaft's lowest served floor; when
        travelling up from there, the car stops only for passenger drop-offs
        (no up hall calls are answered on the way); down travel is Local.
    Express-to-bottom: mirror image (idle at the top; downward trips stop only
        for drop-offs below).
```

Motion profile [D]: trapezoidal (accelerate, cruise, decelerate). The accelerate and decelerate phases each take at most 1/3 of the trip distance. Standard and service cars cruise at about 1 floor per second of real time at normal speed. Express cars cruise about 3× faster and accelerate about 2.5× faster. Doors take 0.1 s to open or close, boarding takes 0.05 s per person, and the minimum dwell is 0.15 s (all in real seconds at normal speed). These values come from a reimplementation's feel tuning and are not the original's.

Multiple cars pass each other freely. (The cutaway view implies depth, so cars in one shaft overlap visually.) [V]

### 5.9 Route finding (people)

A route runs from a start facility to a target facility. It is a sequence of walking legs and vertical legs. Rules [V unless noted]:

- **Preference order of vertical modes**: escalator, then stairs, then standard elevator, then express elevator.
- **Legs limit**: a person changes vertical mode **at most once** per trip. So a route has at most **two vertical legs**. A run of consecutive escalators counts as one leg (at most 7 in a row), and so does a run of consecutive stairs (at most 4 flights). Escalator then elevator is two legs. [V] Service-staff routes use service elevators and stairs. Guards use only the emergency stairs.
- **Elevator-to-elevator transfers happen only on a lobby floor**, and only if both shafts touch the same **continuous** lobby. [V] Transfers from stairs or escalators to an elevator may happen on any floor where the two are joined by walkable floor. [D]
- Choose the lowest-cost route [D]. Cost = walking units × 1 + stairs flights × 30 + escalators × 10 + elevator legs × (20 + expected wait). Expected wait = the current queue length at that shaft and floor ÷ the shaft's car count. Use A* or Dijkstra over a graph whose nodes are (floor, transport access point) and whose edges are the transport links. Precompute the "lobby to facility" routes and invalidate them when transport changes.
- **No route**: the facility shows a "no access" marker. An office or condo with no route from the lobby cannot be let. If a route that existed is lost, a demand message appears: "people on floor X cannot reach floor Y" (paraphrase it in your own words). [V]
- People already travelling when a route changes must be re-routed from their current node, or else removed safely. [R] (A reimplementation crashed here.)
- **Walking limits** [D]: each walked unit adds a little stress (6.2). Walking more than 60 units on one floor adds an extra penalty. People will not choose a route whose total walking exceeds 120 units.

---

## 6. People simulation

### 6.1 Daily schedules
All times are clock times on the uneven clock (3.2). Pick each person's times randomly in the window, freshly every day.

| Population | Weekday | Weekend | Source |
|---|---|---|---|
| Office worker | Arrives 07:00–08:00 through the ground lobby (or the transit station). Lunch around 12:00–12:12: goes to a fast-food outlet, eats about 20 ticks, returns. Leaves 17:00–19:00. | Absent | [R] |
| Office sales worker | As an office worker, but leaves on a sales trip shortly after arriving and returns 13:00–15:00. No lunch trip. | Absent | [R] |
| Condo adult | Leaves 07:30–09:30, returns 17:30–19:30. Late-leaving jitter is more likely than early. | Leaves late morning to shop or eat in the tower, returns by evening. | [R] / [D] |
| Condo child | Leaves 07:30, returns 15:30 or 17:30. | Like an adult. | [R] |
| Hotel guest | Section 4.4 | Same | [R] |
| Fast-food visitor (outside) | Arrives at a random time 10:00–20:00, stays about 20 ticks, leaves. | Same, ×1.5 volume | [R] / [D] |
| Restaurant visitor | Arrives 17:00–22:00, stays 2× as long as fast food. | Same | [R] |
| Shop visitor | Arrives 10:00–20:00. | ×1.5 volume | [D] |
| Cinema audience | Arrives at doors-open, leaves at the end, 50% visit a shop or food outlet within ±5 floors. | Same, larger crowd | [V] / [R] |
| Party guest | Arrives 13:00–15:00, leaves 17:00. | Same | [R] |
| Housekeeper | Works 10:00–17:00 cleaning dirty rooms. | Same | [D] |
| Security guard | Stays in the office. Deploys on events. | Same | [V] |
| Transit visitor | Arrives with each train, visits basement shops and food, leaves by train. | Same | [V] |

Visitor volume [D]: each commercial facility generates outside visitors at the start of its day: fast food 10–48, restaurant 10–30, shop 5–20. Scale by evaluation and reachability from the ground lobby.

### 6.2 Stress
- Each person has a **stress** value of 0–300 [D] (a 16-bit stress value was kept per person, and a separate evaluation value). It is reset each morning. [R]
- Stress accumulates [D, sources V]:
  - waiting at an elevator: +1 per tick waited (lobby waiting is scaled by lobby height: 1-storey ×1.0, 2-storey ×0.75, 3-storey ×0.5)
  - walking: +0.5 per unit
  - stairs: +10 per flight
  - riding: +0.2 per tick
  - noise at home: 4.21
  - high price level: 4.1
  - a dirty hotel room on arrival: +80
  - a missing demand (no parking, no clinic): +30 per day
- Tiers (used for drawing people and for the facility evaluation) [D]: **low** < 80, **medium** 80–149, **high** ≥ 150.
- **Giving up**: a person waiting at one elevator queue for 300 ticks [D] abandons the trip. They go home or leave the building, and their facility gets a heavy evaluation hit. [R]

### 6.3 Facility evaluation
- Each occupied facility has an **evaluation** = 300 − (the mean stress of its occupants over the day) + modifiers. [D]
- Three tiers, shown in the info panel as a bar and in the evaluation overlay: **excellent**, **good (neutral)** and **poor**. [V] [D thresholds: poor < 100, good 100–199, excellent ≥ 200]
- **Leaving**: one full game day in the poor tier means the tenants or operator leave (offices, condos and shops). [V] Hotel rooms in the poor tier are booked at 25% of the normal rate. [D]

### 6.4 Illness and medical trips [D]
Each day, 1% of office workers with high stress make a clinic trip during working hours. If no clinic is reachable within 10 floors, the demand is unmet (4.12).

### 6.5 Demands and requests
The info bar shows tenant demands as short messages, paraphrased in your own words. Examples: a parking space is needed; medical care is needed; recycling capacity is needed; more security is needed; people on floor X cannot reach floor Y; a VIP is coming. [V] Track each demand as met or unmet. The star rules use them (7).

---

## 7. Star rating [V]

| From → To | Population | Other requirements |
|---|---|---|
| start | – | The tower starts at 1★. |
| 1★ → 2★ | 300 | – |
| 2★ → 3★ | 1,000 | Security offices present. The help text says "more than one", and the readme says "at least two". |
| 3★ → 4★ | 5,000 (permanent only) | More than one hotel suite built; recycling demand met; medical demand met; a **favourable VIP rating** |
| 4★ → 5★ | 10,000 (permanent only) | Transit station built; **all outstanding demands met** (readme) |
| 5★ → Landmark rank | 15,000 (permanent only) | Landmark built on floor 100, **and a weekend wedding has taken place in it** |

- Check after any change in population or construction, and at each day boundary. Ratings never go down. [R]
- On promotion: show a modal celebration, play a fanfare, and unlock the next tool set. The lobby's look improves at 2★ and again at 3★. [R]
- Note for the team: the second game kept the same idea (population plus conditions such as security, cleanliness, medical and VIP) but used its own per-map tables. Use the table above.

---

## 8. Economy

### 8.1 Costs
See 4.0. The bulldozer is free. Rescue services (9.1) cost money.

### 8.2 Income
See 4.1 (levels) and 3.3 (timing). The finance view groups income into **office, single room, twin room, suite, shops, fast food, restaurant, party hall, cinema, condo**. [V]

### 8.3 Maintenance per quarter [V amounts]

| Item | Per quarter | Unit basis |
|---|---|---|
| Standard elevator | $10,000 | per shaft [D] (the original did not state whether it charged per shaft or per car) |
| Express elevator | $20,000 | per shaft [D] |
| Service elevator | $10,000 | per shaft [D] |
| Escalator | $5,000 | each |
| Parking ramp | $10,000 | each (per floor) |
| Recycling centre | $50,000 | each |
| Transit station | $100,000 | each |
| Housekeeping room | $10,000 | each |
| Security office | $20,000 | each |
| Lobby | $? | The finance view lists it, but the amount was not found [D: $100 per lobby unit] |

### 8.4 Bankruptcy [D]
Funds may go negative as a result of maintenance or refunds. While funds are negative the player cannot build. If funds stay negative for 4 quarters, the game ends and offers a reload.

---

## 9. Events

### 9.1 Fire [V shape, D numbers]
- Trigger [D]: from 3★, with at least one security office, a 1-in-300 chance per day. It starts in a random occupied facility above floor 1.
- Spread [D]: every 30 ticks, the fire grows 1 unit left and right on its floor. Every 120 ticks it spreads to the facility directly above. Anything the fire covers is **destroyed** and replaced by a "burned" state. The bare floor survives, but a burned unit must be cleared (bulldozed for free) before rebuilding.
- Response: guards from every security office use the emergency stairs to reach the fire floor. Travel time = 20 ticks per floor of separation [D]. Each guard on site puts out 1 unit per 10 ticks. [D]
- The player may **call a rescue helicopter** (menu or button, available only during a fire) for **$500,000** [D]. It puts out the fire within 60 ticks.
- While a fire burns, people avoid the floors on fire, and those floors' facilities earn nothing that day.

### 9.2 Bomb threat [V shape, D numbers]
- Trigger [D]: from 3★, a 1-in-400 chance per day, only between 08:00 and 17:00.
- The player gets a message demanding a ransom [D: $300,000 × star level]. Choices: **pay** (the threat ends), or **refuse**.
- If the player refuses, a countdown starts [D: until 18:00 the same day] and a bomb is hidden on one random occupied floor. Guards start a search from the nearest security office, going floor by floor through the emergency stairs (10 ticks per floor travelled plus 30 ticks to sweep a floor) [D]. With several offices, the floors are split between the teams.
- Found before the deadline: defused, with a small evaluation boost tower-wide. Not found: an **explosion** destroys facilities across [D: ±10 units on the bomb floor and ±5 units on the floors directly above and below], with burned-area results as in a fire.

### 9.3 VIP visit [V]
- It becomes possible once the tower has a suite and is at 3★. [V] One VIP books a suite for one night, arriving in the evening. The VIP must be drawn distinctly so that the player can follow them.
- The VIP judges **the suite** (its evaluation, cleanliness, price) and **the elevators** (the VIP's own stress during the stay). Pass if the VIP's stress at check-out is in the low tier and the suite is not dirty [D]. A favourable rating sets the "VIP satisfied" flag needed for 4★. If the VIP is unhappy, more chances come later [V] [D: a new VIP every 5 days until passed].

### 9.4 Hidden treasure [V that it exists; D mechanics]
When the player places a facility on a basement floor, there is a 1-in-50 chance of finding a cash bonus [D: $50,000–$500,000, random]. It can happen at most once per game [D].

### 9.5 Seasonal holiday visitor
- The last quarter of each year is a holiday season [R]. Spec: invent your own short seasonal sky animation and jingle on Q4 WE, and switch facilities to a "festive" visual variant from Q4 WD1 to the end of Q4. There is no gameplay effect [D].

### 9.6 Pests (infestation) — see 4.4.

### 9.7 Weather [R]
A random rainy day (20% chance [D]) changes the sky and plays rain sounds. Thunder is occasional. Rain reduces outside visitor numbers by 30% [D].

### 9.8 Wedding [V]
At the landmark, at the weekend. It needs the landmark to be reachable. It is required for the final rank.

---

## 10. Emergency stairs
The building has an external emergency staircase on each side that spans every built floor. It is drawn automatically and the player does not build it. [V] Only guards use it (fire and bomb response). It costs nothing.

## 11. Decorations (automatic)
- A construction crane on the highest floor while the tower is still growing [R]
- The emergency stairs (10)
- Lobby entrance doors at both ends of the ground lobby [R]
- Transit tracks drawn below the station [R]

---

## 12. User interface (functional)

### 12.1 Main view
A scrollable 2-D cross-section of the world: sky above ground, earth below, the tower in the middle. Scroll in both directions. Zoom at 1:1 is required. A zoom-out level is recommended [D].

### 12.2 Tools (toolbar; locked tools are hidden or greyed out until their star rating)
- Pause / run toggle, plus speed (pause, ×1, ×2, ×4) [D: the original had only pause and run]
- Bulldozer (free; removes transport and facilities)
- Adjust tool ("finger"): drag a shaft's top or bottom; click a floor number on a shaft to toggle that floor's service
- Inspect (magnifier): click any person, facility, car, shaft or stairs for its info panel
- Lobby (with the 1-, 2- and 3-storey modifier) / Bare floor / Stairs, grouped [V]
- Escalator
- Elevators: standard, express, service. Clicking an existing shaft adds a car.
- Office, Condo
- Hotel group: single, twin, suite, housekeeping [V grouping]
- Food group: fast food, restaurant
- Shop
- Entertainment: party hall, cinema
- Services: security, medical, recycling
- Parking: space (drag along a row), ramp (drag down a column)
- Transit station
- Landmark
- Each tool shows its cost and its star requirement on hover.

### 12.3 Map panel (mini-map) with overlays [V]
- **Silhouette / edit**: a reduced view of the whole tower with the current viewport rectangle. Click it to jump there. The three elevator types are drawn distinguishably.
- **Evaluation overlay**: colours each facility by evaluation tier. It pauses the game.
- **Pricing overlay**: colours each facility by its tenants' view of the price (too high, fair, cheap). It pauses.
- **Hotel overlay**: highlights dirty rooms. It pauses.

### 12.4 Windows and panels
- **Info bar**: clock, star rating, date (day type, quarter, year), funds, population, and a one-line message and demand ticker. [V]
- **Finance window** (pauses): quarter-to-date income by the 10 categories, maintenance by the 10 categories, construction spending, other income, total balance. [V]
- **Facility panel** (pauses): type, name (renamable), evaluation bar (3 tiers), occupants list, price level selector (rented, sold and hotel types), current status (open, closed, vacant, dirty, infested, under construction). [V]
- **Person panel**: name (the player may name up to 20 people), home or work facility, current activity and destination, stress tier. [V]
- **Find person / find facility**: lists of named items (20 each). "Find" scrolls the main view to the item and points at it with an indicator. [V]
- **Elevator panel**: 5.7. Clicking a moving car shows that car's load, direction and destination instead. [V]
- **Cinema panel**: current film, how long it has run, income, audience comments in your own words, and "change film" (new vs classic). [V]
- **Event dialogs**: bomb ransom (pay / refuse), fire (call helicopter), VIP arriving, VIP verdict, star promotion, treasure found, final rank. Write all of their text yourself.

### 12.5 Options
Toggles for people animation and detail animation (machinery, vents), and separate sound toggles for elevators, background ambience and events. [V]

---

## 13. Rendering requirements (functional list)

Sizes are footprints in units × floors. Design all art yourself. Nothing below describes how the originals looked. It lists only which states must be distinguishable.

### 13.1 Facilities
| Facility | Required visual states |
|---|---|
| Lobby (4-unit tiling; 1, 2 or 3 floors tall) | ground lobby vs sky lobby; 3 quality tiers (1★, 2★, 3★+); entrance pieces at both ends of the ground lobby |
| Bare floor (tiling) | empty floor (no tenant) and floor slab only (under a tenant) |
| Office 9×1 | vacant; occupied with lights on (day, workers present); occupied with lights off (night or weekend) ; a few variants |
| Condo 16×1 | vacant (day / night); occupied: daytime, evening lit, night dark; a few variants |
| Single 4×1 / Twin 6×1 / Suite 10×1 | vacant-clean; occupied lights on; occupied sleeping (dark); vacant-dirty; being cleaned; infested; a few variants |
| Fast food 16×1 | closed; open empty; open some customers; open busy; a few variants |
| Restaurant 24×1 | closed; open empty; some; busy; a few variants |
| Shop 12×1 | closed; open; busy (optional); several variants |
| Party hall 24×2 | closed; party in progress |
| Cinema 31×2 | closed; open with audience arriving (empty or partly full); film showing (animated); several invented film posters |
| Housekeeping 15×1 | staff in; staff out |
| Security 16×1 | idle ; deployed |
| Medical 26×1 | 3 activity states (low, normal, busy) |
| Recycling 25×2 | idle; collecting (load level 1–5); being emptied (collection vehicle) |
| Parking space 4×1 | empty; car parked (2 variants) |
| Parking ramp 16×1 | 3 states (idle, car entering, car leaving) |
| Transit station 30×3 | closed; open with no train; open with train at the platform |
| Landmark 28×5 | normal; wedding in progress |
| Stairs 8×2 | static, plus a walking animation while used |
| Escalator 8×2 | static; running animation |
| Elevator shaft (4 or 6 wide) | shaft segment per floor; top and bottom machinery (animated while any car moves); floor number labels; marked "no service" floors |
| Elevator car (standard, express, service) | 5 load states: empty, 1, 2–3, 4+, full; doors open / closed |
| Under construction | generic construction state for room-type facilities, and a separate one for structural pieces (lobby, parking) |
| Burned area | ruin state, any width |
| Fire | small and large flame, animated, placeable per unit |
| No-access marker | an icon over any facility with no route |

### 13.2 People (each person about 1 unit wide; staff and the VIP about 2 units)
- Kinds: man, woman (2 variants), child, adult with child (2 variants), office worker with briefcase (sales), housekeeper, guard, VIP (must stand out).
- States: walking left and right; waiting in a queue (facing up-side or down-side); stepping into and out of a car; riding (inside car, simplified); on stairs or escalator; sitting or eating (inside facilities, optional); sleeping (implied by dark rooms).
- **Stress tier** must be readable on every visible person: low, medium and high, distinguishable from each other (for example by tint).
- Elevator queues are drawn beside the shaft on each floor, with up-callers on one side and down-callers on the other, cut off at a maximum drawn length.

### 13.3 World and sky
- Sky states by time of day: night, pre-dawn, dawn, morning, day, afternoon, dusk, evening, then back to night. Cross-fade between them following the uneven clock.
- Weather: rain overlay, thunder flash, overcast tint.
- Clouds drifting (several shapes). A distant city skyline band near the ground.
- Underground: earth fill below floor 1, revealed where basements are built.
- The seasonal sky animation (9.5).
- The rescue helicopter (fire). Indicators for VIP arriving, treasure, star-up and bomb threat.

---

## 14. Differences between the first and second games, and recommendations

| Topic | First game | Second game | Recommendation |
|---|---|---|---|
| Facility catalogue | Fixed set of about 25 types | Data-driven plugin catalogue with over 100 types (vending machines, restrooms, clinics, convenience stores, spas, schools, stadium, observatory, sky bridge, large elevators, hotel front desk, and more) | **Use a data-driven facility table** (JSON) from day 1, but ship only the 25 types in section 4. Add types later as content. |
| Maps / stages | One open plot | Several maps with different plot widths, height limits and scenario goals | Optional later. Keep the world size in data. |
| Trash | Recycling centre as a demand facility | Trash ("dust") builds up with foot traffic and is collected by a vehicle from a trash facility | Optional add-on: tie it to the recycling demand. |
| Crime | None | Thieves target tenants; guards patrol; police can be called | Optional cheap add-on that reuses the guard pathing. |
| Restrooms / vending | None | Demand facilities that cut stress | Cheap add-on: small 2–4 unit facilities, each giving −20 stress to people passing through the floor. |
| Outside view | None | Exterior view with billboards and rooftop objects that earn advertising income | Skip for now. |
| Hotel | Rooms plus housekeeping | Adds a front desk and a hotel-maintenance room | Skip. |
| Seasonal event | Sky animation | Walk-through visit | Sky animation only. |
| Medical | A demand clinic | Clinic visits driven by stress and injury, with individual patients | Use the first game's model, plus 6.4. |
| Elevator preview | Yes | Yes ("future" simulation) | Keep (5.7 item 7). |
| Naming / find | Yes | Yes | Keep. |
| Placement adjacency | Implicit noise | Explicit left/right compatibility check | Keep the noise rule (4.21) and show a placement warning. |
| Star rating | 5 stars + landmark | Per-map levels, with VIP, security, cleanliness and medical flags | First game's table (7). |

---

## 15. Sound requirements (functional cues)

Provide your own original sounds for each cue. They fall into four groups, each with a mute toggle (12.5).

**Elevators:** car departing; car arriving (bell). Play them only for on-screen shafts and limit how many play at once.

**Events and UI:**
- construction placed (normal)
- construction placed (flexible: floor or lobby extension)
- construction refused
- bulldoze
- cash income (coins)
- star promotion fanfare
- final-rank fanfare
- applause (VIP pleased, wedding)
- phone ring or alarm (bomb threat)
- fire alarm
- explosion
- helicopter
- treasure found
- holiday jingle
- message or notice chime

**Background ambience** (fair random pick among the visible facilities every 0.5 s, weighted by area on screen [R]):
- office chatter (occupied, lit)
- fast-food clatter
- restaurant murmur
- party noise
- cinema soundtrack (per film, while showing)
- condo household sounds
- hotel doorbell and plumbing
- transit train arriving and departing
- parking car arriving and leaving

**Time of day and weather:** a small set of ambient cues of your own design that change across the day (e.g. a dawn cue, daytime, evening, night), plus rain, thunder and wind.

The game has no music. [V] You may add original music if you like.

---

## 16. Acceptance checklist for the implementation team
1. A 300-population tower reaches 2★ with only a lobby, offices, condos, fast food, stairs and standard elevators.
2. With 30 offices on floors 2–20 served by one shaft of 2 cars, the 08:00 rush builds visible queues, and stress rises into the medium and high tiers. Adding cars or a second shaft clearly relieves it.
3. An office left in the poor tier for one full day leaves. A condo that leaves deducts its sale price.
4. A hotel room that is never cleaned becomes infested after the [D] threshold and stays unlettable until it is bulldozed.
5. An express shaft accepts stops only at 1, 15, 30, 45, 60, 75, 90 and basements. Transfers between shafts happen only on a continuous lobby.
6. Promotion to 4★ is blocked until a VIP has stayed in a suite and judged it favourably.
7. Fire spreads, guards climb the emergency stairs, and the helicopter option ends it.
8. Pausing freezes everything, elevators included.

---

---

This document was written in a separate dirty room from facts and rules only. It contains no art, text or code from any existing game. Design every visual, sound, name and line of text yourself.
