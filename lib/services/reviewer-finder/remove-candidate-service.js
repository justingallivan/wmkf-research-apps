/**
 * Reviewer Finder — "Remove entirely" (permanent removal) service.
 *
 * Design: docs/REVIEWER_REMOVE_ENTIRELY_BUILD_PLAN.md (post-Codex-review,
 * no-block / audit-centric model, owner decisions S343, 2026-07-07).
 *
 * High-trust, PD self-service, NO BLOCKS. Safety = integrity + a durable
 * trail, not prevention:
 *   1. Atomicity — the Dataverse deletes (honorarium `akoya_request` +
 *      `wmkf_appreviewanswer` snapshot rows + the `wmkf_appreviewersuggestion`
 *      row [+ optionally the `contact`]) go in ONE atomic `$batch` changeset
 *      via `runChangeset` [VERIFIED via lib/dataverse/core/changeset.js —
 *      requires a trusted DAL context, all-or-none].
 *   2. Pre-delete audit breadcrumb — a durable `system_alerts` row via
 *      `NotificationService.notify` [VERIFIED via lib/services/
 *      notification-service.js] written BEFORE any delete. If that write
 *      throws, this function aborts before touching Dataverse/Postgres — the
 *      `await` naturally propagates, no delete has run yet.
 *   3. Accurate disclosure (`describeRemoval`) — what will be deleted, so the
 *      PD's decision is informed.
 *
 * Cross-store ordering (the one non-atomic seam): audit → Dataverse changeset
 * (atomic) → Postgres `ReviewDraftService.deleteBySuggestion` → audit-result
 * update. A Postgres failure AFTER the changeset commits is a recorded,
 * recoverable orphan draft — never silent (captured in the audit row's
 * metadata, not swallowed).
 *
 * Referential-delete ordering inside the changeset: `wmkf_appreviewanswer`
 * rows hold a lookup INTO the suggestion (`_wmkf_appreviewersuggestion_value`),
 * and the suggestion holds a lookup INTO the honorarium `akoya_request`
 * (`_wmkf_honorariumrequest_value`). Deletes are ordered leaf-to-root —
 * answer rows, then the suggestion, then the honorarium [, then the contact
 * last if opted in] — so no operation in the batch targets a record another
 * *later* operation in the same batch still references. [ASSUMED: Dataverse
 * evaluates each batch operation against the transaction state as it applies
 * sequentially, not a pre-batch snapshot — this ordering has not been
 * verified against live Dataverse relationship cascade-delete configuration
 * in this session; a Restrict-configured relationship would surface as an
 * atomic changeset failure (nothing deleted), not silent corruption, but
 * flagging this as unverified per "verify, don't assume".]
 *
 * Contact-association disclosure scope (Action B, opt-in contact delete):
 * covers what this DAL can verifiably query today — other reviewer
 * engagements for the same person (across other requests), other
 * akoya_requests where this contact is the primary contact (covers other
 * honorarium/grant-request roles), and portal-identity / BILL-vendor linkage
 * flags on the contact row itself. It deliberately does NOT attempt a CRM
 * email/task/appointment activity count — no queryable entity set for that
 * is registered in lib/dataverse/core/entity-registry.js today, and adding
 * one without confirming the real set/field names against live Dataverse
 * metadata would be exactly the kind of guess the registry exists to
 * prevent. This is a disclosed scope limitation, not a silent omission.
 */

import { isGuid } from '../../utils/guid';
import { ServiceHttpError } from '../service-http-error';
import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import * as potentialReviewerAdapter from '../../dataverse/adapters/potential-reviewer';
import * as contactAdapter from '../../dataverse/adapters/contact';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request';
import * as reviewAnswerAdapter from '../../dataverse/adapters/review-answer';
import { runChangeset, atomicParentWithChildren } from '../../dataverse/core/changeset';
import * as odata from '../../dataverse/core/odata';
import ReviewDraftService from '../review-draft-service';
import NotificationService from '../notification-service';
import AlertService from '../alert-service';

export class RemoveCandidateError extends ServiceHttpError {
  constructor(message, httpStatus, body) {
    super(message, { httpStatus, body });
    this.name = 'RemoveCandidateError';
  }
}

const HONORARIUM_SELECT = ['akoya_requestid', 'akoya_requestnum', 'akoya_recommendedamount'];

/**
 * Load the live removal context for one suggestion: the suggestion row
 * (fail-closed on applicant-excluded via `findById`), its parent request,
 * the linked honorarium request (if any), any review-answer snapshot rows,
 * and the linked contact (via the potential-reviewer person row) if present.
 * Shared by `describeRemoval` (preflight) and `removeCandidateEntirely`
 * (commit re-reads independently — no client-supplied disclosure is trusted
 * for the actual delete).
 */
async function loadRemovalContext(suggestionId) {
  const suggestion = await suggestionAdapter.findById(suggestionId);

  const request = suggestion._wmkf_request_value
    ? await grantRequestAdapter.getById(suggestion._wmkf_request_value, {
        select: grantRequestAdapter.SELECT_PROFILES.IDENTITY,
      })
    : null;

  let honorarium = null;
  if (suggestion._wmkf_honorariumrequest_value) {
    const h = await grantRequestAdapter.getById(suggestion._wmkf_honorariumrequest_value, {
      select: HONORARIUM_SELECT,
    });
    honorarium = h
      ? {
          id: h.akoya_requestid,
          requestNumber: h.akoya_requestnum ?? null,
          amount: h.akoya_recommendedamount ?? null,
        }
      : null;
  }

  const answersBySuggestion = await reviewAnswerAdapter.fetchAnswersBySuggestion([suggestionId]);
  const answerRows = answersBySuggestion[suggestionId] || [];

  let potentialReviewer = null;
  let contactId = null;
  if (suggestion._wmkf_potentialreviewer_value) {
    potentialReviewer = await potentialReviewerAdapter.getById(suggestion._wmkf_potentialreviewer_value);
    contactId = potentialReviewer?._wmkf_contact_value || null;
  }

  return { suggestion, request, honorarium, answerRows, potentialReviewer, contactId };
}

/**
 * Comprehensive-as-verifiable contact association preview for the opt-in
 * Action B disclosure. See module header for scope.
 */
async function describeContactAssociations(
  contactId,
  { excludeHonorariumId, potentialReviewerId, excludeSuggestionId } = {},
) {
  const [contactRow, otherEngagements, otherRequests] = await Promise.all([
    contactAdapter.getByIdWithSelect(contactId, ['wmkf_portaloid', 'wmkf_billcomid', 'akoya_isvendor']),
    potentialReviewerId ? suggestionAdapter.findAllByPotentialReviewer(potentialReviewerId) : Promise.resolve([]),
    grantRequestAdapter.queryAllRequests({
      select: 'akoya_requestid',
      filter: odata.eqGuid('_akoya_primarycontactid_value', contactId),
    }),
  ]);

  // Exclude the engagement being removed itself — otherEngagements returns
  // EVERY suggestion row for this person, including the current one.
  const otherEngagementCount = otherEngagements.filter(
    (r) => r.wmkf_appreviewersuggestionid !== excludeSuggestionId,
  ).length;

  const otherRequestRows = (otherRequests?.records || []).filter(
    (r) => !excludeHonorariumId || r.akoya_requestid !== excludeHonorariumId,
  );

  return {
    contactId,
    otherEngagementCount,
    otherGrantOrHonorariumRequestCount: otherRequestRows.length,
    portalIdentityLinked: Boolean(contactRow?.wmkf_portaloid),
    billVendorLinked: Boolean(contactRow?.wmkf_billcomid || contactRow?.akoya_isvendor),
    note:
      'CRM email/task/appointment activity counts are not included — no verified ' +
      'queryable entity set is registered for them yet.',
  };
}

/**
 * Preflight — the accurate disclosure a PD sees before confirming removal.
 * Pure read; makes no writes.
 *
 * @param {{ suggestionId: string }} args
 */
export async function describeRemoval({ suggestionId }) {
  if (!suggestionId || !isGuid(suggestionId)) {
    throw new RemoveCandidateError('suggestionId is required and must be a GUID', 400);
  }

  const { suggestion, request, honorarium, answerRows, contactId, potentialReviewer } =
    await loadRemovalContext(suggestionId);

  const hasSubmittedReview = Boolean(suggestion.wmkf_reviewreceivedat) || answerRows.length > 0;

  let contactAssociations = null;
  if (contactId) {
    contactAssociations = await describeContactAssociations(contactId, {
      excludeHonorariumId: honorarium?.id || null,
      potentialReviewerId: suggestion._wmkf_potentialreviewer_value || null,
      excludeSuggestionId: suggestionId,
    });
  }

  return {
    suggestionId,
    requestId: suggestion._wmkf_request_value || null,
    requestNumber: request?.akoya_requestnum || null,
    honorarium: honorarium ? { id: honorarium.id, requestNumber: honorarium.requestNumber, amount: honorarium.amount } : null,
    hasSubmittedReview,
    answerRowCount: answerRows.length,
    contactId,
    contactName: potentialReviewer?.wmkf_name || null,
    contactAssociations,
  };
}

/**
 * Permanently remove a reviewer↔request engagement. NO blocks — the caller
 * (route, after its own app-access gate) decides when/why. Safety is the
 * audit breadcrumb below, not a precondition here.
 *
 * @param {{ suggestionId: string, deleteContact?: boolean, actingUserSystemId?: string|null }} args
 * @returns {Promise<{ success: true, suggestionId: string, honorariumDeleted: boolean,
 *   answerRowsDeleted: number, contactDeleted: boolean, draftDeleted: boolean, auditAlertId: number|null }>}
 */
export async function removeCandidateEntirely({ suggestionId, deleteContact = false, actingUserSystemId = null }) {
  if (!suggestionId || !isGuid(suggestionId)) {
    throw new RemoveCandidateError('suggestionId is required and must be a GUID', 400);
  }

  // Re-read server-side — never trust a client-supplied preflight snapshot
  // for the actual delete. Fails closed on applicant-excluded (findById).
  const { suggestion, request, honorarium, answerRows, contactId, potentialReviewer } =
    await loadRemovalContext(suggestionId);

  const willDeleteContact = deleteContact === true && Boolean(contactId);

  let contactAssociations = null;
  if (willDeleteContact) {
    contactAssociations = await describeContactAssociations(contactId, {
      excludeHonorariumId: honorarium?.id || null,
      potentialReviewerId: suggestion._wmkf_potentialreviewer_value || null,
      excludeSuggestionId: suggestionId,
    });
  }

  const disclosureSnapshot = {
    requestId: suggestion._wmkf_request_value || null,
    requestNumber: request?.akoya_requestnum || null,
    honorarium: honorarium ? { id: honorarium.id, amount: honorarium.amount } : null,
    hasSubmittedReview: Boolean(suggestion.wmkf_reviewreceivedat) || answerRows.length > 0,
    answerRowCount: answerRows.length,
    contactId: willDeleteContact ? contactId : null,
    contactAssociations,
  };

  // ── 1. Pre-delete audit breadcrumb. If this throws, we abort BEFORE any
  //    delete — nothing below has run yet. ──
  const alert = await NotificationService.notify({
    type: 'reviewer_candidate_removed_entirely',
    severity: 'warning',
    title: `Reviewer removed entirely — suggestion ${suggestionId}`,
    message:
      `actingUserSystemId=${actingUserSystemId || 'unknown'} permanently removed suggestion ` +
      `${suggestionId} (request ${disclosureSnapshot.requestNumber || disclosureSnapshot.requestId || 'unknown'})` +
      (honorarium ? ` — cascading honorarium akoya_request ${honorarium.id} ($${honorarium.amount ?? 'unknown'})` : '') +
      (willDeleteContact ? ` — ALSO deleting contact ${contactId}` : ''),
    metadata: {
      actingUserSystemId,
      suggestionId,
      requestId: disclosureSnapshot.requestId,
      honorariumRequestId: honorarium?.id || null,
      honorariumAmount: honorarium?.amount ?? null,
      deleteContact: willDeleteContact,
      contactId: willDeleteContact ? contactId : null,
      disclosure: disclosureSnapshot,
      result: null, // filled in after the delete attempt (success/partial/failed)
    },
    source: 'reviewer-finder.remove-candidate-entirely',
  });
  const auditAlertId = alert?.id ?? null;

  // ── 2. Atomic Dataverse changeset — answer rows (leaf) → suggestion (mid)
  //    → honorarium → contact (root-most), see module header for the
  //    referential-ordering rationale. ──
  const snapshotKeys = new Set(answerRows.map((r) => r.questionKey));
  const answerDeleteOps = answerRows.map((r) => ({
    method: 'DELETE',
    entitySet: reviewAnswerAdapter.ENTITY_SET_NAME,
    keyPredicate: reviewAnswerAdapter.answerRowKeyPredicate(suggestionId, r.questionKey, snapshotKeys),
  }));
  const suggestionDeleteOp = {
    method: 'DELETE',
    entitySet: suggestionAdapter.ENTITY_SET_NAME,
    key: suggestionId,
  };
  const trailingOps = [];
  if (honorarium?.id) {
    trailingOps.push({ method: 'DELETE', entitySet: 'akoya_requests', key: honorarium.id });
  }
  if (willDeleteContact) {
    trailingOps.push({ method: 'DELETE', entitySet: contactAdapter.ENTITY_SET_NAME, key: contactId });
  }
  const operations = [
    ...atomicParentWithChildren({ parent: suggestionDeleteOp, children: answerDeleteOps }),
    ...trailingOps,
  ];

  let draftDeleted = 0;
  let postgresError = null;
  try {
    await runChangeset(operations, { actingUserSystemId });
  } catch (changesetError) {
    await updateAuditResult(auditAlertId, { status: 'changeset_failed', error: changesetError?.message || String(changesetError) });
    throw changesetError;
  }

  // ── 3. Postgres cross-store cleanup (NOT in the Dataverse changeset). A
  //    failure here is a recorded, recoverable orphan draft — never silent. ──
  try {
    draftDeleted = await ReviewDraftService.deleteBySuggestion(suggestionId);
  } catch (err) {
    postgresError = err?.message || String(err);
    console.error('[remove-candidate-entirely] Postgres draft delete failed after Dataverse changeset committed:', postgresError);
  }

  // ── 4. Update the audit row with the result. ──
  await updateAuditResult(auditAlertId, {
    status: postgresError ? 'partial_postgres_draft_delete_failed' : 'success',
    draftDeleted,
    postgresError,
  });

  return {
    success: true,
    suggestionId,
    honorariumDeleted: Boolean(honorarium?.id),
    answerRowsDeleted: answerDeleteOps.length,
    contactDeleted: willDeleteContact,
    draftDeleted: draftDeleted > 0,
    auditAlertId,
  };
}

/**
 * Best-effort audit-row result update. Never throws — the primary operation
 * (or its abort) has already been decided by the time this runs; a failure
 * to annotate the audit row is logged, not propagated (the row itself, sans
 * this update, remains the durable pre-delete record).
 */
async function updateAuditResult(auditAlertId, resultPatch) {
  if (!auditAlertId) return;
  try {
    await AlertService.updateAlertMetadata(auditAlertId, { result: resultPatch });
  } catch (err) {
    console.error('[remove-candidate-entirely] audit-result update failed (non-fatal):', err?.message || err);
  }
}
