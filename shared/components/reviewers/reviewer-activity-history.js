/**
 * Reviewer activity history — Phase 1, derived from current record state.
 *
 * Every event here is computed at read time from lifecycle stamps already on the
 * reviewer suggestion. Nothing is materialized and nothing is backfilled: re-added
 * reviewers have had those stamps cleared by `ENGAGEMENT_STAMP_RESET_ENTRIES`
 * (`lib/dataverse/adapters/reviewer-suggestion.js`). This is an operational summary
 * of the current row, not an audit log, and it cannot reconstruct overwritten or
 * prior transitions. See
 * `outputs/reviewer-activity-history-opus-review-2026-08-11.md` findings 3 and 11.
 *
 * Evidence tiers (finding 4). Several staff-side stamps are claimed BEFORE dispatch
 * and are not rolled back when the send fails — `reviewer-reminder-sweep.js:261-317`
 * and `reviewer-thankyou-sweep.js:86-139` claim-then-send, and invitation dispatch
 * can finish `unconfirmed` (`send-emails-service.js:747-800`). Those events are
 * therefore labeled "recorded" and carry `deliveryProven: false`; the wording must
 * never assert that mail reached the reviewer. Reviewer-originated portal access is
 * proof of the thing it names. Response stamps are classified from the current
 * response type. Receipt provenance stays neutral because the supporting filename,
 * answer rows, and staff-upload flag are not engagement-scoped.
 *
 * Review receipt is the exception and is decided per row — see `isSyntheticReceipt`.
 * A staff close-out fabricates `wmkf_reviewreceivedat`, so the bare stamp proves only
 * that a receipt was recorded. It does not prove who submitted a review or through
 * which path (Codex adversarial review, 2026-08-12).
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
 * Every event timestamp used below IS in `ENGAGEMENT_STAMP_RESET_ENTRIES`. Auxiliary
 * fields that survive reset must never be used to strengthen an event's provenance.
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
    label: 'Reviewer response received',
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
    label: 'Review receipt recorded',
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

/** Shown instead when the receipt stamp was fabricated by a close-out. */
export const SYNTHETIC_RECEIPT_NOTE = 'Recorded by close-out; no submitted review on record.';

const RESPONSE_EVENT_BY_TYPE = Object.freeze({
  accepted: {
    label: 'Reviewer accepted invitation',
    deliveryProven: true,
  },
  declined: {
    label: 'Reviewer declined invitation',
    deliveryProven: true,
  },
  no_response: {
    label: 'No response recorded at cycle close',
    deliveryProven: false,
    unprovenNote: 'Recorded by automated cycle close; no reviewer response on record.',
  },
  withdrawn_sufficient: {
    label: 'Withdrawn — sufficient reviews received',
    deliveryProven: true,
  },
});

const TERMINAL_STATUS_LABELS = Object.freeze({
  withdrew: 'Withdrew',
  released: 'Released',
});

/**
 * Does a dated timeline event already represent this terminal transition?
 *
 * `withdrew` does: `applyStaffReviewerWithdrawal` stamps `wmkf_responsereceivedat` in
 * the same write as the status (`reviewer-suggestion.js:1832-1842`), which surfaces as
 * the dated "Withdrawal recorded by staff" event. `released` does not: its writer sets
 * only status and token revocation (`terminal-transition-service.js:106-118`), so no
 * timestamp for it exists anywhere in the schema.
 *
 * This distinction is what the Last Action summary turns on. Letting the undated header
 * win for BOTH hides the withdrawal date staff triage on; letting dated activity win for
 * both puts a released reviewer's Last Action back on a stale old reminder, which is the
 * defect the undated header was introduced to fix.
 */
const TERMINAL_STATUS_HAS_DATED_EVENT = Object.freeze({
  withdrew: true,
  released: false,
});

/**
 * Did a staff close-out fabricate this row's review receipt?
 *
 * `updateLifecycle` stamps `wmkf_reviewreceivedat` with `now` on any transition to
 * `reviewStatus=complete` when the field is empty, in the SAME payload that stamps
 * `wmkf_completedat` with the same `now` (`reviewer-suggestion.js:1662-1670`). So a
 * PD closing out a reviewer who never submitted produces a receipt timestamp for a
 * review that does not exist. The adapter itself flags this hazard: its
 * `aggregateReviewHistory` header (line 341) states the engagement signal is when the
 * review was RECEIVED, "NOT the PD's closeout", and the S369 note at 1641-1646
 * records a past bug that re-created exactly this false positive.
 *
 * Identical instants are the only engagement-scoped signal available: both stamps
 * come from one `now` in one payload, so a fabricated pair matches exactly. A real
 * receipt closed out later differs. Filename, answer, and staff-upload fields cannot
 * override this test because they survive remove/re-add and may describe a prior
 * engagement.
 */
export function isSyntheticReceipt(reviewer) {
  if (!reviewer?.reviewReceivedAt || !reviewer?.completedAt) return false;

  const received = parseTime(reviewer.reviewReceivedAt);
  const completed = parseTime(reviewer.completedAt);
  return received !== null && received === completed;
}

export function responseEventEvidence(reviewer) {
  const responseType = reviewer?.responseType || null;
  const reviewStatus = reviewer?.reviewStatus || null;

  if (responseType === 'declined' && reviewStatus === 'withdrew') {
    return {
      label: 'Withdrawal recorded by staff',
      deliveryProven: true,
      // Not "Response: declined". The row's responseType IS `declined`, but that value
      // was written by applyStaffReviewerWithdrawal, not by the reviewer
      // (`reviewer-suggestion.js:1832-1842`). Echoing the raw enum under a
      // staff-recorded label re-introduces the ambiguity the label just removed.
      detail: 'Recorded as declined by a Program Director, not by the reviewer.',
    };
  }

  if (responseType && RESPONSE_EVENT_BY_TYPE[responseType]) {
    return {
      ...RESPONSE_EVENT_BY_TYPE[responseType],
      detail: `Response: ${responseType}`,
    };
  }

  return {
    label: 'Response timestamp recorded',
    deliveryProven: false,
    unprovenNote: 'Response type is missing; timestamp alone does not prove a reviewer response.',
    detail: null,
  };
}

export function reviewReceiptEvidence(reviewer) {
  if (isSyntheticReceipt(reviewer)) {
    return {
      label: 'Review recorded at close-out',
      deliveryProven: false,
      unprovenNote: SYNTHETIC_RECEIPT_NOTE,
    };
  }

  return null;
}

export function currentTerminalStatus(reviewer) {
  const label = TERMINAL_STATUS_LABELS[reviewer?.reviewStatus];
  if (!label) return null;

  return {
    key: `terminal_${reviewer.reviewStatus}`,
    label: `Current status: ${label}`,
    dated: false,
    detail: reviewer.reviewStatus === 'released'
      ? 'No lifecycle timestamp is recorded for this transition.'
      : null,
  };
}

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

    const responseEvidence = descriptor.key === 'response_received'
      ? responseEventEvidence(reviewer)
      : null;
    const receiptEvidence = descriptor.key === 'review_received'
      ? reviewReceiptEvidence(reviewer)
      : null;
    const evidence = responseEvidence || receiptEvidence;

    events.push({
      key: descriptor.key,
      label: evidence?.label || descriptor.label,
      at: raw,
      timestamp,
      deliveryProven: evidence ? evidence.deliveryProven : descriptor.deliveryProven,
      unprovenNote: evidence?.unprovenNote || UNPROVEN_DELIVERY_NOTE,
      order: descriptor.order,
      detail: evidence?.detail ?? buildDetail(descriptor.key, reviewer),
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

/**
 * What the Last Action column shows for one row.
 *
 * The undated terminal header wins ONLY when no dated event represents the transition
 * (i.e. `released`). A withdrawn row keeps its dated withdrawal event so staff can scan
 * WHEN the withdrawal was recorded without opening every drawer. Falls back to the
 * header if a terminal row somehow carries no dated activity at all.
 */
export function latestActivitySummary(reviewer) {
  const terminal = currentTerminalStatus(reviewer);
  if (terminal && !TERMINAL_STATUS_HAS_DATED_EVENT[reviewer?.reviewStatus]) return terminal;
  return latestActivity(buildActivityHistory(reviewer)) || terminal;
}
