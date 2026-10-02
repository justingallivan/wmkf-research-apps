/**
 * Shared helpers for the admin Test Request Factory run routes
 * (pages/api/admin/test-requests/runs/**): error mapping, the cooperative
 * deadline, and the small input validators. Lives here, not under pages/api,
 * so it is not counted as a route file.
 */

import { ServiceHttpError } from '../service-http-error.js';
import { GUID_RE } from '../../utils/guid.js';

const REQUEST_NUMBER = /^\d{1,10}$/;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,200}$/; // the ledger's grammar (run-ledger.js)
const MAX_LABEL_LENGTH = 120;
const MAX_CYCLE_FIELD_LENGTH = 32;
// Reserve for the response and teardown inside the function's own limit.
const DEADLINE_MARGIN_MS = 20_000;

/** Maps a ServiceHttpError through; anything else is logged and answered generically. */
export function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? { error: error.message, code: error.code });
  }
  console.error('admin test-request run error:', error);
  return res.status(500).json({ error: 'The Test Request run could not be processed.' });
}

/** Epoch ms after which a route should not start new work (maxDuration minus a margin). */
export function routeDeadline(maxSeconds) {
  return Date.now() + maxSeconds * 1000 - DEADLINE_MARGIN_MS;
}

export function invalidInput(res, message) {
  return res.status(400).json({ error: message, code: 'factory_invalid_input' });
}

/** Exact GUID: unlike isGuid, surrounding whitespace is refused, so the value the service receives is the value checked. */
export function isExactGuid(value) {
  return typeof value === 'string' && GUID_RE.test(value);
}

export const isRunId = isExactGuid;

/** True when the body is a plain object whose keys are all in `allowed` and include all of `required`. */
export function hasOnlyKeys(body, required, optional = []) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(body, key))
    && Object.keys(body).every((key) => allowed.has(key));
}

/** True for a body with no fields: absent, or an empty plain object. */
export function isEmptyBody(body) {
  if (body === undefined || body === null) return true;
  if (typeof body === 'string') return body === '';
  return typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0;
}

export const isRequestNumber = (value) => typeof value === 'string' && REQUEST_NUMBER.test(value);
export const isIdempotencyKey = (value) => typeof value === 'string' && IDEMPOTENCY_KEY.test(value);
export const isTestLabel = (value) => typeof value === 'string'
  && value.trim().length >= 1 && value.trim().length <= MAX_LABEL_LENGTH;
export const isOptionalCycleField = (value) => value === undefined
  || (typeof value === 'string' && value.length <= MAX_CYCLE_FIELD_LENGTH);
