/**
 * Grant cycle code helpers.
 *
 * The Foundation's board meets twice a year — June and December. The specific
 * day shifts cycle to cycle but the month is fixed. Cycle code derives from
 * the meeting date: June → `J{YY}`, December → `D{YY}` (e.g., a meeting on
 * 2026-06-04 → `J26`).
 *
 * Months other than June/December map to `null`. Callers should treat any
 * proposal with a meeting date outside those months as not having a cycle.
 */

const JUNE = 6;
const DECEMBER = 12;

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Convert a Meeting Date (Date or ISO string) to a cycle code.
 * @returns {string|null} e.g. 'J26', 'D26', or null if the month isn't June/December
 */
export function meetingDateToCycleCode(meetingDate) {
  if (!meetingDate) return null;
  const d = meetingDate instanceof Date ? meetingDate : new Date(meetingDate);
  if (Number.isNaN(d.getTime())) return null;
  const month = d.getUTCMonth() + 1;
  const yy = d.getUTCFullYear() % 100;
  if (month === JUNE) return `J${pad2(yy)}`;
  if (month === DECEMBER) return `D${pad2(yy)}`;
  return null;
}

/**
 * Parse a cycle code into its components.
 * @returns {{ month: 6|12, year: number }|null}
 */
export function parseCycleCode(code) {
  if (!code || typeof code !== 'string') return null;
  const m = code.trim().toUpperCase().match(/^([JD])(\d{2})$/);
  if (!m) return null;
  const month = m[1] === 'J' ? JUNE : DECEMBER;
  const yy = parseInt(m[2], 10);
  // 2-digit year: assume current century. Foundation founded 2024, so anything 00-99 lands in 2000s.
  const year = 2000 + yy;
  return { month, year };
}

/**
 * Build OData $filter range fragment for a cycle code's meeting-date window.
 * Uses an exclusive upper bound to be safe across timezones.
 *
 * @param {string} code - cycle code like 'J26' / 'D26'
 * @param {string} field - field name to filter on (default 'wmkf_meetingdate')
 * @returns {string|null} fragment like
 *   "wmkf_meetingdate ge 2026-06-01T00:00:00Z and wmkf_meetingdate lt 2026-07-01T00:00:00Z"
 */
/**
 * Render a cycle code as a display label.
 * J26 → "June 2026", D26 → "December 2026". Returns null for invalid input.
 */
export function cycleCodeToLabel(code) {
  const parsed = parseCycleCode(code);
  if (!parsed) return null;
  const monthName = parsed.month === JUNE ? 'June' : 'December';
  return `${monthName} ${parsed.year}`;
}

export function cycleCodeToOdataFilter(code, field = 'wmkf_meetingdate') {
  const parsed = parseCycleCode(code);
  if (!parsed) return null;
  const { month, year } = parsed;
  const start = `${year}-${pad2(month)}-01T00:00:00Z`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = `${nextYear}-${pad2(nextMonth)}-01T00:00:00Z`;
  return `${field} ge ${start} and ${field} lt ${end}`;
}

// ---------------------------------------------------------------------------
// Default-cycle resolution (owner decision 2026-09-08, Session 499).
//
// Which cycle a surface opens on is a pure function of the calendar and the
// cycles that exist — never of who is signed in and never of what happens to
// be visible. Two questions have distinct answers:
//   - the WORKING cycle: the earliest cycle whose meeting is on or after today
//     (in September that is the December meeting); falls back to the newest
//     cycle once every listed meeting has passed;
//   - the LAST DECIDED cycle: the newest cycle whose meeting is before today
//     (in September that is the June meeting); null when none has passed.
// `cycles` is a list of codes or `{ code, meetingDate? }` objects. With a
// meeting date the comparison is against that exact UTC day; without one it is
// against the cycle's month. All calendar math is UTC so a client and a server
// agree. An unparseable code throws: the standing rule is fail loud, never
// silently drop an unclassifiable cycle.
// ---------------------------------------------------------------------------

function utcDayStart(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function normalizeCycles(cycles) {
  return (Array.isArray(cycles) ? cycles : []).map((entry) => {
    const code = typeof entry === 'string' ? entry : entry?.code;
    const parsed = parseCycleCode(code);
    if (!parsed) throw new Error(`Unclassifiable cycle code "${code}" in default-cycle resolution`);
    const meetingDay = typeof entry === 'object' && entry?.meetingDate ? utcDayStart(entry.meetingDate) : null;
    return {
      code: code.trim().toUpperCase(),
      order: parsed.year * 100 + parsed.month,
      // Month-granularity anchors when no exact meeting date is known.
      monthStart: Date.UTC(parsed.year, parsed.month - 1, 1),
      monthEnd: Date.UTC(parsed.month === 12 ? parsed.year + 1 : parsed.year, parsed.month === 12 ? 0 : parsed.month, 1),
      meetingDay,
    };
  }).sort((a, b) => a.order - b.order);
}

export function resolveWorkingCycle(cycles, today = new Date()) {
  const list = normalizeCycles(cycles);
  if (!list.length) return null;
  const day = utcDayStart(today);
  const upcoming = list.find((c) => (c.meetingDay != null ? c.meetingDay >= day : c.monthEnd > day));
  return (upcoming || list[list.length - 1]).code;
}

export function resolveLastDecidedCycle(cycles, today = new Date()) {
  const list = normalizeCycles(cycles);
  const day = utcDayStart(today);
  const past = list.filter((c) => (c.meetingDay != null ? c.meetingDay < day : c.monthEnd <= day));
  return past.length ? past[past.length - 1].code : null;
}

/**
 * The June/December convention around `today`, for callers that have no cycle
 * list to hand (a cron, a page before its first fetch). Six codes, ascending,
 * from the previous year's June to next year's December.
 */
export function conventionalCycles(today = new Date()) {
  const year = (today instanceof Date ? today : new Date(today)).getUTCFullYear();
  const codes = [];
  for (const y of [year - 1, year, year + 1]) codes.push(`J${pad2(y % 100)}`, `D${pad2(y % 100)}`);
  return codes;
}
