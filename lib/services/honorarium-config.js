/**
 * Honorarium amount — single Dataverse ground-truth (chunk-4, decided S199).
 *
 * The reviewer honorarium amount lives as ONE admin-editable setting in
 * Dataverse `wmkf_appsystemsettings` (key `honorarium.default_amount`), read
 * live wherever the amount is needed (the portal honorarium-create stamp + the
 * Review Manager invitation email). This replaces the former per-user
 * preference (`SettingsModal` grantCycle.customFields.honorarium) so the value
 * can't drift between staff. Future-creates-only: each honorarium row stamps
 * the value at create time; a later change does not rewrite existing rows.
 *
 * Failure semantics (Codex pre-impl P1 — never silently mint the fallback):
 *   - confirmed-absent key      → DEFAULT_HONORARIUM_AMOUNT (250), documented first-run fallback
 *   - malformed stored value    → throws (code: honorarium_amount_malformed)
 *   - settings fetch failure     → throws (code: honorarium_amount_unavailable)
 * Money-stamping callers must treat a throw as "cannot determine amount" and
 * skip the create + alert, NOT fall back to a guess.
 */

const { getSettingStrict } = require('./settings-service');

const HONORARIUM_AMOUNT_KEY = 'honorarium.default_amount';
const DEFAULT_HONORARIUM_AMOUNT = 250;

async function getHonorariumAmount() {
  let result;
  try {
    result = await getSettingStrict(HONORARIUM_AMOUNT_KEY);
  } catch (err) {
    const e = new Error(`honorarium amount lookup failed: ${err?.message || err}`);
    e.code = 'honorarium_amount_unavailable';
    throw e;
  }

  // Confirmed-absent (the settings read succeeded; the key isn't set yet).
  if (!result.found || result.value == null || String(result.value).trim() === '') {
    return DEFAULT_HONORARIUM_AMOUNT;
  }

  const n = Number(String(result.value).trim());
  if (!Number.isFinite(n) || n <= 0) {
    const e = new Error(
      `honorarium amount setting '${HONORARIUM_AMOUNT_KEY}' is malformed: '${result.value}' ` +
      '(must be a positive number)',
    );
    e.code = 'honorarium_amount_malformed';
    throw e;
  }
  return n;
}

module.exports = {
  HONORARIUM_AMOUNT_KEY,
  DEFAULT_HONORARIUM_AMOUNT,
  getHonorariumAmount,
};
