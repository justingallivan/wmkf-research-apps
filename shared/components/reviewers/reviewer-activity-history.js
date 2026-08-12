/**
 * Reviewer activity history — Phase 1, derived from current record state.
 *
 * Every event here is computed at read time from lifecycle stamps already on the
 * reviewer suggestion. Nothing is materialized and nothing is backfilled: re-added
 * reviewers have had their stamps cleared by `ENGAGEMENT_STAMP_RESET_ENTRIES`
 * (`lib/dataverse/adapters/reviewer-suggestion.js`), so this history describes the
 * CURRENT engagement only and cannot reconstruct prior ones. See
 * `outputs/reviewer-activity-history-opus-review-2026-08-11.md` findings 3 and 11.
 *
 * Evidence tiers (finding 4). Several staff-side stamps are claimed BEFORE dispatch
 * and are not rolled back when the send fails — `reviewer-reminder-sweep.js:261-317`
 * and `reviewer-thankyou-sweep.js:86-139` claim-then-send, and invitation dispatch
 * can finish `unconfirmed` (`send-emails-service.js:747-800`). Those events are
 * therefore labeled "recorded" and carry `deliveryProven: false`; the wording must
 * never assert that mail reached the reviewer. Reviewer-originated events (portal
 * access, response, review receipt) and staff status writes are proof of the thing
 * they name, and carry `deliveryProven: true`.
 *
 * DELIBERATE EXCLUSIONS — do not add these back without addressing the reason:
 *
 * - Deadline extensions. `wmkf_reviewduedateoverride` is a DateOnly holding the new
 *   deadline, not a stamp of when it was granted, so an extension has no position on
 *   a timeline at all. Surfacing it needs Phase 2, not a sort change.
 * - COI and AI-use acknowledgements (`wmkf_coiackedat`, `wmkf_aiuseackedat`). They
 *   have real writers (`reviewer-suggestion.js:1755-1756`) but are NOT members of
 *   `ENGAGEMENT_STAMP_RESET_ENTRIES`, unlike every stamp below. They therefore
 *   survive a remove/re-add, and showing one inside the current engagement's
 *   timeline would assert an acknowledgement that may belong to a prior engagement —
 *   precisely the false-confidence history finding 11 rules out. They stay visible
 *   wherever they are shown today; they just cannot join a timeline that claims to
 *   be engagement-scoped.
 * - "Placed on hold" (`wmkf_heldat`). The column is registered and read, but nothing
 *   in the repository ever writes a value to it — `reviewer-suggestion.js:1957` only
 *   ever nulls it. An event derived from it could never fire.
 *
 * Every field used below IS in `ENGAGEMENT_STAMP_RESET_ENTRIES`, which is what makes
 * the drawer's "current engagement only" wording literally true rather than aspirational.
 *
 * Actor identity is absent by construction — the reviewer DTO carries no acting-user
 * field. Attribution would mean reading Dataverse field audit (finding 7/10).
 */

/**
 * Event descriptors in lifecycle order. `order` breaks ties when two stamps share a
 * timestamp (bulk writes commonly do), so the display order stays stable and sensible
 * rather than depending on object key order.
 */
export const EVENT_DESCRIPTORS = [
  {
    key: 'invited',
    field: 'emailSentAt',
    rawField: 'wmkf_emailsentat',
    label: 'Invitation recorded',
    deliveryProven: false,
    order: 10,
  },
  {
    key: 'respond_reminder',
    field: 'respondReminderSentAt',
    rawField: 'wmkf_respondremindersentat',
    label: 'Response reminder recorded',
    deliveryProven: false,
    order: 20,
  },
  {
    key: 'portal_first_accessed',
    field: 'proposalFirstAccessedAt',
    rawField: 'wmkf_proposalfirstaccessed',
    label: 'Portal first accessed',
    deliveryProven: true,
    order: 30,
  },
  {
    key: 'response_received',
    field: 'responseReceivedAt',
    rawField: 'wmkf_responsereceivedat',
    label: 'Response received',
    deliveryProven: true,
    order: 40,
  },
  {
    key: 'materials_sent',
    field: 'materialsSentAt',
    rawField: 'wmkf_materialssentat',
    label: 'Materials recorded',
    deliveryProven: false,
    order: 70,
  },
  {
    key: 'review_reminder',
    field: 'reminderSentAt',
    rawField: 'wmkf_remindersentat',
    label: 'Review reminder recorded',
    deliveryProven: false,
    order: 80,
  },
  {
    key: 'review_received',
    field: 'reviewReceivedAt',
    rawField: 'wmkf_reviewreceivedat',
    label: 'Review received',
    deliveryProven: true,
    order: 90,
  },
  {
    key: 'thankyou',
    field: 'thankyouSentAt',
    rawField: 'wmkf_thankyousentat',
    label: 'Thank-you recorded',
    deliveryProven: false,
    order: 100,
  },
  {
    key: 'withdrawn_sufficient',
    field: 'withdrawnSufficientAt',
    rawField: 'wmkf_withdrawnsufficientat',
    label: 'Withdrawn — sufficient reviews received',
    deliveryProven: true,
    order: 120,
  },
  {
    key: 'completed',
    field: 'completedAt',
    rawField: 'wmkf_completedat',
    label: 'Engagement completed',
    deliveryProven: true,
    order: 130,
  },
];

/** Timestamps that survive a failed send get this caveat in the drawer. */
export const UNPROVEN_DELIVERY_NOTE = 'Recorded in the record; delivery not confirmed.';

function parseTime(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Build the ordered activity history for one reviewer row.
 *
 * Returns newest-first, which is the order the drawer reads in. Unparseable and
 * absent stamps are both dropped — a malformed date is not evidence of an event.
 *
 * @param {object} reviewer - a reviewer DTO row from `reviewers-service.js`
 * @returns {Array<{key, label, at, timestamp, deliveryProven, detail}>}
 */
export function buildActivityHistory(reviewer) {
  if (!reviewer) return [];

  const events = [];
  for (const descriptor of EVENT_DESCRIPTORS) {
    const raw = reviewer[descriptor.field];
    const timestamp = parseTime(raw);
    if (timestamp === null) continue;

    events.push({
      key: descriptor.key,
      label: descriptor.label,
      at: raw,
      timestamp,
      deliveryProven: descriptor.deliveryProven,
      order: descriptor.order,
      detail: buildDetail(descriptor.key, reviewer),
    });
  }

  // Newest first; ties fall back to reverse lifecycle order so the later-stage
  // event of an identical-timestamp pair still reads as the more recent one.
  events.sort((a, b) => (b.timestamp - a.timestamp) || (b.order - a.order));
  return events;
}

/**
 * Supplementary text for events that carry a count or a typed outcome. Kept out of
 * `label` so the label stays a stable, testable constant.
 */
function buildDetail(key, reviewer) {
  if (key === 'review_reminder' && reviewer.reminderCount > 0) {
    const count = reviewer.reminderCount;
    return `${count} reminder${count === 1 ? '' : 's'} recorded in total`;
  }
  if (key === 'response_received' && reviewer.responseType) {
    return `Response: ${reviewer.responseType}`;
  }
  return null;
}

/**
 * The single most recent event, or null when the row has no stamps at all.
 *
 * This is TRUE RECENCY (owner decision, 2026-08-12), replacing the fixed-precedence
 * fallback `thankyouSentAt || reviewReceivedAt || reminderSentAt || materialsSentAt`
 * that previously fed the Last Action column. That old expression returned whichever
 * stamp ranked highest, not the newest, so a months-old thank-you masked a reminder
 * sent yesterday (finding 12).
 */
export function latestActivity(events) {
  if (!Array.isArray(events) || events.length === 0) return null;
  return events[0];
}
