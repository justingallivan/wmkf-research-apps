/** Read-only sandbox roster projection. The authorized caller owns DAL context. */
import { DynamicsService } from '../../services/dynamics-service.js';
import { hasTrustedDalContext } from '../core/context.js';
import { entitySet } from '../core/entity-registry.js';
import { SANDBOX_HOSTS } from '../core/target-registry.js';
import roster from '../../services/expertise-finder/roster-contract.cjs';
import { buildRecommendationsSnapshot } from '../../services/expertise-finder/recommendations-contract.js';

const ORIGIN = 'https://orgd9e66399.crm.dynamics.com';
const HOST = 'orgd9e66399.crm.dynamics.com';
const ENV_KEYS = ['DYNAMICS_URL', 'DYNAMICS_SANDBOX_URL', 'DATAVERSE_DAL_ENFORCEMENT', 'DATAVERSE_TARGET_INTERLOCK', 'VERCEL_ENV'];
const RAW_FIELDS = ['wmkf_expertiseprofileid', '_etag', 'wmkf_name', 'wmkf_category', 'statecode',
  'wmkf_leadpdeligible', 'wmkf_contactguid', '_wmkf_staffuser_value', ...roster.TEXT.map(roster.column)];
const SELECT = RAW_FIELDS.filter(key => key !== '_etag').join(',');
function fail(message) { throw Object.assign(new Error(message), { code: 'expertise_roster_read_unavailable' }); }
function guard(expected) {
  if (!hasTrustedDalContext()) fail('Trusted Dataverse context is required.');
  const env = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  if (env.DYNAMICS_URL !== ORIGIN || (env.DYNAMICS_SANDBOX_URL && env.DYNAMICS_SANDBOX_URL !== ORIGIN) ||
      env.DATAVERSE_DAL_ENFORCEMENT !== 'on' || env.DATAVERSE_TARGET_INTERLOCK !== 'on' ||
      env.VERCEL_ENV === 'production' || !SANDBOX_HOSTS.includes(HOST) ||
      (expected && ENV_KEYS.some(key => env[key] !== expected[key]))) fail('Sandbox roster target is unavailable or changed.');
  return env;
}
function project(record) {
  if (!record || !RAW_FIELDS.every(key => Object.hasOwn(record, key) && record[key] !== undefined) ||
      !roster.guid(record.wmkf_expertiseprofileid) || typeof record._etag !== 'string' || !/^W\/"\d+"$/.test(record._etag) || record._etag.length > 100 ||
      ![0, 1].includes(record.statecode) || typeof record.wmkf_leadpdeligible !== 'boolean') fail('Roster row is incomplete or malformed.');
  const { id, updated_at, ...profile } = roster.decode(record);
  return profile;
}
export async function readRecommendationsRosterProjection(...args) {
  if (args.length) fail('Roster read takes no selectors.');
  const expected = guard();
  const result = await DynamicsService.queryAllRecords(entitySet('wmkf_expertiseprofiles'), {
    select: SELECT, filter: 'wmkf_expertiseprofileid ne null', orderby: 'wmkf_expertiseprofileid asc',
    strictPagination: true, primaryKey: 'wmkf_expertiseprofileid', expectedOrigin: ORIGIN,
  });
  guard(expected);
  if (!result || !Array.isArray(result.records) || result.capped !== false || result.hasMore ||
      !Number.isSafeInteger(result.totalCount) || result.totalCount !== result.records.length) fail('Roster read is incomplete.');
  const profiles = result.records.map(project), seen = new Set(), candidates = new Set();
  for (const profile of profiles) {
    if (seen.has(profile.profile_guid)) fail('Duplicate roster identity.');
    seen.add(profile.profile_guid);
    const { profile_guid, etag, ...fields } = profile;
    try {
      const valid = roster.normalize(fields, fields);
      if (valid.role_type === 'Research Program Staff' && valid.is_active && valid.lead_pd_eligible && valid.dataverse_user_id) {
        if (candidates.has(valid.dataverse_user_id)) fail('Duplicate candidate User.');
        candidates.add(valid.dataverse_user_id);
      }
    } catch (error) {
      if (error.code === 'expertise_roster_read_unavailable') throw error;
      // The builder preserves invalid known rows in the manifest and warns.
    }
  }
  const users = [];
  for (const id of [...candidates].sort()) {
    guard(expected);
    const user = await DynamicsService.getRecord(entitySet('systemusers'), id, {
      select: 'systemuserid,isdisabled', strictRead: true, expectedOrigin: ORIGIN,
    });
    guard(expected);
    if (!user || user.systemuserid !== id || typeof user.isdisabled !== 'boolean') fail('Candidate User read is incomplete.');
    users.push({ userGuid: id, disabled: user.isdisabled });
  }
  const projection = { complete: true, profiles, users };
  buildRecommendationsSnapshot(projection);
  guard(expected);
  return { targetHost: HOST, projection };
}
