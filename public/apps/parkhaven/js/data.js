// Parkhaven - game data tables. Numbers follow the functional spec (SPEC.md); all names and
// wording are original to Parkhaven. Money is in integer cents (1 cr = 100).

export const TICKS_PER_SEC = 40;
export const MONTH_TICKS = 16384;
export const WEEK_TICKS = 4096;
export const MONTH_NAMES = ['Bloom', 'Showers', 'Blossom', 'Highsun', 'Goldleaf', 'Harvest', 'Ember', 'Frost'];
export const MONTH_DAYS = [31, 30, 31, 30, 31, 31, 30, 31];

// ---- weather (spec 2.1 / 2.2) ----
export const WEATHER = [
  { name: 'Sunny', delta: 10, gloom: 0, effect: 0, level: 0 },
  { name: 'Bright spells', delta: 5, gloom: 0, effect: 0, level: 0 },
  { name: 'Overcast', delta: 0, gloom: 0, effect: 0, level: 0 },
  { name: 'Drizzle', delta: -2, gloom: 1, effect: 1, level: 1 },
  { name: 'Downpour', delta: -4, gloom: 2, effect: 1, level: 2 },
  { name: 'Thunderstorm', delta: 2, gloom: 2, effect: 2, level: 2 },
];
export const CLIMATE = [
  { base: 8, w: [3, 4, 4, 3, 1, 0] },
  { base: 11, w: [4, 4, 3, 3, 1, 0] },
  { base: 15, w: [5, 4, 3, 2, 1, 1] },
  { base: 19, w: [6, 4, 2, 2, 1, 1] },
  { base: 22, w: [7, 4, 2, 1, 1, 1] },
  { base: 21, w: [6, 4, 2, 2, 1, 1] },
  { base: 16, w: [4, 4, 3, 3, 1, 1] },
  { base: 11, w: [3, 4, 4, 3, 2, 0] },
];

// ---- finance categories (spec 3.3) ----
export const FIN = {
  RIDE_BUILD: 0, RIDE_RUN: 1, LAND: 2, LANDSCAPE: 3, PARK_TICKETS: 4, RIDE_TICKETS: 5,
  SHOP_SALES: 6, SHOP_STOCK: 7, FOOD_SALES: 8, FOOD_STOCK: 9, WAGES: 10, MARKETING: 11,
  RESEARCH: 12, INTEREST: 13,
};
export const FIN_NAMES = ['Ride building', 'Ride running costs', 'Land purchase', 'Landscaping',
  'Park admission', 'Ride tickets', 'Gift sales', 'Gift stock', 'Food & drink sales',
  'Food & drink stock', 'Staff wages', 'Marketing', 'Research', 'Loan interest'];
export const FIN_TODAY = [1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0];

// ---- items (spec 7.2) ----
export const ITEMS = {
  F1: { name: 'Pasty', cat: 'food', cost: 50, value: 190, hot: 190, cold: 220, price: 150, consume: 150, container: 1 },
  F2: { name: 'Pretzel', cat: 'food', cost: 40, value: 160, hot: 160, cold: 180, price: 150, consume: 120, container: 2 },
  D1: { name: 'Lemonade', cat: 'drink', cost: 30, value: 120, hot: 200, cold: 100, price: 120, consume: 100, container: 3 },
  S1: { name: 'Plush Heron', cat: 'souvenir', cost: 150, value: 300, hot: 300, cold: 300, price: 250 },
  S2: { name: 'Umbrella', cat: 'souvenir', cost: 200, value: 350, hot: 250, cold: 500, price: 250 },
  M: { name: 'Park Map', cat: 'souvenir', cost: 10, value: 70, hot: 70, cold: 80, price: 60 },
};
export const ITEM_KEYS = Object.keys(ITEMS);

// ---- stalls & facilities (spec 7.1) ----
export const STALLS = {
  pie: { name: 'Pie Cart', cost: 30000, upkeep: 310, sells: ['F1'], bonus: 15, color: [0.86, 0.45, 0.25], icon: 'pie' },
  lemonade: { name: 'Lemonade Stand', cost: 25000, upkeep: 310, sells: ['D1'], bonus: 15, color: [0.95, 0.82, 0.25], icon: 'drink' },
  toilets: { name: 'Restrooms', cost: 22500, upkeep: 310, facility: 'toilet', bonus: 5, color: [0.35, 0.6, 0.85], icon: 'wc' },
  info: { name: 'Info Kiosk', cost: 25000, upkeep: 310, sells: ['M', 'S2'], bonus: 15, color: [0.3, 0.7, 0.62], icon: 'info' },
  gifts: { name: 'Gift Hut', cost: 20000, upkeep: 310, sells: ['S1', 'S2'], bonus: 15, color: [0.8, 0.4, 0.7], icon: 'gift' },
  firstaid: { name: 'First Aid Post', cost: 25000, upkeep: 280, facility: 'firstaid', bonus: 5, color: [0.92, 0.92, 0.92], icon: 'aid' },
  pretzel: { name: 'Pretzel Stand', cost: 30000, upkeep: 310, sells: ['F2'], bonus: 15, color: [0.7, 0.5, 0.3], icon: 'pretzel' },
  cash: { name: 'Cash Point', cost: 20000, upkeep: 250, facility: 'cash', bonus: 5, color: [0.4, 0.75, 0.45], icon: 'cash' },
};

// ---- flat rides (spec 8.3). Ratings in hundredths. cycleUnit / load in ticks. ----
export const FLAT_RIDES = {
  carousel: {
    name: 'Carousel', cat: 'gentle', w: 3, l: 3, cost: 46000, cap: 16,
    option: { name: 'Rotations', min: 4, max: 25, def: 10 }, unitTicks: 120, loadTicks: 400,
    base: [60, 15, 30], bonus: [5, 5, 5], scen: 0.298, prox: 0, mult: [50, 10, 0],
    upkeep: { base: 500, len: 1, car: 0 }, price: 100, typeBonus: 45,
    breakdowns: ['cutout', 'control'], unrel: 16, music: true, color: [0.95, 0.55, 0.6],
  },
  cups: {
    name: 'Teacup Twirl', cat: 'thrill', w: 3, l: 3, cost: 36000, cap: 18,
    option: { name: 'Rotations', min: 3, max: 6, def: 4 }, unitTicks: 200, loadTicks: 480,
    base: [113, 97, 190], bonus: [20, 20, 20], scen: 0.213, prox: 0, mult: [40, 20, 10],
    upkeep: { base: 500, len: 1, car: 0 }, price: 100, typeBonus: 40,
    breakdowns: ['cutout', 'control'], unrel: 16, music: true, color: [0.55, 0.75, 0.95],
  },
  ship: {
    name: 'Swingboat', cat: 'thrill', w: 3, l: 5, cost: 38750, cap: 20,
    option: { name: 'Swings', min: 7, max: 25, def: 10 }, unitTicks: 120, loadTicks: 480,
    base: [150, 190, 141], bonus: [5, 5, 10], scen: 0.255, prox: 0, mult: [50, 30, 10],
    upkeep: { base: 500, len: 1, car: 0 }, price: 150, typeBonus: 35,
    breakdowns: ['cutout'], unrel: 10, music: false, color: [0.75, 0.5, 0.3],
  },
  droptower: {
    name: 'Sky Drop', cat: 'thrill', w: 3, l: 3, cost: 18000, perSection: 2250, sections: 8, cap: 12,
    option: null, base: [280, 350, 350], perHu: [5.1, 10.2, 10.2], scen: 0.383, prox: 0.171,
    mult: [50, 50, 10], upkeep: { base: 500, len: 20, car: 100 }, price: 200, typeBonus: 45,
    breakdowns: ['cutout', 'stuckShut', 'stuckOpen', 'vehicle'], unrel: 24, music: false, color: [0.9, 0.35, 0.3],
  },
  obstower: {
    name: 'Lookout Tower', cat: 'gentle', w: 3, l: 3, cost: 14800, perSection: 1850, sections: 10, cap: 20,
    option: null, base: [150, 0, 10], perHu: [1.12, 0, 0.64], scen: 1.277, prox: 0.307,
    mult: [80, 10, 0], upkeep: { base: 500, len: 20, car: 100 }, price: 100, typeBonus: 45,
    breakdowns: ['cutout', 'vehicle'], unrel: 15, music: false, sheltered: true, color: [0.4, 0.65, 0.85],
  },
};

// ---- tracked rides ----
export const TRACK_RIDES = {
  coaster: {
    name: 'Steel Coaster', cat: 'coaster', piecePrice: 4500, supportPrice: 250, maxHeight: 70,
    mult: [50, 30, 10], upkeep: { base: 400, lift: 800, len: 20, train: 100, car: 30, station: 100, brake: 200 },
    price: 200, typeBonus: 95, unrel: 15, breakdowns: ['cutout', 'stuckShut', 'stuckOpen', 'vehicle', 'brakes'],
    carLen: 1.8, seats: 4, carsMin: 1, carsMax: 8, carsDef: 4, vehMax: 1, color: [0.9, 0.3, 0.35],
  },
  karts: {
    name: 'Go-Karts', cat: 'thrill', piecePrice: 3100, supportPrice: 200, maxHeight: 24,
    mult: [120, 20, 0], upkeep: { base: 500, lift: 0, len: 20, train: 0, car: 80, station: 0, brake: 0 },
    price: 200, typeBonus: 55, unrel: 16, breakdowns: ['vehicle'], carLen: 1.4, seats: 1,
    carsMin: 1, carsMax: 1, vehDef: 6, vehMax: 12, color: [0.95, 0.75, 0.2],
  },
  flume: {
    name: 'Splash Flume', cat: 'water', piecePrice: 2250, supportPrice: 250, maxHeight: 40,
    mult: [80, 34, 6], upkeep: { base: 800, lift: 0, len: 20, train: 90, car: 0, station: 100, brake: 0 },
    price: 200, typeBonus: 65, unrel: 15, breakdowns: ['cutout', 'brakes'], carLen: 2.0, seats: 2,
    carsMin: 1, carsMax: 1, vehDef: 4, vehMax: 10, color: [0.35, 0.6, 0.9],
  },
};

export const BREAKDOWNS = {
  cutout: { name: 'Safety cut-out', w: 25 },
  stuckShut: { name: 'Restraints stuck shut', w: 12 },
  stuckOpen: { name: 'Restraints stuck open', w: 10 },
  vehicle: { name: 'Vehicle fault', w: 6 },
  brakes: { name: 'Brake failure', w: 3 },
  control: { name: 'Control failure', w: 3 },
};

// ---- path add-ons and scenery ----
export const ADDONS = {
  1: { key: 'bench', name: 'Bench', cost: 1000 },
  2: { key: 'bin', name: 'Litter Bin', cost: 600 },
  3: { key: 'lamp', name: 'Lamp', cost: 800 },
};
export const SCENERY = {
  1: { key: 'pine', name: 'Pine Tree', cost: 1500, tall: 2.2 },
  2: { key: 'oak', name: 'Round Tree', cost: 2000, tall: 1.8 },
  3: { key: 'birch', name: 'Slim Tree', cost: 1200, tall: 2.0 },
  4: { key: 'bush', name: 'Shrub', cost: 500, tall: 0.5 },
  5: { key: 'flowers', name: 'Flower Bed', cost: 1000, tall: 0.2 },
  6: { key: 'fountain', name: 'Fountain', cost: 4000, tall: 0.8, fountain: true },
  7: { key: 'statue', name: 'Heron Statue', cost: 3500, tall: 1.2 },
  8: { key: 'rock', name: 'Boulder', cost: 600, tall: 0.5 },
};

// ---- staff (spec 10) ----
export const STAFF = {
  handyman: { name: 'Handyman', wage: 5000, color: [0.3, 0.6, 0.3] },
  mechanic: { name: 'Mechanic', wage: 8000, color: [0.85, 0.5, 0.15] },
  security: { name: 'Security Guard', wage: 6000, color: [0.2, 0.25, 0.5] },
  entertainer: { name: 'Entertainer', wage: 5500, color: [0.85, 0.3, 0.75] },
};

// ---- research (spec 11) ----
export const RESEARCH_FUNDING = [
  { name: 'None', monthly: 0, rate: 0 },
  { name: 'Minimum', monthly: 10000, rate: 160 },
  { name: 'Normal', monthly: 20000, rate: 250 },
  { name: 'Maximum', monthly: 40000, rate: 400 },
];
export const RESEARCH_CATS = ['gentle', 'coaster', 'thrill', 'water', 'shops'];
export const RESEARCH_CAT_NAMES = { gentle: 'Gentle rides', coaster: 'Coasters', thrill: 'Thrill rides', water: 'Water rides', shops: 'Shops & stalls' };
export const START_AVAILABLE = ['carousel', 'cups', 'coaster', 'pie', 'lemonade', 'toilets', 'info',
  'track:base', 'track:gentle', 'track:curves', 'track:lift', 'track:brakes'];
export const RESEARCH_LIST = [
  { id: 'ship', cat: 'thrill', name: 'Swingboat' },
  { id: 'gifts', cat: 'shops', name: 'Gift Hut' },
  { id: 'track:banked', cat: 'coaster', name: 'Coaster banked curves' },
  { id: 'obstower', cat: 'gentle', name: 'Lookout Tower' },
  { id: 'firstaid', cat: 'shops', name: 'First Aid Post' },
  { id: 'karts', cat: 'thrill', name: 'Go-Karts' },
  { id: 'pretzel', cat: 'shops', name: 'Pretzel Stand' },
  { id: 'track:steep', cat: 'coaster', name: 'Coaster steep slopes' },
  { id: 'flume', cat: 'water', name: 'Splash Flume' },
  { id: 'track:loop', cat: 'coaster', name: 'Coaster vertical loop' },
  { id: 'droptower', cat: 'thrill', name: 'Sky Drop' },
  { id: 'cash', cat: 'shops', name: 'Cash Point' },
];

// ---- marketing (spec 5.3) ----
export const CAMPAIGNS = [
  { key: 'freeEntry', name: 'Free admission voucher', weekly: 5000, pc: 400, needs: 'gate' },
  { key: 'freeRide', name: 'Free ride voucher', weekly: 5000, pc: 300, needs: 'ride', subject: 'ride' },
  { key: 'halfEntry', name: 'Half-price admission voucher', weekly: 5000, pc: 200, needs: 'gate' },
  { key: 'freeFood', name: 'Free snack voucher', weekly: 5000, pc: 200, subject: 'item' },
  { key: 'parkAd', name: 'Park advertising', weekly: 35000, pc: 250 },
  { key: 'rideAd', name: 'Ride advertising', weekly: 20000, pc: 200, subject: 'ride' },
];

// ---- guest thoughts. {r} = ride name, {i} = item name. Wording is Parkhaven's own. ----
export const THOUGHTS = {
  badValue: "I'm not paying that much for {r}!",
  goodValue: '{r} is a real bargain.',
  cantAfford: "I can't afford {r}.",
  outOfMoney: 'My wallet is completely empty.',
  itemExpensive: '{i} costs far too much here.',
  itemGoodValue: 'What a good price for a {i}!',
  wontPayToilet: 'Pay to use the restroom? No way.',
  tooIntense: '{r} looks way too wild for me.',
  notIntense: '{r} looks a bit tame.',
  tooSickening: "My stomach couldn't cope with {r}.",
  rain: "I'm not riding {r} in this rain.",
  notSafe: "{r} doesn't look safe to me.",
  hungry: "I'm starving!",
  thirsty: 'I could really use a drink.',
  toilet: 'Where are the restrooms?!',
  tired: 'My feet are killing me.',
  lowCash: "I'm running low on cash.",
  sick: 'I feel a bit queasy.',
  verySick: 'I feel really, really sick...',
  goHome: 'Time to head home.',
  lost: 'Where am I? I am totally lost.',
  cantFind: "I can't find {r} anywhere.",
  cantFindExit: 'How do I get out of this place?',
  waitedLong: 'This queue for {r} is taking forever.',
  crowded: "It's so crowded on these paths.",
  litter: 'There is rubbish everywhere.',
  disgusting: 'Ugh, these paths are disgusting.',
  vandalism: 'Someone has been smashing things up.',
  scenery: 'The gardens here are lovely.',
  fountains: 'I love these fountains.',
  music: 'This music is so cheerful!',
  clean: 'This park is spotless!',
  rideGreat: '{r} was brilliant!',
  wantOff: 'Let me off {r}!',
  alreadyHave: 'I already have a {i}.',
  notFinished: "I haven't finished my {i} yet.",
  notHungry: "I'm not hungry right now.",
  notThirsty: "I'm not thirsty.",
  queueFull: 'The queue for {r} is full.',
  noRatings: "Nobody knows what {r} is like yet.",
  wow: 'Wow! Look at {r}!',
  happyGeneric: 'What a lovely day out.',
};

export const FIRST_NAMES = ['Ada', 'Bram', 'Cleo', 'Dev', 'Esme', 'Finn', 'Gwen', 'Hugo', 'Iris', 'Jude',
  'Kit', 'Luca', 'Maya', 'Nico', 'Opal', 'Pip', 'Quinn', 'Rosa', 'Sami', 'Tess', 'Uma', 'Vik', 'Wren',
  'Xan', 'Yara', 'Zed', 'Alba', 'Bo', 'Cora', 'Dex', 'Elle', 'Faye', 'Gus', 'Hana', 'Ivo', 'Juno',
  'Kai', 'Lena', 'Milo', 'Nell', 'Otto', 'Pia', 'Remy', 'Sol', 'Theo', 'Ula', 'Vera', 'Wes', 'Yuki', 'Zoe'];

export const SHIRT_COLORS = [[0.9, 0.3, 0.3], [0.3, 0.55, 0.9], [0.95, 0.8, 0.2], [0.35, 0.75, 0.4],
  [0.85, 0.45, 0.8], [0.95, 0.6, 0.25], [0.3, 0.8, 0.8], [0.95, 0.95, 0.95], [0.55, 0.4, 0.8], [0.2, 0.3, 0.45]];
export const PANTS_COLORS = [[0.2, 0.25, 0.4], [0.35, 0.3, 0.25], [0.15, 0.15, 0.18], [0.5, 0.45, 0.4], [0.3, 0.4, 0.6]];
