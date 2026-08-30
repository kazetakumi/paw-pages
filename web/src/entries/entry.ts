/** Calendar arithmetic for the date shortcuts, done on the y-m-d string.
 *
 *  Nothing here ever parses a date the API gave us — a received date is only
 *  ever formatted. These build a *new* date from one the handler picked, and
 *  they work in UTC so no timezone can move the answer a day either way.
 */

const pad = (n: number) => String(n).padStart(2, "0");

const iso = (date: Date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

/** The handler's own calendar day, read from their clock, not from UTC. */
export function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function shiftDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return iso(new Date(Date.UTC(year!, month! - 1, day! + days)));
}

export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const moved = new Date(Date.UTC(year!, month! - 1 + months, day!));
  // 31 January plus a month has no 31st to land on. The last day of the month
  // the vet meant is the answer, not a date in the one after it.
  if (moved.getUTCDate() !== day) moved.setUTCDate(0);
  return iso(moved);
}

/** The intervals a vet states, as drawn. */
export const INTERVALS: { label: string; months: number }[] = [
  { label: "+1 mo", months: 1 },
  { label: "+3 mo", months: 3 },
  { label: "+6 mo", months: 6 },
  { label: "+1 yr", months: 12 },
  { label: "+3 yr", months: 36 },
];
