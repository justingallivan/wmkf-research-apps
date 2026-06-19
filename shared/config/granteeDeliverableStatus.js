/**
 * Grantee deliverable status — shared constants for the Grantee Deliverables Portal.
 *
 * Single source of truth for the `wmkf_granteedeliverablestatus` picklist on the
 * core `akoya_request` entity. The Awardee-tab workflow, the external grantee
 * portal submit route, the metadata-probe preflight, the dashboard query, and the
 * UI ALL import from here — never compare on label, never inline the magic numbers.
 *
 * This status tracks the lifecycle of a grantee's deliverables PACKAGE (one
 * AI-formatted abstract the grantee edits/approves + one graphical image + a
 * caption). The image-publication waiver is a client-side submit gate, NOT a
 * stored field — a submitted package IS the consent record. See
 * docs/GRANTEE_PORTAL_SPEC.md.
 *
 * IMPORT DIRECTLY from this file — `import { GRANTEE_DELIVERABLE_STATUS } from
 * 'shared/config/granteeDeliverableStatus'`. Do NOT import via
 * `shared/config/index.js`: that barrel re-exports a server-only loader, which
 * would pull server-side deps into a client bundle. This module is deliberately
 * dependency-free so it is safe in both client and server bundles. (Same rule as
 * shared/config/triageStatus.js.)
 *
 * The numeric option values are mirrored in the Dataverse schema
 * (lib/dataverse/schema/wave2-grantee-deliverables/akoya_request-grantee-deliverables.json,
 * the source of truth for Dataverse) and MUST stay in sync with it. New values
 * may be appended additively without a migration.
 */

// Numeric option-set values (label → value). Dataverse picklist values.
// `null`/absent = not started (no option).
export const GRANTEE_DELIVERABLE_STATUS = {
  DRAFTED: 100000000,
  INVITED: 100000001,
  REMINDER_SENT: 100000002,
  SUBMITTED: 100000003,
  STAFF_REVIEW: 100000004,
  REVISION_REQUESTED: 100000005,
  COMPLETE: 100000006,
  CLOSED_NO_RESPONSE: 100000007,
};

// value → human label.
export const GRANTEE_DELIVERABLE_LABEL = {
  [GRANTEE_DELIVERABLE_STATUS.DRAFTED]: 'Drafted',
  [GRANTEE_DELIVERABLE_STATUS.INVITED]: 'Invited',
  [GRANTEE_DELIVERABLE_STATUS.REMINDER_SENT]: 'Reminder Sent',
  [GRANTEE_DELIVERABLE_STATUS.SUBMITTED]: 'Submitted',
  [GRANTEE_DELIVERABLE_STATUS.STAFF_REVIEW]: 'Staff Review',
  [GRANTEE_DELIVERABLE_STATUS.REVISION_REQUESTED]: 'Revision Requested',
  [GRANTEE_DELIVERABLE_STATUS.COMPLETE]: 'Complete',
  [GRANTEE_DELIVERABLE_STATUS.CLOSED_NO_RESPONSE]: 'Closed No Response',
};

/**
 * True iff `v` is a valid, settable grantee-deliverable option value. Coerces
 * numeric strings (so a JSON body's "100000003" passes), but rejects
 * null/undefined/'' — clearing the field is not a settable value through a
 * write route.
 *
 * @param {*} v
 * @returns {boolean}
 */
export function isValidGranteeDeliverableValue(v) {
  if (v === null || v === undefined || v === '') return false;
  const n = Number(v);
  return Number.isInteger(n) && Object.values(GRANTEE_DELIVERABLE_STATUS).includes(n);
}

/**
 * Statuses in which the grantee may still edit/submit through the portal. The
 * single source of truth shared by the external context route (what to render
 * editable) and the submit route (what to accept) — null/unknown is NOT here, so
 * both fail closed. Submitted / Staff Review / Complete / Closed are read-only.
 */
export const GRANTEE_EDITABLE_STATUSES = [
  GRANTEE_DELIVERABLE_STATUS.DRAFTED,
  GRANTEE_DELIVERABLE_STATUS.INVITED,
  GRANTEE_DELIVERABLE_STATUS.REMINDER_SENT,
  GRANTEE_DELIVERABLE_STATUS.REVISION_REQUESTED,
];

/**
 * True iff `v` (number or numeric string) is an editable status. Fail-closed on
 * null/unknown/non-numeric.
 * @param {*} v
 * @returns {boolean}
 */
export function isGranteeEditableStatus(v) {
  if (v === null || v === undefined || v === '') return false;
  const n = Number(v);
  return Number.isInteger(n) && GRANTEE_EDITABLE_STATUSES.includes(n);
}
