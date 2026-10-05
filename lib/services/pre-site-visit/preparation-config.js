import { isGuid } from '../../utils/guid.js';
import { readScheduledPreparationStateStatusPairs } from '../../../shared/config/siteVisit.js';
import { isGuardedReopenSchemaReady } from '../../utils/guarded-reopen-readiness.js';

function readJsonList(raw, transform) {
  if (!raw) return [];
  let value;
  try { value = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(transform).filter((item) => item !== null))];
}

export function readPreparationConfig(env = process.env) {
  const programIds = readJsonList(env.STAFF_DELIBERATIONS_AUTO_PREPARE_PROGRAM_IDS, (value) => (
    isGuid(value) ? String(value).toLowerCase() : null
  ));
  const cycleCodes = readJsonList(env.STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES, (value) => {
    const code = String(value || '').trim().toUpperCase();
    return /^[JD]\d{2}$/.test(code) ? code : null;
  });
  const requestStatuses = readJsonList(env.STAFF_DELIBERATIONS_AUTO_PREPARE_REQUEST_STATUSES, (value) => {
    const status = String(value || '').trim();
    return status && status.length <= 120 ? status : null;
  });
  const stateStatusPairs = readScheduledPreparationStateStatusPairs(
    env.STAFF_DELIBERATIONS_SITE_VISIT_STATE_STATUS_PAIRS,
  );
  const batch = Number(env.STAFF_DELIBERATIONS_AUTO_PREPARE_BATCH_SIZE || 10);
  const batchSize = Number.isInteger(batch) ? Math.min(25, Math.max(1, batch)) : 10;
  const enabled = env.STAFF_DELIBERATIONS_AUTO_PREPARE === 'on';
  const deploymentEnabled = env.NODE_ENV !== 'production'
    || env.STAFF_DELIBERATIONS_AUTO_PREPARE_PRODUCTION === 'on';
  const atomicFenceConfirmed = env.STAFF_DELIBERATIONS_AUTO_PREPARE_ATOMIC_FENCE_CONFIRMED === 'on';
  const guardedReopenSchemaReady = isGuardedReopenSchemaReady(env);
  const ready = programIds.length > 0 && cycleCodes.length > 0
    && requestStatuses.length > 0 && stateStatusPairs.length > 0
    && stateStatusPairs.some((pair) => pair.eligible)
    && guardedReopenSchemaReady && atomicFenceConfirmed && deploymentEnabled;
  return {
    enabled,
    ready,
    active: enabled && ready,
    programIds,
    cycleCodes,
    requestStatuses,
    stateStatusPairs,
    guardedReopenSchemaReady,
    batchSize,
    blockedBy: [
      ...(enabled ? [] : ['feature_disabled']),
      ...(programIds.length ? [] : ['program_allowlist_missing']),
      ...(cycleCodes.length ? [] : ['cycle_allowlist_missing']),
      ...(requestStatuses.length ? [] : ['request_status_allowlist_missing']),
      ...(stateStatusPairs.length && stateStatusPairs.some((pair) => pair.eligible) ? [] : ['event_state_status_map_missing']),
      ...(guardedReopenSchemaReady ? [] : ['correction_schema_not_ready']),
      ...(atomicFenceConfirmed ? [] : ['atomic_fence_not_confirmed']),
      ...(deploymentEnabled ? [] : ['production_activation_not_authorized']),
    ],
  };
}
