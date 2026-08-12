/**
 * All day values in Bullets are 'YYYY-MM-DD' strings in local time.
 * Never pass a Date across a module boundary — that is how timezone bugs get in.
 */
export type Day = string;

export function toDay(d: Date): Day {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromDay(day: Day): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today(): Day {
  return toDay(new Date());
}

export function addDays(day: Day, n: number): Day {
  const d = fromDay(day);
  d.setDate(d.getDate() + n);
  return toDay(d);
}

/** Monday-based. Sunday belongs to the week that began six days earlier. */
export function weekStart(day: Day): Day {
  const dow = fromDay(day).getDay(); // 0 = Sunday
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

export function weekDays(day: Day): Day[] {
  const start = weekStart(day);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function daysUntil(from: Day, to: Day): number {
  // Round rather than floor so DST transitions don't shift the count.
  return Math.round((fromDay(to).getTime() - fromDay(from).getTime()) / 86_400_000);
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function weekdayName(day: Day): string {
  return WEEKDAY[fromDay(day).getDay()];
}

export function shortDate(day: Day): string {
  const d = fromDay(day);
  return `${MONTH[d.getMonth()]} ${d.getDate()}`;
}

/** Human phrasing for a day relative to today — 'Today', 'Tomorrow', 'Wed Aug 19'. */
export function relativeDay(day: Day, from: Day = today()): string {
  const delta = daysUntil(from, day);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  if (delta > 1 && delta < 7) return weekdayName(day);
  return `${weekdayName(day)} ${shortDate(day)}`;
}

export function timeOfDay(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}
