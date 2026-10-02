# Parkhaven — Functional Game Specification (v1)

Clean-room functional specification for an original browser theme-park management game.
This document describes **rules, numbers and behaviour only**. It contains no art, no
palette, no text strings and no code from any existing game. All wording that players
will see is to be written by the build team.

## 0. Conventions

### 0.1 Provenance tags
| Tag | Meaning |
|---|---|
| [R] | Number or rule taken from the reference reimplementation's source (the behaviour of the reference game as reimplemented). |
| [V] | Verified against the reference game's own data. (Not used in this revision: the reference install image was not consulted; see SPEC-LOG.) |
| [D] | Design default chosen by the spec writer. Free to tune. |

Where [R] numbers are given, the build team may tune them freely; they are a known-good
starting point, not a requirement. The build team **should** change the presentation,
naming and fine tuning to make the game its own.

### 0.2 Units
| Quantity | Unit used in this spec |
|---|---|
| Money | "credits" (cr), with 2 decimal places. Internally store integer **cents** (1 cr = 100). The reference uses a pound-like unit at the same scale; costs below are directly usable. |
| Horizontal distance | **tile** = 1 map square. Internally the reference uses 32 sub-units per tile. This spec uses `u` = 1/32 tile where needed. |
| Vertical distance | **height unit (hu)** = 1/4 of a tile width. Land and paths move in **land steps** of 2 hu. Track pieces snap to whole hu. See §9. |
| Ratings | Excitement / Intensity / Nausea as fixed-point **hundredths**: a rating of 6.50 is stored as 650. |
| Speed | metres per second (m/s). See §8.6 for the world scale and the rating-unit conversions. |
| G-force | dimensionless g, stored as hundredths (1.00 g = 100). |
| Time | **tick** = 1/40 s at normal speed [R]. |

### 0.3 Random numbers
Use one seeded deterministic PRNG for all simulation randomness (needed for save/replay
determinism). Notation in pseudo-code: `rand(n)` returns an integer in `[0, n)`; `chance(p, of)`
is true with probability `p/of`.

---

## 1. Time and calendar

### 1.1 Ticks [R]
- The simulation runs at **40 ticks per second** at 1× speed. Offer speeds 1×, 2×, 4×, 8× [D] (run N simulation ticks per frame); plus Pause.
- The calendar advances by a 16-bit "month progress" counter: **+4 per tick**, a month ends when the counter wraps at 65 536. So **1 month = 16 384 ticks ≈ 6 min 50 s** real time at 1×. [R]
- Day boundaries are derived from month progress × days-in-month; a **week** begins every 16 384/4 = 4 096 ticks (progress & 0x3FFF == 0); a **fortnight** every 8 192 ticks. So every month has exactly **4 weeks and 2 fortnights** regardless of its number of days. [R]

### 1.2 The year [R]
- The operating year has **8 months only**: the season runs from early spring to mid-autumn. (Months: the 3rd to the 10th month of the real calendar.) Days per month in order: **31, 30, 31, 30, 31, 31, 30, 31** (245 days/year). [R]
- Year 1 begins on day 1 of the first month. There is no winter; the year rolls straight from the last month to the first.
- Month index 0 = first (spring) month … 7 = last (autumn) month.

### 1.3 Scheduled events
| When | What happens | Source |
|---|---|---|
| every tick | guests, staff, vehicles move; guest generation roll (§5); weather step check | [R] |
| every 512 ticks (~13 s) | recalc park rating, park value, company value, "ride value for money", suggested max guests, guest generation probability | [R] |
| every 4 096 ticks | recalc park size (owned tiles) | [R] |
| each **day** start | daily profit estimate; queue-time counters; low-rating day counter; objective check (for objective types that can complete early); reduce casualty penalty by 7 | [R] |
| each **week** start | pay wages (¼ of monthly wage per staff); pay research (¼ of monthly funding); pay loan interest; tick marketing campaigns; guest-complaint warnings; reachability check of ride entrances/exits; history graphs push (rating, guests, cash, weekly profit, park value) | [R] |
| each **fortnight** start | pay ride running costs (each ride's upkeep value once) | [R] |
| each **month** start | shift finance table to a new month; objective check; "entrance fee too high" warning; awards update | [R] |

### 1.4 Day/night (optional) [R]
Optional lighting cycle driven by month progress `f` in [0,1): dark 0–1/8, fade to light 1/8–3/8, full light 3/8–5/8, fade to dark 5/8–7/8, dark 7/8–1. Purely visual; off by default [D].

---

## 2. Weather

### 2.1 Weather types [R]
| # | Type | Temp delta (°C) | Effect | Gloom level (0–3) | Precip level |
|---|---|---|---|---|---|
| 0 | Sunny | +10 | none | 0 | none |
| 1 | Partly cloudy | +5 | none | 0 | none |
| 2 | Cloudy | 0 | none | 0 | none |
| 3 | Rain | −2 | rain | 1 | light |
| 4 | Heavy rain | −4 | rain | 2 | heavy |
| 5 | Thunderstorm | +2 | storm | 2 | heavy |

(The reference also has three snow types; omit in v1 [D].)

"Dry" = types 0–2. "Raining" = types 3–5.

### 2.2 Climate table [D]
Each month has a base temperature and a weighted weather distribution. The reference
stores this per "climate" object; the data was not in the source tree, so these are design
defaults with the same shape (temperate climate):

| Month | Base °C | Sunny | P.cloudy | Cloudy | Rain | Heavy rain | Storm |
|---|---|---|---|---|---|---|---|
| 0 | 8 | 3 | 4 | 4 | 3 | 1 | 0 |
| 1 | 11 | 4 | 4 | 3 | 3 | 1 | 0 |
| 2 | 15 | 5 | 4 | 3 | 2 | 1 | 1 |
| 3 | 19 | 6 | 4 | 2 | 2 | 1 | 1 |
| 4 | 22 | 7 | 4 | 2 | 1 | 1 | 1 |
| 5 | 21 | 6 | 4 | 2 | 2 | 1 | 1 |
| 6 | 16 | 4 | 4 | 3 | 3 | 1 | 1 |
| 7 | 11 | 3 | 4 | 4 | 3 | 2 | 0 |

Actual temperature = base + delta of the weather type.

### 2.3 Weather transition [R]
```
on new weather target chosen:
    next.type  = weighted_pick(climate[month])
    next.temp  = climate[month].base + delta(next.type)
    next.gloom, next.effect, next.level from the table
    hold_timer = 1920 ticks            # current weather persists at least this long
each tick:
    if hold_timer > 0: hold_timer -= 1; continue
    every 128 ticks:
        if cur.temp != next.temp:      cur.temp  step 1 toward next.temp
        elif cur.gloom != next.gloom:  cur.gloom step 1 toward next.gloom   (screen darkens/brightens one level)
        else:
            cur.effect = next.effect
            if cur.level != next.level: cur.level step 1 toward next.level
            else: cur.type = next.type; choose a new target
```
Weather starts as Partly cloudy at the base temperature. Thunder: while effect=storm, roll each tick for a lightning flash + thunder sound (reference: about 436 in 65 536 per tick while no thunder is playing) [R-approx].

### 2.4 Weather effects
Guests: at ≥ 21 °C thirst falls faster (§6.4); item values change with temperature (§7.2); in rain guests refuse unsheltered rides (§6.5, §8.9) and frozen/balloon-type items. Rides: brake failures more likely in rain (§8.10). Visual: gloom darkening and rain particles (§14).

---

## 3. Economy

### 3.1 Starting state [R]
| Item | Value |
|---|---|
| Starting cash | 10 000 cr |
| Starting loan | 10 000 cr (the starting cash is borrowed) |
| Max loan | 20 000 cr (scenario-configurable) |
| Interest rate | 10 % per year (scenario-configurable) |
| Loan adjust step | 1 000 cr per click [D, matches reference UI] |
| Park entrance fee default | 10.00 cr (only if the scenario charges for entry) |
| Land purchase price | 90 cr per tile [R scenario default] |
| Construction rights price | 40 cr per tile [R] |

### 3.2 Loan & interest [R]
- Interest is paid **weekly**: `weekly_interest = loan × rate_percent × 5 / 16384` (e.g. 10 000 at 10% → 30.52 per week). That is ≈ loan × rate% / 32.8 per week, i.e. about the nominal rate per 8-month (32-week) year.
- Repay in steps; cannot repay more than the cash available; cannot borrow over the max.
- Cash may go negative; [D] if cash < 0 for 4 consecutive weeks show a warning; no bankruptcy in v1 except as an objective failure condition (scenario option).

### 3.3 Expenditure categories (finance table) [R]
Monthly columns kept for the last 16 months [R]; the oldest month is folded into a lifetime total.

| # | Category | Sign | Counts towards "today's spend" ticker |
|---|---|---|---|
| 1 | Ride construction | − | yes |
| 2 | Ride running costs | − | no |
| 3 | Land purchase | − | yes |
| 4 | Landscaping | − | yes |
| 5 | Park entrance tickets | + | yes |
| 6 | Ride tickets | + | yes |
| 7 | Shop sales (non-food) | + | yes |
| 8 | Shop stock (non-food) | − | yes |
| 9 | Food/drink sales | + | yes |
| 10 | Food/drink stock | − | yes |
| 11 | Staff wages | − | no |
| 12 | Marketing | − | yes |
| 13 | Research | − | no |
| 14 | Loan interest | − | no |

### 3.4 Recurring costs [R]
| Cost | Monthly amount | Paid |
|---|---|---|
| Handyman | 50 cr | weekly, ¼ each week |
| Mechanic | 80 cr | weekly |
| Security guard | 60 cr | weekly |
| Entertainer | 55 cr | weekly |
| Research: none / minimum / normal / maximum | 0 / 100 / 200 / 400 cr | weekly, ¼ each week |
| Ride running cost ("upkeep") | per-ride value (§8.8) | **once per fortnight** (so 2× per month); only while the ride is not Closed |
| Loan interest | see 3.2 | weekly |

### 3.5 Daily profit estimate (for the UI) [R]
```
estimated_week_profit = 7 × (income − spend recorded today)
                      + ( − Σ monthly wages − research_monthly − loan/600 − Σ 2×upkeep(open rides) ) / 4
```
Averaged per week for the weekly-profit graph.

### 3.6 Park value and company value [R]
- **Ride value** of each ride (computed by the ratings engine, §8.7) is roughly the fair ticket price in cr.
- `ride_park_value(cr) = ride_value(cr) × 10 × (customers_in_last_5_min + 4 × ride_type_bonus)` — summed over all rides that have a value. ("Last 5 min" = the last 10 samples of a 960-tick customer counter, §8.7.)
- `park_value = Σ ride_park_value + 7.00 cr × guests_in_park`.
- `company_value = park_value − loan + cash`.
- "Total ride value for money" (used for entrance-fee tolerance) = `Σ over open, working rides of 2 × max(0, ride_value − ride_ticket_price)` (ticket price subtracted only if rides are charged).

### 3.7 Pricing model choice (scenario flag) [R]
A scenario is one of:
- **Pay-per-ride**: rides charge a ticket price; park entry free.
- **Pay-at-gate**: park entry has a fee; rides are free (ticket price fixed at 0).
- [R also has a "both" option; v1 may offer it as a sandbox toggle [D].]

Monthly warning if `entrance_fee > 1.5 × total_ride_value_for_money` [R].

---

## 4. Park rating [R]

Integer 0–999, recomputed every 512 ticks. Displayed as a bar/number. Pseudo-code:

```
rating = 1150                                  (1050 if scenario flag "harder rating")
# Guests
rating -= 150 - min(2000, guests_in_park) / 13          # -150 … +3
happy  = guests in park with happiness > 128
lost   = guests that are leaving AND have been unable to find the exit for a while (lost countdown < 90)
rating -= 500
if guests_in_park > 0: rating += 2 * min(250, happy * 300 / guests_in_park)   # 0 … +500
if lost > 25: rating -= (lost - 25) * 7
# Rides
rating -= 200
if ride_count > 0: rating += 2 * average_over_all_rides(100 - downtime%)         # 0 … +200
rating -= 100
rated = rides that have ratings
if rated > 0:
    avgE = Σ(excitement/8)/rated      # excitement in hundredths, so /8 ⇒ ~12.5 per point
    avgI = Σ(intensity/8)/rated
    dE = min(|avgE - 46| / 2, 50)      # ideal average excitement ≈ 3.70
    dI = min(|avgI - 65| / 2, 50)      # ideal average intensity  ≈ 5.20
    rating += 100 - dE - dI
rating -= 200 - (min(1000, Σ excitement/8) + min(1000, Σ intensity/8)) / 10   # rewards *many* good rides
# Litter
old_litter = litter items at least 7680 ticks old (anywhere on map)
rating -= 600 - 4 * (150 - min(150, old_litter))       # 0 litter = +0, 150+ = -600
# Casualties
rating -= casualty_penalty       # added when a ride crashes and kills guests; decays 7/day
clamp(rating, 0, 999)
```
Notes for the build team:
- Rides with excitement/intensity of 0 still count towards uptime.
- Casualty penalty [R]: +200 per ride crash that kills riders; +25 per guest who drowns (capped 1 000); decays by 7 per day. v1 may omit crashes (§8.10).

---

## 5. Guest arrival

### 5.1 Suggested guest maximum ("park capacity") [R]
```
cap = Σ over rides that are Open and not broken: type_bonus(ride)          # see ride tables, e.g. carousel 45, coaster 95
if scenario flag "harder guest generation":
    cap = min(cap, 1000)
    cap += Σ over open, tested tracked rides with excitement ≥ 6.00 and track length ≥ 600 L: 2 × type_bonus
cap = min(cap, 65535)
```

### 5.2 Generation probability [R]
Recomputed every 512 ticks; each tick a guest spawns if `rand(65536) < P`.
```
P = 50 + clamp(park_rating - 200, 0, 650)          # 50 … 700
N = guests_in_park + guests_walking_to_park
if N > cap:  P /= 4  (and /4 again under "harder guest generation")
if N > 52000: P /= 4
if entrance_fee > total_ride_value_for_money:      P /= 4
    if entrance_fee / 2 > total_ride_value_for_money: P /= 4
for each active award: P += P/4 if positive else P -= P/4   (awards optional in v1)
# under "harder guest generation", additionally no spawn if guests_in_park > cap + 150
```
Expected arrivals at the maximum P=700: 700/65536 per tick ≈ 0.43 guests per real second at 1× ≈ **175 guests per game month**; at P=250 (rating ≈ 400) ≈ 62 per month. Marketing adds 50–100 per month per campaign. Guests stay for months, so populations of several hundred to a few thousand result. [D] If sessions feel slow, scale all spawn probabilities (base and campaign) by a single global factor rather than changing individual terms.

### 5.3 Marketing campaigns [R]
Each active campaign adds an independent spawn roll per tick: `rand(65536) < Pc`; the spawned guest is tagged by the campaign.

| Campaign (functional) | Cost per week | Pc | Effect on guest spawned by it | Reduced (Pc/8) when |
|---|---|---|---|---|
| Free park entry voucher | 50 cr | 400 | carries a voucher for free entry | entry fee < 4.00 |
| Free ride voucher (one chosen ride) | 50 cr | 300 | voucher for that ride; heads to it | ride price < 0.30 |
| Half-price entry voucher | 50 cr | 200 | half-price entry voucher | entry fee < 6.00 |
| Free food/drink voucher (one chosen item) | 50 cr | 200 | voucher for that item | — |
| Park advertising | 350 cr | 250 | none (just brings guests) | — |
| Ride advertising (one chosen ride) | 200 cr | 200 | heads straight for that ride | — |

- Duration chosen by the player: 2–12 weeks (default 2) [R UI]. Total cost = weekly cost × weeks, paid up front (category: Marketing). Only one campaign of each type at a time; starting another of the same type replaces it. Demolishing a ride cancels campaigns for that ride.
- Entry campaigns only available in pay-at-gate scenarios; ride-voucher only in pay-per-ride scenarios; ride campaigns need at least one open ride.
- A campaign ends after its weeks expire (the start week does not count if started mid-week); a notice is raised.

### 5.4 Spawn points and entering [R]
- Guests appear at "spawn points" on the map edge on a path leading to the park entrance (scenario-defined), walk to the entrance.
- At the entrance: if the entry fee (after voucher) exceeds their cash, they turn round and leave. Otherwise they pay the fee (category Park entrance tickets) and get a "paid to enter" flag that **cuts their willingness to pay for rides to ¼ of value** (§6.6).

---

## 6. Guests

### 6.1 Guest attributes (all 0–255 unless noted) [R]
| Attribute | Initial value | Meaning |
|---|---|---|
| happiness / happiness_target | scenario default (≈128 i.e. 50%) ± rand(−15…+16) | current value moves 4 points toward target per update |
| energy / energy_target | 65 + rand(64)  (range 32…128 kept) | walking speed; tiredness |
| hunger | scenario default 200 ± 15 | **high = full**; falls over time |
| thirst | scenario default 200 ± 15 | **high = not thirsty** |
| toilet | 0 | **high = needs toilet** |
| nausea / nausea_target | 0 | current moves 4 points/update toward target |
| cash | scenario default (50.00) + one of {−10.00, 0, +10.00, +20.00} (equal odds; min 0) | money in pocket |
| preferred intensity range [min,max] | max = 3 + rand(8) (a value ≥7 becomes 15 i.e. "no upper limit"); min = min(max,7) − 3 | in whole rating points |
| nausea tolerance | none 1/12, low 2/12, average 3/12, high 6/12 | |
| mass | 45 + rand(32) | affects vehicle physics (optional) |
| items carried | bitset | food, drink, souvenirs, empty containers, voucher, map, umbrella |
| ride history | per-ride and per-ride-type "has ridden" sets | |
| favourite ride, thoughts list (max 5) | | |

Scenario options (v1 subset): guest initial cash, initial happiness, initial hunger, initial thirst; flags "guests prefer less intense rides" (range 0–4) and "guests prefer more intense rides" (range 9–15, nausea tolerance biased up).

Thresholds:
| Nausea tolerance | Max ride nausea accepted | Min preferred nausea |
|---|---|---|
| none | 3.00 | 0 |
| low | 6.00 | 0 |
| average | 8.00 | 2.00 |
| high | 10.00 | 4.00 |

### 6.2 Update cadence [R]
- Every tick: movement (steps proportional to energy; queuing guests move at least at 95; walking on slopes halves speed).
- Every **128 ticks** ("consumption update"): eating/drinking progress, energy/happiness/nausea move toward targets.
- Every **512 ticks** per guest (staggered by guest id) ("needs update"): the full needs logic below, then the consumption update.

### 6.3 Consumption update (every 128 ticks) [R]
```
if has food or drink and consume_timer == 0: consume_timer += 3
if consume_timer > 0 and not on a ride:
    consume_timer -= 3 (min 0)
    if drink:  thirst += 7
    else:      hunger += 7; thirst -= 3; toilet += 2
    when consume_timer hits 0: item consumed; if item has a container, guest now carries that empty container
energy  → energy_target:  down 2 per update, or up 4 per update (clamped 32…128)
happiness → target: ±4 per update
nausea  → target:   ±4 per update
```
Buying an item adds its consumption time (table §7) to consume_timer (max 255).

### 6.4 Needs update (every 512 ticks) [R]
In order:
1. If "crowded" flag (set by path congestion, §6.11) → random crowd-related thought.
2. **Surroundings** (walking/sitting guests, every 18th needs update): scan the 10×10-tile square around the guest:
   - ≥5 fountains and <20 litter → *positive thought: fountains*;
   - else ≥40 scenery items and <8 litter → *positive: scenery*;
   - else pleasant ride music nearby and <20 litter → *positive: music*;
   - else <2 litter → *positive: very clean*.
   - Any of those also gives happiness_target +45.
3. On a ride for a long time: after 15 needs-updates on the same ride, happiness_target −5 per update; after 22, *wants to get off* thought.
4. **Picking a ride**: a guest who has entered, been in the park ≥5 × 2048 ticks and ridden nothing, tries to pick a ride; if none fits, happiness_target −128 and they leave.
5. With probability 2184/65536 (8192 with a map) per needs update → run ride choice (§6.5).
6. Every other needs update, if not leaving: gather candidate need-thoughts and pick one at random:
   - tired: energy ≤ 70 and happiness < 128
   - hungry: hunger ≤ 10 and nothing to eat → head for nearest food stall
   - thirsty: thirst ≤ 25 and nothing to drink → head for nearest drink stall
   - toilet: toilet ≥ 160 → head for nearest toilet
   - running out of money: cash ≤ 9.00, happiness ≥ 105, energy ≥ 70 → head for cash machine (if built)
   - if leaving: *wants to go home*
   On the alternate updates: nausea ≥ 140 → *feels sick*; ≥ 200 → *feels very sick* and heads for a nearby first aid room.
7. State-specific:
   - walking / entering / leaving: decide-whether-to-leave (§6.8), then hunger tick.
   - sitting on bench: energy_target +5 (up to 135), thirst −4 and toilet +3, nausea_target −6 (min 50), hunger tick.
   - queuing: if time_in_queue ≥ 2000: happiness_target −4 (or, if a queue entertainment add-on is on the path, rises gradually toward 165), hunger tick.
8. **Idle drift**: happiness_target moves 1 toward 128; nausea_target −2; energy ≤ 50 → happiness_target −2; hunger < 10 → −1; thirst < 10 → −1; toilet ≥ 195 → −1.
9. **Vomit roll**: walking and nausea_target ≥ 128 → with probability (nausea − 128)/2 out of 256, the guest vomits (§6.10).

**Hunger tick** (when hunger ≥ 3): hunger −2, energy_target +2, toilet +1.
**Decide-whether-to-leave** also does: energy_target −2 (min 33); if temperature ≥ 21 °C, thirst −1.

Resulting decay (for balancing): a needs update every 512 ticks ⇒ 32 per month. Hunger falls ~2 per needs update, so from 200 a guest is hungry (≤10) after ≈95 updates ≈ 3 months of game time without eating — tune [D] if guests feel too self-sufficient; many players expect hunger within the first game-month. **Recommended [D]: hunger tick −4 instead of −2** for a browser-session-length game.

### 6.5 Ride choice [R]
```
pick_ride(guest):
    if not walking, already heading somewhere, leaving, or holding food/drink: return
    candidates = rides on tiles within 10 tiles of the guest  (all rides if guest has a map)
               ∪ rides visible from anywhere: highest drop > 66 height units OR excitement ≥ 8.00
    best = the candidate with the highest excitement such that
           guest has not ridden it, its queue is not flagged full,
           has ratings, and guest_accepts_ride(guest, ride, thinking=true)
    if best: head for it (lost countdown = 200)
```

`guest_accepts_ride(guest, ride, at_ride, at_queue)`:
```
reject if ride not Open or broken down
reject if guest is leaving (unless ride is a free transport ride)
if shop/facility → shop rules (§7.3)
if at_ride and queue full (last queuer within 8 u, or standing still within 13 u) → reject, mark queue full
reject if this is the ride the guest just left/rejected (memory clears after 720 ticks)
price check (if rides cost money and no voucher): price > cash → reject (*can't afford* / *out of money*)
reject if ride crashed recently and happiness < 225 (*not safe*)
if ride has ratings:
    if guest already decided to go to this ride: only reject if intensity > 10.00
    else:
        if precipitating and ride sheltered < 3/8 (and no umbrella-friendly ride): reject (*not while raining*)
        maxI = min(pref_max*100, 1000) + happiness;  minI = pref_min*100 - happiness
        intensity < minI → reject (*not thrilling enough*)
        intensity > maxI → reject (*too intense*)
        nausea > max_nausea(tolerance) + happiness → reject (*too sickening*)
        nausea ≥ 1.40 and guest nausea > 160 → reject
if ride has no ratings yet and is a coaster-type (g-forces): 90% reject; also reject if measured g's exceed +5/−4/4 lateral
value check (if ride has a value and money is on):
    v = ride_value;  if guest paid park entry: v /= 4
    price > 2v → reject (*bad value*, happiness_target −16)
    at the ride and price ≤ v/2 and guest did not pay entry → *good value* thought
accept: popularity +1
```
Every rejection *made at the ride* (not when merely thinking) adds the matching thought, happiness_target −8 (−16 for bad value) if target ≥ 64, and counts as a "popularity 0" sample.

### 6.6 Riding [R]
On boarding:
```
sat = value_satisfaction + intensity_nausea_satisfaction + queue_bonus + familiarity
value_satisfaction: money off → −30; no value yet → −30; price ≤ value → −5;
                    price ≤ value × (1 + happiness/256) → −30; else 0
intensity_nausea_satisfaction: for each of intensity and nausea, count how many of three widening windows
    contain the ride's rating: [min,max], then [min−2h, max+h], then [min−4h, max+2h] (h = happiness)
    score_x = 3 − windows_hit  (0 = perfect fit)
    hi = max(score_i, score_n); lo = min(...)
    (hi,lo): (0,·)=70, (1,0)=50, (1,1)=35, (2,0)=35, (2,1)=20, (2,2)=10, (3,0)=−35, (3,1)=−50, (3,2/3)=−60
    ride without ratings: 70
queue_bonus: time_in_queue ≥ 4500 → −35; ≥ 2250 → −10; ≤ 750 → +10
familiarity: +10 if ridden this ride type before; +10 more if ridden this exact ride
happiness_target += sat (clamped 0…255)
ride satisfaction sample: sat ≥ 40 → 3, ≥ 20 → 2, ≥ 0 → 1, else 0
nausea_target += ((ride_nausea × clamp(256 − happiness_target, 64, 200) / 512) × max(128, hunger)/128 × 2) >> tolerance_index
```
(tolerance_index 0 none, 1 low, 2 average, 3 high).

On leaving the ride:
- happiness = happiness_target, nausea = nausea_target (instant).
- Ride again? only for rides flagged "re-rideable" (coasters, go-karts, flume): needs happiness ≥ 180, energy ≥ 100, nausea ≤ 160, hunger ≥ 30, thirst ≥ 20, toilet ≤ 170, intensity ≤ 10.00; then 75% (or 25% if they have ridden >7 rides).
- Preferred intensity max +1 (up to 15) with probability (256 − pref)/256 when happiness ≥ 200 (unless "prefer less intense" flag).
- *Really enjoyed it* thought (and a laugh sound 3/8 of the time) if happiness ≥ 215, nausea ≤ 120, intensity ≤ 10.00.
- Favourite ride: score = excitement/4 + sat (≤255); becomes favourite if higher than current favourite's score and happiness & target ≥ 160.

Ride popularity: average of the last 25 popularity samples (1 = joined/bought, 0 = turned away), shown as %. Ride satisfaction: sum of last 20 samples (0–3 each)/4, shown as %.

### 6.7 Queues [R]
- A guest who arrives at the queue-entry tile of a ride's queue (facing the queue's ride sign) runs guest_accepts_ride(at_queue=true). If accepted they join; time_in_queue counts up 1 per movement step while queued.
- Queue walking speed floor is 95 (queues keep moving even when guests are tired).
- At time_in_queue ≥ 2000: occasional fidget animation. ≥ 3500: chance 93/65536 per step of a *waited too long* thought for that ride. ≥ 4300: if happiness ≤ 65, chance 2184/65536 per step to give up and leave the queue.
- Weekly warning to the player if more than 25 guests (and ≥5% of queuers) have a fresh *waited too long* thought; it points at the worst ride.

### 6.8 Leaving the park [R]
Checked each needs update while walking:
```
if not already leaving:
    money park:  stay if energy ≥ 55 and happiness ≥ 45 and cash ≥ 5.00
    free park:   stay if energy ≥ 70 and happiness ≥ 60
otherwise: 5% chance (3276/65536) per check to start leaving
leaving: forget current ride target, *go home* thought, head for nearest park entrance; a lost-countdown runs;
         when it repeatedly fails to find the exit: *can't find exit* thought and happiness_target −30 each cycle (90-step cycle).
```
Leaving guests are removed when they reach the map edge outside the park.

### 6.9 Spending [R]
- Every purchase subtracts from cash (min 0), adds to that guest's lifetime spend and per-category spend, and books income in the matching finance category. Show a floating money amount at the guest and play the "purchase" cue.
- Ride tickets: paid at the station entrance; if cash ≤ 0 or price > cash, or price > 2 × value, the guest refuses at the entrance and leaves the queue.

### 6.10 Nausea and vomiting [R]
- Vomit event: hunger /= 2, nausea_target /= 2, nausea −30; creates a *vomit* litter item at the guest's feet; plays a random cough/vomit cue.
- Guests at nausea ≥ 200 seek first aid (§7). Guests will not buy food while nausea ≥ 145.
- Benches: guests with nausea > 170 or energy ≤ 50, or holding food when hungry/unhappy, look for a free bench on their tile; sitting recovers as in §6.4.

### 6.11 Litter, vandalism, crowding (per path tile entered) [R]
When a guest steps onto a path tile it samples that tile:
- **Crowding**: ≥10 walking guests on the tile → 1/3 chance of *crowded* thought, happiness_target −14.
- **Litter** (non-vomit litter, capped at 3 per tile) and **vomit** (capped 3) are tallied over the last 3 tiles visited; if the 3-tile total ≥ 3 → 1/6 chance of *litter is bad* (or *path is disgusting* for vomit) thought, happiness_target −17, then a cool-down of ~3 tiles before repeating.
- **Vandalism seen**: if 2 of the last 6 tiles had broken path furniture → 1/6 chance of *vandalism* thought, happiness_target −17.

Dropping litter [R]:
- A guest carrying an **empty container** (from finished food/drink) on a path, about once per 512 ticks, has 1/16 chance to drop it as litter (if no bin is adjacent; see bins below).
- Bins [R-functional]: walking guests with an empty container who pass a path tile with a non-full bin put it in the bin instead (bin capacity: [D] 8 items per bin; full bins are emptied by handymen).

Vandalism [R]:
- Candidate vandal: happiness < 48, energy ≥ 85, walking, and has recently been disgusted by litter or vomit; then 5% chance per path tile.
- Target: a breakable path add-on (bench, bin, lamp) on the tile. Blocked if someone is sitting on it or a **security guard is within 7 tiles** (the guard is credited with a "vandal stopped").
- Effect: the add-on becomes *broken* (no longer works); the guest becomes angry for 16 needs updates. Handymen do not repair; the player replaces it [R] (v1 [D]: allow handymen to repair broken add-ons, or require the player to re-place; pick one).

### 6.12 Lost guests [R]
- If the park has ≥2 rides, walking guests accumulate a "time lost" counter each path junction decision without reaching any destination; at 254 → *lost* thought, happiness_target −30 (repeats every ~24 increments). Reset when they reach a queue/shop/target.
- A guest heading to a specific ride has a countdown of 200 decisions; at 60 and 30 remaining → *can't find ride X*, happiness_target −30; at 0 they give up.

### 6.13 Thought system [R-functional]
Each guest keeps up to **5 thoughts**, newest first. A thought has a type and optional subject (a ride or an item). A thought is "fresh" for 220 ticks after it surfaces; afterwards it ages and is removed after ≈ 6 900 ticks. A new thought of the same type+subject as an existing one replaces it (moves to the top). Only fresh thoughts count for player warnings.

Functional thought categories (wording is up to the build team):

| Group | Categories |
|---|---|
| Price / value | ride too expensive (bad value); ride is good value; can't afford ride; out of money; item too expensive (per item); item good value (per item); won't pay for toilet |
| Preferences | ride too intense; ride not intense enough; ride too sickening; not while it's raining; ride not safe (recent crash) |
| Needs | hungry; thirsty; needs toilet; tired; running low on cash; feel sick; feel very sick; want to go home |
| Navigation | lost; can't find ride X; can't find the exit; queue too long / waited too long for ride X; path crowded |
| Environment (negative) | litter is bad; path is disgusting (vomit); vandalism is bad |
| Environment (positive) | nice scenery; lovely fountains; nice music; park is very clean |
| Ride experience | ride was great; wants to get off (on too long); "wow" on a big ride (optional) |
| Purchases | already have this item; haven't finished current food; not hungry; not thirsty |
| Misc | new ride spotted (while watching); watching scenery |

Player warnings [R] (each throttled to at most once per 4 weeks per type; checked weekly):
| Warning | Trigger (count of guests whose top thought is fresh) |
|---|---|
| guests hungry | ≥25 and ≥ guests/16 (not counting those already heading to food) |
| guests thirsty | ≥25 and ≥ guests/16 |
| guests can't find toilet | ≥28 and ≥ guests/16 |
| guests dislike litter | ≥23 and ≥ guests/32 |
| guests disgusted by paths | ≥22 and ≥ guests/32 |
| guests dislike vandalism | ≥15 and ≥ guests/32 |
| guests lost / can't find exit | ≥8 |
| queue too long at ride X | >25 and > queuers/20 |

### 6.14 Guest visible state (for rendering and inspection)
State machine: arriving (outside park) → entering park → walking ⇄ {queuing → entering ride → on ride → leaving ride; buying at stall; sitting; watching a ride; using bin} → leaving park → gone. Also: picked up by the player (dragged), falling (placed off path), drowning (placed in water → removed [D]).

---

## 7. Stalls and facilities

### 7.1 Stall archetypes (v1) [R costs; D for which items each sells]
All are 1×1 tile, built adjacent to a path with the service side facing it. No breakdowns. Rating calculation: none ("stall"). Opening sets them Open immediately (no testing).

| Archetype | Build cost | Running cost per fortnight [R] | Sells (v1) | Type bonus (§5.1) |
|---|---|---|---|---|
| Food stall A ("hot meal") | 300 cr | 3.10 cr | Meal-type food (item F1) | 15 |
| Food stall B ("snack") | 300 cr | 3.10 cr | Snack food (item F2) | 15 |
| Drink stall | 250 cr | 3.10 cr | Drink (item D1) | 15 |
| Souvenir stall | 200 cr | 3.10 cr | Souvenir (S1), umbrella (S2) | 15 |
| Information kiosk | 250 cr | 3.10 cr | Park map (M), umbrella (S2) | 15 |
| Toilets | 225 cr | 3.10 cr | Use fee (default 0, max 0.60 sensible) | 5 |
| First aid | 250 cr | 2.80 cr | Free | 5 |
| Cash machine (optional) | 200 cr | 2.50 cr | Gives guest +50.00 cash | 5 |

Upkeep formula for stalls = base_upkeep × 5/8 where base = 5.00 cr (first aid 4.50, cash machine 4.00) [R]. **Money granularity note:** the reference keeps money in units of 0.10; all amounts in this spec are already converted to credits.

### 7.2 Items [R]
Values are what a guest thinks the item is worth; "hot" applies when temperature ≥ 21 °C, "cold" when ≤ 11 °C.

| Item (functional) | Category | Cost to park | Value | Value hot | Value cold | Default price | Consume time | Empty container left |
|---|---|---|---|---|---|---|---|---|
| F1 hot meal | food | 0.50 | 1.90 | 1.90 | 2.20 | 1.50 | 150 | box (litter) |
| F2 snack | food | 0.40 | 1.60 | 1.60 | 1.80 | 1.50 | 120 | wrapper |
| F3 frozen treat (optional) | food | 0.40 | 1.00 | 1.50 | 0.60 | 0.90 | 60 | none |
| D1 cold drink | drink | 0.30 | 1.20 | 2.00 | 1.00 | 1.20 | 100 | can |
| D2 hot drink (optional) | drink | 0.30 | 1.10 | 1.50 | 2.00 | 1.20 | 90 | cup |
| S1 souvenir (plush/hat class) | souvenir | 1.50 | 3.00 | 3.00 | 3.00 | 2.50 | — | — |
| S2 umbrella | souvenir | 2.00 | 3.50 | 2.50 | 5.00 | 2.50 | — | — |
| M park map | souvenir | 0.10 | 0.70 | 0.70 | 0.80 | 0.60 | — | — |
| P on-ride photo (optional) | souvenir | 0.20 | 3.00 | 3.00 | 3.00 | 0 | — | — |

### 7.3 Buying rules [R]
Shop approach (deciding whether to visit a shop):
- Won't revisit the same shop twice in a row.
- Toilets: needs toilet ≥ 70; refuses if `price × 40 > toilet` (in cents ⇒ max acceptable ≈ toilet/40 cents… i.e. 0.10–0.60 cr) → *won't pay* thought, happiness_target −16.
- First aid: only if nausea ≥ 128.
- Price > cash → refuses.

Purchase decision for an item:
```
refuse if already carrying that item                       (*already have*)
food/drink: refuse if currently holding food/drink          (*haven't finished*); refuse if nausea ≥ 145
refuse balloon-like/frozen/sunglasses-like items while precipitating; frozen/sun items if temp < 12
food and hunger > 75 → refuse (*not hungry*)   drink and thirst > 75 → refuse (*not thirsty*)
souvenir (except map; except umbrella in rain; except with voucher):
    refuse unless happiness ≥ 115 + rand(128) and guest has ridden ≥ 3 rides
voucher for this item → free
price > cash (or cash 0) → refuse
v = value(temp)
if v < price:
    over = price − v (in units of 0.10 cr);  if happiness ≥ 128: over /= 2;  if ≥ 180: over /= 2 (integer division)
    if over > rand(8) → refuse (*item too expensive*)        (umbrella in rain ignores this)
else:
    margin = max(0.80, v − price)  (in units of 0.10 cr, so ≥ 8)
    if margin ≥ rand(8) → *good value* thought   (always true given the floor of 8)
    happiness and happiness_target += margin × 4  (clamped to 255) — i.e. +32 at least for any fairly priced item
stall satisfaction sample: (v − price) > −0.80 → 1, > −0.30 → 2, > +0.30 → 3, else 0
buy: give item (+consume time), book cost to stock category and price to sales category,
     stall profit += price − cost; customers +1
```
Note: the "over > rand(8)" test means a guest tolerates being overcharged by up to ~0.70 cr only with luck: at 0.10 over value most buy, at 0.40 over about half refuse, at 0.80 over all refuse (halved/quartered for happy guests) [R].

Toilet use: guest stays until toilet need reaches 0 (−1 per step), then happiness_target +30 and happiness = target; flush cue.
First aid: guest stays until nausea ≤ 35 (−1 per step), then happiness_target +30.
Cash machine: used if not leaving, cash ≤ 20.00, happiness ≥ 115 + rand(128), energy ≥ 80 → +50.00 cash (the park is not charged).
Map: reading a map makes ride choice consider all rides (§6.5) and multiplies the per-update chance of choosing a ride by ~3.75.
Umbrella: guest may go on unsheltered "walk-through" rides in rain (v1: no such ride, so umbrella is purely a rain-mood item: [D] guests with umbrellas do not get the −happiness from rain, §8.9).

---

## 8. Rides

### 8.1 Ride lifecycle [R]
Status values: **Closed**, **Testing**, **Open**. (Reference also has a ghost "simulate" mode; optional.)

```
build → (Closed) → Testing: vehicles run empty; for tracked rides one full circuit measures stats → ratings computed
      → Open: guests may queue; ticket income; breakdowns possible; inspections due
Open → Closed: guests in queue leave; riders finish and exit; no running cost charged while Closed
```
- A tracked ride cannot leave Closed unless: track is a complete circuit (or valid shuttle), has ≥1 station, every station has an entrance and an exit that connect to a path (warn if not reachable; weekly check), and the station length fits ≥1 train. Flat rides need an entrance and exit.
- Flat rides get ratings immediately (no test).
- Tracked rides: going to Open directly from Closed first runs a test; guests see "no ratings yet" until the test completes (90% of guests avoid untested coasters).
- Any edit to the track (reference: any change) invalidates the test results; ratings are cleared until re-tested.
- Ratings are re-evaluated continuously in the background for open/testing rides (one ride at a time), so scenery and proximity changes flow into excitement over time.

Station operating controls (per ride) [R]:
| Control | Values | Effect |
|---|---|---|
| Load mode | wait for any / ¼ / ½ / ¾ / full load | departs when that fraction is seated (or on max wait) |
| Minimum wait | 0–250 s (in 32-tick "ride seconds") | holds the vehicle at least this long |
| Maximum wait | 0–250 s | departs after this even if not loaded |
| Leave when another train arrives | on/off | |
| Number of trains / cars per train | per type limits | coaster: [D] 1–4 trains (block brakes required for >1, v1: brakes only → 1 train unless block sections are implemented), 3–8 cars |
| Operating option | type-specific (rotations, swings, laps, launch speed, lift-hill speed) | feeds ratings for flat rides |
| Price | 0.00–20.00 [R cap] | ticket |
| Inspection interval | 10, 20, 30, 45, 60, 120 "minutes", never | 1 "minute" = 2 048 ticks |

### 8.2 Common ride numbers
**Ride value** (price at which a guest is indifferent), recomputed with ratings [R]:
```
base = (E × mE + I × mI + N × mN) / 10240     # ratings in hundredths → credits
age (months since built):  <5: base + 3.00 | <13: base + 1.00 | <40: ×1 | <64: ×3/4 | <88: ×9/16
                           | <104: ×27/64 | <120: ×81/256 | <128: ×81/512 | ≥128: ×81/1024
if 2+ open rides of the same type exist: value −= value/4
value = max(0, value)
```
(Reference quirk: ≥200 months jumps back to ×9/16; ignore [D].)

**Running cost (upkeep), charged every fortnight while not Closed** [R]:
```
u = base + per_lift × lift_sections + (len_mult × length_L) / 1024
  + 4.00 if on-ride photo + 2.00 × brake_pieces + 3.00 × reverser_pieces
  + per_train × trains + per_car × cars_per_train + per_station × stations
upkeep_per_fortnight = u × 5/8
```
(Values in the table are in credits; 0.10-unit reference data converted.)

**Guests' ride income** (UI estimate) [R]: customers per hour = customers in the last 10 samples of a 960-tick counter (≈ last 5 game-minutes) × 12; profit/hour = income/hour − upkeep × 16.

**Popularity / satisfaction** as in §6.6.

### 8.3 Flat ride archetypes (v1)
Ratings are [R] (base + operating-option bonus + scenery bonus). Footprint, capacity and cycle are [D]. Breakdown sets and unreliability are [R]. Build cost = type price × footprint multiplier [R] (3×3 ⇒ ×8, 1×5 ⇒ ×5, tower base ×8 + ×1 per tower section).

| | Carousel (gentle spinner) | Spinning cups (thrill-lite spinner) | Swinging ship | Drop tower | Observation tower |
|---|---|---|---|---|---|
| Category | gentle | thrill | thrill | thrill | gentle |
| Footprint | 3×3 | 3×3 | 1×5 (long axis), +1 tile clearance each side [D] | 3×3 base + tower (1 tile) | 3×3 base + tower |
| Build cost | 460 cr | 360 cr | 387.50 cr | 180 cr + 22.50/section | 148 cr + 18.50/section |
| Max height | 12 hu | 12 hu | 12 hu | 255 hu | 255 hu |
| Capacity per cycle [D] | 16 | 18 (6 cups × 3) | 20 | 12 (ring of seats) | 20 (cabin) |
| Operating option | rotations 4–25 (default 10 [D]) | rotations 3–6 (default 4 [D]) | swings 7–25 (default 10 [D]) | — (drop height = tower height) | — |
| Cycle time [D] | 3 s per rotation + 10 s load/unload | 5 s per rotation + 12 s | 3 s per swing + 12 s | up 1 hu per 4 ticks, hold 2 s, free-fall drop, brake, + 12 s | up 1 hu per 8 ticks, 1 slow revolution at top (8 s), down, + 12 s |
| Base E / I / N | 0.60 / 0.15 / 0.30 | 1.13 / 0.97 / 1.90 | 1.50 / 1.90 / 1.41 | 2.80 / 3.50 / 3.50 | 1.50 / 0.00 / 0.10 |
| Option bonus (per unit) | +0.05 / +0.05 / +0.05 per rotation | +0.20 / +0.20 / +0.20 per rotation | +0.05 / +0.05 / +0.10 per swing | per hu of tower height: +0.051 / +0.102 / +0.102 | per hu: +0.011 E, +0.0064 N |
| Scenery factor (× scenery score) | 0.298 | 0.213 | 0.255 | 0.383 | 1.277 |
| Proximity factor (× proximity score) | — | — | — | 0.171 | 0.307 |
| Other | — | — | — | — | if ≥5/8 sheltered: E/4, I/4, N/1 [R] |
| Value mult (mE, mI, mN) | 50, 10, 0 | 40, 20, 10 | 50, 30, 10 | 50, 50, 10 | 80, 10, 0 |
| Upkeep base / len_mult / per-train/car/station | 5.00 / 1 / 0,0,0 | 5.00 / 1 / 0,0,0 | 5.00 / 1 / 0,0,0 | 5.00 / 20 / 1.00 per car | 5.00 / 20 / 1.00 per car |
| Default price | 1.00 | 1.00 | 1.50 | 2.00 | 1.00 |
| Type bonus (§5.1) | 45 | 40 | 35 | 45 | 45 |
| Breakdowns | safety cut-out, control failure | safety cut-out | safety cut-out | safety cut-out, restraints stuck shut, restraints stuck open, vehicle malfunction | safety cut-out, vehicle malfunction |
| Unreliability | 16 | 16 | 10 | 24 | 15 |
| Plays music | yes (fairground style) | optional | optional | optional | optional |

Tower bonuses derive from the vehicle's measured travel: travel length L ≈ 2 × height (up and down) and the reference adds `L × k / 65536`. Expressed per height unit of tower (§8.6 units): drop tower E += 0.051, I += 0.102, N += 0.102 per hu; observation tower E += 0.0112, N += 0.0064 per hu [R-derived].

Scenery score (all rides) [R]: count scenery objects on the 11×11 tiles centred on the first station tile (or the ride's tile); `score = min(count, 47) × 5` (0–235). If the station is underground, score = 40.

### 8.4 Go-kart track [R ratings; D geometry]
- Tracked ride with its own simple piece set: straight, station (start/finish), gentle slopes (up/down, flat↔gentle transitions), small/medium/large flat curves, S-bend. No lift, no banking, no inversions.
- Build cost: 31.00 per straight-equivalent × piece multiplier + 2.00 per land step of support.
- Modes: **race** (N karts start together, run L laps 1–10, winner announced [D]) or continuous.
- Karts are powered: [D] target speed 9 m/s on flat, 6 m/s uphill, 12 m/s max downhill.
- Capacity 1 per kart, karts 1–12 [D] (default 6).
- Ratings (hundredths, sub-ratings as defined in §8.7.4): base 142 / 173 / 40; E += min(L,700) × 0.5; race mode with ≥4 karts: +140 E, +50 I, plus (laps−1) × 30 E and (laps−1) × 15 I; turns sub-rating × (0.068, 0.053, 0.087); drops sub-rating × (0.133, 0.083, 0.100); sheltered sub-rating × (0.039, 0.133, 0.036); E += proximity × 0.171; E += scenery × 0.255; if ≥6/8 of the track is sheltered: E/2.
- Value mult 120, 20, 0. Upkeep base 5.00, len_mult 20, per car 0.80. Default price 2.00. Type bonus 55. Unreliability 16. Breakdown: vehicle malfunction only.
- Re-rideable: yes.

### 8.5 Log-flume type water ride [R ratings; D geometry]
- Tracked water channel; boats float. Pieces: straight, station, gentle up (acts as a conveyor lift, always powered at 3–5 m/s [D]), gentle down, steep down (only down), flat↔gentle and gentle↔steep transitions, small flat curves, S-bends, **splash-down** effect at the bottom of a steep drop [D: any flat piece directly after a steep-down section counts as a splash].
- Build cost: 22.50 per straight-equivalent × multiplier + 2.50 per land step of support.
- Boats: [D] 2 riders each (1–4 seats), 1–10 boats; continuous circuit.
- Ratings (hundredths): base 150 / 55 / 30; E += min(L,2000) × 0.11; E += S_max × 8.11, I += S_max × 10.0, N += S_max × 4.59; E += min(T,300) × 0.2; turns sub-rating × (0.340, 0.318, 0.070); drops sub-rating × (1.067, 0.952, 0.750); sheltered × (0.255, 0.467, 0.536); E += proximity × 0.341; E += scenery × 0.170; splash-down present: +50 / +30 / +20 [R special-element bonus]; airtime as §8.7.4; **requirement: highest drop ≥ 6 hu, else E/2, I/2, N/2**; then the intensity penalty.
- Value mult 80, 34, 6. Upkeep base 8.00, len_mult 20, per train 0.90, per station 1.00. Default price 2.00. Type bonus 65. Unreliability 15. Breakdowns: safety cut-out, brakes failure.
- Guests get wet: [D] cosmetic only. Re-rideable: yes. Counts as "has drops" and "has airtime".

### 8.6 World scale and rating units (applies to all tracked rides)
Parkhaven world scale [D] (chosen so the reference rating constants can be used unchanged):
| Quantity | Parkhaven | Note |
|---|---|---|
| tile | 3.0 m horizontal | |
| height unit (hu) | 0.75 m vertical (= 1/4 tile) | land/path step = 2 hu = 1.5 m |
| speed S used in rating formulas | **m/s** | the reference's speed term ≈ m/s at this scale |
| length L used in rating formulas | **1 tile of straight track = 4.25 L**; diagonal 6.0 L; 1 hu of pure vertical travel = 0.8 L | i.e. L ≈ metres × 1.42 |
| ride time T used in rating formulas | units of 32 ticks (0.8 s) while the vehicle is moving | |
| drop height H | hu | |
| g-forces | hundredths of g | |

### 8.7 The roller coaster (one track type, piece-by-piece builder)

#### 8.7.1 Ride numbers [R]
| Field | Value |
|---|---|
| Category | roller coaster |
| Track price (per straight-equivalent) | 45.00 cr; supports +2.50 per land step of height above ground, per tile of the piece |
| Max height above ground | 35 land steps (= 70 hu) [R "35" in land-step units] |
| Trains | [D] 1 train in v1 (2+ only with block sections) ; 3–8 cars of 4 riders [D] |
| Lift-hill speed | 4–6 m/s [R range 4–6 in reference speed units] |
| Value mult | 50, 30, 10 |
| Upkeep | base 4.00; +8.00 per lift section; len_mult 20; per train 1.00; per car 0.30; per station 1.00; +2.00 per brake piece |
| Default price | 2.00 |
| Type bonus | 95 |
| Unreliability | 15 (+2 per lift-speed step above minimum) |
| Breakdowns | safety cut-out, restraints stuck shut, restraints stuck open, vehicle malfunction, brakes failure |
| Re-rideable | yes |

#### 8.7.2 Track pieces (v1 set)
Price multipliers [R]; geometry and G factors are expressed in this spec's own terms; footprints are [D] where they differ from a straight copy of the reference's shapes.

| Piece | Footprint | Height change | Price × | Length (L) | G behaviour |
|---|---|---|---|---|---|
| Station | 1×1 straight | 0 | 1.50 | 4.25 | — |
| Straight | 1×1 | 0 | 1.00 | 4.25 | — |
| Brakes | 1×1 straight | 0 | 1.375 | 4.25 | holds speed ≤ set brake speed |
| Lift hill | flag on straight / gentle-up / steep-up pieces | — | +0 | — | chain pulls at lift speed |
| Flat → gentle up | 1×1 | +1 hu | 1.125 | 4.25 | vertical factor +103 (valley) |
| Gentle up (≈25°) | 1×1 | +2 hu | 1.22 | 4.4 | — |
| Gentle up → flat | 1×1 | +1 hu | 1.125 | 4.25 | vertical factor −103 (crest) |
| Gentle → steep up | 1×1 | +4 hu | 1.47 | 4.5 | +82 |
| Steep up (≈60°) | 1×1 | +8 hu | 1.75 | 5.3 | — |
| Steep → gentle up | 1×1 | +4 hu | 1.47 | 4.5 | −82 |
| (all the above mirrored downward) | | negative | same | same | signs: entering a down-slope from flat is a crest (−103); levelling out at the bottom is a valley (+103); gentle→steep down −82; steep→gentle down +82 |
| Small curve (90°, flat) | 2×2 quarter (3 tiles) | 0 | 2.36 | 10.0 | lateral factor 59 |
| Large curve (90°, flat) | 3×3 quarter (5 tiles) | 0 | 3.93 | 16.5 | lateral factor 98 |
| Small banked curve | 2×2 (3 tiles) | 0 | 2.50 | 10.0 | vertical factor 100, lateral factor 100 |
| Large banked curve | 3×3 (5 tiles) | 0 | 5.09 | 16.5 | vertical 200, lateral 160 |
| Flat ↔ bank transition | 1×1 | 0 | 1.06 | 4.25 | — |
| Small curve, gentle up/down | 2×2 (3 tiles) | ±4 hu | 4.12 | 10.3 | lateral 59 |
| Vertical loop | 3 long × 2 wide (exits 1 tile to the side) [D] | 0 net (peaks at +12 hu) | 7.50 | 16.0 | vertical factor varies along the loop: `F(p) = |p − 0.5|×155 + 28` for progress p ∈ [0,1] (strongest at the top); counts as 1 inversion |

G-force model ("game g", not real physics) [R]:
```
vertical_g = cos(pitch) × cos(bank) + (speed_mps × 9.8 / F_vertical(piece, progress))   if piece has a vertical factor
lateral_g  = speed_mps × 9.8 / F_lateral(piece)                                            if piece has a lateral factor
```
- Factor signs: positive vertical factor ⇒ pushes rider into the seat (valleys, loops); negative ⇒ lifts rider (crests).
- Each tick, the measured values are smoothed: `g = (g_now + g_previous) / 2`.
- Track maximum positive vertical g, minimum (most negative) vertical g, and maximum absolute lateral g. Every tick with vertical g ≤ 0 adds one tick of **airtime**.
- The build team may substitute a physically based model (v²/r) if they re-tune the rating constants; the [R] numbers below assume this linear game model.

Physics [D]: `accel = −9.81 × sin(pitch) − 0.002·v − drag·v²` (m/s² per tick at 40 Hz), drag tuned so a 30 m drop on a straight gives about 22 m/s at the bottom; lift sets speed to lift speed while on a lift piece; brakes clamp to brake speed; station pieces hold the train while loading and launch at 2 m/s. A train that rolls back down a lift (insufficient speed at a crest) rolls backwards; the ride's test fails and the player is told the train cannot complete the circuit [D].

#### 8.7.3 Measurements taken during the test run [R]
While the test train runs one circuit (only on stations that have an entrance):
- **max speed** (m/s), **average speed** (sampled every 32 ticks while moving; divided by moving time),
- **ride length L** (sum of distance travelled per tick), **ride time T** (count of 32-tick periods moving),
- **max positive vertical g, max negative vertical g, max lateral g**, **airtime** ticks,
- **drops**: a drop starts when the train enters a downward piece while moving forward; it ends when the train stops going down; the drop height in hu is recorded; count drops and keep the **highest drop H**. (Upward "drops" when rolling backward also count.)
- **inversions**: count of loop pieces passed.
- **turns**: consecutive pieces turning the same way form a "turn"; classify by length (1, 2, 3, 4+ pieces) and kind (flat, banked, sloped — the first piece decides).
- **lift sections**: count of separate lift runs.
- **sheltered length**: length travelled while something is overhead (path, other track, scenery); number of sheltered sections.

#### 8.7.4 Rating formula for the coaster [R]
All ratings in hundredths. "+ x / y / z" means add to E / I / N.
```
E, I, N = 300, 50, 20                                   # base 3.00 / 0.50 / 0.20

E += min(L, 6000) × 0.01166                             # length (max +70)
E += (cars_per_train − 1) × 2.857                       # train length
E += S_max × 0.676;  I += S_max × 1.351;  N += S_max × 0.540
E += S_avg × 4.444;  I += S_avg × 6.667
E += min(T, 150) × 0.400                                # duration (max +60)

# g-forces sub-rating, then weighted (0.375, 0.545, 0.758)
gE = Gpos × 0.08 + min(|min(Gneg,0)|, 250) × 0.24 + min(Glat, 150) × 0.40
gI = Gpos × 0.80 + (100 − Gneg) × 0.80 + Glat × 1.00
gN = Gpos × 0.26 + (100 − Gneg) × 0.222 + Glat × 0.333
E += gE × 0.375;  I += gI × 0.545;  N += gN × 0.758
   (Gpos, Gneg, Glat in hundredths of g; Gneg is the most negative vertical g, which may be positive if the ride never goes light)

# turns sub-rating, then weighted (0.408, 0.531, 0.698)
for each turn group by length class (1, 2, 3, 4+ pieces) and kind:
   flat:   1-piece +0.97/+0.32/+0.65   2-piece +3.00/+0.75/+3.13   3+-piece +2.50/+1.25/+5.00
   banked: 1-piece +1.13/+0.32/+0.74   2-piece +3.75/+0.75/+3.13   3+-piece +3.75/+1.25/+5.00
   sloped: E: 1-piece 2.86 (max 7 counted), 2-piece 3.67 (max 6), 3-piece 4.17 (max 6), 4+ 7.50 (max 4); N: 4+ 7.50 each (max 8); I: 0
inversions: E + min(n,6) × 26.67;  I + n × 50.0;  N + n × 21.67
(summed into tE, tI, tN)  →  E += tE × 0.408;  I += tI × 0.531;  N += tN × 0.698

# drops sub-rating, weighted (0.444, 0.714, 0.750)
dE = min(drops, 9) × 11.11 + H × 0.488
dI = drops × 14.17         + H × 0.977
dN = drops × 10.0          + H × 0.3125
E += dE × 0.444;  I += dI × 0.714;  N += dN × 0.750

# sheltered sub-rating (usually 0 in v1), weighted (0.235, 0.5, 0.536)
sE = min(Ls,1000) × 0.14 + min(sections, 11) × 11.82 (+20 if banked while sheltered, +20 if pitched while sheltered)
sI = min(Ls,2000) × 0.15
sN = min(Ls,1000) × 0.25 (+15, +15 likewise)

E += proximity_score × 0.307        (§8.7.5)
E += scenery_score × 0.102          (§8.3)

# requirements (each failure halves E, I and N; the first three are waived if the track has ≥1 inversion)
if H < 14 hu:                         E/=2; I/=2; N/=2
if drops < 2:                         E/=2; I/=2; N/=2
if Gneg ≥ +0.10 (never goes light):   E/=2; I/=2; N/=2
if S_max < 10 m/s:                    E/=2; I/=2; N/=2    (not waived)

# excessive lateral g
if 280 < Glat ≤ 310: I += 375 × 0.545;  N += 200 × 0.758
if Glat > 310 (instead of the above): E −= gE × 0.1875 (i.e. half the g-force excitement is taken back);  I += 1225 × 0.545;  N += 600 × 0.758

# airtime (coaster & flume)
E += min(airtime_ticks, 200) / 8;  N += airtime_ticks / 16

# intensity penalty: for each threshold in {1000, 1100, 1200, 1320, 1450} with I ≥ threshold: E −= E/4
clamp all to ≥ 0
```
Guidance: a modest out-and-back with one 20 hu drop, a few curves and one loop should land around E 5–6, I 5–6, N 3–4. Very tight steep courses push I above 10 (guests refuse, and the intensity penalty crushes E).

#### 8.7.5 Proximity score [R]
For every track piece (walking the circuit, including stations that have entrances), increment counters for what is near it, then combine with diminishing returns. Helper notation: `cap(x, m) × k` means min(x, m) × k; `capPlus(x, a, m) × k` means (x == 0 ? 0 : min(x + a, m)) × k; `flag(x, v)` means v if x > 0.

| Counter (per piece where condition holds) | Score contribution |
|---|---|
| track is above water | cap(n, 60) × 0.667 |
| track at water surface level | cap(n, 22) × 2.27 |
| track 2 hu above the water | cap(n, 10) × 2.0 |
| track ≥ 16 hu above water | cap(n, 40) × 0.625 |
| track running on the ground | cap(n, 70) × 1.714 |
| queue path under track | cap(n + 8, 12) × 6.25  (note: gives 50 even with none) |
| queue path directly touching the track from below / above | flag 40 / flag 45 |
| footpath directly below / above the track | capPlus(n, 10, 20) × 3.75 / × 4.25 |
| own track directly above/below | capPlus(n, 10, 15) × 3.33 |
| own track close (2–10 hu) above/below | cap(n, 5) × 6.0 |
| other ride's track above/below | capPlus(n, 10, 15) × 2.67 |
| other ride's track touching | capPlus(n, 10, 15) × 4.67 |
| other ride's track close | cap(n, 5) × 9.0 |
| scenery beside, below track level / above | cap(n, 35) × 1.43 / × 0.857 |
| own station directly above/below / close | flag 55 / flag 25 |
| track threading through a loop / path through a loop | capPlus(n, 4, 6) × 20 / × 15 |
| two loops interlocking | flag 100 |
| track passing just under a loop's top | capPlus(n, 4, 6) × 10 |
| path beside track (within 2 hu) | capPlus(n, 10, 20) × 1.75 |
| other track beside (within 2 hu) | capPlus(n, 10, 20) × 2.25 |
| ground beside the track rising above it (cutting/trench) | capPlus(n, 10, 20) × 2.5 |

### 8.8 Upkeep examples [R-derived]
Coaster with 1 lift run, 1 train × 6 cars, 1 station, 1 brake piece, length 1 500 L: u = 4.00 + 8.00 + 2.93 + 1.00 + 1.80 + 1.00 + 2.00 = 20.73 → 12.96 cr per fortnight.

### 8.9 Weather and rides [R]
- While it is raining, guests reject rides with < 3/8 of their length sheltered (flat rides: all v1 flat rides count as unsheltered except [D] the observation tower cabin, which is enclosed) — they get the *not while raining* thought.
- Brakes failure is far more likely in rain: weight 20 instead of 3 (§8.10).
- Items: umbrellas worth more in rain (and in cold), drinks and frozen treats more in heat, see §7.2.

### 8.10 Breakdowns, reliability, inspection [R]
Reliability is a percentage with sub-percent precision (store ×256; new ride = 100%).
```
every 256 ticks, for each ride that is Open/Testing and can break down:
    reliability −= unreliability + age_penalty          (in 1/256 %)
        age_penalty by age in years: 0 → 0; 1 → u/8; 2 → u/4; 3–4 → u/2; 5–7 → u; 8+ → 2u
    breakdown if reliability == 0 or rand(3 145 728) ≤ 25 856 − reliability
    downtime accounting: if broken, the current half-month bucket +1
every 8 192 ticks: downtime% = min(100, (sum of last 8 buckets) / 2); shift buckets
```
Rule of thumb: at 100% almost never; at 75% ≈ 11% chance per month; at 50% ≈ 23% per month.

Breakdown type pick (weighted among those the ride supports):
| Type | Weight | Effect (functional) | Mechanic goes to |
|---|---|---|---|
| Safety cut-out | 25 | whole ride stops where it is (powered/lift vehicles halt) | station |
| Restraints stuck shut | 12 | one car cannot unload at the station; ride halts loading | the broken vehicle at the station |
| Restraints stuck open | 10 | one car cannot load/depart | the broken vehicle |
| Vehicle malfunction | 6 | one train stops on the track | the broken vehicle (walks to it if reachable, else station) [D] |
| Brakes failure | 3 (20 when precipitating) | station/brake pieces stop braking; train runs through the station at speed; with 2+ trains risks a crash. Only possible if ride age ≥ 16 months and reliability ≤ 50% | station |
| Control failure (spinners) | 3 | flat ride spins too fast / won't stop; riders' nausea up [D: +50 nausea_target] | station |

Process:
```
breakdown pending → (as soon as a mechanic is being called) the ride is flagged Broken Down; notice raised
ride status shows "broken down"; vehicles behave per the table; queue stays but nobody boards;
guests deciding to go there treat it as unavailable
call the closest available mechanic (Manhattan distance to the station exit) who is patrolling,
    has the "fix rides" duty, and whose patrol area contains the exit (no patrol area = anywhere)
mechanic walks to the exit, does the fix sequence for the breakdown type (walk to station end/start or the vehicle, work animation)
on fix: clear broken flags; reliability += mechanic_speed(96) × (100 − reliability%) / 2 / 256  (in %); mechanic leaves via exit
if still not fixed: reminder notice every ~16 breakdown-status checks
```
Inspections:
```
each ride has an inspection interval; every 2048 ticks "minutes since inspection" +1
when ≥ interval and no breakdown: flag "due inspection", call nearest mechanic with the "inspect" duty
mechanic visits the station and works; on completion: reliability += (100 − reliability%) / 4 × rand(256) / 256 (%); minutes since inspection = 0
```
Downtime feeds the park rating (§4). Reliability shown as % and downtime % in the ride's maintenance tab.

Crash (optional in v1) [R-simplified]: if a train hits another train (e.g. after brake failure), both trains are destroyed with explosion effects; all riders are killed (removed); park rating penalty +200 (decays 7/day); ride closes; for the next few fortnights guests with happiness < 225 refuse that ride (*not safe*). A test-mode crash only marks the ride as crashed (no casualties). Recommend [D] shipping v1 with 1 train per coaster so crashes cannot occur, and leaving crash logic for later.

---

## 9. The world: map, land, paths

### 9.1 Projection [D recommendation]
The genre convention is a tile map drawn in a 2:1 dimetric ("isometric") view that the player can rotate in 90° steps. Two viable builds:

1. **Orthographic 3D (recommended for v1)**: render the tile/height world as low-poly meshes with a WebGL orthographic camera at the classic isometric angle (azimuth 45°, elevation ≈ 30°). Depth sorting, rotation, zoom and tall overlapping track come for free; art is original simple geometry. Picking via ray casting against the tile grid.
2. **2D sprite isometric**: original sprites, painter's-algorithm sorting by tile and height with per-quadrant splitting for multi-tile objects. Proven but the depth-sorting of track over/under other track and guests is the single hardest rendering problem in the genre.

Either way the simulation is a pure 2.5D grid and must not depend on the renderer.

### 9.2 Map and coordinates [R structure, D sizes]
- Map: square grid of tiles, v1 sizes 64×64 to 128×128 [D]. The outermost ring is unusable border.
- Each tile has a list of **elements** stacked by height: one surface (land) element plus any paths, track pieces, stalls, entrances, scenery. Each element has a base height and a clearance height (in hu), so things can be stacked (path under track, track over track).
- Coordinates: (x, y) tile, z in hu. Sub-tile positions for moving entities in 1/32 tile.
- Valid land heights 2–254 hu [R]; v1 [D] cap at 64 land steps.

### 9.3 Land surface [R]
- A tile's surface has a base height and a slope: each of the 4 corners is either at base or one land step (2 hu) above it; one extra "steep diagonal" shape allows one corner 2 steps up when its opposite corner is at base. That gives 19 valid shapes [R].
- Surface material (functional): grass (grows, can be mowed), sand, dirt, rock [D]. Grass length has stages from freshly mown to long clumps; it grows slowly on unshaded owned tiles [R]; v1: cosmetic [D].
- **Water**: a tile may have a water level above its surface. Rides/paths can be built over water. Water raise/lower tool: 25.00 per tile per step [R].
- **Terraform** tool: raise/lower a corner, edge or whole tile (area brush 1×1 up to 5×5 [D]); cost **2.50 per corner per hu changed** (so raising a flat tile one land step = 20.00) [R]; small scenery on the tile is removed and charged its removal cost. Only on owned land; not under existing structures.

### 9.4 Land ownership [R]
Each tile is one of: **owned** (full building rights), **construction rights only** (may build paths/track **above or below** the surface but not on it, no terraforming), **not owned**, and, for not-owned tiles, flags **for sale** and/or **rights for sale** (scenario-defined).
| Action | Price |
|---|---|
| Buy land | scenario land price (default 90.00 per tile) |
| Buy construction rights | scenario rights price (default 40.00 per tile) |
Park boundary: show a fence/marker along edges between owned and unowned tiles [R]. Guests can never walk on unowned land except the paths outside the entrance used for arrival and departure. Litter can only exist on owned path tiles.

### 9.5 Paths and queues [R]
- **Footpath**: 1 tile; flat, or sloped rising one land step across the tile in one of 4 directions. Flat paths auto-connect to adjacent paths at the same height and to sloped paths leading to them; they also connect to ride entrances/exits, stalls (service side) and the park entrance.
- Cost: 12.00 per tile, + 5.00 per land step the path is above the ground (supports), or + 20.00 if it is underground [R]. Replacing a path with another style costs 6.00 [R].
- Paths may be elevated (with supports) or tunnelled. Clearance: 4 hu above a path must be free [D: 2 land steps].
- **Queue path**: separate path type. A queue tile connects to at most 2 neighbours (in-line). A queue tile adjacent to a ride entrance links to that ride (and that station). Linked queues propagate the ride link along the chain. The queue tile at the far end that meets a normal path shows the ride's sign facing the incoming walker; guests decide there (§6.7).
- **Wide areas**: guests treat any 2×2 block of path as open plaza (not a junction) for pathfinding [R].
- **Path furniture** (one per path tile, not on queues except a queue screen add-on [optional]):
  | Add-on | Cost [D] | Function |
  |---|---|---|
  | Bench | 10.00 | guests sit (up to 2 per side) (§6.10); can be vandalised |
  | Litter bin | 6.00 | each free tile edge acts as a bin side holding ~24 items (capacity counter 3 that drops by 1 with 1/8 chance per deposit) [R]; full bins overflow as litter; handymen empty them; can be vandalised |
  | Lamp | 8.00 | cosmetic (lights at dusk if day/night is on); can be vandalised |
  | Queue entertainment screen (optional) | 15.00 | on queue tiles: guests waiting long get gradually happier (§6.4) |
- **Park entrance**: 3 tiles wide, the centre is a path tile; placed by the scenario [D: not movable in v1]. Guests arrive from map-edge spawn points on unowned paths to it. Park open/closed toggle: when closed, no guests enter; the game starts with the park closed [R].
- **Ride entrance / exit**: 1 tile each, placed against a station edge facing away from the track; free to place [R]. Must connect to a path (entrance via queue usually).

### 9.6 Scenery (minimal v1) [D]
Trees and small decorative objects (1/4 tile or full tile), costs 5–40, removable. Scenery counts toward ride scenery scores (§8.3) and the guests' surroundings check (§6.4). Fountains (path add-on or object) [optional]. Flower beds [optional, need watering by handymen in the reference; v1 can omit].

### 9.7 Guest pathfinding [R-functional]
- Movement is tile-to-tile along path edges; decisions happen at tile centres.
- **Aimless** guests: at a junction pick a random connected edge other than the one they came from (dead end: turn back).
- **Heading to a target** (ride entrance, stall, exit): bounded search from the current tile toward the goal, exploring at most 5 junctions deep (7 with a map or when leaving, 8 when lost while leaving; staff 8), and at most 15 000 tiles (staff 50 000) [R]. Choose the edge whose explored branch ends closest to the goal (by 3-D Manhattan distance), ties broken randomly. Remember the last few junction choices to avoid loops.
- Guests with a map occasionally stop to read it at junctions (≈2.5%, ≈14% when heading somewhere).
- Lost-ness counters per §6.12. These limits are what makes big confusing path networks bad; keep them.

---

## 10. Staff [R unless noted]

| Type | Monthly wage | Duties (toggles in staff window) | Speed |
|---|---|---|---|
| Handyman | 50.00 | sweep litter; empty bins; (optional) mow grass; (optional) water flower beds | fixed staff speed (96 on the guest 32–128 energy scale) |
| Mechanic | 80.00 | inspect rides; fix rides | same |
| Security guard | 60.00 | patrol; deters vandalism | same |
| Entertainer | 55.00 | patrol and perform | same |

Hiring: no hire fee; the new staff member appears at the park entrance or the player places them on a path [D]. Firing: immediate. Wages are paid weekly (¼ of monthly).

**Patrol areas**: each staff member may be assigned any set of 4×4-tile blocks [R granularity]. Empty set = whole park. Staff only choose path edges that keep them inside their area; mechanics only answer calls for rides whose exit is inside their area.

**Handyman**:
```
on each path decision:
    if sweeping enabled (and most of the time): look for the nearest litter within 3 tiles (Manhattan, z weighted ×4) inside the patrol area
        follow toward it with 90% probability (10% if standing on a ride queue)
    else pick a random connected edge (avoiding reversing)
on arriving on a tile with litter: sweep animation, remove it (+1 swept)
on a tile with a bin whose sides are not empty: empty animation, reset bin capacity
optional: mow tiles with long grass adjacent to the path; water flower beds nearby
```
**Mechanic**: patrols randomly; when called (§8.10) walks to the station exit (bounded pathfinding), performs the type-specific fix sequence (walk to station end, work, walk to station start, work, or walk to the broken vehicle and work), then leaves via the exit. Stats: rides fixed, rides inspected. Call order: breakdowns first; an inspection-bound mechanic is redirected if the ride breaks down meanwhile.

**Security guard**: patrols randomly. While any guard is within 7 tiles of a would-be vandal, vandalism does not happen (§6.11). Stat: vandals stopped.

**Entertainer**: patrols randomly; at each path decision, 25% chance to perform (wave/joy). A performance affects every guest within 3 tiles at roughly the same height: walking guests happiness_target +4; queuing guests happiness_target +3 and time_in_queue −200. Stat: guests entertained.

Staff never leave, never tire [R]. They can be picked up and dropped on any path.

---

## 11. Research [R]

- Categories: transport, gentle, roller coasters, thrill, water, shops & stalls, scenery. v1 uses gentle, coaster, thrill, water, shops (+ coaster track features, see below [D]).
- Funding levels and monthly cost: none 0 / minimum 100.00 / normal 200.00 / maximum 400.00 (paid weekly in quarters).
- Progress: every 32 ticks add 0 / 160 / 250 / 400 points by funding level. Each item passes through three stages — *initial research* (choosing), *designing*, *completing design* — each needing 65 536 points. At normal funding an item takes ≈ 25 000 ticks ≈ 1.5 months; minimum ≈ 2.4 months; maximum ≈ 0.96 months.
- Item choice at the start of *designing*: the first remaining item in the scenario's research list whose category is ticked in the player's priorities; if none, the first remaining item.
- On completion: item becomes available to build; a notice is raised; research continues with the next. When the list is exhausted, funding drops to none.
- The UI shows: funding level, category priorities (checkboxes), the current stage, the category being researched (and in the final stage the actual item), and an expected completion date computed from the remaining points and the rate.

v1 research list [D]:
| Start available | Researchable (default order) |
|---|---|
| Carousel, spinning cups, coaster (straights, gentle slopes, flat curves, lift, station, brakes), food stall A, drink stall, toilets, information kiosk | swinging ship; souvenir stall; coaster banked curves; observation tower; first aid room; go-karts; food stall B; coaster steep slopes; log flume; coaster vertical loop; drop tower; cash machine |

(The reference researches whole ride types and scenery groups, not individual track pieces; researching coaster features is a design choice that adds progression to the single coaster type.)

---

## 12. Scenarios and objectives

### 12.1 Scenario definition [R structure]
A scenario provides: map (terrain, water, ownership, for-sale land, park entrance, spawn points, pre-placed scenery/paths), climate, start date (always month 0 year 1), start cash / loan / max loan / interest rate, pricing model (pay-at-gate or pay-per-ride), land and rights prices, guest initial cash/happiness/hunger/thirst, intensity preference flags, harder-rating and harder-guest-generation flags, available and researchable items, research funding default (normal) and priorities, objective.

### 12.2 Three original objective types [D]
Checked at each month start (and daily for objectives that may complete early) [R mechanism].

| # | Objective type | Win condition | Lose condition | Example numbers (easy / medium / hard) |
|---|---|---|---|---|
| A | **Attendance by a deadline** | at the end of year Y: guests in park ≥ N and park rating ≥ R. May complete early if reached before (option). | deadline passes without meeting both | N 400 / 900 / 1 500 by Y 2 / 3 / 3, R 600 |
| B | **Park value by a deadline** | at the end of year Y: park value ≥ V | deadline passes | V 30 000 / 60 000 / 100 000 by Y 3 / 3 / 4 |
| C | **Sustained ride takings** | finished month's ride-ticket income ≥ M for K consecutive months (pay-per-ride parks only) | none (or optional deadline of year Y) | M 3 000 / 6 000 / 10 000, K 1 / 2 / 3 |

Global failure rule (all objectives) [R-inspired, D numbers]: if the park rating stays below 200 for 4 consecutive weeks after the first month, the park is closed and the scenario is failed. Warn at the start of each of those weeks.

On success: show a completion screen with company value; play continues (sandbox). On failure: show a failure screen; offer restart or continue in sandbox.

### 12.3 Awards (optional, v2) [R]
Monthly, the reference grants positive/negative "awards" (e.g. cleanest park, best value, most dangerous) that raise or lower guest generation by ¼ each for some months. Out of scope for v1; the hook is in §5.2.

---

## 13. User interface (functional)

### 13.1 Always-on HUD
Cash, current date (day / month / year), park rating (numeric + trend), guests in park, weather icon and temperature, game speed controls (pause, 1×–8×), news ticker (latest notice; click to jump to subject), a button to open the notice history.

### 13.2 Tools (top or side toolbar)
| Tool | Function |
|---|---|
| Camera | pan (drag / edge / keys), zoom (3–4 levels), rotate 90° left/right |
| Terrain | raise/lower land (corner/edge/tile, brush size), water level, cost preview before apply |
| Land rights | buy land / buy construction rights on for-sale tiles (drag area, shows cost) |
| Path | place path / queue; slope mode (down, flat, up); click-drag to lay a run; auto-connect; bulldoze path; place path add-ons |
| Build ride | ride/stall picker (tabs by category, shows cost, capacity description, base ratings) → place flat ride or enter track builder |
| Scenery | tree/decor picker, place/remove, rotate |
| Bulldozer | remove scenery/path/ride piece (refunds per §13.5) |
| Staff | hire by type; open staff list |
| Guests | guest list with filters; thought summary |
| Park | park window |
| Finances | finances window (incl. loan, marketing, research tabs) |
| Research | research window |
| Map | overview map with overlays |
| Options | sound/music volume, units (metric/imperial), auto-pause on notices, save/load |

### 13.3 Track builder (coaster, go-karts, flume)
- State: the "cursor" piece end (position, heading, height, current slope, current bank, lift flag).
- Piece selector buttons: direction (left small / left large / straight / right large / right small), slope (steep down … flat … steep up, only valid transitions enabled), bank (left / none / right), lift-hill toggle, special pieces (station, brakes, loop, splash for flume).
- Ghost preview of the next piece with its cost; invalid placements shown with reason (collides, too high, no rights, not affordable).
- Place / remove last piece / step back-forward along existing track; placing the first piece = a station.
- Finishing: when the track end meets the station start, the circuit closes; the builder then asks for entrance/exit placement.
- Station length = consecutive station pieces (1–8 [D]); trains must fit.

### 13.4 Windows (functional content)
| Window | Content |
|---|---|
| Ride | name (editable), status (closed/test/open) controls, current vehicle view; tabs: Vehicles (trains, cars), Operating (load mode, min/max wait, option such as rotations/laps, lift speed), Maintenance (reliability %, downtime %, inspection interval, last inspection, call mechanic, breakdown reason), Measurements (E/I/N with category labels, max/avg speed, ride time, length, max +/− vertical g, max lateral g, airtime, drops, highest drop, inversions; optional graphs of speed/height/g along the test run), Price (ticket price, value hint optional), Customers (on ride, queue length, longest wait, customers/hour, popularity %, satisfaction %, favourite-of count, total customers, income/hour, running cost, profit/hour, age) |
| Stall | status, item price(s), items sold, profit, upkeep, popularity |
| Guest | name/number, happiness, energy, hunger, thirst, nausea, toilet bars; cash, spend breakdown; items carried; thoughts (newest first); current state ("heading for…", "queuing for…"); favourite ride; rides ridden list; actions: pick up, follow |
| Guest list | all guests filterable by state, ride, thought; summary mode: grouped by current top thought with counts (click to filter) |
| Staff list / staff | per type list; wage; orders toggles; patrol area tool; stats; pick up; fire |
| Park | open/close park; entrance fee (if pay-at-gate); rating + weekly graph; guests + weekly graph; park value; company value; objective and its progress; park size |
| Finances | 16-month expenditure table by category; cash; loan with +/− and interest rate; weekly profit graph; park value graph; marketing campaigns (choose type, subject, weeks; list active); research funding & priorities |
| Research | as §11 |
| Notices | scrollable history: ride broken/not fixed; inspection overdue (optional); research completed; campaign ended; guest warnings (§6.13); objective results; ride crashed |

### 13.5 Refunds [R-functional]
Removing track refunds the piece's price including supports; **only 70% once the ride has ever been opened** [R]. Stalls and flat rides follow the same rule [D]. Removing paths refunds the path price [D]. Selling land back is not allowed in play [D].

### 13.6 Overlays and view modes
Land ownership (owned / rights / for sale), height markers on land and track, path-only view, underground/see-through mode (transparent land), hide scenery, highlight a ride's queue and footprint, patrol area of a selected staff member, guest density heat map [D], litter heat map [D], ride status colouring (open / closed / broken) [D].

---

## 14. Rendering: functional visual states

Describe what must be *distinguishable*, not how it looks. The build team designs all art.

| Thing | States / variants required |
|---|---|
| Land tile | each of the 19 slope shapes × 4 view rotations; surface material; grass length stages (≥3) [if mowing kept]; vertical cliff faces between tiles of different height; water surface at its level; ownership boundary marker; for-sale and rights-for-sale markers (overlay); construction selection highlight |
| Path / queue | isolated, end, straight, corner, T, cross, plaza (2×2+); sloped in 4 directions; elevated supports to ground; queue variant incl. ride sign at queue start; add-ons: bench, bin (normal / full), lamp (off/on), each with a broken variant |
| Park entrance | open / closed |
| Ride entrance & exit | 4 facings; open / closed; ride broken indicator (optional) |
| Stall | 4 facings; open / closed; distinct per stall type |
| Carousel | idle; rotating (≥8 frames per revolution); riders visible |
| Spinning cups | platform rotation + cup self-rotation frames |
| Swinging ship | swing angle frames (≥ ±90° range in ≥9 steps) |
| Drop tower / observation tower | base, tower section, top; car/cabin at any height; drop tower car seated riders |
| Coaster track | every piece in §8.7.2 × 4 headings; lift chain marker; brake marker; station platform with canopy; supports from piece to ground at any height; track drawn correctly when other things pass under/over |
| Coaster car | heading in ≥16 (better 32) yaw steps; pitch: flat, ±gentle, ±steep, and the loop pitch sequence (≥8 steps through inversion); bank: left, none, right (and pitch+bank on banked slopes); empty / with riders |
| Go-kart & track | kart in ≥16 headings × pitch (flat/±gentle); track pieces × 4 headings |
| Flume channel & boat | channel pieces × 4 headings; boat headings × pitch (flat/±gentle/steep down); splash effect |
| Guest | walk cycle in 4 directions (8 for smoother) ; idle/queue stand; sitting; watching; eating/drinking (generic held item per item category); holding umbrella (rain); reading map; vomiting; waving/joy; angry (vandal) action; being carried (picked up); seated in a ride vehicle; mood indicator states (≥7: very happy … neutral … very unhappy, plus sick, very sick, tired, angry) for lists/inspector |
| Staff | 4 types distinguishable; walking; sweeping; emptying bin; fixing/inspecting (working); entertainer performing; picked up |
| Litter | small item types (can, cup, box, wrapper, bottle) and vomit (2 variants) — need not be type-accurate, but vomit must be distinguishable from litter |
| Effects | floating money amount at a purchase; crash explosion cloud, flare, debris (if crashes kept); rain light/heavy particles; lightning flash; screen darkening by gloom level 0–3; optional day/night tint |
| Construction | ghost preview (valid / invalid tint), direction arrow at the track cursor, selection rectangle for area tools |

---

## 15. Sound (functional cues)

The community packs **OpenSoundEffects (OpenSFX, MIT)** and **OpenMusic (CC-BY-SA-4.0)** may be used. Per the reference source, game sound IDs are indexes into a base sound pack; OpenSFX ships a drop-in base pack with samples at the same indexes. IDs 0–63 index the base pack; 64–66 index the reference's "additional" pack (OpenSFX also covers these) — **verify each index against the OpenSFX object manifest before relying on it**.

| Cue (functional) | Trigger | Sound ID |
|---|---|---|
| Lift hill chain (steel) | coaster train on a lift piece, looped | 0 |
| Coaster rolling (steel, classic) | train moving on track, looped by speed | 2 |
| Riders scream (several variants) | train on steep drops / loops / high g | 3, 7, 8, 9, 10, 11, 35, 58 |
| UI click | button presses | 4, 5, 37 |
| Place item | placing scenery/path/stall | 6 |
| Purchase | guest pays for anything | 13 |
| Crash / explosion | vehicle crash | 14 |
| Laying out water | water tool | 15 |
| Water ambience | boats on flume | 16, 17, 32 |
| Splash | boat hits splash-down | 20 |
| Go-kart engine | kart moving, looped | 21 |
| Cough / vomit | guest vomits | 24, 25, 26, 27 |
| Rain | rain/storm weather, looped | 28 |
| Thunder | lightning strike | 29, 30 |
| Balloon pop | optional | 33 |
| Mechanic fixing | mechanic working | 34 |
| Toilet flush | guest leaves toilet | 36 |
| Notice | new notice in the ticker | 39 |
| Window open | opening a window | 40 |
| Laugh | guest really liked the ride (3/8 chance) | 41, 42, 43 |
| Applause | scenario complete [D use] | 44 |
| Error | invalid action | 50 |
| Brake release | train released from brakes/station | 51 |
| Crowd ambience | background, volume scaled by visible guests | 63 |
| Flume lift | boat on flume up-slope conveyor | 66 (additional pack index 2) |
| Ride music | per-ride looping track by style (fairground, rock, water, gentle, techno) | OpenMusic tracks, chosen by style |
| Title / menu music | menu | OpenMusic |

Positional audio [R-functional]: world sounds pan and attenuate by screen position and zoom; vehicle loops pitch-shift with speed.

---

## 16. Notices (functional list) [R-functional]
Ride broken down; ride still not fixed (repeat); ride crashed; research item available; marketing campaign finished; guests hungry / thirsty / can't find toilet / dislike litter / disgusted by paths / dislike vandalism / lost / queue too long at X (§6.13); entrance fee too high (monthly, pay-at-gate parks); park rating low (weekly while in the failure window); objective achieved / failed; first guest arrived [D]; new ride became most popular [D, optional].

---

## 17. Known gaps, assumptions and v2 candidates

| Area | Status |
|---|---|
| Climate data | reference climate tables are object data not present in the source tree; §2.2 is a design default |
| Flat ride capacity and cycle times | reference stores these in per-ride object data (not in the source tree); §8.3 values are design defaults |
| Coaster vehicle physics | integer physics of the reference not transcribed; §8.7.2 gives a design-default model tuned to produce speeds in the rating ranges |
| G-force factors per piece | given for the v1 pieces; the loop factor curve is expressed in normalised progress |
| Sloped-turn rating terms | only matter for the small sloped curve in v1 |
| Pathfinding | functional description; tune search limits by testing |
| Block sections / multiple trains | out of v1 (prevents crashes) |
| Awards, mowing, watering, ducks, day/night, snow | out of v1 or optional |
| Shops' on-ride photos, cash machine | optional |
| Verification [V] | reference data install was not consulted; numbers are [R] from the reimplementation |

