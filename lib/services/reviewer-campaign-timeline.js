/**
 * Reviewer campaign timeline defaults.
 *
 * Ground truth: Dataverse `wmkf_appsystemsettings`, key
 * `reviewer.campaign_timeline_defaults`.
 *
 * This is the app-wide default used to pre-fill reviewer invitation timing:
 * response days and reviewer quota. The proposal release copy date was
 * retired once the proposal went out on acceptance; a legacy stored
 * `proposalReleaseDate` is ignored. Request-level campaign config
 * (`akoya_request.wmkf_respondoffsetdays`) still wins when present. The review
 * due date is not here: it comes from the cycle calendar (D48).
 */

const { getSetting, setSetting } = require('./settings-service');

const REVIEWER_CAMPAIGN_TIMELINE_KEY = 'reviewer.campaign_timeline_defaults';

const DEFAULT_REVIEWER_CAMPAIGN_TIMELINE = Object.freeze({
  cycleLabel: '',
  respondOffsetDays: 7,
  desiredCount: 4,
});

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().slice(0, 120) : '';
}

function normalizeOptionalOffset(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 0) {
    throw new Error('respondOffsetDays must be a non-negative integer or blank');
  }
  return n;
}

function normalizeOptionalDesiredCount(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 0) {
    throw new Error('desiredCount must be a non-negative integer or blank');
  }
  return n;
}

function normalizeTimeline(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('timeline must be an object');
  }
  return {
    cycleLabel: normalizeText(input.cycleLabel),
    respondOffsetDays: normalizeOptionalOffset(input.respondOffsetDays),
    desiredCount: normalizeOptionalDesiredCount(input.desiredCount),
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
    const timeline = normalizeTimeline(decoded);
    // Legacy stored JSON predates desiredCount — merge the default in rather than
    // surfacing null so pre-existing settings pick up the reviewer quota default.
    if (decoded.desiredCount === undefined) {
      timeline.desiredCount = DEFAULT_REVIEWER_CAMPAIGN_TIMELINE.desiredCount;
    }
    return {
      timeline,
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
