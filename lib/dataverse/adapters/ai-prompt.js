/**
 * Adapter: wmkf_ai_prompts (AI prompt store — Executor + admin publish + seeding).
 *
 * The `wmkf_ai_prompt` Dataverse table holds versioned prompt rows: same
 * `wmkf_ai_promptname` across rows, discriminated by `wmkf_ai_iscurrent` +
 * integer `wmkf_promptversion` (no parent/child, no activeVersion pointer). This
 * adapter mirrors — call-for-call — the query/write contracts the four live
 * callers use today, so a later conversion commit can swap them in place with no
 * DTO / filter / error change (Stage-2 behavior freeze):
 *   - lib/services/prompt-store.js  (Executor current-prompt fetch)
 *   - pages/api/admin/prompts/index.js  (inventory list)
 *   - pages/api/admin/prompts/[name].js  (versioned publish: GET history + PUT)
 *   - lib/services/prompt-seed.js  (bootstrap/recovery seeding)
 *
 * TRUST BOUNDARY — caller-owned Dynamics restriction context (do NOT change this):
 * prompt-store.js documents that its callers own the restriction context — the
 * leaf does not wrap `bypassDynamicsRestrictions(...)`, the caller must
 * `[VERIFIED via lib/services/prompt-store.js:14]`. The admin routes establish
 * that context THEMSELVES, after auth, before the query
 * `[VERIFIED via pages/api/admin/prompts/index.js:58,62]`. This adapter therefore
 * makes bare DynamicsService calls (exactly like the existing adapters, e.g.
 * lib/dataverse/adapters/contact.js:58) and NEVER wraps, injects, or bypasses
 * restriction context. Whatever restriction context the caller has established
 * is preserved unchanged; the adapter adds no context of its own.
 *
 * FIELD_SELECT stays local to this adapter (not in entity-registry.js) — the
 * three distinct SELECT projections below are caller-specific and intentionally
 * NOT collapsed: the Executor read omits provenance/status, the admin read adds
 * it, the seed read is a 4-field id/name/version/current slice.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import * as odata from '../core/odata.js';
import { entitySet } from '../core/entity-registry.js';
import { adapterError } from '../core/errors.js';

const ENTITY_SET = entitySet('wmkf_ai_prompts');

// Executor read projection — the exact fields the Executor / prompt resolver
// read. No provenance, no iscurrent/status. (prompt-store.js:47)
const EXECUTOR_SELECT = [
  'wmkf_ai_promptid', 'wmkf_ai_promptname', 'wmkf_ai_systemprompt',
  'wmkf_ai_promptbody', 'wmkf_ai_promptvariables', 'wmkf_ai_promptoutputschema',
  'wmkf_ai_model', 'wmkf_ai_temperature', 'wmkf_ai_maxtokens', 'wmkf_promptversion',
];

// Admin read projection — full editable metadata + S269 provenance columns.
// Byte-identical to index.js SELECT and [name].js ROW_SELECT (verified equal).
const ADMIN_ROW_SELECT = [
  'wmkf_ai_promptid', 'wmkf_ai_promptname', 'wmkf_promptversion', 'wmkf_ai_iscurrent',
  'wmkf_ai_promptstatus', 'wmkf_ai_systemprompt', 'wmkf_ai_promptbody',
  'wmkf_ai_promptvariables', 'wmkf_ai_promptoutputschema', 'wmkf_ai_model',
  'wmkf_ai_temperature', 'wmkf_ai_maxtokens',
  'createdon', 'modifiedon', '_modifiedby_value', 'wmkf_ai_publisheddatetime',
];

// Seed read projection — id/name/version/current slice. (prompt-seed.js:40)
const SEED_LIST_SELECT = [
  'wmkf_ai_promptid', 'wmkf_ai_promptname', 'wmkf_promptversion', 'wmkf_ai_iscurrent',
];

// Slim id-only / id+version selects used by the flip + verify steps.
const ID_SELECT = 'wmkf_ai_promptid';
const ID_VERSION_SELECT = 'wmkf_ai_promptid,wmkf_promptversion';

/** Stable machine codes for the Executor current-prompt resolution failures. */
export const PROMPT_STORE_ERROR_CODES = {
  NOT_FOUND: 'PROMPT_NOT_FOUND',
  DUPLICATE_CURRENT: 'PROMPT_DUPLICATE_CURRENT',
};

const nameEq = (promptName) => odata.eq('wmkf_ai_promptname', promptName);
const isCurrent = (value) => odata.eqRaw('wmkf_ai_iscurrent', value);

// ───────────────────────── reads (queryRecords) ─────────────────────────

/**
 * The single `iscurrent` row for a prompt name, resolved for the Executor.
 * Mirrors prompt-store.fetchCurrentPrompt: Executor SELECT, name+current filter,
 * top:2, and the SAME typed business errors (code + verbatim message) on 0 / >1
 * current rows. An underlying transport failure propagates unwrapped (no `code`).
 * (prompt-store.js:47)
 *
 * @param {string} promptName
 * @returns {Promise<object>} the single current prompt row
 */
export async function getCurrentForExecutor(promptName) {
  const r = await DynamicsService.queryRecords(ENTITY_SET, {
    select: odata.select(EXECUTOR_SELECT),
    filter: odata.and([nameEq(promptName), isCurrent(true)]),
    top: 2,
  });
  const rows = r.records || [];
  if (rows.length === 0) {
    throw adapterError(`No current prompt found for name "${promptName}"`, {
      code: PROMPT_STORE_ERROR_CODES.NOT_FOUND,
    });
  }
  if (rows.length > 1) {
    throw adapterError(`Multiple current prompts for name "${promptName}" — resolve in Dynamics`, {
      code: PROMPT_STORE_ERROR_CODES.DUPLICATE_CURRENT,
    });
  }
  return rows[0];
}

/**
 * All current rows (one per distinct name), admin projection, name asc, top:200.
 * (admin/prompts/index.js:64) Returns the raw queryRecords result (`{ records }`).
 */
export function listCurrent() {
  return DynamicsService.queryRecords(ENTITY_SET, {
    select: odata.select(ADMIN_ROW_SELECT),
    filter: isCurrent(true),
    orderby: 'wmkf_ai_promptname asc',
    top: 200,
  });
}

/**
 * All non-current rows, admin projection, version desc, top:200.
 * (admin/prompts/index.js:67) Returns the raw queryRecords result (`{ records }`).
 */
export function listNonCurrent() {
  return DynamicsService.queryRecords(ENTITY_SET, {
    select: odata.select(ADMIN_ROW_SELECT),
    filter: isCurrent(false),
    orderby: 'wmkf_promptversion desc',
    top: 200,
  });
}

/**
 * Every row for a name (version history + current), admin projection, version
 * desc, top:50. (admin/prompts/[name].js:68 handleGet)
 */
export function listVersions(promptName) {
  return DynamicsService.queryRecords(ENTITY_SET, {
    select: odata.select(ADMIN_ROW_SELECT),
    filter: nameEq(promptName),
    orderby: 'wmkf_promptversion desc',
    top: 50,
  });
}

/**
 * The current row(s) for a name, admin projection, top:3 — used to resolve the
 * prior row / detect a torn ≥2-current state in the publish path.
 * (admin/prompts/[name].js:111)
 */
export function queryCurrentRows(promptName) {
  return DynamicsService.queryRecords(ENTITY_SET, {
    select: odata.select(ADMIN_ROW_SELECT),
    filter: odata.and([nameEq(promptName), isCurrent(true)]),
    top: 3,
  });
}

/**
 * The current row(s) for a name, slim id+version projection, top:3 — the
 * post-flip "exactly one current" verification read. (admin/prompts/[name].js:213)
 */
export function queryCurrentIdVersions(promptName) {
  return DynamicsService.queryRecords(ENTITY_SET, {
    select: ID_VERSION_SELECT,
    filter: odata.and([nameEq(promptName), isCurrent(true)]),
    top: 3,
  });
}

/**
 * Every row for a name, seed projection (id/name/version/current), version desc,
 * top:50 — the seeder's plan/verify read. (prompt-seed.js:40)
 */
export function listSeedRows(promptName) {
  return DynamicsService.queryRecords(ENTITY_SET, {
    select: odata.select(SEED_LIST_SELECT),
    filter: nameEq(promptName),
    orderby: 'wmkf_promptversion desc',
    top: 50,
  });
}

// ───────────────────────── reads (getRecord) ─────────────────────────

/**
 * Fetch a single row by id with the id-only select — used purely to read a fresh
 * ETag before an iscurrent flip. Returns the record (carrying `_etag`).
 * (admin/prompts/[name].js:168, :238; prompt-seed.js:111)
 */
export function getIdOnly(id) {
  return DynamicsService.getRecord(ENTITY_SET, id, { select: ID_SELECT });
}

// ───────────────────────── writes ─────────────────────────

/**
 * Create a prompt row. `fields` is the complete column set the caller assembles
 * (content + iscurrent/version/published); the adapter owns only the entity set.
 * (admin/prompts/[name].js:176; prompt-seed.js:101)
 *
 * @param {object} fields full column payload
 * @param {object} [opts] passthrough DynamicsService options (e.g. actingUserSystemId)
 * @returns {Promise<object>} the created record
 */
export function create(fields, opts = {}) {
  return DynamicsService.createRecord(ENTITY_SET, fields, opts);
}

/**
 * Set a row's `wmkf_ai_iscurrent` flag, guarded by an optional If-Match ETag.
 * Every live caller flips it to `false` (retire the prior current row); the value
 * is explicit so the contract stays faithful to `updateRecord`.
 * (admin/prompts/[name].js:200, :239; prompt-seed.js:112)
 *
 * @param {string} id record id
 * @param {boolean} value new iscurrent value
 * @param {object} [opts] passthrough DynamicsService options (e.g. `{ ifMatch }`)
 */
export function setIsCurrent(id, value, opts = {}) {
  return DynamicsService.updateRecord(ENTITY_SET, id, { wmkf_ai_iscurrent: value }, opts);
}

export const ENTITY_SET_NAME = ENTITY_SET;
