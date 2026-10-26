/** Exact-owner future grantee reminder wording. Strict reads; never touches a scheduled row or transport. */
import { getSettingStrict } from './settings-service.js';
import * as prefs from '../dataverse/adapters/user-preference.js';
import { isGuid } from '../utils/guid.js';
import { PREFERENCE_KEYS } from '../../shared/config/reviewerFinderPreferences.js';
import { validateScheduledGranteeReminderTemplate } from '../../shared/config/scheduledGranteeReminderEmail.js';
const KEY = PREFERENCE_KEYS.SCHEDULED_GRANTEE_REMINDER_TEMPLATE;
const DEFAULTS = { getSettingStrict, ...prefs };


export async function ownScheduledGranteeReminderTemplate(systemId, deps = DEFAULTS) {
  if (!isGuid(systemId)) return { status: 'identity_unavailable', template: null };
  systemId = systemId.toLowerCase();
  try {
    const rows = await deps.listByOwnerAndKey(systemId, KEY);
    if (!rows.length) return { status: 'absent', template: null };
    if (rows.length > 1) return { status: 'duplicates', template: null };
    if (rows[0].wmkf_isencrypted) return { status: 'encrypted', template: null };
    let raw;
    try { raw = JSON.parse(rows[0].wmkf_preferencevalue); } catch { return { status: 'invalid', template: null }; }
    const checked = validateScheduledGranteeReminderTemplate(raw);
    return checked.valid ? { status: 'configured', template: checked.value } : { status: 'invalid', template: null };
  } catch { return { status: 'unavailable', template: null }; }
}

export async function sharedScheduledGranteeReminderTemplate(deps = DEFAULTS) {
  try {
    const fields = await Promise.all(['subject', 'body'].map(field => deps.getSettingStrict(`email.grantee_reminder.${field}`)));
    if (fields.some(field => !field?.found || typeof field.value !== 'string' || !field.value.trim())) return { status: 'missing', template: null };
    // Existing Admin copy may use legacy aliases; never run the personal validator here.
    return { status: 'available', template: { subject: fields[0].value, body: fields[1].value } };
  } catch { return { status: 'unavailable', template: null }; }
}

export async function getScheduledGranteeReminderPreferences(systemId, deps = DEFAULTS) {
  const [own, shared] = await Promise.all([ownScheduledGranteeReminderTemplate(systemId, deps), sharedScheduledGranteeReminderTemplate(deps)]);
  const readable = !['identity_unavailable', 'unavailable'].includes(own.status);
  return { ownerSystemId: isGuid(systemId) ? systemId.toLowerCase() : null, ownStatus: own.status, own: own.template,
    shared: shared.template, sharedStatus: shared.status, effective: own.template || shared.template,
    source: own.template ? 'personal' : shared.template ? 'shared' : 'unavailable',
    configured: own.status === 'configured', canSave: readable && own.status !== 'duplicates', canClear: readable && own.status !== 'absent' };
}

export async function saveScheduledGranteeReminderPreference(systemId, template, deps = DEFAULTS) {
  const checked = validateScheduledGranteeReminderTemplate(template);
  if (!checked.valid) return { ok: false, reason: 'validation', errors: checked.errors };
  if (!isGuid(systemId)) return { ok: false, reason: 'identity_unavailable' };
  systemId = systemId.toLowerCase();
  let rows;
  try { rows = await deps.listByOwnerAndKey(systemId, KEY); }
  catch { return { ok: false, reason: 'preference_unavailable' }; }
  if (rows.length > 1) return { ok: false, reason: 'duplicates' };
  try {
    const body = { wmkf_preferencevalue: JSON.stringify(checked.value), wmkf_isencrypted: false };
    if (rows.length) await deps.update(rows[0].wmkf_appuserpreferenceid, body);
    else await deps.create({ ...body, wmkf_preferencekey: KEY, 'ownerid@odata.bind': `/systemusers(${systemId})` });
    const after = await ownScheduledGranteeReminderTemplate(systemId, deps);
    if (after.status !== 'configured' || JSON.stringify(after.template) !== JSON.stringify(checked.value)) return { ok: false, reason: 'persistence_unconfirmed' };
    return { ok: true };
  } catch { return { ok: false, reason: 'persistence_unconfirmed' }; }
}

export async function clearScheduledGranteeReminderPreference(systemId, deps = DEFAULTS) {
  if (!isGuid(systemId)) return { ok: false, reason: 'identity_unavailable' };
  systemId = systemId.toLowerCase();
  let rows;
  try { rows = await deps.listByOwnerAndKey(systemId, KEY); }
  catch { return { ok: false, reason: 'preference_unavailable' }; }
  try {
    for (const row of rows) await deps.remove(row.wmkf_appuserpreferenceid);
    if ((await deps.listByOwnerAndKey(systemId, KEY)).length) return { ok: false, reason: 'persistence_unconfirmed' };
    return { ok: true };
  } catch { return { ok: false, reason: 'persistence_unconfirmed' }; }
}
