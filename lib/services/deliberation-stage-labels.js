/**
 * Reads the four admin-editable Staff Deliberations rail labels (D6,
 * docs/PC_MEETING_TRACKER_PLAN.md). One catalog entry per stage key in
 * shared/config/editableTextDefaults.js; unset or blank falls back to
 * shared/utils/deliberation-stage.js's DELIBERATION_STAGE_DEFAULT_LABELS.
 * Never throws — a settings read failure degrades to the default label for
 * that stage only, with a single console.warn.
 */

const { getSettingStrict } = require('./settings-service');
const {
  DELIBERATION_STAGE_KEYS,
  DELIBERATION_STAGE_TEXT_KEYS,
  DELIBERATION_STAGE_DEFAULT_LABELS,
} = require('../../shared/utils/deliberation-stage');

let warned = false;

async function readDeliberationStageLabels() {
  const labels = {};
  await Promise.all(DELIBERATION_STAGE_KEYS.map(async (stage) => {
    const textKey = DELIBERATION_STAGE_TEXT_KEYS[stage];
    const fallback = DELIBERATION_STAGE_DEFAULT_LABELS[stage];
    try {
      const { found, value } = await getSettingStrict(textKey);
      labels[stage] = found && typeof value === 'string' && value.trim() ? value.trim() : fallback;
    } catch (error) {
      if (!warned) {
        warned = true;
        console.warn('readDeliberationStageLabels: settings read failed, using defaults.', error?.message || error);
      }
      labels[stage] = fallback;
    }
  }));
  return labels;
}

module.exports = { readDeliberationStageLabels };
