/**
 * Triage status — shared constants for the Workbench triage field.
 *
 * Single source of truth for the `wmkf_triagestatus` picklist on the core
 * `akoya_request` entity. The route, backfill script, metadata-probe preflight,
 * dashboard query, and UI ALL import from here — never compare on label, never
 * inline the magic numbers.
 *
 * Triage drives DASHBOARD VISIBILITY ONLY (staff winnowing — in-contention vs
 * set-aside; reversible). It is NOT the official Phase I→II status flip, NOT the
 * board "Invited" signal, NOT the doc-arrival ("Phase II Pending") signal. See
 * docs/WORKBENCH_TRIAGE_FIELD_BUILD_PLAN.md "The lifecycle signals".
 *
 * IMPORT DIRECTLY from this file — `import { TRIAGE_STATUS } from
 * 'shared/config/triageStatus'`. Do NOT import via `shared/config/index.js`:
 * that barrel re-exports a server-only loader (lib/services/model-override-loader),
 * which would pull server-side deps into a client bundle. This module is
 * deliberately dependency-free so it is safe in both client and server bundles.
 *
 * The numeric option values are mirrored in the Dataverse schema
 * (lib/dataverse/schema/wave2-triagestatus/akoya_request-triagestatus.json,
 * the source of truth for Dataverse) and MUST stay in sync with it.
 */

// Numeric option-set values (label → value). Dataverse picklist values.
// `null`/absent = untriaged (no option). Additively extensible for J27 — new
// values can be appended without a migration.
export const TRIAGE_STATUS = {
  ADVANCING: 100000000,
  SET_ASIDE: 100000001,
};

// value → human label. Labels avoid the akoya_requeststatus='Active' collision.
export const TRIAGE_LABEL = {
  [TRIAGE_STATUS.ADVANCING]: 'Advancing',
  [TRIAGE_STATUS.SET_ASIDE]: 'Set aside',
};

/**
 * True iff `v` is a valid, settable triage option value. Coerces numeric
 * strings (so a JSON body's "100000000" passes), but rejects null/undefined —
 * clearing the field is not a settable value through the write route.
 *
 * @param {*} v
 * @returns {boolean}
 */
export function isValidTriageValue(v) {
  if (v === null || v === undefined || v === '') return false;
  const n = Number(v);
  return Number.isInteger(n) && Object.values(TRIAGE_STATUS).includes(n);
}
