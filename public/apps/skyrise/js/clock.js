// The uneven clock (spec 3.2). One day = 2600 ticks, tick 0 = 07:00.
export const DAY_TICKS = 2600;
export const MIDNIGHT_TICK = 2300;
// slot boundaries in ticks and the matching minutes after 07:00
const TB = [0, 400, 800, 1200, 1600, 2000, 2400, 2600];
const MB = [0, 300, 330, 360, 600, 840, 1080, 1440];

// minutes after 07:00 (0..1440) for a day tick
export function tickToMin(t) {
  for (let i = 0; i < 7; i++) {
    if (t < TB[i + 1]) return MB[i] + (t - TB[i]) * (MB[i + 1] - MB[i]) / (TB[i + 1] - TB[i]);
  }
  return 1440;
}
// day tick for minutes after 07:00
export function minToTick(m) {
  m = Math.max(0, Math.min(1440, m));
  for (let i = 0; i < 7; i++) {
    if (m < MB[i + 1]) return TB[i] + (m - MB[i]) * (TB[i + 1] - TB[i]) / (MB[i + 1] - MB[i]);
  }
  return 2600;
}
// clock "HH:MM" (24h, absolute) -> day tick. Hours before 07:00 are on the following night.
export function clockToTick(h, mm = 0) {
  let m = h * 60 + mm - 420;
  if (m < 0) m += 1440;
  return Math.round(minToTick(m));
}
// absolute clock minutes (0..1439, midnight = 0) for a day tick
export function clockMinutes(t) {
  return (tickToMin(t) + 420) % 1440;
}
export function clockString(t) {
  const m = Math.floor(clockMinutes(t));
  const h = Math.floor(m / 60), mi = m % 60;
  return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
}
// game seconds per tick in the slot containing t
export function slotOf(t) {
  for (let i = 0; i < 7; i++) if (t < TB[i + 1]) return i;
  return 6;
}
// the 6 user-visible elevator periods (slot 7 folded into 6)
export function periodOf(t) { return Math.min(5, slotOf(t)); }
export const PERIOD_NAMES = ['Morning', 'Lunch (early)', 'Lunch (late)', 'Afternoon', 'Evening', 'Night'];

// absolute tick helpers. Absolute tick a: schedule day = floor(a/2600), dayTick = a % 2600.
// The date (WD1/WD2/WE...) advances at midnight (dayTick 2300).
export function dateDay(a) { return Math.floor((a + 300) / DAY_TICKS) - 1; }
export function dayTick(a) { return ((a % DAY_TICKS) + DAY_TICKS) % DAY_TICKS; }
export function dayType(a) { return ((dateDay(a) % 3) + 3) % 3; } // 0 WD1, 1 WD2, 2 WE
export function quarterOf(a) { return Math.floor(dateDay(a) / 3) % 4 + 1; }
export function yearOf(a) { return Math.floor(dateDay(a) / 12) + 1; }
export const START_TICK = MIDNIGHT_TICK; // a new game starts at midnight before WD1 Q1 Y1

// absolute tick of the next occurrence of day tick dt at or after a
export function nextAt(a, dt) {
  const base = a - dayTick(a);
  let r = base + dt;
  if (r < a) r += DAY_TICKS;
  return r;
}
// add game minutes of absolute time to absolute tick a (not stretched by the slow lunch)
export function addMinutes(a, minutes) {
  const dt = dayTick(a);
  const m = tickToMin(dt) + minutes;
  const days = Math.floor(m / 1440);
  const rem = m - days * 1440;
  return a - dt + days * DAY_TICKS + Math.max(Math.ceil(minToTick(rem)), 0);
}
