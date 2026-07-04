/**
 * Adapter: wmkf_policies + wmkf_policyversions (reviewer policy slots).
 *
 * A `wmkf_policy` is a named slot (e.g. `reviewer-coi`, `reviewer-ai-use`) whose
 * `wmkf_ActiveVersion` lookup points at the currently-published
 * `wmkf_policyversion` row. Reviewers ack the ACTIVE version; staff publish new
 * versions through the admin route. Both the read-time resolver
 * (`lib/external/policy-fetcher.js`) and the publish route
 * (`pages/api/admin/policies.js`) touch these two entities.
 *
 * This adapter mirrors the exact live DynamicsService calls those callers make
 * (Wave-3 buildout) so a later conversion commit can swap them in place without
 * changing filter/select/body shape.
 *
 * Restriction-context posture is CALLER-OWNED: every current caller wraps these
 * reads/writes in its own `bypassDynamicsRestrictions(...)` scope (policy-fetcher
 * uses `'policy-fetcher'`; the admin handler uses `'admin-policies'`). This
 * adapter therefore does NOT establish or bypass restriction context — it issues
 * raw transport calls and leaves the trust boundary to the caller, exactly as
 * today (Stage-7 will fold context into the layer deliberately, not here).
 *
 * The `wmkf_code`/`wmkf_versionlabel` string filters run through `odata.eq`
 * (doubles embedded quotes). `policy-fetcher` interpolated `wmkf_code` without
 * escaping; the admin route already escaped via its local `escapeOData`. For the
 * real, allowlisted slot codes (`reviewer-coi`, `reviewer-ai-use`) the escaped
 * and raw forms are byte-identical, so this is a safe hardening, not a behavior
 * change for any live input.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import * as odata from '../core/odata.js';
import { entitySet } from '../core/entity-registry.js';

const POLICY_ENTITY = entitySet('wmkf_policies');
const POLICY_VERSION_ENTITY = entitySet('wmkf_policyversions');

// Parent-slot projection incl. statecode + the active-version lookup, used by the
// read-time resolver's active-child sanity check (policy-fetcher.js).
const POLICY_SLOT_SELECT = [
  'wmkf_policyid',
  'wmkf_code',
  'wmkf_displayname',
  '_wmkf_activeversion_value',
  'statecode',
];

// Parent-slot projection the admin route lists slots with (no statecode).
const POLICY_ADMIN_SELECT = [
  'wmkf_policyid',
  'wmkf_code',
  'wmkf_displayname',
  '_wmkf_activeversion_value',
];

// Version-row projection shared by the admin route's history list and its
// (parent, label) idempotency lookup.
const POLICY_VERSION_SELECT = [
  'wmkf_policyversionid',
  'wmkf_versionlabel',
  'wmkf_policytitle',
  'wmkf_policybody',
  'wmkf_effectivedate',
  'statecode',
  'statuscode',
];

// $expand string the read-time resolver uses to pull the active child in one hop.
const ACTIVE_VERSION_EXPAND =
  'wmkf_ActiveVersion($select=wmkf_policyversionid,wmkf_versionlabel,wmkf_policytitle,wmkf_policybody,wmkf_effectivedate,statecode,_wmkf_policy_value)';

// ───────────────────────── wmkf_policies (reads) ─────────────────────────

/**
 * Resolve an active slot by code with its active version expanded (read-time).
 * Mirrors policy-fetcher.getActivePolicy. Returns the raw queryRecords result
 * (`{ records, ... }`); caller destructures `records`.
 */
export async function queryActiveSlotByCode(slotCode) {
  return DynamicsService.queryRecords(POLICY_ENTITY, {
    select: odata.select(POLICY_SLOT_SELECT),
    filter: odata.and([odata.eq('wmkf_code', slotCode), 'statecode eq 0']),
    expand: ACTIVE_VERSION_EXPAND,
    top: 1,
  });
}

/**
 * List parent slot rows by code (admin route). top:2 so a duplicate slot is
 * detectable. Mirrors policies.loadSlotState step 1.
 */
export async function querySlotByCode(slotCode) {
  return DynamicsService.queryRecords(POLICY_ENTITY, {
    select: odata.select(POLICY_ADMIN_SELECT),
    filter: odata.eq('wmkf_code', slotCode),
    top: 2,
  });
}

/**
 * Fetch a single parent slot with the admin projection (for its ETag annotation).
 * Mirrors policies.loadSlotState step 2.
 */
export async function getSlotForAdmin(policyId) {
  return DynamicsService.getRecord(POLICY_ENTITY, policyId, {
    select: odata.select(POLICY_ADMIN_SELECT),
  });
}

/**
 * Fetch a parent slot projecting ONLY the id — used solely to read a fresh
 * `_etag` before a resume-mode active-version flip. Mirrors policies.flipAndRetire.
 */
export async function getSlotEtagRow(policyId) {
  return DynamicsService.getRecord(POLICY_ENTITY, policyId, { select: 'wmkf_policyid' });
}

/**
 * Fetch a parent slot projecting ONLY the code — used for the concurrency-conflict
 * reverse lookup. Mirrors policies.reverseLookupSlotCode.
 */
export async function getSlotCodeRow(policyId) {
  return DynamicsService.getRecord(POLICY_ENTITY, policyId, { select: 'wmkf_code' });
}

// ───────────────────── wmkf_policyversions (reads) ─────────────────────

/**
 * List all versions of a slot, newest first. Mirrors policies.loadSlotState
 * version query. `_wmkf_policy_value` is an unquoted lookup GUID (odata.eqRaw).
 */
export async function queryVersionsByPolicy(policyId) {
  return DynamicsService.queryRecords(POLICY_VERSION_ENTITY, {
    select: odata.select(POLICY_VERSION_SELECT),
    filter: odata.eqRaw('_wmkf_policy_value', policyId),
    orderby: 'createdon desc',
    top: 50,
  });
}

/**
 * Idempotency lookup: a slot's version by exact label. top:2. Mirrors
 * policies.runPublish existing-version lookup.
 */
export async function queryVersionByLabel(policyId, versionLabel) {
  return DynamicsService.queryRecords(POLICY_VERSION_ENTITY, {
    select: odata.select(POLICY_VERSION_SELECT),
    filter: odata.and([
      odata.eqRaw('_wmkf_policy_value', policyId),
      odata.eq('wmkf_versionlabel', versionLabel),
    ]),
    top: 2,
  });
}

// ─────────────────── wmkf_policyversions / wmkf_policies (writes) ───────────────────

/**
 * Create a new version row bound to its parent slot. Mirrors policies.runPublish
 * Branch A create. Returns the created record (`{ wmkf_policyversionid, ... }`).
 */
export async function createVersion(policyId, { versionLabel, title, body, effectiveDate }) {
  return DynamicsService.createRecord(POLICY_VERSION_ENTITY, {
    wmkf_versionlabel: versionLabel,
    wmkf_policytitle: title,
    wmkf_policybody: body,
    wmkf_effectivedate: effectiveDate,
    'wmkf_Policy@odata.bind': `/${POLICY_ENTITY}(${policyId})`,
  });
}

/**
 * Flip a slot's active version, conditional on the parent ETag (If-Match).
 * Mirrors policies.flipAndRetire parent PATCH.
 */
export async function setActiveVersion(policyId, versionId, { ifMatch } = {}) {
  return DynamicsService.updateRecord(
    POLICY_ENTITY,
    policyId,
    { 'wmkf_ActiveVersion@odata.bind': `/${POLICY_VERSION_ENTITY}(${versionId})` },
    { ifMatch },
  );
}

/**
 * Retire a prior version by setting its state/status codes (best-effort in the
 * caller). Mirrors policies.flipAndRetire prior-retire PATCH. The RETIRED code
 * values stay caller-owned (they come from the route's probed status map).
 */
export async function updateVersionState(versionId, { statecode, statuscode }) {
  return DynamicsService.updateRecord(POLICY_VERSION_ENTITY, versionId, {
    statecode,
    statuscode,
  });
}

export const POLICY_ENTITY_NAME = POLICY_ENTITY;
export const POLICY_VERSION_ENTITY_NAME = POLICY_VERSION_ENTITY;
