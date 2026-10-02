// Skyrise — static rule data. Data-driven facility table (spec 4.0, 14).
// Internal level index: 0 = ground (floor 1), 1 = floor 2 ... 99 = floor 100.
// Negative levels are basements: -1 = B1 ... -10 = B10.

export const WORLD_W = 400;          // units
export const MIN_LEVEL = -10;        // B10
export const MAX_BUILD_LEVEL = 99;   // floor 100
export const TOP_LEVEL = 103;        // the landmark rises above floor 100
export const MIN_BUILD_BASEMENT = -9; // normal construction to B9
export const LEVELS = TOP_LEVEL - MIN_LEVEL + 1;
export const START_FUNDS = 2000000;
export const FLOOR_COST = 500;       // per unit of bare slab

export const STAR_LANDMARK = 6;      // internal value for the final rank

export function isLobbyLevel(L) {
  return L === 0 || (L > 0 && L <= 89 && L % 15 === 14);
}
export function floorLabel(L) {
  return L >= 0 ? String(L + 1) : 'B' + (-L);
}
export function isExpressStop(L) {
  return L < 0 || isLobbyLevel(L);
}

// price levels: index 0 = L1 (highest) ... 3 = L4 (lowest); default index 1
export const PRICE_EVAL_OFFSET = [30, 0, -20, -40];
export const PRICE_MOVE_FACTOR = [0.5, 1.0, 1.3, 1.6];
export const PRICE_NAMES = ['Premium', 'Standard', 'Budget', 'Bargain'];

// Facility table. flags:
//  under: allowed underground; above: allowed above ground; ground: allowed on level 0
//  sensitive: noise-sensitive; noisy: noise source; commercial: daily customers
export const FAC = {
  lobby:     { label: 'Lobby', w: 4, h: 1, cost: 20000, star: 1, removable: false, above: true, struct: true },
  office:    { label: 'Office', w: 9, h: 1, cost: 40000, star: 1, pop: 6, prices: [15000, 10000, 5000, 2000], per: 'quarter', under: true, above: true, tenant: true },
  condo:     { label: 'Apartment', w: 16, h: 1, cost: 80000, star: 1, pop: 3, prices: [200000, 150000, 100000, 40000], per: 'sale', above: true, sensitive: true, tenant: true },
  fastfood:  { label: 'Snack bar', w: 16, h: 1, cost: 100000, star: 1, under: true, above: true, noisy: true, commercial: true, cap: 48, perCustomer: 100, dailyCost: 1000, open: [10 * 60, 21 * 60], visitors: [10, 48] },
  single:    { label: 'Single room', w: 4, h: 1, cost: 20000, star: 2, pop: 1, prices: [3000, 2000, 1500, 500], per: 'night', above: true, sensitive: true, hotel: true, guests: 1 },
  twin:      { label: 'Double room', w: 6, h: 1, cost: 50000, star: 3, pop: 2, prices: [4500, 3000, 2000, 800], per: 'night', above: true, hotel: true, guests: 2 },
  suite:     { label: 'Suite', w: 10, h: 1, cost: 100000, star: 3, pop: 2, prices: [9000, 6000, 4000, 1500], per: 'night', above: true, sensitive: true, hotel: true, guests: 2 },
  housekeeping: { label: 'Housekeeping', w: 15, h: 1, cost: 50000, star: 2, pop: 6, removable: false, under: true, above: true, staff: true },
  security:  { label: 'Security post', w: 16, h: 1, cost: 100000, star: 2, pop: 6, removable: false, under: true, above: true, limit: 10, staff: true },
  restaurant:{ label: 'Restaurant', w: 24, h: 1, cost: 200000, star: 3, under: true, above: true, noisy: true, commercial: true, cap: 60, perCustomer: 200, dailyCost: 2000, open: [17 * 60, 23 * 60], visitors: [10, 30] },
  shop:      { label: 'Boutique', w: 12, h: 1, cost: 100000, star: 3, prices: [20000, 15000, 10000, 4000], per: 'quarter', under: true, above: true, noisy: true, commercial: true, cap: 40, open: [10 * 60, 21 * 60], visitors: [5, 20] },
  party:     { label: 'Banquet hall', w: 24, h: 2, cost: 100000, star: 3, under: true, above: true, noisy: true, limitGroup: 'ent' },
  cinema:    { label: 'Cinema', w: 31, h: 2, cost: 500000, star: 3, under: true, above: true, noisy: true, limitGroup: 'ent', accessTop: true },
  clinic:    { label: 'Clinic', w: 26, h: 1, cost: 500000, star: 3, under: true, above: true, limit: 10 },
  recycling: { label: 'Recycling plant', w: 25, h: 2, cost: 500000, star: 3, removable: false, under: true, above: true, noisy: true },
  parkspace: { label: 'Parking bay', w: 4, h: 1, cost: 3000, star: 3, under: true, underOnly: true, limit: 512 },
  parkramp:  { label: 'Car ramp', w: 16, h: 1, cost: 50000, star: 3, under: true, underOnly: true },
  transit:   { label: 'Metro station', w: 30, h: 3, cost: 1000000, star: 4, removable: false, under: true, underOnly: true, limit: 1, noisy: true, accessTop: true },
  ruin:      { label: 'Burnt-out shell', w: 1, h: 1, cost: 0, star: 1, nobuild: true, above: true, under: true },
  landmark:  { label: 'Sky chapel', w: 28, h: 5, cost: 3000000, star: 5, removable: false, above: true, limit: 1 },
};
for (const k in FAC) { FAC[k].key = k; if (FAC[k].removable === undefined) FAC[k].removable = true; }

export const TRANSPORT = {
  stairs:    { label: 'Stairs', w: 8, cost: 5000, star: 1, mode: 'stairs' },
  escalator: { label: 'Escalator', w: 8, cost: 20000, star: 3, mode: 'esc' },
  elevator:  { label: 'Lift', w: 4, cost: 200000, star: 1, mode: 'elev', cap: 21, maxSpan: 30, carCost: 50000, vmax: 0.5, acc: 0.06, board: 2 },
  express:   { label: 'Express lift', w: 6, cost: 400000, star: 3, mode: 'elev', cap: 42, maxSpan: 200, carCost: 100000, vmax: 1.5, acc: 0.15, board: 3 },
  service:   { label: 'Service lift', w: 4, cost: 100000, star: 2, mode: 'elev', cap: 17, maxSpan: 30, carCost: 50000, vmax: 0.5, acc: 0.06, board: 2 },
};
for (const k in TRANSPORT) TRANSPORT[k].key = k;

export const LIMITS = { shafts: 24, carsPerShaft: 8, stairsEsc: 64, commercial: 512, parkspace: 512, clinic: 10, security: 10, ent: 16, transit: 1, landmark: 1, namedPeople: 20, namedFacs: 20, nameLen: 15 };

// Quarterly maintenance (spec 8.3)
export const MAINT = { elevator: 10000, express: 20000, service: 10000, escalator: 5000, parkramp: 10000, recycling: 50000, transit: 100000, housekeeping: 10000, security: 20000, lobbyUnit: 100 };

export const INCOME_CATS = ['office', 'single', 'twin', 'suite', 'shop', 'fastfood', 'restaurant', 'party', 'cinema', 'condo'];
export const INCOME_LABELS = { office: 'Offices', single: 'Single rooms', twin: 'Double rooms', suite: 'Suites', shop: 'Boutiques', fastfood: 'Snack bars', restaurant: 'Restaurants', party: 'Banquets', cinema: 'Cinema', condo: 'Apartment sales' };
export const MAINT_CATS = ['lobby', 'elevator', 'express', 'service', 'escalator', 'parkramp', 'recycling', 'transit', 'housekeeping', 'security'];
export const MAINT_LABELS = { lobby: 'Lobbies', elevator: 'Lifts', express: 'Express lifts', service: 'Service lifts', escalator: 'Escalators', parkramp: 'Car ramps', recycling: 'Recycling', transit: 'Metro', housekeeping: 'Housekeeping', security: 'Security' };

// Star thresholds (spec 7)
export const STAR_POP = { 2: 300, 3: 1000, 4: 5000, 5: 10000, 6: 15000 };

// Stress tiers (spec 6.2) and evaluation tiers (6.3)
export const STRESS_MAX = 300;
export function stressTier(s) { return s < 80 ? 0 : s < 150 ? 1 : 2; }
export function evalTier(e) { return e < 100 ? 0 : e < 200 ? 1 : 2; } // 0 poor, 1 good, 2 excellent

// Film catalogue (all invented)
export const FILMS = [
  { title: 'Midnight Over Marlow Bay', kind: 'new' },
  { title: 'The Clockmaker\'s Moon', kind: 'new' },
  { title: 'Sixteen Paper Kites', kind: 'new' },
  { title: 'Rust and Rosemary', kind: 'new' },
  { title: 'Orbit of the Lantern Fish', kind: 'new' },
  { title: 'A Lighthouse in Kansas', kind: 'classic' },
  { title: 'The Velvet Tram', kind: 'classic' },
  { title: 'Ballad for a Broken Radio', kind: 'classic' },
  { title: 'Captain Juniper Returns', kind: 'classic' },
];
export const FILM_COST = { new: 150000, classic: 30000 };
export const FILM_DRAW = { new: 1.0, classic: 0.5 };

export const DAY_NAMES = ['WD1', 'WD2', 'WE'];
