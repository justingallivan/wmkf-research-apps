/**
 * Reads the four admin-editable Staff Deliberations rail labels (D6,
 * docs/PC_MEETING_TRACKER_PLAN.md). One catalog entry per stage key in
 * shared/config/editableTextDefaults.js; unset or blank falls back to
 * shared/utils/deliberation-stage.js's DELIBERATION_STAGE_DEFAULT_LABELS.
 *
 * Reads all four keys in one `listSettingsWithMetaStrict` prefix call rather
 * than four `getSettingStrict` calls, and memoises the result in-module for
 * TTL_MS: GET /api/workbench/pre-site-visit polls every 3s for up to 20
 * attempts during generation, so an uncached per-request read would add up to
 * 80 extra Dataverse reads per generation.
 *
 * Never throws — a settings read failure degrades every stage to its default
 * label, with a console.warn rate-limited to once per TTL_MS (not once ever)
 * so a sustained outage still surfaces in logs.
 */

const { listSettingsWithMetaStrict } = require('./settings-service');
const {
  DELIBERATION_STAGE_KEYS,
  DELIBERATION_STAGE_TEXT_KEYS,
  DELIBERATION_STAGE_DEFAULT_LABELS,
} = require('../../shared/utils/deliberation-stage');

const TTL_MS = 60000;
const SETTING_PREFIX = 'stage.deliberations.';

let cache = null; // { labels, expiresAt } | null
let lastWarnAt = 0;

function defaultLabels() {
  return { ...DELIBERATION_STAGE_DEFAULT_LABELS };
}

function warnRateLimited(error, now) {
  if (now - lastWarnAt < TTL_MS) return;
  lastWarnAt = now;
  console.warn('readDeliberationStageLabels: settings read failed, using defaults.', error?.message || error);
}

async function readDeliberationStageLabels() {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.labels;

  let rows;
  try {
    rows = await listSettingsWithMetaStrict(SETTING_PREFIX);
  } catch (error) {
    warnRateLimited(error, now);
    const labels = defaultLabels();
    cache = { labels, expiresAt: now + TTL_MS };
    return labels;
  }

  const labels = {};
  for (const stage of DELIBERATION_STAGE_KEYS) {
    const textKey = DELIBERATION_STAGE_TEXT_KEYS[stage];
    const value = rows?.[textKey]?.value;
    labels[stage] = typeof value === 'string' && value.trim()
      ? value.trim()
      : DELIBERATION_STAGE_DEFAULT_LABELS[stage];
  }
  cache = { labels, expiresAt: now + TTL_MS };
  return labels;
}

/**
 * Test-only: clears the in-module label cache so the next read hits
 * `listSettingsWithMetaStrict` again. Deliberately leaves the warn
 * rate-limit timer alone — resetting both would make the warn's own TTL
 * untestable without also refetching.
 */
function __resetDeliberationStageLabelCacheForTests() {
  cache = null;
}

module.exports = { readDeliberationStageLabels, __resetDeliberationStageLabelCacheForTests };
