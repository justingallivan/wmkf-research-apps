/**
 * Admin-owned lead time for NEW applicant materials collections.
 * An absent setting uses two business days; malformed values and storage errors
 * fail closed. Existing collections use their persisted due_at, not this setting.
 */
import { getSettingStrict, setSetting } from '../settings-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import {
  SITE_VISIT_MATERIALS_DUE_BUSINESS_DAYS_SETTING,
  SITE_VISIT_MATERIALS_DUE_BUSINESS_DAYS_DEFAULT,
  normalizeDueBusinessDays,
} from '../../../shared/config/siteVisitMaterials.js';

const DEFAULT_DEPENDENCIES = Object.freeze({ getSettingStrict, setSetting });

function unavailable() {
  return new ServiceHttpError('The materials due-date setting is unavailable. Ask an administrator to check it and try again.', {
    httpStatus: 503, code: 'site_visit_materials_due_days_unavailable',
  });
}

export async function getDueBusinessDays(dependencies = DEFAULT_DEPENDENCIES) {
  let setting;
  try { setting = await dependencies.getSettingStrict(SITE_VISIT_MATERIALS_DUE_BUSINESS_DAYS_SETTING); }
  catch { throw unavailable(); }
  if (setting?.found === false) return { dueBusinessDays: SITE_VISIT_MATERIALS_DUE_BUSINESS_DAYS_DEFAULT, dueDaysSource: 'default' };
  const value = setting?.found === true ? normalizeDueBusinessDays(setting.value) : null;
  if (value === null) throw unavailable();
  return { dueBusinessDays: value, dueDaysSource: 'setting' };
}

export async function setDueBusinessDays(value, { updatedBy = null } = {}, dependencies = DEFAULT_DEPENDENCIES) {
  const days = normalizeDueBusinessDays(value);
  if (days === null) throw new ServiceHttpError('Enter a whole number of business days from 1 to 30.', {
    httpStatus: 400, code: 'site_visit_materials_due_days_invalid',
  });
  let saved;
  try { saved = await dependencies.setSetting(SITE_VISIT_MATERIALS_DUE_BUSINESS_DAYS_SETTING, String(days), updatedBy); }
  catch { throw unavailable(); }
  if (saved !== true) throw unavailable();
  return { dueBusinessDays: days, dueDaysSource: 'setting' };
}
