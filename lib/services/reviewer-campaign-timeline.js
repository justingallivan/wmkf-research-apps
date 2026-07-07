/**
 * Reviewer campaign timeline defaults.
 *
 * Ground truth: Dataverse `wmkf_appsystemsettings`, key
 * `reviewer.campaign_timeline_defaults`.
 *
 * This is the cycle-level default used to pre-fill reviewer invitation timing.
 * Request-level campaign config (`akoya_request.wmkf_respondoffsetdays` and
 * `akoya_request.wmkf_reviewduedate`) still wins when present; this setting
 * removes stale per-user/manual entry as the first source of truth for a new
 * cycle.
 */

const { getSetting, setSetting } = require('./settings-service');

const REVIEWER_CAMPAIGN_TIMELINE_KEY = 'reviewer.campaign_timeline_defaults';

const DEFAULT_REVIEWER_CAMPAIGN_TIMELINE = Object.freeze({
  cycleLabel: '',
  inviteStartDate: '',
  respondOffsetDays: 7,
  proposalReleaseDate: '',
  reviewDueDate: '',
});

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().slice(0, 120) : '';
}

function isYmd(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function normalizeOptionalDate(value, fieldName) {
  if (value == null || value === '') return '';
  const trimmed = String(value).trim();
  if (!isYmd(trimmed)) throw new Error(`${fieldName} must be a YYYY-MM-DD date or blank`);
  return trimmed;
}

function normalizeOptionalOffset(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 0) {
    throw new Error('respondOffsetDays must be a non-negative integer or blank');
  }
  return n;
}

function normalizeTimeline(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('timeline must be an object');
  }
  return {
    cycleLabel: normalizeText(input.cycleLabel),
    inviteStartDate: normalizeOptionalDate(input.inviteStartDate, 'inviteStartDate'),
    respondOffsetDays: normalizeOptionalOffset(input.respondOffsetDays),
    proposalReleaseDate: normalizeOptionalDate(input.proposalReleaseDate, 'proposalReleaseDate'),
    reviewDueDate: normalizeOptionalDate(input.reviewDueDate, 'reviewDueDate'),
  };
}

function parseStoredTimeline(raw) {
  if (raw == null || String(raw).trim() === '') {
    return {
      timeline: { ...DEFAULT_REVIEWER_CAMPAIGN_TIMELINE },
      isDefault: true,
      malformed: false,
    };
  }
  try {
    const decoded = JSON.parse(String(raw));
    return {
      timeline: normalizeTimeline(decoded),
      isDefault: false,
      malformed: false,
    };
  } catch {
    return {
      timeline: { ...DEFAULT_REVIEWER_CAMPAIGN_TIMELINE },
      isDefault: true,
      malformed: true,
    };
  }
}

async function getReviewerCampaignTimeline() {
  const raw = await getSetting(REVIEWER_CAMPAIGN_TIMELINE_KEY);
  return {
    key: REVIEWER_CAMPAIGN_TIMELINE_KEY,
    ...parseStoredTimeline(raw),
  };
}

async function setReviewerCampaignTimeline(timeline, updatedByProfileId = null) {
  const normalized = normalizeTimeline(timeline);
  const ok = await setSetting(
    REVIEWER_CAMPAIGN_TIMELINE_KEY,
    JSON.stringify(normalized),
    updatedByProfileId,
  );
  if (!ok) return null;
  return {
    key: REVIEWER_CAMPAIGN_TIMELINE_KEY,
    timeline: normalized,
    isDefault: false,
    malformed: false,
  };
}

module.exports = {
  REVIEWER_CAMPAIGN_TIMELINE_KEY,
  DEFAULT_REVIEWER_CAMPAIGN_TIMELINE,
  normalizeTimeline,
  parseStoredTimeline,
  getReviewerCampaignTimeline,
  setReviewerCampaignTimeline,
};
