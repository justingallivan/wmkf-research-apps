/**
 * Shared closed contract for personalized scheduled-email preference values.
 * Review lead days open the intervention window earlier; they never move the
 * underlying workflow's scheduled send time.
 */

export const EMAIL_AUTOMATION_MODE = Object.freeze({
  AUTOMATIC: 'automatic',
  REVIEW: 'review',
});

export const MIN_REVIEW_LEAD_DAYS = 1;
export const MAX_REVIEW_LEAD_DAYS = 14;
export const SUGGESTED_REVIEW_LEAD_DAYS = 3;

export function normalizeEmailAutomationPreference(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  if (parsed.mode === EMAIL_AUTOMATION_MODE.AUTOMATIC) {
    return { mode: EMAIL_AUTOMATION_MODE.AUTOMATIC };
  }
  if (parsed.mode !== EMAIL_AUTOMATION_MODE.REVIEW) return null;

  const leadDays = Number(parsed.leadDays);
  if (!Number.isInteger(leadDays)
      || leadDays < MIN_REVIEW_LEAD_DAYS
      || leadDays > MAX_REVIEW_LEAD_DAYS) {
    return null;
  }
  return { mode: EMAIL_AUTOMATION_MODE.REVIEW, leadDays };
}

export function serializeEmailAutomationPreference(value) {
  const normalized = normalizeEmailAutomationPreference(value);
  if (!normalized) throw new TypeError('Invalid email automation preference');
  return JSON.stringify(normalized);
}

export function calculateReviewAvailableAt(scheduledSendAt, preference) {
  const normalized = normalizeEmailAutomationPreference(preference);
  const sendAt = scheduledSendAt instanceof Date
    ? new Date(scheduledSendAt.getTime())
    : new Date(scheduledSendAt);
  if (Number.isNaN(sendAt.getTime())) throw new TypeError('scheduledSendAt must be a valid date');
  if (!normalized || normalized.mode === EMAIL_AUTOMATION_MODE.AUTOMATIC) {
    return sendAt;
  }
  return new Date(sendAt.getTime() - normalized.leadDays * 24 * 60 * 60 * 1000);
}
