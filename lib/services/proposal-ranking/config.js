/** Revisioned facilitator defaults and round-scoped facilitator membership. */

import { getSettingStrict, setSettingIfUnchanged } from '../settings-service.js';
import { canonicalGuid } from './calculations.js';
import { getRankingTestPolicy, RANKING_TEST_FACILITATOR_NAMES } from './test-policy.js';
import {
  facilitationError,
  normalizeFacilitatorIds,
  parseFacilitationSettingValue,
} from './facilitation.js';

export const DEFAULT_FACILITATOR_SETTING_KEY = 'proposal_ranking.default_facilitator_systemuser_id';
export const DEFAULT_FACILITATORS_SETTING_KEY = 'proposal_ranking.default_facilitators_v1';

function invalidConfiguration() {
  return { configurationError: true, configured: false, systemUserIds: [], source: null, settingRevision: null };
}

async function testFacilitatorSet() {
  const { listEnabledProposalRankingStaff } = await import('../../dataverse/adapters/proposal-ranking-source.js');
  const staff = await listEnabledProposalRankingStaff();
  const systemUserIds = [];
  for (const name of RANKING_TEST_FACILITATOR_NAMES) {
    const matches = staff.filter((user) => user.name === name);
    if (matches.length !== 1) throw facilitationError();
    const id = canonicalGuid(matches[0].systemUserId);
    if (!id) throw facilitationError();
    systemUserIds.push(id);
  }
  const normalized = normalizeFacilitatorIds(systemUserIds);
  if (!normalized || normalized.length !== RANKING_TEST_FACILITATOR_NAMES.length) throw facilitationError();
  return {
    systemUserIds: normalized,
    source: 'set',
    settingRevision: 'ranking-test-v1',
    revision: 'ranking-test-v1',
    newSettingPresent: true,
    newSettingMissing: false,
    configured: true,
    configurationError: false,
  };
}

/**
 * The new setting wins when present, even if malformed. Only absence enables the
 * old scalar fallback. `allowInvalid` is for Admin repair reads, never authority.
 */
export async function readDefaultFacilitators({ allowInvalid = false } = {}) {
  const testPolicy = getRankingTestPolicy();
  if (testPolicy.requested) {
    if (!testPolicy.enabled) throw facilitationError();
    return testFacilitatorSet();
  }

  const setting = await getSettingStrict(DEFAULT_FACILITATORS_SETTING_KEY);
  let result;
  if (setting.found) {
    const parsed = parseFacilitationSettingValue(setting.value);
    result = parsed
      ? {
          systemUserIds: parsed.systemUserIds,
          source: 'set',
          settingRevision: setting.revision,
          configured: true,
          configurationError: false,
        }
      : invalidConfiguration();
    result.revision = setting.revision;
    result.newSettingPresent = true;
    result.newSettingMissing = false;
  } else {
    const legacy = await getSettingStrict(DEFAULT_FACILITATOR_SETTING_KEY);
    if (legacy.found) {
      const systemUserId = canonicalGuid(legacy.value);
      result = systemUserId
        ? {
            systemUserIds: [systemUserId],
            source: 'legacy-scalar',
            settingRevision: legacy.revision,
            configured: true,
            configurationError: false,
          }
        : invalidConfiguration();
      result.revision = null;
      result.newSettingPresent = false;
      result.newSettingMissing = true;
    } else {
      result = {
        systemUserIds: [],
        source: null,
        settingRevision: null,
        revision: null,
        configured: false,
        configurationError: false,
        newSettingPresent: false,
        newSettingMissing: true,
      };
    }
  }
  if (result.configurationError && !allowInvalid) throw facilitationError();
  if (result.configured && !result.settingRevision) {
    if (allowInvalid) return { ...invalidConfiguration(), revision: result.revision, newSettingPresent: result.newSettingPresent, newSettingMissing: result.newSettingMissing };
    throw facilitationError();
  }
  return result;
}

/** Legacy callers use the primary member; v2 authorization reads the full set. */
export async function readDefaultFacilitator(options) {
  const value = await readDefaultFacilitators(options);
  return {
    systemUserId: value.systemUserIds[0] || null,
    revision: value.newSettingPresent ? value.revision : value.settingRevision,
    configured: value.configured,
  };
}

export async function saveDefaultFacilitators(systemUserIds, expectedRevision, profileId) {
  const normalized = normalizeFacilitatorIds(systemUserIds);
  if (!normalized) {
    const error = new Error('Choose one or two unique active staff members.');
    error.code = 'invalid_request';
    error.status = 400;
    error.publicMessage = true;
    throw error;
  }
  const settingValue = JSON.stringify({ version: 1, systemUserIds: normalized });
  await setSettingIfUnchanged(DEFAULT_FACILITATORS_SETTING_KEY, settingValue, expectedRevision, profileId);
  return { systemUserIds: normalized };
}

/** Retained for read-only migration/rehearsal scripts that explicitly manage v1. */
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
