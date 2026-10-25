/** Exact authenticated sender's future distribution wording; never prepares or sends email. */
import { getSettingStrict } from '../settings-service.js';
import * as prefs from '../../dataverse/adapters/user-preference.js';
import { isGuid } from '../../utils/guid.js';
import { PREFERENCE_KEYS } from '../../../shared/config/reviewerFinderPreferences.js';
import { DELIBERATION_SHARE_SEED_SUBJECT, DELIBERATION_SHARE_SEED_BODY, validateDeliberationShareTemplate } from '../../../shared/config/deliberationShareEmail.js';
const KEY = PREFERENCE_KEYS.DELIBERATION_SHARE_TEMPLATE;
const DEFAULTS = { getSettingStrict, ...prefs };
const SEED = { subject: DELIBERATION_SHARE_SEED_SUBJECT, body: DELIBERATION_SHARE_SEED_BODY };

export async function ownDistributionTemplate(systemId, deps = DEFAULTS) {
  if (!isGuid(systemId)) return { status: 'identity_unavailable', template: null };
  try {
    const rows = await deps.listByOwnerAndKey(systemId, KEY);
    if (!rows.length) return { status: 'absent', template: null };
    if (rows.length > 1) return { status: 'duplicates', template: null };
    if (rows[0].wmkf_isencrypted) return { status: 'encrypted', template: null };
    let raw;
    try { raw = JSON.parse(rows[0].wmkf_preferencevalue); } catch { return { status: 'invalid', template: null }; }
    const checked = validateDeliberationShareTemplate(raw);
    return checked.valid ? { status: 'configured', template: checked.value } : { status: 'invalid', template: null };
  } catch { return { status: 'unavailable', template: null }; }
}

export async function sharedDistributionTemplate(deps = DEFAULTS) {
  const fields = await Promise.all(['subject', 'body'].map(async field => {
    try {
      const setting = await deps.getSettingStrict(`email.deliberation_share.${field}`);
      if (!setting?.found || typeof setting.value !== 'string' || !setting.value.trim()) return { value: SEED[field], status: 'missing' };
      // Shared wording has literal semantics; only enforce existing compose bounds here.
      const value = setting.value;
      const valid = field === 'subject' ? value.length <= 500 && !/[\r\n]/.test(value) : value.length <= 20000;
      return valid ? { value, status: 'available' } : { value: SEED[field], status: 'invalid' };
    } catch { return { value: SEED[field], status: 'unavailable' }; }
  }));
  return { template: { subject: fields[0].value, body: fields[1].value }, status: { subject: fields[0].status, body: fields[1].status } };
}

export async function getDistributionPreferences(systemId, deps = DEFAULTS) {
  const [own, shared] = await Promise.all([ownDistributionTemplate(systemId, deps), sharedDistributionTemplate(deps)]);
  const readable = !['identity_unavailable', 'unavailable'].includes(own.status);
  return { ownStatus: own.status, own: own.template, shared: shared.template, sharedStatus: shared.status,
    effective: own.template || shared.template, source: own.template ? 'personal' : Object.values(shared.status).includes('available') ? 'shared' : 'built_in',
    configured: own.status === 'configured', canSave: readable && own.status !== 'duplicates', canClear: readable && own.status !== 'absent' };
}

export async function saveDistributionPreference(systemId, template, deps = DEFAULTS) {
  const checked = validateDeliberationShareTemplate(template);
  if (!checked.valid) return { ok: false, reason: 'validation', errors: checked.errors };
  if (!isGuid(systemId)) return { ok: false, reason: 'identity_unavailable' };
  try {
    const rows = await deps.listByOwnerAndKey(systemId, KEY);
    if (rows.length > 1) return { ok: false, reason: 'duplicates' };
    const body = { wmkf_preferencevalue: JSON.stringify(checked.value), wmkf_isencrypted: false };
    if (rows.length) await deps.update(rows[0].wmkf_appuserpreferenceid, body);
    else await deps.create({ ...body, wmkf_preferencekey: KEY, 'ownerid@odata.bind': `/systemusers(${systemId})` });
    const after = await ownDistributionTemplate(systemId, deps);
    if (after.status !== 'configured' || JSON.stringify(after.template) !== JSON.stringify(checked.value)) return { ok: false, reason: 'persistence_unconfirmed' };
    return { ok: true };
  } catch { return { ok: false, reason: 'persistence_unconfirmed' }; }
}

export async function clearDistributionPreference(systemId, deps = DEFAULTS) {
  if (!isGuid(systemId)) return { ok: false, reason: 'identity_unavailable' };
  try {
    const rows = await deps.listByOwnerAndKey(systemId, KEY);
    for (const row of rows) await deps.remove(row.wmkf_appuserpreferenceid);
    if ((await deps.listByOwnerAndKey(systemId, KEY)).length) return { ok: false, reason: 'persistence_unconfirmed' };
    return { ok: true };
  } catch { return { ok: false, reason: 'persistence_unconfirmed' }; }
}
