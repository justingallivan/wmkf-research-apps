/**
 * Review Manager — reviewer-engagement campaign config service
 * (Route→Service Consolidation Plan, Stage 2 wave).
 *
 * Holds ALL business logic for GET/POST /api/review-manager/campaign-config;
 * the route is a thin shell (method dispatch, auth, GUID validation, DAL
 * context, HTTP mapping).
 *
 * Contract (plan Decision 3):
 *   - takes plain argument objects, never req/res;
 *   - returns plain values:
 *       getCampaignConfig  → { requestId, config }
 *       saveCampaignConfig → { success: true, requestId, config }
 *   - throws CampaignConfigError (extends ServiceHttpError) for domain
 *     failures; this route's envelopes are `{ error }`-shaped, so no `body`
 *     override is needed (the shell defaults to `{ error: message }`);
 *   - ASSUMES a trusted DAL context already exists — never establishes one.
 *
 * Semantics preserved exactly from the route (characterization tests are the
 * oracle): quotaNotifiedAt is read-only (absent from WRITABLE_FIELDS); field
 * validation happens BEFORE the existence read; POST confirms the request
 * exists before writing (a 404 from updateRecord is opaque); the POST
 * response config merges the pre-write record with the provided fields.
 */

import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import { ServiceHttpError } from '../service-http-error';

// camelCase field → { Dataverse column, value kind }. quotaNotifiedAt is intentionally
// absent from the WRITABLE set (system marker, read-only).
const WRITABLE_FIELDS = {
  respondOffsetDays: { col: 'wmkf_respondoffsetdays', kind: 'int' },
  reviewDueDate: { col: 'wmkf_reviewduedate', kind: 'date' },
  respondReminderEnabled: { col: 'wmkf_respondreminderenabled', kind: 'bool' },
  respondReminderLeadDays: { col: 'wmkf_respondreminderleaddays', kind: 'int' },
  reviewDueReminderEnabled: { col: 'wmkf_reviewduereminderenabled', kind: 'bool' },
  reviewDueReminderLeadDays: { col: 'wmkf_reviewduereminderleaddays', kind: 'int' },
  desiredCount: { col: 'wmkf_desiredcount', kind: 'int' },
};

const READ_SELECT = [
  'akoya_requestid',
  ...Object.values(WRITABLE_FIELDS).map((f) => f.col),
  'wmkf_quotanotifiedat',
].join(',');

/**
 * Domain error carrying an HTTP status for the route shell to map.
 * This route speaks `{ error }`, so no explicit `body` is set.
 */
export class CampaignConfigError extends ServiceHttpError {
  constructor(message, httpStatus) {
    super(message, { httpStatus });
    this.name = 'CampaignConfigError';
  }
}

function isYmd(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function readConfig(rec) {
  return {
    respondOffsetDays: rec?.wmkf_respondoffsetdays ?? null,
    reviewDueDate: rec?.wmkf_reviewduedate ?? null,
    respondReminderEnabled: rec?.wmkf_respondreminderenabled ?? null,
    respondReminderLeadDays: rec?.wmkf_respondreminderleaddays ?? null,
    reviewDueReminderEnabled: rec?.wmkf_reviewduereminderenabled ?? null,
    reviewDueReminderLeadDays: rec?.wmkf_reviewduereminderleaddays ?? null,
    desiredCount: rec?.wmkf_desiredcount ?? null,
    quotaNotifiedAt: rec?.wmkf_quotanotifiedat ?? null,
  };
}

// Validate + coerce a single provided field. Returns { col, value } or throws a
// caller-facing message. `null` is allowed (explicitly clears the column).
function coerceField(name, raw) {
  const spec = WRITABLE_FIELDS[name];
  if (!spec) throw new Error(`Unknown or read-only config field: ${name}`);
  if (raw === null) return { col: spec.col, value: null };
  if (spec.kind === 'int') {
    if (!Number.isInteger(raw) || raw < 0) throw new Error(`${name} must be a non-negative integer`);
    return { col: spec.col, value: raw };
  }
  if (spec.kind === 'bool') {
    if (typeof raw !== 'boolean') throw new Error(`${name} must be a boolean`);
    return { col: spec.col, value: raw };
  }
  if (spec.kind === 'date') {
    if (!isYmd(raw)) throw new Error(`${name} must be a YYYY-MM-DD date or null`);
    return { col: spec.col, value: raw };
  }
  throw new Error(`Unhandled field kind for ${name}`);
}

async function readRequest(requestId) {
  let rec;
  try {
    rec = await grantRequestAdapter.getById(requestId, { select: READ_SELECT });
  } catch {
    rec = null;
  }
  if (!rec?.akoya_requestid) {
    throw new CampaignConfigError(`No request found for ${requestId}`, 404);
  }
  return rec;
}

/**
 * Read the campaign config for a request.
 *
 * @param {Object} args
 * @param {string} args.requestId - GUID (already validated by the shell)
 * @returns {Promise<{ requestId: string, config: Object }>}
 * @throws {CampaignConfigError} httpStatus 404 when the request is not found
 */
export async function getCampaignConfig({ requestId }) {
  const rec = await readRequest(requestId);
  return { requestId, config: readConfig(rec) };
}

/**
 * Save a partial campaign config (only provided, valid fields are written).
 *
 * @param {Object} args
 * @param {string} args.requestId - GUID (already validated by the shell)
 * @param {Object} args.config - subset of the editable camelCase fields
 * @param {string|null} args.actingUserSystemId - Dynamics systemuser of the staff actor
 * @returns {Promise<{ success: true, requestId: string, config: Object }>}
 * @throws {CampaignConfigError} httpStatus 400 on invalid/unknown/empty fields;
 *   httpStatus 404 when the request is not found
 */
export async function saveCampaignConfig({ requestId, config, actingUserSystemId }) {
  const patch = {};
  try {
    for (const [name, raw] of Object.entries(config)) {
      if (raw === undefined) continue;
      const { col, value } = coerceField(name, raw);
      patch[col] = value;
    }
  } catch (validationErr) {
    throw new CampaignConfigError(validationErr.message, 400);
  }
  if (Object.keys(patch).length === 0) {
    throw new CampaignConfigError('config must contain at least one editable field', 400);
  }

  // Confirm the request exists before writing (a 404 from updateRecord is opaque).
  const rec = await readRequest(requestId);

  await grantRequestAdapter.updateById(requestId, patch, { actingUserSystemId });

  const merged = { ...readConfig(rec) };
  for (const [name, raw] of Object.entries(config)) {
    if (raw !== undefined && WRITABLE_FIELDS[name]) merged[name] = raw;
  }
  return { success: true, requestId, config: merged };
}
