import { canonicalGuid } from './calculations.js';

export const FACILITATION_VERSION = 1;
export const FACILITATION_SOURCES = Object.freeze([
  'set',
  'legacy-scalar',
  'legacy-round',
]);

export function normalizeFacilitatorIds(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return null;
  const ids = value.map((item) => {
    if (typeof item !== 'string') return null;
    const id = canonicalGuid(item);
    return id && item === id ? id : null;
  });
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return null;
  return ids.sort();
}

export function parseFacilitationSettingValue(value) {
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (Object.keys(parsed).sort().join(',') !== 'systemUserIds,version') return null;
  if (parsed.version !== FACILITATION_VERSION) return null;
  const systemUserIds = normalizeFacilitatorIds(parsed.systemUserIds);
  return systemUserIds ? { version: FACILITATION_VERSION, systemUserIds } : null;
}

/** Missing round membership is a legacy scalar; present malformed membership fails closed. */
export function resolveRoundFacilitation(workflow, legacyFacilitatorId) {
  if (!Object.hasOwn(workflow || {}, 'facilitation')) {
    const systemUserIds = normalizeFacilitatorIds([legacyFacilitatorId]);
    if (!systemUserIds) throw facilitationError();
    return {
      version: FACILITATION_VERSION,
      systemUserIds,
      source: 'legacy-round',
      settingRevision: null,
    };
  }
  const value = workflow.facilitation;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw facilitationError();
  if (Object.keys(value).sort().join(',') !== 'settingRevision,source,systemUserIds,version') throw facilitationError();
  if (value.version !== FACILITATION_VERSION || !FACILITATION_SOURCES.includes(value.source)) throw facilitationError();
  const systemUserIds = normalizeFacilitatorIds(value.systemUserIds);
  if (!systemUserIds || JSON.stringify(systemUserIds) !== JSON.stringify(value.systemUserIds)) throw facilitationError();
  if (value.source === 'legacy-round') {
    if (systemUserIds.length !== 1 || value.settingRevision !== null) throw facilitationError();
  } else if (typeof value.settingRevision !== 'string' || !value.settingRevision) {
    throw facilitationError();
  } else if (value.source === 'legacy-scalar' && systemUserIds.length !== 1) {
    throw facilitationError();
  }
  return { version: FACILITATION_VERSION, systemUserIds, source: value.source, settingRevision: value.settingRevision };
}

export function facilitationError() {
  return Object.assign(new Error('The round facilitator configuration is invalid. Contact an administrator.'), {
    code: 'proposal_ranking_configuration_invalid',
    status: 503,
    publicMessage: true,
  });
}
