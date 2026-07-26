/**
 * Reviewer Finder — "Remove entirely" (permanent removal) service.
 *
 * Design: docs/REVIEWER_REMOVE_ENTIRELY_BUILD_PLAN.md (post-Codex-review,
 * no-block / audit-centric model, owner decisions S343, 2026-07-07).
 *
 * High-trust, PD self-service, NO BLOCKS. Safety = integrity + a durable
 * trail, not prevention:
 *   1. Atomicity — the required Dataverse deletes (honorarium `akoya_request`
 *      + `wmkf_appreviewanswer` snapshot rows + the `wmkf_appreviewersuggestion`
 *      row) go in ONE atomic `$batch` changeset via `runChangeset` [VERIFIED
 *      via lib/dataverse/core/changeset.js — requires a trusted DAL context,
 *      all-or-none]. Optional contact deletion is a separate best-effort
 *      changeset AFTER the required changeset commits, so a Restrict
 *      relationship on the contact can never roll back Action A.
 *   2. Pre-delete audit breadcrumb — a durable `system_alerts` row via
 *      `NotificationService.notify` [VERIFIED via lib/services/
 *      notification-service.js] written BEFORE any delete. If that write
 *      throws, this function aborts before touching Dataverse/Postgres — the
 *      `await` naturally propagates, no delete has run yet.
 *   3. Accurate disclosure (`describeRemoval`) — what will be deleted, so the
 *      PD's decision is informed.
 *   4. Scoped SharePoint cleanup — current per-attempt folders are isolated
 *      and may be removed as a unit; legacy folders delete only the stored
 *      primary filename unless a trusted internal caller supplies an exact
 *      drive-item allowlist. The target set is resolved before any write.
 *
 * Cross-store ordering (the non-atomic seams): SharePoint target resolution →
 * audit → required Dataverse changeset (atomic) → optional contact delete
 * changeset → optional SharePoint review-file cleanup → Postgres
 * `ReviewDraftService.deleteBySuggestion` → audit-result update. Any
 * post-Action-A cleanup failure is recorded and returned as a partial warning;
 * it never undoes the committed Action A delete.
 *
 * Referential-delete ordering inside the changeset: `wmkf_appreviewanswer`
 * rows hold a lookup INTO the suggestion (`_wmkf_appreviewersuggestion_value`),
 * and the suggestion holds a lookup INTO the honorarium `akoya_request`
 * (`_wmkf_honorariumrequest_value`). Deletes are ordered leaf-to-root —
 * answer rows, then the suggestion, then the honorarium — so no operation in
 * the batch targets a record another
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
import { GraphService } from '../graph-service';
import { cleanupSharePointItemsDetailed } from '../sharepoint-cleanup';

export class RemoveCandidateError extends ServiceHttpError {
  constructor(message, httpStatus, body) {
    super(message, { httpStatus, body });
    this.name = 'RemoveCandidateError';
  }
}

const HONORARIUM_SELECT = ['akoya_requestid', 'akoya_requestnum', 'akoya_recommendedamount'];
const REVIEW_LIBRARY = 'akoya_request';
const ISOLATED_REVIEW_ATTEMPT_FOLDER_RE = /(?:^|\/)attempt_[0-9a-f]{32}$/i;

function reviewFilePointerFromSuggestion(suggestion) {
  const folder = suggestion?.wmkf_reviewsharepointfolder || null;
  const filename = suggestion?.wmkf_reviewfilename || null;
  return {
    folder,
    filename,
    wmkf_reviewsharepointfolder: folder,
    wmkf_reviewfilename: filename,
  };
}

function hasReviewArtifacts({ suggestion, answerRows, reviewFile }) {
  return Boolean(suggestion.wmkf_reviewreceivedat)
    || answerRows.length > 0
    || Boolean(reviewFile.folder || reviewFile.filename);
}

function messageFromError(err) {
  return err?.message || String(err);
}

function resultStatusFromWarnings(warnings) {
  if (!warnings.length) return 'success';
  if (warnings.length > 1) return 'partial_multiple_cleanup_failures';
  return `partial_${warnings[0]}`;
}

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

  const reviewFile = reviewFilePointerFromSuggestion(suggestion);

  return { suggestion, request, honorarium, answerRows, potentialReviewer, contactId, reviewFile };
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

  const { suggestion, request, honorarium, answerRows, contactId, potentialReviewer, reviewFile } =
    await loadRemovalContext(suggestionId);
  let reviewFileCleanupPlan = null;
  let reviewFileCleanupPreviewError = null;
  if (reviewFile.folder) {
    try {
      reviewFileCleanupPlan = await prepareScopedSharePointCleanup(reviewFile, null);
    } catch (err) {
      reviewFileCleanupPreviewError = messageFromError(err);
    }
  }

  const hasSubmittedReview = hasReviewArtifacts({ suggestion, answerRows, reviewFile });

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
    reviewFile,
    reviewSharePointFolder: reviewFile.folder,
    reviewFilename: reviewFile.filename,
    reviewFileCleanupPreview: reviewFileCleanupPlan
      ? {
          deletionPolicy: reviewFileCleanupPlan.deletionPolicy,
          deleteFiles: reviewFileCleanupPlan.filesToDelete.map((item) => ({
            id: item.id,
            name: item.name || null,
          })),
          preserveFiles: reviewFileCleanupPlan.preservedFiles,
        }
      : reviewFileCleanupPreviewError
        ? {
            deletionPolicy: 'skip_on_resolution_failure',
            deleteFiles: [],
            preserveFiles: [],
            error: reviewFileCleanupPreviewError,
          }
        : null,
  };
}

/**
 * Permanently remove a reviewer↔request engagement. NO blocks — the caller
 * (route, after its own app-access gate) decides when/why. There are no
 * business-stage blocks; integrity checks and the audit breadcrumb fail
 * closed before durable mutation.
 *
 * @param {{ suggestionId: string, deleteContact?: boolean, actingUserSystemId?: string|null,
 *   reviewFileDeletionAllowlist?: Array<{id:string,name:string}>|null }} args
 * @returns {Promise<{ success: true, suggestionId: string, honorariumDeleted: boolean,
 *   answerRowsDeleted: number, contactDeleted: boolean, draftDeleted: boolean,
 *   auditAlertId: number|null, warnings: string[], partialFailure?: string|null }>}
 */
export async function removeCandidateEntirely({
  suggestionId,
  deleteContact = false,
  actingUserSystemId = null,
  reviewFileDeletionAllowlist = null,
}) {
  if (!suggestionId || !isGuid(suggestionId)) {
    throw new RemoveCandidateError('suggestionId is required and must be a GUID', 400);
  }
  const normalizedReviewFileDeletionAllowlist =
    normalizeReviewFileDeletionAllowlist(reviewFileDeletionAllowlist);

  // Re-read server-side — never trust a client-supplied preflight snapshot
  // for the actual delete. Fails closed on applicant-excluded (findById).
  const { suggestion, request, honorarium, answerRows, contactId, potentialReviewer, reviewFile } =
    await loadRemovalContext(suggestionId);
  let scopedSharePointCleanupPlan = null;
  let sharePointTargetResolutionError = null;
  if (reviewFile.folder || normalizedReviewFileDeletionAllowlist !== null) {
    try {
      scopedSharePointCleanupPlan = await prepareScopedSharePointCleanup(
        reviewFile,
        normalizedReviewFileDeletionAllowlist,
      );
    } catch (err) {
      if (normalizedReviewFileDeletionAllowlist !== null) throw err;
      sharePointTargetResolutionError = messageFromError(err);
    }
  }

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
    hasSubmittedReview: hasReviewArtifacts({ suggestion, answerRows, reviewFile }),
    answerRowCount: answerRows.length,
    reviewFile,
    reviewSharePointFolder: reviewFile.folder,
    reviewFilename: reviewFile.filename,
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
      reviewSharePointFolder: reviewFile.folder,
      reviewFilename: reviewFile.filename,
      reviewFileDeletionAllowlist: normalizedReviewFileDeletionAllowlist,
      reviewFileDeletionPolicy: scopedSharePointCleanupPlan?.deletionPolicy || null,
      reviewFilesSelectedForDeletion: scopedSharePointCleanupPlan?.filesToDelete || null,
      reviewFilesPreserved: scopedSharePointCleanupPlan?.preservedFiles || null,
      reviewFileTargetResolutionError: sharePointTargetResolutionError,
      deleteContact: willDeleteContact,
      contactId: willDeleteContact ? contactId : null,
      disclosure: disclosureSnapshot,
      result: null, // filled in after the delete attempt (success/partial/failed)
    },
    source: 'reviewer-finder.remove-candidate-entirely',
  });
  const auditAlertId = alert?.id ?? null;

  // ── 2. Required atomic Dataverse changeset — answer rows (leaf) →
  //    suggestion (mid) → honorarium (root-most), see module header for the
  //    referential-ordering rationale. Contact delete intentionally is NOT in
  //    this changeset; a Restrict relationship on a well-connected contact
  //    must not roll back the valid engagement/honorarium removal. Robust
  //    force-delete of connected contacts is out of scope pending live
  //    Dataverse cascade verification. ──
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
  const operations = [
    ...atomicParentWithChildren({ parent: suggestionDeleteOp, children: answerDeleteOps }),
    ...trailingOps,
  ];

  let draftDeleted = 0;
  let postgresError = null;
  let contactDeleted = false;
  let contactDeleteError = null;
  let sharePointCleanup = {
    attempted: false,
    filesFound: 0,
    deleted: false,
    deletedCount: 0,
    selectedCount: 0,
    folderFilesFound: 0,
    filenames: [],
    deletedFiles: [],
    failedFiles: [],
    preservedCount: 0,
    preservedFilenames: [],
    deletionPolicy: null,
    error: null,
  };
  try {
    await runChangeset(operations, { actingUserSystemId });
  } catch (changesetError) {
    await updateAuditResult(
      auditAlertId,
      { status: 'changeset_failed', error: messageFromError(changesetError) },
      { suggestionId, actingUserSystemId },
    );
    throw changesetError;
  }

  // ── 3. Optional contact delete, isolated from Action A. ──
  if (willDeleteContact) {
    try {
      await runChangeset(
        [{ method: 'DELETE', entitySet: contactAdapter.ENTITY_SET_NAME, key: contactId }],
        { actingUserSystemId },
      );
      contactDeleted = true;
    } catch (err) {
      contactDeleteError = messageFromError(err);
      console.error(
        '[remove-candidate-entirely] Contact delete failed after required Dataverse changeset committed:',
        contactDeleteError,
      );
    }
  }

  // ── 4. SharePoint cleanup (NOT in the Dataverse changeset). The deleted
  //    suggestion's folder/filename pointer is already preserved in the audit
  //    snapshot above; file-byte cleanup is best-effort and never rolls back
  //    Action A. ──
  sharePointCleanup = sharePointTargetResolutionError
    ? skippedSharePointCleanupAfterResolutionFailure(sharePointTargetResolutionError)
    : await cleanupReviewSharePointFiles(reviewFile, scopedSharePointCleanupPlan);

  // ── 5. Postgres cross-store cleanup (NOT in the Dataverse changeset). A
  //    failure here is a recorded, recoverable orphan draft — never silent. ──
  try {
    draftDeleted = await ReviewDraftService.deleteBySuggestion(suggestionId);
  } catch (err) {
    postgresError = messageFromError(err);
    console.error('[remove-candidate-entirely] Postgres draft delete failed after Dataverse changeset committed:', postgresError);
  }

  const warnings = [];
  if (contactDeleteError) warnings.push('contact_delete_failed');
  if (sharePointCleanup.error) warnings.push('sharepoint_review_file_cleanup_failed');
  if (postgresError) warnings.push('postgres_draft_delete_failed');

  const resultPatch = {
    status: resultStatusFromWarnings(warnings),
    warnings,
    contactDeleted,
    contactDeleteError,
    sharePointCleanup,
    draftDeleted,
    postgresError,
  };

  // ── 6. Update the audit row with the result. ──
  await updateAuditResult(auditAlertId, resultPatch, { suggestionId, actingUserSystemId });

  return {
    success: true,
    suggestionId,
    honorariumDeleted: Boolean(honorarium?.id),
    answerRowsDeleted: answerDeleteOps.length,
    contactDeleteAttempted: willDeleteContact,
    contactDeleted,
    contactDeleteError,
    reviewFile,
    sharePointCleanup,
    sharePointCleanupAttempted: sharePointCleanup.attempted,
    sharePointReviewFilesDeleted: sharePointCleanup.attempted ? sharePointCleanup.deleted : false,
    sharePointReviewFilesDeletedCount: sharePointCleanup.deletedCount,
    draftDeleted: draftDeleted > 0,
    postgresError,
    warnings,
    partialFailure: warnings[0] || null,
    auditAlertId,
  };
}

function normalizeReviewFileDeletionAllowlist(allowlist) {
  if (allowlist == null) return null;
  if (!Array.isArray(allowlist)) {
    throw new RemoveCandidateError(
      'reviewFileDeletionAllowlist must be null or an array',
      400,
    );
  }
  const seenIds = new Set();
  return allowlist.map((item) => {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    if (!id || !name || seenIds.has(id)) {
      throw new RemoveCandidateError(
        'reviewFileDeletionAllowlist entries require unique non-empty id and name values',
        400,
      );
    }
    seenIds.add(id);
    return { id, name };
  });
}

async function prepareScopedSharePointCleanup(reviewFile, allowlist) {
  if (!reviewFile?.folder && allowlist !== null) {
    throw new RemoveCandidateError(
      'reviewFileDeletionAllowlist requires a live review SharePoint folder',
      409,
    );
  }
  const driveId = await GraphService.getDriveId(REVIEW_LIBRARY);
  const items = await GraphService.listFiles(REVIEW_LIBRARY, reviewFile.folder, { recursive: false });
  const files = (items || []).filter((item) => item?.id);
  const filesById = new Map(files.map((item) => [item.id, item]));
  let deletionPolicy;
  let filesToDelete;
  if (allowlist !== null) {
    deletionPolicy = 'explicit_allowlist';
    filesToDelete = allowlist.map((expected) => {
      const live = filesById.get(expected.id);
      if (!live || live.name !== expected.name) {
        throw new RemoveCandidateError(
          `reviewFileDeletionAllowlist no longer matches live SharePoint item ${expected.name} (${expected.id})`,
          409,
        );
      }
      return live;
    });
  } else if (ISOLATED_REVIEW_ATTEMPT_FOLDER_RE.test(reviewFile.folder)) {
    deletionPolicy = 'isolated_attempt_folder';
    filesToDelete = files;
  } else if (reviewFile.filename) {
    deletionPolicy = 'legacy_primary_filename_only';
    filesToDelete = files.filter((item) => item.name === reviewFile.filename);
  } else {
    deletionPolicy = 'preserve_all_no_filename';
    filesToDelete = [];
  }
  const deleteIds = new Set(filesToDelete.map((item) => item.id));
  const preservedFiles = files
    .filter((item) => !deleteIds.has(item.id))
    .map((item) => ({ id: item.id, name: item.name || null }));
  return {
    driveId,
    filesToDelete,
    preservedFiles,
    folderFilesFound: files.length,
    deletionPolicy,
  };
}

async function cleanupReviewSharePointFiles(reviewFile, scopedPlan = null) {
  if (!reviewFile?.folder) {
    return {
      attempted: false,
      filesFound: 0,
      deleted: false,
      deletedCount: 0,
      selectedCount: 0,
      folderFilesFound: 0,
      filenames: [],
      deletedFiles: [],
      failedFiles: [],
      preservedCount: 0,
      preservedFilenames: [],
      deletionPolicy: null,
      error: null,
    };
  }
  if (!scopedPlan) {
    return skippedSharePointCleanupAfterResolutionFailure(
      'pre-resolved cleanup plan unavailable',
    );
  }

  try {
    const driveId = scopedPlan.driveId;
    const items = scopedPlan.filesToDelete;
    const files = (items || []).filter((item) => item?.id);
    const preservedFiles = scopedPlan?.preservedFiles || [];
    if (files.length === 0) {
      return {
        attempted: true,
        filesFound: 0,
        deleted: false,
        deletedCount: 0,
        selectedCount: 0,
        folderFilesFound: scopedPlan?.folderFilesFound || 0,
        filenames: [],
        deletedFiles: [],
        failedFiles: [],
        preservedCount: preservedFiles.length,
        preservedFilenames: preservedFiles.map((item) => item.name).filter(Boolean),
        deletionPolicy: scopedPlan?.deletionPolicy || null,
        error: null,
      };
    }

    const cleanupResult = await cleanupSharePointItemsDetailed(
      driveId,
      files,
      'remove-candidate-review-files',
    );
    const cleanedUp = cleanupResult.failed.length === 0;
    return {
      attempted: true,
      filesFound: files.length,
      deleted: cleanedUp,
      deletedCount: cleanupResult.deleted.length,
      selectedCount: files.length,
      folderFilesFound: scopedPlan?.folderFilesFound ?? files.length,
      filenames: files.map((item) => item.name).filter(Boolean),
      deletedFiles: cleanupResult.deleted.map((item) => ({ id: item.id, name: item.name || null })),
      failedFiles: cleanupResult.failed.map((item) => ({
        id: item.id,
        name: item.name || null,
        error: item.error,
      })),
      preservedCount: preservedFiles.length,
      preservedFilenames: preservedFiles.map((item) => item.name).filter(Boolean),
      deletionPolicy: scopedPlan?.deletionPolicy || null,
      error: cleanedUp ? null : 'one_or_more_sharepoint_deletes_failed',
    };
  } catch (err) {
    const message = messageFromError(err);
    console.error('[remove-candidate-entirely] SharePoint review-file cleanup failed after Dataverse changeset committed:', message);
    return {
      attempted: true,
      filesFound: 0,
      deleted: false,
      deletedCount: 0,
      selectedCount: scopedPlan?.filesToDelete?.length || 0,
      folderFilesFound: scopedPlan?.folderFilesFound || 0,
      filenames: [],
      deletedFiles: [],
      failedFiles: [],
      preservedCount: scopedPlan?.preservedFiles?.length || 0,
      preservedFilenames: (scopedPlan?.preservedFiles || []).map((item) => item.name).filter(Boolean),
      deletionPolicy: scopedPlan?.deletionPolicy || null,
      error: message,
    };
  }
}

function skippedSharePointCleanupAfterResolutionFailure(error) {
  return {
    attempted: false,
    filesFound: 0,
    deleted: false,
    deletedCount: 0,
    selectedCount: 0,
    folderFilesFound: null,
    filenames: [],
    deletedFiles: [],
    failedFiles: [],
    preservedCount: 0,
    preservedFilenames: [],
    deletionPolicy: 'skip_on_resolution_failure',
    error: `sharepoint_target_resolution_failed: ${error}`,
  };
}

/**
 * Best-effort audit-row result update. Never throws — the primary operation
 * (or its abort) has already been decided by the time this runs; a failure
 * to annotate the audit row is logged, not propagated (the row itself, sans
 * this update, remains the durable pre-delete record).
 */
async function updateAuditResult(auditAlertId, resultPatch, fallbackContext = {}) {
  if (!auditAlertId) return;
  try {
    await AlertService.updateAlertMetadata(auditAlertId, { result: resultPatch });
  } catch (err) {
    const updateError = messageFromError(err);
    console.error('[remove-candidate-entirely] audit-result update failed (non-fatal):', updateError);
    try {
      await NotificationService.notify({
        type: 'reviewer_candidate_remove_audit_update_failed',
        severity: 'error',
        title: `Reviewer removal audit result update failed — suggestion ${fallbackContext.suggestionId || 'unknown'}`,
        message:
          `Could not update removal audit alert ${auditAlertId}; the attempted result ` +
          'is stored on this fallback alert.',
        metadata: {
          ...fallbackContext,
          auditAlertId,
          resultPatch,
          updateError,
        },
        source: 'reviewer-finder.remove-candidate-entirely',
      });
    } catch (notifyErr) {
      console.error(
        '[remove-candidate-entirely] fallback audit-update-failed alert failed:',
        messageFromError(notifyErr),
      );
    }
  }
}
