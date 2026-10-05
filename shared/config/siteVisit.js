/** Shared Site Visit logistics values used by schema, services, routes, and UI. */

export const SITE_VISIT_FORMAT = Object.freeze({
  IN_PERSON: 100000000,
  VIRTUAL: 100000001,
  HYBRID: 100000002,
});

export const SITE_VISIT_FORMAT_LABEL = Object.freeze({
  [SITE_VISIT_FORMAT.IN_PERSON]: 'In person',
  [SITE_VISIT_FORMAT.VIRTUAL]: 'Virtual',
  [SITE_VISIT_FORMAT.HYBRID]: 'Hybrid',
});

export const SITE_VISIT_ACTIVE_STATE_CODES = Object.freeze([0, 3]);

/**
 * Site Visit state/status pairs are target-specific Activity semantics. Keep
 * scheduled-end automation fail-closed until deployment evidence supplies an
 * exhaustive JSON classification, e.g. [[0, 3, true], [2, 3, false]]. The
 * boolean says whether that exact pair represents a non-cancelled event.
 */
export function readScheduledPreparationStateStatusPairs(value = process.env.STAFF_DELIBERATIONS_SITE_VISIT_STATE_STATUS_PAIRS) {
  if (!value) return [];
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set();
  const pairs = [];
  for (const entry of parsed) {
    if (!Array.isArray(entry) || entry.length !== 3
      || !Number.isInteger(Number(entry[0])) || !Number.isInteger(Number(entry[1]))
      || typeof entry[2] !== 'boolean') continue;
    const normalized = [Number(entry[0]), Number(entry[1]), entry[2]];
    const key = normalized.slice(0, 2).join(':');
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ stateCode: normalized[0], statusCode: normalized[1], eligible: normalized[2] });
  }
  return pairs;
}

export const SITE_VISIT_PARTICIPATION_MASK = Object.freeze({
  REQUIRED: 5,
  OPTIONAL: 6,
  ORGANIZER: 7,
});

export const SITE_VISIT_LIMITS = Object.freeze({
  subject: 400,
  description: 2000,
  timeZone: 100,
  locationOrLink: 2000,
  attendeeRefsJson: 32000,
  attendeesPerRole: 100,
});

const SITE_VISIT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeSiteVisitEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email && email.length <= 320 && SITE_VISIT_EMAIL_RE.test(email) ? email : null;
}

export function isSiteVisitFormat(value) {
  return Object.values(SITE_VISIT_FORMAT).includes(Number(value));
}
