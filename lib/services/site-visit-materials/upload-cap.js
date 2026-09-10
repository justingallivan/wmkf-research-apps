/**
 * Admin-editable upload size cap for applicant materials (plan §16 M3).
 * Stored as an app system setting; unset → the default. A read failure is a
 * 503, never the default: an outage must not widen a lower configured cap.
 */
import { getSettingStrict, setSetting } from '../settings-service.js';
import {
  SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_SETTING,
  SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_DEFAULT,
  SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_LIMITS,
  normalizeUploadMaxMb,
} from '../../../shared/config/siteVisitMaterials.js';
import { ServiceHttpError } from '../service-http-error.js';

const DEFAULT_DEPENDENCIES = Object.freeze({ getSettingStrict, setSetting });

function capUnavailable() {
  return new ServiceHttpError('The upload limit is unavailable.', {
    httpStatus: 503,
    code: 'site_visit_materials_cap_unavailable',
    body: { ok: false, reason: 'cap_unavailable' },
  });
}

/** @returns {Promise<{ maxMb: number, source: 'setting' | 'default' }>} */
export async function getUploadMaxMb(dependencies = DEFAULT_DEPENDENCIES) {
  let setting;
  try {
    setting = await dependencies.getSettingStrict(SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_SETTING);
  } catch {
    throw capUnavailable();
  }
  const raw = setting?.found === true ? setting.value : null;
  const normalized = normalizeUploadMaxMb(raw);
  return normalized === null
    ? { maxMb: SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_DEFAULT, source: 'default' }
    : { maxMb: normalized, source: 'setting' };
}

export async function setUploadMaxMb(value, { updatedBy = null } = {}, dependencies = DEFAULT_DEPENDENCIES) {
  const normalized = normalizeUploadMaxMb(value);
  if (normalized === null) {
    throw new ServiceHttpError(
      `The upload cap must be a whole number of megabytes between ${SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_LIMITS.min} and ${SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_LIMITS.max}.`,
      { httpStatus: 400, code: 'site_visit_materials_cap_invalid' },
    );
  }
  let saved = false;
  try {
    saved = await dependencies.setSetting(SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_SETTING, String(normalized), updatedBy);
  } catch {
    throw capUnavailable();
  }
  if (saved !== true) throw capUnavailable();
  return { maxMb: normalized, source: 'setting' };
}

export function uploadMaxBytes(maxMb) {
  return Number(maxMb) * 1024 * 1024;
}
