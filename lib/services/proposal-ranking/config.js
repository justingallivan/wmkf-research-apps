/** Stable system-user identity for the configured default facilitator. */

import { getSettingStrict, setSettingIfUnchanged } from '../settings-service.js';
import { canonicalGuid } from './calculations.js';
import { getRankingTestPolicy } from './test-policy.js';

export const DEFAULT_FACILITATOR_SETTING_KEY = 'proposal_ranking.default_facilitator_systemuser_id';

export async function readDefaultFacilitator() {
  const testPolicy = getRankingTestPolicy();
  if (testPolicy.requested) {
    if (!testPolicy.enabled) throw new Error('Ranking rehearsal is unavailable.');
    return { systemUserId: '29b0de0d-4ff7-ee11-a1fd-000d3a3621c7', revision: 'ranking-test-v1', configured: true };
  }
  const setting = await getSettingStrict(DEFAULT_FACILITATOR_SETTING_KEY);
  if (!setting.found) return { systemUserId: null, revision: null, configured: false };
  const systemUserId = canonicalGuid(setting.value);
  if (!systemUserId) {
    const error = new Error('The configured facilitator identity is invalid. Ask an administrator to select an active staff member again.');
    error.code = 'proposal_ranking_configuration_invalid';
    error.status = 503;
    throw error;
  }
  return { systemUserId, revision: setting.revision, configured: true };
}

export async function saveDefaultFacilitator(systemUserId, expectedRevision, profileId) {
  const normalized = canonicalGuid(systemUserId);
  if (!normalized) {
    const error = new Error('Choose an active staff member.');
    error.code = 'invalid_request';
    error.status = 400;
    error.publicMessage = true;
    throw error;
  }
  await setSettingIfUnchanged(DEFAULT_FACILITATOR_SETTING_KEY, normalized, expectedRevision, profileId);
  return { systemUserId: normalized };
}
