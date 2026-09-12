/**
 * One deterministic rule for "the" active site visit of a request
 * (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md §2.2). `findActiveByRequest` can
 * return up to three active activities in no defined order; the briefing
 * link's expiry and the page's visit line must not depend on which one
 * Dataverse listed first. Rule [ASSUMED, owner may adjust]: the earliest
 * scheduled end wins, so the expiry window is the narrowest; rows without an
 * end sort last; ties break on activity id.
 */
export function selectActiveSiteVisit(records) {
  const rows = Array.isArray(records) ? records.filter(Boolean) : [];
  if (rows.length === 0) return null;
  const endOf = (row) => {
    const value = row.scheduledend || row.scheduledstart || null;
    const time = value ? new Date(value).getTime() : NaN;
    return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
  };
  return [...rows].sort((a, b) => (
    endOf(a) - endOf(b)
    || String(a.activityid || '').localeCompare(String(b.activityid || ''))
  ))[0];
}
