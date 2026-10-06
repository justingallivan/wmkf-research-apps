import { isGuid } from '../../utils/guid.js';
import { readScheduledPreparationStateStatusPairs } from '../../../shared/config/siteVisit.js';
import { isGuardedReopenSchemaReady } from '../../utils/guarded-reopen-readiness.js';
import { testRequestIsolationEnabled } from '../test-requests/isolation.js';
import { meetingDateToCycleCode } from '../../utils/cycle-code.js';

function readJsonList(raw, transform) {
  if (!raw) return [];
  let value;
  try { value = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(transform).filter((item) => item !== null))];
}

function readExcludedRequestNumbers(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { numbers: [], valid: true };
  let value;
  try { value = JSON.parse(raw); } catch { return { numbers: [], valid: false }; }
  if (!Array.isArray(value)) return { numbers: [], valid: false };
  const numbers = value.map((item) => (typeof item === 'string' || typeof item === 'number' ? String(item).trim() : ''));
  if (numbers.some((number) => !/^\d{1,12}$/.test(number))) return { numbers: [], valid: false };
  return { numbers: [...new Set(numbers)], valid: true };
}

/** True when the request's number is on the configured exclusion list. */
export function isExcludedPreparationRequest(request, config) {
  const number = String(request?.akoya_requestnum ?? '').trim();
  return Boolean(number) && (config?.excludedRequestNumbers || []).includes(number);
}

/**
 * Program/cycle/status allowlists plus the exclusion list. Identity (ordinary
 * vs. Factory TEST) is the caller's separate check.
 */
export function requestMatchesPreparationAllowlists(request, config) {
  return !isExcludedPreparationRequest(request, config)
    && (config?.programIds || []).includes(String(request?._wmkf_grantprogram_value || '').toLowerCase())
    && (config?.cycleCodes || []).includes(meetingDateToCycleCode(request?.wmkf_meetingdate))
    && (config?.requestStatuses || []).includes(String(request?.akoya_requeststatus || '').trim());
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
  // Requests the worker must never touch even when otherwise allowlisted, e.g.
  // hand-made test copies that predate the Factory TEST marker. Unset or []
  // excludes nothing; any other unreadable value blocks automation, because an
  // exclusion list that silently parses empty would widen the cohort.
  const { numbers: excludedRequestNumbers, valid: exclusionsValid } = readExcludedRequestNumbers(
    env.STAFF_DELIBERATIONS_AUTO_PREPARE_EXCLUDED_REQUEST_NUMBERS,
  );
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
  const testIsolationReady = testRequestIsolationEnabled(env);
  const ready = programIds.length > 0 && cycleCodes.length > 0
    && requestStatuses.length > 0 && stateStatusPairs.length > 0
    && stateStatusPairs.some((pair) => pair.eligible)
    && guardedReopenSchemaReady && testIsolationReady && atomicFenceConfirmed && deploymentEnabled
    && exclusionsValid;
  return {
    enabled,
    ready,
    active: enabled && ready,
    programIds,
    cycleCodes,
    requestStatuses,
    excludedRequestNumbers,
    stateStatusPairs,
    guardedReopenSchemaReady,
    testIsolationReady,
    batchSize,
    blockedBy: [
      ...(enabled ? [] : ['feature_disabled']),
      ...(programIds.length ? [] : ['program_allowlist_missing']),
      ...(cycleCodes.length ? [] : ['cycle_allowlist_missing']),
      ...(requestStatuses.length ? [] : ['request_status_allowlist_missing']),
      ...(stateStatusPairs.length && stateStatusPairs.some((pair) => pair.eligible) ? [] : ['event_state_status_map_missing']),
      ...(exclusionsValid ? [] : ['excluded_request_numbers_invalid']),
      ...(guardedReopenSchemaReady ? [] : ['correction_schema_not_ready']),
      ...(testIsolationReady ? [] : ['test_request_isolation_not_ready']),
      ...(atomicFenceConfirmed ? [] : ['atomic_fence_not_confirmed']),
      ...(deploymentEnabled ? [] : ['production_activation_not_authorized']),
    ],
  };
}
