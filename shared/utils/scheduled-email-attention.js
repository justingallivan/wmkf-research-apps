/**
 * The ONLY display/guard test for scheduled-email rows that need a person
 * (docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md A2/A3). Every
 * reader — digest grouping, the scheduled-emails page, the edit/approve/
 * send-now route guards and the cron passes — decides through these helpers,
 * so the vocabulary lives in one place. Accepts a raw ledger row
 * (`last_error_code`) or a projected message (`lastErrorCode`).
 *
 * This is display/guard state only. The transport guard is the independent
 * `send_requested_at IS NULL` predicate in the store's claim SQL, so a missing
 * or temporarily cleared marker can never permit a resend.
 */

export const SCHEDULED_EMAIL_ATTENTION = Object.freeze({
  UNCONFIRMED: 'unconfirmed',
  ACTIVITY_MISSING: 'activity_missing',
  ACTIVITY_FORBIDDEN: 'activity_forbidden',
});

const CODE_TO_REASON = Object.freeze({
  scheduled_email_send_unconfirmed: SCHEDULED_EMAIL_ATTENTION.UNCONFIRMED,
  scheduled_email_activity_missing: SCHEDULED_EMAIL_ATTENTION.ACTIVITY_MISSING,
  scheduled_email_activity_forbidden: SCHEDULED_EMAIL_ATTENTION.ACTIVITY_FORBIDDEN,
});

export const SCHEDULED_EMAIL_ATTENTION_COPY = Object.freeze({
  [SCHEDULED_EMAIL_ATTENTION.UNCONFIRMED]:
    'Send status is uncertain. Check the email history before trying again.',
  [SCHEDULED_EMAIL_ATTENTION.ACTIVITY_MISSING]:
    'The Dynamics email for this message could not be found. Check Dynamics and the email history, send by hand if needed, then stop this message.',
  [SCHEDULED_EMAIL_ATTENTION.ACTIVITY_FORBIDDEN]:
    'The Dynamics email for this message could not be read (access denied). It is checked again each day; check Dynamics if this persists.',
});

function errorCode(row) {
  if (!row) return null;
  const code = row.last_error_code ?? row.lastErrorCode ?? null;
  return typeof code === 'string' && code ? code : null;
}

/** A2: a send was requested and Dynamics has not confirmed acceptance. */
export function isSendUnconfirmed(row) {
  return errorCode(row) === 'scheduled_email_send_unconfirmed';
}

/**
 * A3: `unconfirmed` (via isSendUnconfirmed), `activity_missing`,
 * `activity_forbidden`, or null when the row needs no attention.
 */
export function scheduledEmailAttentionReason(row) {
  if (isSendUnconfirmed(row)) return SCHEDULED_EMAIL_ATTENTION.UNCONFIRMED;
  return CODE_TO_REASON[errorCode(row)] || null;
}

/** Row-level actions a PD may still take: only Stop remains on attention rows. */
export function scheduledEmailActionsAllowed(row) {
  const reason = scheduledEmailAttentionReason(row);
  const hasActivity = Boolean(row?.dynamics_email_id ?? row?.hasActivity);
  const sendRequested = Boolean(row?.send_requested_at ?? row?.sendRequestedAt);
  const status = row?.status;
  const openStatus = status === 'scheduled' || status === 'failed';
  return {
    reason,
    // A4: no edits or approval once the Dynamics activity exists.
    edit: openStatus && !reason && !hasActivity && !sendRequested,
    approve: openStatus && !reason && !hasActivity && !sendRequested,
    sendNow: openStatus && !reason && !sendRequested,
    stop: openStatus,
  };
}
