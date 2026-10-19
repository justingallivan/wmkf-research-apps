/** Admin/Grants Manager-owned versioned Dataverse settings; operational history lives in the cycle journal. */
import { boardWorkEnabled } from './mode.js';
import { canonicalJson } from '../../utils/canonical-json.js';
import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';
import { getSettingStrict, setSettingIfUnchanged, listSettingsWithMetaStrict } from '../settings-service.js';
import { resolveSystemUserToProfile, resolveProfileToSystemUser } from '../dataverse-identity-map.js';
import { listAppKeysForUser } from '../app-access-service.js';
import * as users from '../../dataverse/adapters/system-user.js';
import { ROLE_KEYS, CYCLE_PREFIX, PROGRAM_ID, validateCycle, validateRole, cycleCode, guid, fail } from './model.js';
import { mutateCycle, readCycle, audit } from './store.js';
const DEFAULTS = { getSettingStrict, setSettingIfUnchanged, listSettingsWithMetaStrict, resolveSystemUserToProfile, listAppKeysForUser,
  getUser: id => users.getByIdWithSelect(id, 'systemuserid,fullname,internalemailaddress,isdisabled'),
  profile: async id => (await sql`SELECT p.id,p.is_active,EXISTS(SELECT 1 FROM dynamics_user_roles r WHERE r.user_profile_id=p.id AND r.role='superuser') AS superuser FROM user_profiles p WHERE p.id=${id}`).rows[0],
  mutateCycle, readCycle };
function decode(row, validate) {
  if (!row.found) return { value: null, revision: null };
  if (!row.revision) fail('board_settings_revision_missing', 'Settings revision unavailable.', 503);
  let value;
  try { value = validate(JSON.parse(row.value)); }
  catch { fail('board_settings_corrupt', 'Board settings need administrator attention.', 503); }
  return { value, revision: row.revision };
}
export async function getRole(role, overrides = {}) {
  if (!ROLE_KEYS[role]) fail('board_role_invalid', 'Unknown Board role.', 400);
  const d = { ...DEFAULTS, ...overrides };
  return decode(await d.getSettingStrict(ROLE_KEYS[role]), validateRole);
}
export async function getCycle(cycle, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  const result = decode(await d.getSettingStrict(`${CYCLE_PREFIX}${cycleCode(cycle)}`), validateCycle);
  if (result.value && result.value.cycle !== cycle) fail('board_cycle_identity_mismatch');
  return result;
}
export async function listCycles(overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  const rows = await d.listSettingsWithMetaStrict(CYCLE_PREFIX);
  const codes = Object.keys(rows).map(key => cycleCode(key.slice(CYCLE_PREFIX.length)));
  if (codes.length > 100) fail('board_cycle_scan_capped');
  return codes.sort().reverse();
}
export async function eligibleStaff(systemUserId, { admin = false, app = true } = {}, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  guid(systemUserId);
  const [user, profileId] = await Promise.all([d.getUser(systemUserId), d.resolveSystemUserToProfile(systemUserId)]);
  if (!user || user.isdisabled !== false || !profileId || !/@wmkeck\.org$/i.test(user.internalemailaddress || '')) fail('board_staff_unavailable', 'A configured staff member is not eligible.', 403);
  const profile = await d.profile(profileId);
  if (profile?.is_active !== true || (admin && profile.superuser !== true)) fail('board_staff_unavailable', 'A configured staff member is not eligible.', 403);
  if (app && !profile.superuser && !(await d.listAppKeysForUser(profileId, { throwOnError: true })).includes('reviewers')) fail('board_staff_app_access', 'Reviewer app access is required for this role.', 403);
  return { systemUserId: guid(systemUserId), profileId, name: user.fullname, email: user.internalemailaddress, isSuperuser: profile.superuser === true };
}
export async function boardActor(actor, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  const staff = await eligibleStaff(actor.systemUserId, {}, d);
  if (staff.profileId !== actor.profileId) fail('board_actor_mismatch', 'Staff identity could not be verified.', 403);
  const [cso, manager] = await Promise.all([getRole('cso', d), getRole('grantsManager', d)]);
  return { ...staff, canRelease: cso.value?.systemUserId === staff.systemUserId, canArchive: staff.isSuperuser || manager.value?.systemUserId === staff.systemUserId };
}
export async function canViewEarlyDraft(systemUserId, overrides = {}) {
  if (!boardWorkEnabled()) return false;
  try {
    const role = await getRole('cso', overrides);
    if (!role.value?.systemUserId || role.value.systemUserId !== systemUserId?.toLowerCase()) return false;
    await eligibleStaff(systemUserId, {}, overrides);
    return true;
  } catch { return false; }
}
function revision(value) {
  if (value !== null && (typeof value !== 'string' || !value.length || value.length > 256)) fail('board_revision_invalid', 'Reload settings before saving.', 400);
}
async function requireSetupManager(actor, d) {
  const staff = await eligibleStaff(actor.systemUserId, {}, d);
  if (staff.profileId !== actor.profileId) fail('board_actor_mismatch', 'Staff identity could not be verified.', 403);
  if (!staff.isSuperuser) {
    const manager = await getRole('grantsManager', d);
    if (manager.value?.systemUserId !== staff.systemUserId) fail('board_settings_denied', 'A system administrator or the assigned Grants Manager is required.', 403);
  }
  return staff;
}
export async function saveRole(actor, role, value, expectedRevision, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  await requireSetupManager(actor, d);
  if (!ROLE_KEYS[role]) fail('board_role_invalid');
  revision(expectedRevision);
  const parsed = validateRole(value);
  if (parsed.systemUserId) await eligibleStaff(parsed.systemUserId, {}, d);
  await d.setSettingIfUnchanged(ROLE_KEYS[role], JSON.stringify(parsed), expectedRevision, actor.profileId);
  return getRole(role, d);
}
export async function saveCycle(actor, input, expectedRevision, reason, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  await requireSetupManager(actor, d);
  revision(expectedRevision);
  const value = validateCycle(input);
  const previous = await getCycle(value.cycle, d);
  if (previous.revision !== expectedRevision) fail('board_settings_changed', 'Reload cycle settings before saving.');
  if (value.rosterConfirmed && value.cycle === 'D26' && !previous.value?.rosterConfirmed && value.requestIds.length !== 23) fail('board_d26_roster_count', 'Confirm all 23 D26 proposals.');
  const rosterChanged = previous.value?.rosterConfirmed && JSON.stringify(previous.value.requestIds) !== JSON.stringify(value.requestIds);
  if (rosterChanged && (typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 2000)) fail('board_roster_reason', 'Explain the change to the confirmed request list.', 400);
  if (value.adminId) await eligibleStaff(value.adminId, { admin: true, app: false }, d);
  if (value.active) {
    for (const role of Object.keys(ROLE_KEYS)) {
      const config = await getRole(role, d);
      if (!config.value?.systemUserId) fail('board_roles_required', 'Assign the President, CSO and Grants Manager before activation.', 400);
      await eligibleStaff(config.value.systemUserId, {}, d);
    }
  }
  const intentId = crypto.randomUUID();
  await d.mutateCycle(value.cycle, state => {
    if (state.archiveStartedAt || Object.values(state.releases).some(x => !x.releasedAt && x.state !== 'cancelled')) fail('board_cycle_busy', 'Resolve outstanding operations before editing cycle setup.');
    if (state.configIntent) fail('board_config_outcome_unknown', 'Reconcile the previous settings save before continuing.');
    state.configIntent = { id: intentId, value, before: previous.value, expectedRevision, actorId: actor.systemUserId, reason: reason || null, at: new Date().toISOString() };
  });
  // Leave the durable intent on all uncertain responses. GET can reconcile exact readback.
  try {
    await d.setSettingIfUnchanged(`${CYCLE_PREFIX}${value.cycle}`, JSON.stringify(value), expectedRevision, actor.profileId);
  } catch (error) {
    // Only definite server rejection clears intent. Timeouts/network/5xx remain unresolved.
    if ([400, 401, 403, 404, 409, 412, 422].includes(error.status)) {
      await d.mutateCycle(value.cycle, state => {
        if (state.configIntent?.id === intentId) {
          audit(state, actor.systemUserId, 'cycle_save_rejected', { status: error.status });
          state.configIntent = null;
        }
      });
    }
    throw error;
  }
  return reconcileConfig(value.cycle, d);
}
export async function reconcileConfig(cycle, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  const config = await getCycle(cycle, d);
  await d.mutateCycle(cycle, state => {
    const intent = state.configIntent;
    if (!intent) return;
    if (canonicalJson(config.value) === canonicalJson(intent.value)) {
      state.configHistory.push({ ...intent, revision: config.revision });
      audit(state, intent.actorId, 'cycle_saved', { revision: config.revision, reason: intent.reason });
      state.configIntent = null;
    } else if (config.revision === intent.expectedRevision) {
      // Do not infer failure while a settings request may still be in flight.
      fail('board_config_outcome_unknown', 'A previous settings save still needs reconciliation.');
    } else fail('board_config_conflict', 'Cycle settings changed outside this workflow.');
  });
  return config;
}

/** Staff selectors use human labels; unavailable identities are never silently assigned. */
export async function staffDirectory() {
  const profiles = (await sql`SELECT id FROM user_profiles WHERE is_active=true ORDER BY id LIMIT 101`).rows;
  if (profiles.length > 100) fail('board_staff_scan_capped');
  const result = [];
  for (const profile of profiles) {
    const identity = await resolveProfileToSystemUser(profile.id);
    if (!identity?.systemuserid) continue;
    try {
      const staff = await eligibleStaff(identity.systemuserid);
      if (!result.some(x => x.systemUserId === staff.systemUserId)) result.push(staff);
    } catch (e) { if (e.httpStatus !== 403) throw e; }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/** Resume the SAME conditional save; its old ETag cannot overwrite a later value. */
export async function resumeConfig(cycle, actor, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  await requireSetupManager(actor, d);
  const { state } = await d.readCycle(cycle);
  const intent = state.configIntent;
  if (!intent) return getCycle(cycle, d);
  const current = await getCycle(cycle, d);
  if (canonicalJson(current.value) === canonicalJson(intent.value)) return reconcileConfig(cycle, d);
  if (current.revision !== intent.expectedRevision) fail('board_config_conflict');
  // An initial create has no ETag. Do not replay an ambiguous POST.
  if (intent.expectedRevision === null) fail('board_config_create_unknown', 'The initial settings save needs an administrator to inspect Dataverse before retrying.');
  try { await d.setSettingIfUnchanged(`${CYCLE_PREFIX}${cycle}`, JSON.stringify(intent.value), intent.expectedRevision, actor.profileId); }
  catch (error) { if (error.status !== 409 && error.status !== 412) throw error; }
  return reconcileConfig(cycle, d);
}

/** Central staffing uses the existing assignments independently of Board execution readiness. */
export async function staffingCapabilities(actor, overrides = {}) {
  const staff = await requireSetupManager(actor, { ...DEFAULTS, ...overrides });
  return { canManageSharedRoles: true, isSuperuser: staff.isSuperuser };
}
export async function loadStaffing(actor, overrides = {}) {
  const capabilities = await staffingCapabilities(actor, overrides);
  const [staff, entries] = await Promise.all([
    (overrides.staffDirectory || staffDirectory)(),
    Promise.all(Object.keys(ROLE_KEYS).map(async role => [role, await getRole(role, overrides)])),
  ]);
  return { ...capabilities, staff, roles: Object.fromEntries(entries) };
}
