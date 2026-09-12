/**
 * Business-day arithmetic in a named IANA zone (weekends only; no holiday
 * calendar). First use: the applicant materials due date, two business days
 * before the site visit starts (docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md M2).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return { weekday: get('weekday'), year: get('year'), month: get('month'), day: get('day') };
}

export function isWeekendInZone(date, timeZone) {
  const { weekday } = zonedParts(date, timeZone);
  return weekday === 'Sat' || weekday === 'Sun';
}

/**
 * Move `businessDays` weekdays back from `date`, keeping the wall-clock time,
 * evaluated in `timeZone`. Weekend days are skipped and never counted.
 * Invalid input returns null rather than throwing so callers can fail open.
 */
export function subtractBusinessDays(date, businessDays, timeZone) {
  const start = new Date(date);
  const count = Number(businessDays);
  if (Number.isNaN(start.getTime()) || !Number.isInteger(count) || count < 0) return null;
  let zone = timeZone || 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); } catch { zone = 'UTC'; }
  let cursor = start;
  let remaining = count;
  while (remaining > 0) {
    cursor = new Date(cursor.getTime() - DAY_MS);
    if (!isWeekendInZone(cursor, zone)) remaining -= 1;
  }
  return cursor;
}

/** Calendar date (YYYY-MM-DD) of an instant in a zone, for display and comparisons. */
export function zonedDateKey(date, timeZone) {
  const { year, month, day } = zonedParts(new Date(date), timeZone || 'UTC');
  return `${year}-${month}-${day}`;
}
