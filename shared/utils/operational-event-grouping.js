/**
 * View-level grouping for the admin Operational Events card.
 *
 * Vercel Log Drain rows are keyed `vercel:<log id>` so redelivery stays
 * idempotent — which means a repeating failure lands as N rows, not one row
 * with a count (the 2026-08-27 Graph throttle storm was 86 rows for one
 * message). Folding those rows in STORAGE would trade away that exact-id
 * idempotency; folding them in the VIEW does not. This module derives a
 * signature per row and groups rows that share one, so the card can show
 * "message × N" with a single Resolve-group action while every stored row
 * keeps its own identity and freshness precondition.
 *
 * Pure functions, no I/O; exported for the card and its tests.
 */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONG_HEX_RE = /\b[0-9a-f]{8,}\b/gi;
const DIGITS_RE = /\d+/g;
const WS_RE = /\s+/g;
const SIGNATURE_SUMMARY_CHARS = 160;

/**
 * Normalize a summary so rows that differ only in ids, counters, durations,
 * or trace ids share a signature. Deliberately coarse: grouping is a reading
 * aid, and every row is still resolved with its own precondition.
 */
export function normalizeSummary(summary) {
  return String(summary || '')
    .replace(UUID_RE, '<uuid>')
    .replace(LONG_HEX_RE, '<hex>')
    .replace(DIGITS_RE, '#')
    .replace(WS_RE, ' ')
    .trim()
    .slice(0, SIGNATURE_SUMMARY_CHARS);
}

/** Signature: same source, environment, type, subsystem, and normalized summary. */
export function eventSignature(event) {
  return [
    event?.source || '',
    event?.environment || '',
    event?.event_type || '',
    event?.subsystem || '',
    normalizeSummary(event?.summary),
  ].join('|');
}

/**
 * Group rows by signature, preserving the list's order of first appearance
 * (the API returns newest first, so a group sits where its newest row was).
 *
 * @param {Array<Object>} events
 * @returns {Array<{key:string, events:Object[], newest:Object, oldest:Object, openEvents:Object[]}>}
 */
export function groupOperationalEvents(events) {
  const byKey = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    const key = eventSignature(event);
    let group = byKey.get(key);
    if (!group) {
      group = { key, events: [], newest: event, oldest: event, openEvents: [] };
      byKey.set(key, group);
    }
    group.events.push(event);
    if (String(event.last_occurred_at || '') > String(group.newest.last_occurred_at || '')) group.newest = event;
    if (String(event.first_occurred_at || event.last_occurred_at || '') < String(group.oldest.first_occurred_at || group.oldest.last_occurred_at || '')) group.oldest = event;
    if (event.status === 'open') group.openEvents.push(event);
  }
  return [...byKey.values()];
}
