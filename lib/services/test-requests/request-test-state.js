/**
 * Server-side test-request state for one Grant Request.
 *
 * Reads only the marker and run ID for a request GUID and classifies them with
 * the pure isolation policy. Any failure to read (invalid ID, missing row,
 * unselectable field, transport error) returns `unknown`, so callers fail
 * closed; callers decide what `unknown` blocks. This establishes no actor
 * authorization and never accepts a caller-supplied classification.
 */

import { isGuid } from '../../utils/guid.js';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import { ServiceHttpError } from '../service-http-error.js';
import {
  TEST_REQUEST_ISOLATION_FIELDS,
  classifyTestRequestSnapshot,
  testRequestIsolationEnabled,
} from './isolation.js';

const TEST_STATE_SELECT = Object.freeze([
  TEST_REQUEST_ISOLATION_FIELDS.marker,
  TEST_REQUEST_ISOLATION_FIELDS.runId,
]);

export async function resolveRequestTestState(
  requestId,
  { getRequestById = grantRequestAdapter.getById } = {},
) {
  if (!isGuid(requestId)) return { kind: 'unknown', reason: 'request_id_invalid' };
  let row;
  try {
    row = await getRequestById(requestId.trim(), { select: [...TEST_STATE_SELECT] });
  } catch (error) {
    return { kind: 'unknown', reason: error?.status === 404 ? 'request_not_found' : 'read_failed' };
  }
  return classifyTestRequestSnapshot(row);
}

/**
 * Per-run test-state lookup for scheduled jobs (Stage 1c). While
 * TEST_REQUEST_ISOLATION is off every request reads as ordinary with no read;
 * when on, each request is resolved once per run. Callers skip anything that
 * is not `ordinary` before claims, tokens, provider calls, writes or sends.
 */
export function createRequestTestStateLookup({ resolve = resolveRequestTestState, env = process.env } = {}) {
  const enabled = testRequestIsolationEnabled(env);
  const cache = new Map();
  return async function requestTestState(requestId) {
    if (!enabled) return { kind: 'ordinary', reason: 'isolation_off' };
    const key = String(requestId || '').toLowerCase();
    if (!cache.has(key)) cache.set(key, resolve(requestId));
    return cache.get(key);
  };
}

/** Counts a scheduled-job skip: test/anomaly rows vs. unreadable marker state. */
export function recordTestRequestSkip(summary, state) {
  const key = state?.kind === 'unknown' ? 'testStateUnknown' : 'skippedTestRequest';
  summary[key] = (summary[key] || 0) + 1;
}

/**
 * Early email refusal for service paths that mint links or create records
 * before the shared delivery seam would see the email (grantee invite,
 * materials create/invite/remind). Inactive unless TEST_REQUEST_ISOLATION=on;
 * when active, anything but a verified ordinary request is refused.
 */
export async function assertRequestEmailAllowed(
  requestId,
  { resolve = resolveRequestTestState, env = process.env } = {},
) {
  if (!testRequestIsolationEnabled(env)) return;
  const state = await resolve(requestId);
  if (state.kind === 'ordinary') return;
  const message = state.kind === 'unknown'
    ? 'Email was not sent: the request could not be confirmed as an ordinary request. Try again.'
    : 'Email is disabled for test requests.';
  throw new ServiceHttpError(message, {
    httpStatus: 409,
    code: 'test_request_email_denied',
    body: { error: message, code: 'test_request_email_denied' },
  });
}
