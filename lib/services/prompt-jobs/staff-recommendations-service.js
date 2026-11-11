/** Server-side Sandbox recommendation result boundary. No job admission or writes. */
import { db, sql } from '@vercel/postgres';
import { getByIdWithSelect } from '../../dataverse/adapters/system-user.js';
import { isGuid } from '../../utils/guid.js';
import { hasActiveExpertiseAppGrant } from '../dataverse-app-access-service.js';
import { createRecommendationsProposalSource } from './proposal-source.js';
import { createRecommendationsReader } from './recommendations-reader.js';
import { RECOMMENDATIONS_SANDBOX_ORIGIN, readRecommendationsAccessPolicy } from './recommendations-sandbox-policy.js';
import { canonical } from './profile.js';
import { createPromptJobStore } from './store.js';

const READ_USER_SELECT = 'systemuserid,azureactivedirectoryobjectid,internalemailaddress,isdisabled';
const staffActorDependencies = {
  profile: async id => (await sql`SELECT id, azure_id, is_active, needs_linking, dynamics_systemuser_id FROM user_profiles WHERE id=${id}`).rows[0],
  user: id => getByIdWithSelect(id, READ_USER_SELECT, { strictRead: true, expectedOrigin: RECOMMENDATIONS_SANDBOX_ORIGIN }),
  hasGrant: id => hasActiveExpertiseAppGrant(id, RECOMMENDATIONS_SANDBOX_ORIGIN),
};
const defaults = {
  ...staffActorDependencies, store: createPromptJobStore(db), policy: readRecommendationsAccessPolicy,
  observeSource: args => createRecommendationsProposalSource().observe(args),
  observeRoster: async () => (await import('../../dataverse/adapters/expertise-recommendations-read.js')).readRecommendationsRosterProjection(),
};

function guid(value) { return isGuid(value) ? value.trim().toLowerCase() : null; }

function staffActor(access) {
  const session = access?.session;
  const user = session?.user;
  const profileId = access?.profileId;
  if (access?.authBypassed || session?.authBypassed || user?.authBypassed || user?.userType !== 'staff'
    || !Number.isSafeInteger(profileId) || profileId < 1 || user.profileId !== profileId) return null;
  const systemUserId = guid(user.dynamicsSystemuserId), azureId = guid(user.azureId);
  return systemUserId && azureId ? { profileId, systemUserId, azureId } : null;
}

/** Fresh checks for an exact, server-selected staff actor. */
export async function verifyRecommendationsStaffActor(actor, policyCurrent, deps = staffActorDependencies) {
  if (!policyCurrent()) return null;
  const profile = await deps.profile(actor.profileId);
  if (profile?.id !== actor.profileId || profile.is_active !== true || profile.needs_linking !== false
    || guid(profile.azure_id) !== actor.azureId || guid(profile.dynamics_systemuser_id) !== actor.systemUserId
    || !policyCurrent()) return null;
  const user = await deps.user(actor.systemUserId);
  if (guid(user?.systemuserid) !== actor.systemUserId || guid(user.azureactivedirectoryobjectid) !== actor.azureId
    || user.isdisabled !== false || !/@wmkeck\.org$/i.test(user.internalemailaddress || '') || !policyCurrent()) return null;
  if (await deps.hasGrant(actor.systemUserId) !== true || !policyCurrent()) return null;
  return { profileId: actor.profileId, systemUserId: actor.systemUserId };
}

export async function readStaffRecommendation({ access, requestId, jobId }, overrides = {}) {
  const deps = { ...defaults, ...overrides };
  const actor = staffActor(access);
  const initial = deps.policy();
  if (!actor || !initial || requestId !== initial.requestId || jobId !== initial.jobId
    || actor.profileId !== initial.profileId || actor.systemUserId !== initial.systemUserId) return null;
  const policyCurrent = () => canonical(deps.policy()) === canonical(initial);
  const reader = createRecommendationsReader({
    sandbox: true,
    store: deps.store,
    authorizeStaffRead: () => verifyRecommendationsStaffActor(actor, policyCurrent, deps),
    resolveJobOwner: async () => policyCurrent() ? { environment: initial.environment,
      principalKey: initial.principalKey, authorizationScope: initial.authorizationScope } : null,
    readSourceObservation: args => policyCurrent() ? deps.observeSource(args) : null,
    readRosterProjection: () => policyCurrent() ? deps.observeRoster() : null,
  });
  return reader.readResult({ requestId, jobId });
}
