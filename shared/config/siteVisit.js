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

export function isSiteVisitFormat(value) {
  return Object.values(SITE_VISIT_FORMAT).includes(Number(value));
}
