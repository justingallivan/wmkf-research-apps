/** Exact-owner agenda wording. Only explicit Save/Clear writes; no send or session mutation. */
import { getSettingStrict } from '../settings-service.js';
import * as prefs from '../../dataverse/adapters/user-preference.js';
import { isGuid } from '../../utils/guid.js';
import { PREFERENCE_KEYS } from '../../../shared/config/reviewerFinderPreferences.js';
import { validateAgendaTemplate } from '../../../shared/config/agendaEmail.js';
const KEY = PREFERENCE_KEYS.MEETING_AGENDA_TEMPLATE;
const DEFAULTS = { getSettingStrict, ...prefs };
export async function sharedAgendaTemplate(deps = DEFAULTS) {
  try {
    const [subject, body] = await Promise.all(['subject', 'body'].map((field) => deps.getSettingStrict(`email.deliberation_agenda.${field}`)));
    if (!subject?.found || !body?.found) return { status: 'missing', template: null };
    const template = { subject: subject.value, body: body.value ?? '' };
    return validateAgendaTemplate(template).valid ? { status: 'available', template } : { status: 'shared_invalid', template: null };
  } catch { return { status: 'unavailable', template: null }; }
}
export async function ownAgendaTemplate(systemId, deps = DEFAULTS) {
  if (!isGuid(systemId)) return { status: 'identity_unavailable', template: null };
  try {
    const rows = await deps.listByOwnerAndKey(systemId, KEY);
    if (!rows.length) return { status: 'absent', template: null };
    if (rows.length !== 1 || rows[0].wmkf_isencrypted) return { status: 'invalid', template: null };
    let parsed;
    try { parsed = JSON.parse(rows[0].wmkf_preferencevalue); }
    catch { return { status: 'invalid', template: null }; }
    const checked = validateAgendaTemplate(parsed);
    return checked.valid ? { status: 'configured', template: checked.value } : { status: 'invalid', template: null };
  } catch { return { status: 'unavailable', template: null }; }
}
export function effectiveAgendaDefaults(own, shared) {
  const template = own.template || shared.template || { subject: '', body: '' };
  return {
    subject: template.subject, message: template.body,
    source: own.template ? 'personal' : shared.template ? own.status === 'absent' ? 'shared' : 'shared_fallback' : 'empty',
    personalStatus: own.status, sharedStatus: shared.status,
  };
}
export async function getAgendaPreferences(systemId, deps = DEFAULTS) {
  const [own, shared] = await Promise.all([ownAgendaTemplate(systemId, deps), sharedAgendaTemplate(deps)]);
  return { ownSystemId: systemId, configured: !['absent', 'identity_unavailable'].includes(own.status), template: own.template || shared.template,
    shared: shared.template, defaults: effectiveAgendaDefaults(own, shared) };
}
export async function saveAgendaPreference(systemId, template, deps = DEFAULTS) {
  const checked = validateAgendaTemplate(template);
  if (!checked.valid) return { ok: false, reason: 'validation', errors: checked.errors };
  if (!isGuid(systemId)) return { ok: false, reason: 'identity_unavailable' };
  try {
    const rows = await deps.listByOwnerAndKey(systemId, KEY);
    if (rows.length > 1) return { ok: false, reason: 'preference_invalid' };
    const body = { wmkf_preferencevalue: JSON.stringify(checked.value), wmkf_isencrypted: false };
    if (rows.length) await deps.update(rows[0].wmkf_appuserpreferenceid, body);
    else await deps.create({ ...body, wmkf_preferencekey: KEY, 'ownerid@odata.bind': `/systemusers(${systemId})` });
    const after = await ownAgendaTemplate(systemId, deps);
    if (after.status !== 'configured' || JSON.stringify(after.template) !== JSON.stringify(checked.value)) return { ok: false, reason: 'persistence_unconfirmed' };
    return { ok: true };
  } catch { return { ok: false, reason: 'persistence_unconfirmed' }; }
}
export async function clearAgendaPreference(systemId, deps = DEFAULTS) {
  if (!isGuid(systemId)) return { ok: false, reason: 'identity_unavailable' };
  const removed = [];
  try {
    const rows = await deps.listByOwnerAndKey(systemId, KEY);
    for (const row of rows) { await deps.remove(row.wmkf_appuserpreferenceid); removed.push(row.wmkf_appuserpreferenceid); }
    if ((await deps.listByOwnerAndKey(systemId, KEY)).length) return { ok: false, reason: 'persistence_unconfirmed', removed };
    return { ok: true };
  } catch { return { ok: false, reason: 'persistence_unconfirmed', removed }; }
}
