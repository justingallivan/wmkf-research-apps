/**
 * Cycle calendar: the operations Grant Cycle (`wmkf_grantcycle`) date columns
 * the apps may show and edit (alignment log D43;
 * docs/plans/CYCLE_CALENDAR_DATAVERSE_PLAN_2026-10-28.md).
 *
 * `CYCLE_CALENDAR_DATE_COLUMNS` is the write allowlist: the save path rejects
 * any other column. Labels are the Dataverse display names verified by
 * scripts/probe-grant-cycle-dates.cjs (2026-10-28). The Board Meeting Date is
 * shown read-only; editing it is an open question in the plan.
 */

export const CYCLE_CALENDAR_DATE_COLUMNS = Object.freeze([
  { column: 'wmkf_researchproposalduedate', label: 'Proposal Due' },
  { column: 'wmkf_researchleadershipsemifinalistemaildate', label: 'Leadership Semi-Finalist Email Date' },
  { column: 'wmkf_researchleadershipsemifinalistmeetingdate', label: 'Leadership Semi-Finalist Meeting Date' },
  { column: 'wmkf_researchchairssemifinalistemaildate', label: "Chairs' Semi-Finalist Email Date" },
  { column: 'wmkf_researchchairssemifinalistmeetingdate', label: 'Chairs Semi-Finalist Meeting Date' },
  { column: 'wmkf_researchreviewsduedate', label: 'Reviews Due Date' },
  { column: 'wmkf_researchofframpmeetingdate', label: 'Offramp Meeting Date' },
  { column: 'wmkf_researchleadershipfinalistemaildate', label: 'Leadership Finalist Email Date' },
  { column: 'wmkf_researchchairsfinalistemaildate', label: "Chairs' Finalist Email Date" },
  { column: 'wmkf_researchbudgetduedate', label: 'Budget Due Date' },
  { column: 'wmkf_boardmailingdate', label: 'Board Mailing Date' },
]);

export const CYCLE_CALENDAR_BOARD_DATE = Object.freeze({ column: 'wmkf_meetingdate', label: 'Board Meeting Date' });

/**
 * What each app need reads from the calendar (owner, 2026-10-29; centralization
 * plan §5). Add a meaning only together with the feature that reads it.
 */
export const CYCLE_CALENDAR_MEANINGS = Object.freeze({
  reviewsDue: 'wmkf_researchreviewsduedate',
});

export const CYCLE_CALENDAR_EDITABLE = Object.freeze(new Set(CYCLE_CALENDAR_DATE_COLUMNS.map(({ column }) => column)));

/** Modern cycle codes only; the table also holds historical March/September and four-digit-year codes. */
export const CYCLE_CODE_PATTERN = /^[JD]\d{2}$/;

/** A DateOnly value as `YYYY-MM-DD`; Dataverse returns `YYYY-MM-DDT00:00:00Z`. Never convert time zones. */
export function dateOnly(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.0+)?Z)?$/);
  return match ? match[1] : null;
}
