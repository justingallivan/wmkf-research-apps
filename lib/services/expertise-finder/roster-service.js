/** Admin-only roster operations. Caller supplies authorization, trusted DAL context,
 * and the authenticated system-user ID. No automation or cutover side effects.
 */
import * as profiles from '../../dataverse/adapters/expertise-profile.js';
import * as users from '../../dataverse/adapters/system-user.js';
import * as contacts from '../../dataverse/adapters/contact.js';
import contract from './roster-contract.cjs';
import { rosterTarget } from './roster-mode.js';
import { ensureProfileBinding } from './roster-binding.js';
const { normalize, decode, encode, guid, fail } = contract;

export async function listRoster(query = {}) {
  rosterTarget();
  if (query.id) return { member: decode(await profiles.get(query.id)), backend: 'dataverse' };
  const all = (await profiles.list()).map(decode);
  const term = String(query.search || '').trim().toLowerCase();
  const members = all.filter(r => (query.includeInactive === 'true' || r.is_active)
    && (!query.roleType || r.role_type === query.roleType)
    && (!term || ['name', 'affiliation', 'expertise', 'keywords'].some(k => String(r[k] || '').toLowerCase().includes(term))))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { members, backend: 'dataverse', users: (await profiles.users()).map(u => ({ id: u.systemuserid, name: u.fullname, email: u.internalemailaddress })) };
}
async function personRecord(read, message) {
  try { return await read(); } catch (error) { if (error.status === 404) fail(message); throw error; }
}
async function validateLinks(value, current) {
  if (value.dataverse_user_id && (value.dataverse_user_id !== current?.dataverse_user_id || value.lead_pd_eligible)) {
    if ((await personRecord(() => users.getById(value.dataverse_user_id), 'That staff account no longer exists. Choose another account.'))?.isdisabled !== false) fail('Choose an enabled staff account.');
  }
  if (value.dataverse_contact_id && value.dataverse_contact_id !== current?.dataverse_contact_id) {
    if ((await personRecord(() => contacts.getByIdWithSelect(value.dataverse_contact_id, 'contactid,statecode'), 'That Contact no longer exists. Choose another Contact.'))?.statecode !== 0) fail('Choose an active Contact.');
  }
  // Dataverse keys reserve links even for inactive profiles. Give a human error.
  if (value.dataverse_contact_id || value.dataverse_user_id) {
    const conflict = (await profiles.list()).map(decode).find(r => r.id !== current?.id
      && ((value.dataverse_contact_id && r.dataverse_contact_id === value.dataverse_contact_id)
        || (value.dataverse_user_id && r.dataverse_user_id === value.dataverse_user_id)));
    if (conflict) fail(`That person link is already used by ${conflict.name}. Unlink it there before reassignment.`, 409);
  }
}
export async function saveRoster(input, actor, { create = false } = {}) {
  const { host } = rosterTarget();
  if (!guid(actor)) fail('Your staff account must be linked before editing.', 403);
  if (process.env.DYNAMICS_IMPERSONATION_ENABLED !== 'true') fail('Staff attribution is not configured.', 503);
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Roster object required.');
  const { id, mutation_id, etag, ...fields } = input;
  if (create ? !guid(mutation_id) : !guid(id)) fail('Invalid roster identity.');
  const record = create ? null : await profiles.get(id);
  const current = record ? decode(record) : null;
  if (fields.is_active === false) fields.lead_pd_eligible = false;
  const value = normalize(fields, current);
  const body = encode(value);
  if (create) {
    const key = 'app_' + mutation_id;
    let existing = await profiles.byCreationKey(key);
    if (!existing) {
      await validateLinks(value, null);
      // Reserve the numeric identity first. A failed create leaves only an unused
      // number, never a visible unbound profile that could break existing consumers.
      await ensureProfileBinding(host, mutation_id, key);
      try { await profiles.create({ ...body, wmkf_expertiseprofileid: mutation_id, wmkf_creationkey: key }, actor); }
      catch (error) { existing = await profiles.byCreationKey(key); if (!existing) throw error; }
      existing = existing || await profiles.byCreationKey(key);
    }
    if (!existing) fail('Creation could not be confirmed. Retry without closing this form.', 503);
    const actual = decode(existing);
    // Also repair earlier uncertain creations before rejecting a changed retry.
    await ensureProfileBinding(host, actual.id, key);
    for (const k of ['name', 'role_type', 'is_active', 'lead_pd_eligible', 'dataverse_contact_id', 'dataverse_user_id', ...contract.TEXT]) {
      if (actual[k] !== value[k]) fail('This creation was already saved with different values. Reload the roster.', 409);
    }
    return { member: actual };
  }
  await validateLinks(value, current);
  // Repair/check binding before updating, so a saved row cannot masquerade as complete.
  await ensureProfileBinding(host, id, record.wmkf_creationkey);
  await profiles.update(id, body, etag, actor, { clearStaffUser: Boolean(current.dataverse_user_id && !value.dataverse_user_id) });
  return { member: decode(await profiles.get(id)) };
}
