/**
 * Test Request Factory bounded resumable runner (build order item 5, slice
 * 5b). `advanceRun` performs EXACTLY ONE bounded step per call against the
 * frozen ledger API (lib/services/test-requests/run-ledger.js, slice 5a) and
 * the injected step bodies (basic-clone-steps.js). It never loops.
 *
 * Design doc: docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md,
 * "Operation contract and recovery". This runner is v4 (bundle) manifests
 * only: `--execute` in scripts/rehearse-test-request-sandbox.mjs remains the
 * path for a v3 (sandbox-source, no files) manifest.
 *
 * The run row (test_request_runs) stores identities and digests only; the
 * manifest and bundle stay on local disk and are passed in on every call.
 * Before doing anything else, every call refuses if the caller-supplied
 * manifest/bundle no longer match the ledger row's bound identities and
 * hashes -- a caller error, checked before any lease is claimed so a bad
 * manifest never touches the run's lease or version.
 *
 * Every JSONB value this file sends to the ledger (plannedIdentity,
 * readback) is a FLAT object built only from run-ledger.js's
 * `LEDGER_RECEIPT_KEYS` allowlist: step bodies in basic-clone-steps.js and
 * bundle-file-copy.js return richer, sometimes-nested shapes (a GoVerify
 * bypass receipt, a file-copy journal entry with nested `source`/
 * `destination`/`item`), so this file flattens them to the allowed key
 * names before every ledger call and reconstructs the shape the step
 * bodies' own verify/reverify functions expect when reading resources back.
 *
 * The run's own observation snapshot (Dataverse/SharePoint state right
 * after create) is NOT persisted to the ledger: the ledger's contract
 * (docs/atlas/postgres-test-request-runs.md) keeps it to
 * identities/hashes/timestamps, and the observation snapshot is neither.
 * The `observe` step performs the 60-second settle window; the `verify`
 * step re-reads a fresh single-shot snapshot of its own
 * (`observe(..., { observationMs: 0 })`) rather than re-running the wait.
 */

import crypto from 'node:crypto';
import {
  GOVERIFY_WORKFLOW,
  READBACK_FIELDS,
  bodyOrThrow,
  bundleSourceOf,
  checkPreallocatedRequestAbsent,
  compileBody,
  correctMeetingDate,
  createRequestWithGoverifyBypass,
  fenceSource,
  foundationBaselineDigest,
  getContactSnapshot,
  getFoundationSnapshot,
  getLocations,
  getRequest,
  guidEqual,
  isBundleManifest,
  listSharePointFiles,
  observe as observeStep,
  provisionSharePointLocation,
  readRequestForCorrection,
  reverifyClone,
  runPreflight,
  sha256,
  verifyClone,
} from './basic-clone-steps.js';
import { isGoverifyDeactivationUncertain } from './bypass-signal-fence.js';
import { expectedRequestFolder } from './sandbox-clone.js';
import {
  copyBundleFiles, planBundleFileCopies, reverifyCopiedItems, verifyCopiedFiles,
} from './bundle-file-copy.js';
import { planReviewFileCopies, REVIEW_FILE_COPY_POLICY } from './review-file-copy.js';
import { buildReviewerSubfolder } from '../reviewer-subfolder.js';
import { attestDocxPackageAgainstSource } from './docx-package-attestation.js';
import { LEDGER_REASON_CODES } from './run-ledger.js';
import { createIaSandboxDeps, processAnnotations } from './ia-sandbox-deps.js';
import {
  SYNTHETIC_GENERATED,
  SYNTHETIC_PROPOSAL_FILENAME,
  SYNTHETIC_PROPOSAL_TEXT,
} from './fixtures/initial-assessment-synthetic.js';
import {
  buildInitialAssessmentIdentity,
  sanitizeFilePart,
  sameId as sameSandboxId,
} from '../initial-assessment/artifact-model.js';
import {
  commitReadyLineage,
  conditionalOptions,
  rereadByGenerationKey,
} from '../initial-assessment/artifact-lineage.js';
import { renderInitialAssessmentDocx } from '../initial-assessment/template.js';
import { attestDocxPackageAgainstRender } from './docx-package-attestation.js';
import { hashGovernedDocxContent, GOVERNED_DOCX_HASH_PREFIX } from '../documents/governed-docx-hash.js';
import { REQUEST_DOCUMENT_ACTOR_POLICY } from '../request-document-actor-service.js';
import { createInitialAssessmentBoardSnapshot } from '../initial-assessment/controls-service.js';
import {
  INITIAL_ASSESSMENT_CONTRACT,
  INITIAL_ASSESSMENT_BOARD_SNAPSHOT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
  isInitialAssessmentBoardSnapshot,
} from '../../../shared/config/requestDocument.js';
import { requestInstitution } from '../../../shared/utils/institution.js';
import { meetingDateToCycleCode } from '../../utils/cycle-code.js';
import { createReviewsSandboxDeps, PERSON_READ_FIELDS } from './reviews-sandbox-deps.js';
import { SYNTHETIC_REVIEWER_MARKER_FIELDS } from './isolation.js';
import {
  syntheticPersonProjection,
  buildSuggestionCreateBody,
  buildCompletionWrite,
  SUGGESTION_COPY_FIELDS,
} from '../reviewer-engagement/seed-synthetic-review.js';
import { REVIEWER_SUGGESTION_FIELDS, REVIEWER_ANSWER_FIELDS } from './source-bundle.js';

/**
 * Give an error a stable lowercase code token so the ledger's own error
 * reduction (run-ledger.js, markNeedsAttention/recordError/
 * recordResourceFailure) has something more useful to record than
 * `unknown_error` -- the ledger discards message text entirely and reduces
 * an Error to a code; only this process's own return value and the CLI's
 * console/sidecar output carry the full human-readable message.
 */
function codedError(message, code) {
  if (!LEDGER_REASON_CODES.includes(code)) {
    throw new Error(`Not a member of LEDGER_REASON_CODES: ${code}`);
  }
  return Object.assign(new Error(message), { code });
}

/** The Basic recipe's step order (unchanged from slice 5b). */
const BASIC_STEP_ORDER = [
  'fence_source', 'create_request', 'correct_meeting_date', 'provision_location', 'copy_file', 'observe', 'verify',
];
/** Kept as the Basic order under its original exported name. */
export const STEP_ORDER = BASIC_STEP_ORDER;

/**
 * Per-recipe step order (slice 6a). `initial_assessment` is the Basic steps
 * through `verify`, then three IA-only steps; the Basic `verify` step
 * ADVANCES to `seed_initial_assessment` for this recipe instead of calling
 * markReady (see stepVerify below) -- only a recipe's LAST step may mark the
 * run ready.
 */
/**
 * `reviews` is cumulative on `initial_assessment` (slice 6c-i): the IA order,
 * then the four Reviews-only steps. `verify_initial_assessment` therefore
 * advances rather than marking ready for this recipe (see stepVerifyInitialAssessment's
 * terminal branch below), and only `verify_reviews` -- the recipe's actual
 * final step -- may markReady.
 */
const INITIAL_ASSESSMENT_STEP_ORDER = [
  ...BASIC_STEP_ORDER, 'seed_initial_assessment', 'seed_initial_assessment_snapshot', 'verify_initial_assessment',
];
export const RECIPE_STEP_ORDER = Object.freeze({
  basic: Object.freeze(BASIC_STEP_ORDER),
  initial_assessment: Object.freeze(INITIAL_ASSESSMENT_STEP_ORDER),
  reviews: Object.freeze([
    ...INITIAL_ASSESSMENT_STEP_ORDER, 'seed_reviewers', 'copy_review_file', 'seed_review_answers', 'verify_reviews',
  ]),
});

/** Fail closed on an unrecognized recipe, rather than silently defaulting. */
function stepOrderForRecipe(recipe) {
  const order = RECIPE_STEP_ORDER[recipe];
  if (!order) throw new Error(`Unknown Test Request Factory recipe: ${recipe}.`);
  return order;
}

/** Whether `recipe`'s step order includes `step` at all. Throws on an unrecognized recipe (same fail-closed rule as stepOrderForRecipe/nextStepFor). */
export function recipeIncludesStep(recipe, step) {
  return stepOrderForRecipe(recipe).includes(step);
}

/**
 * The lease duration (seconds) `--advance` should claim for `recipe`. Any
 * recipe whose step order runs the Initial Assessment steps chains several
 * sequential Dataverse/Graph calls under one lease with no renewal (owner
 * decision 2026-09-24, Codex adversarial round 1 F4) and needs the ledger's
 * maximum (900s, run-ledger.js claimLease's clamp); every other recipe keeps
 * the Basic 300s. Derived from RECIPE_STEP_ORDER via recipeIncludesStep so a
 * future IA-cumulative recipe (as `reviews` is on `initial_assessment`)
 * cannot miss this by omission at the CLI call site.
 */
export function recipeLeaseSeconds(recipe) {
  return recipeIncludesStep(recipe, 'seed_initial_assessment') ? 900 : 300;
}

/**
 * The step immediately after `currentStep` in `recipe`'s order, or `null`
 * when `currentStep` is that recipe's final step (the caller must markReady
 * instead of advancing). Throws if `currentStep` is not part of the order --
 * a caller/data bug, not a runtime condition to route around.
 */
export function nextStepFor(recipe, currentStep) {
  const order = stepOrderForRecipe(recipe);
  const index = order.indexOf(currentStep);
  if (index === -1) throw new Error(`Step ${currentStep} is not part of the ${recipe} recipe's step order.`);
  if (index + 1 >= order.length) return null;
  return { step: order[index + 1], index: index + 1 };
}

/** Drop undefined/null entries so an omitted field never reaches the ledger as `null` where the allowlist expects a typed value. */
function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null));
}

/**
 * Flatten a GoVerify bypass receipt (basic-clone-steps.js field names) onto
 * run-ledger.js's LEDGER_RECEIPT_KEYS allowlist. `status`/`workflowName`/
 * `reason` are not receipt keys (Dataverse record state must not be
 * journaled as free text): the workflow's identity is `workflowId` only,
 * and any human-readable reason is reported through recordResourceFailure's
 * `error` argument by the caller, never through this readback shape.
 */
function flattenGoverifyState(state) {
  return compact({
    workflowId: state.workflowId,
    versionNumber: state.originalVersionNumber == null ? undefined : String(state.originalVersionNumber),
    versionNumberAfter: (state.restoredVersionNumber ?? state.deactivatedVersionNumber) == null
      ? undefined : String(state.restoredVersionNumber ?? state.deactivatedVersionNumber),
    deactivationAttemptedAt: state.deactivationAttemptedAt,
    deactivationPatchAttemptedAt: state.deactivationPatchAttemptedAt,
    deactivatedAt: state.deactivatedAt,
    restoreAttemptedAt: state.restoreAttemptedAt,
    restoredAt: state.restoredAt,
    restored: state.restored,
    restoreVerified: state.restoreVerified,
    restoreWasAlreadyActive: state.restoreWasAlreadyActive,
    manualRecheckRequired: state.restoreManualRecheckRequired,
  });
}

/** Flatten a meeting-date correction patch (basic-clone-steps.js field names) onto the allowlist (no `reason`; an error goes through recordResourceFailure). */
function flattenMeetingDatePatch(patch) {
  return compact({
    meetingDate: patch.desired,
    valueBefore: patch.before,
    valueAfter: patch.after,
    patchAttemptedAt: patch.patchAttemptedAt,
    responseStatus: patch.patchResponseStatus,
    patchResponseReceivedAt: patch.patchResponseReceivedAt,
    readbackAt: patch.readbackAt,
  });
}

/** Flatten a SharePoint location-provisioning patch onto the allowlist. */
function flattenLocationPatch(patch) {
  return compact({
    parentLocationId: patch.parentId,
    folder: patch.folder,
    graphFolderAttemptedAt: patch.graphFolderAttemptedAt,
    folderItemId: patch.graphFolder?.id,
    graphFolderReadyAt: patch.graphFolderReadyAt,
    locationCreateAttemptedAt: patch.locationCreateAttemptedAt,
    responseStatus: patch.createResponseStatus,
    createResponseReceivedAt: patch.createResponseReceivedAt,
    locationId: patch.locationId,
  });
}

/**
 * Flatten one bundle-file-copy.js journal entry (which nests source/
 * destination/item, and carries a free-text `status`) onto the allowlist.
 * `status` is dropped -- the resource row's own `outcome` column (a
 * lowercase token) carries copy state instead; `inflateFileCopyEntry` below
 * reconstructs `status` from `outcome` for bundle-file-copy.js's own
 * verify/reverify functions, which are frozen and expect that field.
 */
function flattenFileCopyEntry(entry, index) {
  return compact({
    index,
    filename: entry.destination?.filename,
    folder: entry.destination?.folder,
    library: entry.destination?.library,
    size: entry.source?.size,
    contentHash: entry.source?.contentHash,
    sourceGraphItemId: entry.source?.graphItemId,
    driveId: entry.destinationDriveId,
    itemId: entry.item?.id,
    eTag: entry.item?.eTag,
    versionId: entry.item?.versionId,
    uploadAttemptedAt: entry.uploadAttemptedAt,
    itemJournaledAt: entry.itemJournaledAt,
    verifiedAt: entry.verifiedAt,
    // Reviews recipe only (slice 6c-ii Stage C): the DOCX package
    // comparator's digest of the downloaded destination bytes, journaled as
    // evidence (never equality-checked against the source, since
    // SharePoint's property promotion changes the bytes by design).
    attestedDigest: entry.attestedDigest,
    // Reviews recipe: the FRESHLY re-resolved source drive id (`entry.
    // sourceDriveId`, set at copy time by resolveDrives -- NOT `entry.
    // source.snapshotDriveId`, the bundle's stale export-time snapshot),
    // needed by reverifyCopiedItems/reconcileJournaledCopies to re-download
    // a FRESH source copy for DOCX package re-attestation. Basic/IA's
    // exact-hash files never re-download the source, so they keep using
    // the bundle's snapshot id here exactly as before this change (P1
    // regression fix: this used to be a SECOND `sourceDriveId:` key later
    // in this same object literal, silently overwriting the line above with
    // `undefined` for every non-reviewerUpload file).
    sourceDriveId: entry.kind === 'reviewerUpload' ? entry.sourceDriveId : entry.source?.snapshotDriveId,
    mimeType: entry.kind === 'reviewerUpload' ? entry.source?.mimeType : undefined,
  });
}

/** Reconstruct the shape bundle-file-copy.js's verifyCopiedFiles/reverifyCopiedItems expect from a ledger resource row. */
function inflateFileCopyEntry(row) {
  const flat = row.readback || {};
  return {
    index: flat.index,
    status: row.outcome === 'verified' ? 'verified' : row.outcome,
    destination: { filename: flat.filename ?? null, folder: flat.folder ?? null, library: flat.library ?? null },
    source: { size: flat.size ?? null, contentHash: flat.contentHash ?? null, mimeType: flat.mimeType ?? null, graphItemId: flat.sourceGraphItemId ?? null },
    destinationDriveId: flat.driveId ?? null,
    sourceDriveId: flat.sourceDriveId ?? null,
    attestedDigest: flat.attestedDigest ?? null,
    item: flat.itemId ? { id: flat.itemId, eTag: flat.eTag ?? null, versionId: flat.versionId ?? null } : null,
  };
}

/** Caller error: the supplied manifest/bundle no longer match the reserved run. Never touches the run row. */
function assertRunMatchesManifestAndBundle(run, manifest, bundle) {
  const mismatches = [];
  if (!isBundleManifest(manifest)) mismatches.push('manifest kind (runner is v4/bundle-only)');
  // A manifest built before slice 6a has no `recipe` field; treat that as
  // `basic` so an existing v4 manifest can still resume a Basic run.
  if ((manifest.recipe ?? 'basic') !== run.recipe) mismatches.push('recipe');
  if (manifest.createBodySha256 !== run.createBodySha256) mismatches.push('createBodySha256');
  if (manifest.source?.bundleSha256 !== run.bundleSha256) mismatches.push('bundleSha256 (manifest)');
  if (bundle && sha256(bundle) !== manifest.source?.bundleSha256) mismatches.push('bundleSha256 (bundle file)');
  if (manifest.copyPolicy?.digest !== run.copyPolicyDigest) mismatches.push('copyPolicyDigest');
  if (!guidEqual(manifest.source?.requestId, run.sourceRequestId)) mismatches.push('sourceRequestId');
  if (manifest.source?.revision !== run.sourceRevision) mismatches.push('sourceRevision');
  if (!guidEqual(manifest.values?.requestId, run.destinationRequestId)) mismatches.push('destinationRequestId');
  if (!guidEqual(manifest.values?.locationId, run.destinationLocationId)) mismatches.push('destinationLocationId');
  if (mismatches.length) {
    throw new Error(`Manifest/bundle does not match the reserved run (${mismatches.join(', ')}).`);
  }
}

async function completeStep(ledger, run, { nextStep, nextStepIndex, destinationRequestNumber = null }) {
  const advanced = await ledger.advanceStep({
    runId: run.runId,
    leaseToken: run.leaseToken,
    leaseGeneration: run.leaseGeneration,
    expectedVersion: run.version,
    nextStep,
    nextStepIndex,
    status: 'creating',
    destinationRequestNumber,
  });
  if (!advanced) return null;
  await ledger.releaseLease({ runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration });
  return advanced;
}

/**
 * Complete `currentStep` and advance to whatever the run's recipe puts next
 * in its order (see RECIPE_STEP_ORDER / nextStepFor above). Throws if
 * `currentStep` is not the recipe's final step but has no successor, or if
 * it IS the final step -- a final step must call markReady, never this.
 */
async function completeCurrentStep(ledger, run, currentStep, { destinationRequestNumber = null } = {}) {
  const next = nextStepFor(run.recipe, currentStep);
  if (!next) throw new Error(`${currentStep} is the ${run.recipe} recipe's final step; it must markReady, not advance.`);
  return completeStep(ledger, run, { nextStep: next.step, nextStepIndex: next.index, destinationRequestNumber });
}

async function stepFenceSource({ run, ledger, manifest, client, graph, sharePointTarget }) {
  const preflight = await runPreflight(client, graph, sharePointTarget);
  if (!guidEqual(preflight.foundation.accountid, run.expectedOrganizationId)) {
    throw codedError('Foundation account identity changed since prepare.', 'preflight_identity_changed');
  }
  if (preflight.grantOption.value !== manifest.expectedRequestType.value) {
    throw codedError('Grant request-type option changed since prepare.', 'preflight_identity_changed');
  }
  if (!guidEqual(preflight.appUser.systemuserid, run.expectedAppUserId)) {
    throw codedError('App-suite application user changed since prepare.', 'preflight_identity_changed');
  }
  if (preflight.siteId !== run.expectedGraphSiteId || preflight.driveId !== run.expectedGraphDriveId) {
    throw codedError('Graph site or Request drive identity changed since prepare.', 'preflight_identity_changed');
  }
  let source;
  try {
    source = await fenceSource(client, manifest, preflight.grantOption.value);
  } catch (error) {
    throw codedError(error.message, 'source_fence_failed');
  }
  const rebuiltBody = compileBody(preflight, manifest.values, source);
  if (sha256(rebuiltBody) !== run.createBodySha256) {
    throw codedError('Fresh preflight does not reproduce manifest body.', 'manifest_digest_mismatch');
  }
  await checkPreallocatedRequestAbsent(client, run.destinationRequestId);

  const advanced = await completeCurrentStep(ledger, run, 'fence_source');
  if (!advanced) return { run, step: 'fence_source', outcome: 'lease_lost', resources: [] };
  return { run: advanced, step: 'fence_source', outcome: 'advanced', resources: [] };
}

/**
 * Re-entry rule: read the preallocated destination GUID FIRST, unconditionally
 * (this subsumes both the fresh-create and resumed cases). Absent -> the POST
 * may proceed. Present and owned by this run -> recovered, no POST. Present
 * and NOT owned -> permanent needs_attention, never POST. A prior GoVerify
 * bypass on this run that never confirmed its restore also blocks a fresh
 * POST, since the runner cannot safely re-attempt the deactivate/restore
 * pairing across invocations (a signal fence cannot span calls).
 */
async function stepCreateRequest({ run, ledger, manifest, client, graph, sharePointTarget, bypassGoverify }) {
  const preflight = await runPreflight(client, graph, sharePointTarget);
  const priorResources = await ledger.listRunResources(run.runId);
  const priorGoverify = priorResources.filter((row) => row.resourceKind === 'workflow_bypass').slice(-1)[0];
  // A bypass row still `planned` with no deactivationPatchAttemptedAt never
  // dispatched the deactivation PATCH, so it cannot have left GoVerify off.
  const bypassNeverDispatched = priorGoverify?.outcome === 'planned' && !priorGoverify.readback?.deactivationPatchAttemptedAt;
  if (priorGoverify && !bypassNeverDispatched && (priorGoverify.outcome !== 'verified' || priorGoverify.readback?.restoreVerified !== true
    || isGoverifyDeactivationUncertain({
      deactivationPatchAttemptedAt: priorGoverify.readback?.deactivationPatchAttemptedAt,
      deactivatedAt: priorGoverify.readback?.deactivatedAt,
    }))) {
    // Checked before the GUID read so a recovered create can never advance
    // past a GoVerify workflow that may still be deactivated.
    throw codedError('A prior GoVerify bypass on this run is not confirmed restored; resolve manually before continuing.', 'goverify_restore_unverified');
  }
  const existing = await client.get(`/akoya_requests(${run.destinationRequestId})?$select=${READBACK_FIELDS.join(',')}`);
  const resources = [];
  let destinationRequestNumber = null;

  if (existing.status === 404) {
    // Dispatch-marker rule (Codex round twelve): a prior invocation that
    // journaled createAttemptedAt sent, or may have sent, the POST. Absence of
    // the GUID after an attempt is not definitive (the earlier worker may be
    // stalled past its lease), so the run stops instead of POSTing again.
    const attempted = priorResources.some((row) => row.resourceKind === 'dataverse_request' && (
      row.readback?.createAttemptedAt || row.readback?.createResponseReceivedAt || row.responseStatus != null || row.outcome !== 'planned'
    ));
    if (attempted) {
      throw codedError('A prior invocation attempted the Request POST and the GUID is not readable; resolve manually, never re-POST.', 'ambiguous_create_outcome');
    }
  }

  if (existing.status !== 404) {
    const row = bodyOrThrow('preallocated Request readback', existing);
    const owned = guidEqual(row.wmkf_testcreationrunid, manifest.values.runId)
      && guidEqual(row._createdby_value, run.expectedAppUserId)
      && guidEqual(row._ownerid_value, run.expectedAppUserId);
    if (!owned) {
      throw codedError('Preallocated request GUID exists and is not owned by this run; never re-create.', 'preallocated_request_present_not_owned');
    }
    const resource = await ledger.journalPlannedResource({
      runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
      step: 'create_request', resourceKind: 'dataverse_request', system: 'dataverse',
      plannedIdentity: { requestId: run.destinationRequestId },
    });
    const readback = await ledger.recordResourceReadback({
      resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
      responseStatus: 200,
      readback: compact({ recovered: true, requestNumber: row.akoya_requestnum == null ? undefined : String(row.akoya_requestnum) }),
      outcome: 'recovered',
    });
    resources.push(readback);
    destinationRequestNumber = row.akoya_requestnum == null ? null : String(row.akoya_requestnum);
  } else {
    const createResource = await ledger.journalPlannedResource({
      runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
      step: 'create_request', resourceKind: 'dataverse_request', system: 'dataverse',
      plannedIdentity: { requestId: run.destinationRequestId },
    });
    let goverifyResource = null;
    if (bypassGoverify) {
      goverifyResource = await ledger.journalPlannedResource({
        runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
        step: 'create_request', resourceKind: 'workflow_bypass', system: 'dataverse',
        plannedIdentity: { workflowId: GOVERIFY_WORKFLOW.definitionId },
      });
    }
    let goverifyState = {};
    // Create receipt state accumulates across callbacks so the dispatch marker
    // (createAttemptedAt) survives the response write; the ledger also merges
    // readbacks rather than replacing them (Codex round thirteen).
    let createState = {};
    const journal = async (patch) => {
      if (patch.goverifyBypass && goverifyResource) {
        goverifyState = patch.goverifyBypass;
        const reasonText = goverifyState.restoreManualRecheckReason ?? goverifyState.restoreError
          ?? goverifyState.restoreIntentPersistError ?? null;
        if (reasonText) {
          // A human-readable reason is never a receipt key; it goes through
          // recordResourceFailure's own `error` argument. The flat readback
          // fields recorded earlier (deactivationPatchAttemptedAt without a
          // matching deactivatedAt, etc.) are left in place for
          // isGoverifyDeactivationUncertain to recompute on resume.
          const row = await ledger.recordResourceFailure({
            resourceId: goverifyResource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
            outcome: 'ambiguous', error: codedError(reasonText, 'goverify_deactivation_uncertain'),
          });
          resources.push(row);
        } else {
          const flat = flattenGoverifyState(goverifyState);
          const row = await ledger.recordResourceReadback({
            resourceId: goverifyResource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
            responseStatus: null,
            readback: flat,
            outcome: flat.restored && flat.restoreVerified ? 'verified' : (flat.deactivationPatchAttemptedAt ? 'dispatched' : 'planned'),
          });
          resources.push(row);
        }
      }
      const createKeys = ['createAttemptedAt', 'createResponseStatus', 'createResponseReceivedAt'];
      if (createKeys.some((key) => key in patch)) {
        createState = { ...createState, ...compact({
          createAttemptedAt: patch.createAttemptedAt,
          responseStatus: patch.createResponseStatus,
          createResponseReceivedAt: patch.createResponseReceivedAt,
        }) };
        const flat = { ...createState };
        const row = await ledger.recordResourceReadback({
          resourceId: createResource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
          responseStatus: patch.createResponseStatus ?? null, readback: flat,
          outcome: patch.createResponseStatus ? 'dispatched' : 'planned',
        });
        resources.push(row);
      }
      if ('postCreateStepsSkipped' in patch && goverifyResource && patch.postCreateStepsSkipped) {
        const row = await ledger.recordResourceFailure({
          resourceId: goverifyResource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
          outcome: 'ambiguous', error: codedError(patch.postCreateStepsSkippedReason || 'Post-create steps were skipped after a GoVerify restore failure.', 'goverify_restore_failed'),
        });
        resources.push(row);
      }
    };
    const { created } = await createRequestWithGoverifyBypass({ client, manifest, preflightBefore: preflight, bypassGoverify, journal });
    const createdRow = bodyOrThrow('single Request create', created);
    destinationRequestNumber = createdRow.akoya_requestnum ?? null;
  }

  const advanced = await completeCurrentStep(ledger, run, 'create_request', { destinationRequestNumber });
  if (!advanced) return { run, step: 'create_request', outcome: 'lease_lost', resources };
  return { run: advanced, step: 'create_request', outcome: 'advanced', resources };
}

async function stepCorrectMeetingDate({ run, ledger, manifest, client }) {
  const request = await readRequestForCorrection(client, run.destinationRequestId);
  const resource = await ledger.journalPlannedResource({
    runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
    step: 'correct_meeting_date', resourceKind: 'dataverse_request_patch', system: 'dataverse',
    plannedIdentity: compact({ requestId: run.destinationRequestId, meetingDate: manifest.values.meetingDate }),
  });
  let journaled = false;
  const resources = [];
  const journal = async (patch) => {
    journaled = true;
    if (patch.after !== undefined) {
      const matched = String(patch.after || '').slice(0, 10) === manifest.values.meetingDate;
      const flat = flattenMeetingDatePatch(patch);
      const row = await ledger.recordResourceReadback({
        resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
        responseStatus: flat.responseStatus ?? null, readback: flat,
        outcome: matched ? 'verified' : (patch.patchResponseError ? 'ambiguous' : 'failed'),
      });
      resources.push(row);
      return;
    }
    if (patch.patchResponseError) {
      const row = await ledger.recordResourceFailure({
        resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
        outcome: 'ambiguous', error: codedError(patch.patchResponseError, 'meeting_date_patch_failed'),
      });
      resources.push(row);
      return;
    }
    const flat = flattenMeetingDatePatch(patch);
    const row = await ledger.recordResourceReadback({
      resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
      responseStatus: flat.responseStatus ?? null, readback: flat,
      outcome: 'dispatched',
    });
    resources.push(row);
  };
  await correctMeetingDate(client, manifest, request, journal);
  if (!journaled) {
    // No PATCH was needed (the source date already matched): journal the no-op.
    const row = await ledger.recordResourceReadback({
      resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
      responseStatus: null,
      readback: compact({ meetingDate: manifest.values.meetingDate, valueBefore: request.wmkf_meetingdate || undefined }),
      outcome: 'verified',
    });
    resources.push(row);
  }

  const advanced = await completeCurrentStep(ledger, run, 'correct_meeting_date');
  if (!advanced) return { run, step: 'correct_meeting_date', outcome: 'lease_lost', resources };
  return { run: advanced, step: 'correct_meeting_date', outcome: 'advanced', resources };
}

async function stepProvisionLocation({ run, ledger, manifest, client, graph, sharePointTarget }) {
  const request = await getRequest(client, run.destinationRequestId);
  const resource = await ledger.journalPlannedResource({
    runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
    step: 'provision_location', resourceKind: 'dataverse_document_location', system: 'dataverse',
    plannedIdentity: { locationId: run.destinationLocationId },
  });
  const resources = [];
  const existingLocations = await getLocations(client, run.destinationRequestId);
  if (existingLocations.length === 0) {
    const priorRows = await ledger.listRunResources(run.runId);
    const attempted = priorRows.some((row) => row.resourceKind === 'dataverse_document_location'
      && row.resourceId !== resource.resourceId && row.readback?.locationCreateAttemptedAt);
    if (attempted) {
      // Dispatch-marker rule: an earlier invocation attempted the location
      // POST; its absence is not definitive, so never POST a second one.
      throw codedError('A prior invocation attempted the location POST and no location is readable; resolve manually.', 'location_readback_mismatch');
    }
  }
  if (existingLocations.length > 0) {
    const owned = existingLocations.length === 1
      && guidEqual(existingLocations[0].sharepointdocumentlocationid, run.destinationLocationId)
      && guidEqual(existingLocations[0]._createdby_value, run.expectedAppUserId)
      && guidEqual(existingLocations[0]._ownerid_value, run.expectedAppUserId)
      && existingLocations[0].relativeurl === expectedRequestFolder(request.akoya_requestnum, run.destinationRequestId);
    if (!owned) {
      throw codedError('A Request SharePoint location exists that this run does not own; never create a second one.', 'location_preexisting');
    }
    const row = await ledger.recordResourceReadback({
      resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
      responseStatus: 200,
      readback: compact({
        recovered: true,
        locationId: existingLocations[0].sharepointdocumentlocationid,
        folder: existingLocations[0].relativeurl,
      }),
      outcome: 'recovered',
    });
    resources.push(row);
  } else {
    const journal = async (patch) => {
      const flat = flattenLocationPatch(patch);
      const row = await ledger.recordResourceReadback({
        resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
        responseStatus: flat.responseStatus ?? null, readback: flat,
        outcome: flat.locationId ? 'verified' : (flat.locationCreateAttemptedAt ? 'dispatched' : 'planned'),
      });
      resources.push(row);
    };
    await provisionSharePointLocation(client, graph, sharePointTarget, manifest, request, journal);
  }

  const advanced = await completeCurrentStep(ledger, run, 'provision_location');
  if (!advanced) return { run, step: 'provision_location', outcome: 'lease_lost', resources };
  return { run: advanced, step: 'provision_location', outcome: 'advanced', resources };
}

/**
 * One bundle document per call; which document = the count of already
 * verified sharepoint_file resources. Delegates to copyBundleFiles's own
 * exact-item recovery for a single-file slice. If a prior attempt journaled
 * an item ID for the next index but it was never verified, this refuses and
 * stops for manual inspection rather than re-planning it -- copyBundleFiles'
 * own destination-exists refusal is the safety net for anything genuinely
 * re-attempted, but an ambiguous prior identity should be looked at, not
 * silently retried.
 */
async function stepCopyFile({ run, ledger, manifest, client, graph, sharePointTarget }) {
  const request = await getRequest(client, run.destinationRequestId);
  const requestFolder = expectedRequestFolder(request.akoya_requestnum, request.akoya_requestid);
  let bundle;
  try {
    ({ bundle } = bundleSourceOf(manifest));
  } catch (error) {
    // A resumed run may outlive the bundle's 6-hour window; the run stops
    // here (needs_attention: bundle_stale) rather than copying stale files.
    throw codedError(error.message, 'bundle_stale');
  }
  const plannedFiles = planBundleFileCopies(bundle, { destinationRequestNumber: request.akoya_requestnum });

  const existingResources = await ledger.listRunResources(run.runId);
  const fileResources = existingResources.filter((row) => row.step === 'copy_file' && row.resourceKind === 'sharepoint_file');
  const verifiedCount = fileResources.filter((row) => row.outcome === 'verified').length;

  if (verifiedCount >= plannedFiles.length) {
    const advanced = await completeCurrentStep(ledger, run, 'copy_file');
    if (!advanced) return { run, step: 'copy_file', outcome: 'lease_lost', resources: [] };
    return { run: advanced, step: 'copy_file', outcome: 'advanced', resources: [] };
  }

  const index = verifiedCount;
  const pending = fileResources.find((row) => row.plannedIdentity?.index === index && row.outcome !== 'verified');
  if (pending && pending.readback?.itemId) {
    throw codedError(`File copy at index ${index} has an unverified journaled item (${pending.readback.itemId}); inspect before resuming.`, 'file_journal_unverified');
  }
  if (pending && pending.readback?.uploadAttemptedAt) {
    // Dispatch-marker rule: the PUT was attempted by an earlier invocation
    // and no item id was journaled; recover by hand, never PUT again.
    throw codedError(`File copy at index ${index} was attempted without a journaled item; inspect before resuming.`, 'file_ambiguous_unrecovered');
  }

  const resource = pending ?? await ledger.journalPlannedResource({
    runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
    step: 'copy_file', resourceKind: 'sharepoint_file', system: 'sharepoint',
    plannedIdentity: compact({ index, filename: plannedFiles[index]?.destination?.filename }),
  });

  const dependencies = {
    clearGraphCaches: () => graph.clearGraphCaches(),
    configuredSharePointTarget: () => graph.configuredSharePointTarget(),
    getSiteId: () => graph.getSiteId(),
    getDriveId: (library, options) => graph.getDriveId(library, options),
    getFileMetadataById: (driveId, itemId) => graph.getFileMetadataById(driveId, itemId),
    downloadFile: (driveId, itemId) => graph.downloadFile(driveId, itemId),
    getFileMetadataByPath: (library, folder, filename, options) => graph.getFileMetadataByPath(library, folder, filename, options),
    ensureFolderPath: (library, folder, options) => graph.ensureFolderPath(library, folder, options),
    uploadFile: (library, folder, filename, content, contentType, options) => (
      graph.uploadFile(library, folder, filename, content, contentType, options)
    ),
  };
  const resources = [];
  const journal = async (copies) => {
    const entry = copies[0];
    const flat = flattenFileCopyEntry(entry, index);
    if (entry.status === 'failed') {
      const row = await ledger.recordResourceFailure({
        resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
        outcome: 'failed', error: codedError(entry.error, 'file_copy_failed'),
      });
      resources.push(row);
      return;
    }
    const row = await ledger.recordResourceReadback({
      resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
      responseStatus: null, readback: flat, outcome: entry.status === 'verified' ? 'verified' : 'dispatched',
    });
    resources.push(row);
  };
  const preflight = await runPreflight(client, graph, sharePointTarget);
  await copyBundleFiles(
    { plannedFiles: [plannedFiles[index]], requestFolder, expectedSiteId: preflight.siteId, expectedDestinationDriveId: preflight.driveId },
    dependencies,
    journal,
  );

  const done = index + 1 >= plannedFiles.length;
  const advanced = done
    ? await completeCurrentStep(ledger, run, 'copy_file')
    : await completeStep(ledger, run, { nextStep: 'copy_file', nextStepIndex: run.stepIndex });
  if (!advanced) return { run, step: 'copy_file', outcome: 'lease_lost', resources };
  return { run: advanced, step: 'copy_file', outcome: 'advanced', resources };
}

async function stepObserve({ run, ledger, client, observationOverrides }) {
  await observeStep(client, run.destinationRequestId, observationOverrides);
  const advanced = await completeCurrentStep(ledger, run, 'observe');
  if (!advanced) return { run, step: 'observe', outcome: 'lease_lost', resources: [] };
  return { run: advanced, step: 'observe', outcome: 'advanced', resources: [] };
}

async function stepVerify({ run, ledger, manifest, client, graph, sharePointTarget }) {
  const preflight = await runPreflight(client, graph, sharePointTarget);
  // The 60s wait already happened in the `observe` step; the ledger does not
  // persist that snapshot (identities/hashes only), so verify re-reads a
  // fresh single-shot snapshot of its own.
  const observation = await observeStep(client, run.destinationRequestId, { observationMs: 0 });
  let files = null;
  let graphError = null;
  try {
    files = await listSharePointFiles(graph, observation);
  } catch (error) {
    graphError = error.message;
  }
  const [foundationAfter, contactsAfter] = await Promise.all([
    getFoundationSnapshot(client),
    getContactSnapshot(client, run.expectedOrganizationId),
  ]);
  const existingResources = await ledger.listRunResources(run.runId);
  const fileCopies = existingResources
    .filter((row) => row.step === 'copy_file' && row.resourceKind === 'sharepoint_file' && row.readback)
    .map(inflateFileCopyEntry);

  const verification = verifyClone(manifest, preflight, observation, files, foundationAfter, contactsAfter, fileCopies);
  try {
    await fenceSource(client, manifest, preflight.grantOption.value);
  } catch {
    verification.ok = false;
    verification.failures.push('source changed during clone rehearsal');
  }
  if (graphError) {
    verification.ok = false;
    verification.failures.push(`Graph folder inspection failed: ${graphError}`);
  }
  const reverifyFailures = await reverifyClone(graph, fileCopies);
  if (reverifyFailures.length) {
    verification.ok = false;
    verification.failures.push(...reverifyFailures.map((failure) => `final file check: ${failure}`));
  }

  if (!verification.ok) {
    throw codedError(`Verification failed: ${verification.failures.join('; ')}`, 'verification_failed');
  }

  // Only a recipe's FINAL step may markReady (see RECIPE_STEP_ORDER above).
  // The Basic recipe ends at `verify`; `initial_assessment` continues, so
  // its `verify` records a Foundation/Contact baseline digest -- proving no
  // Foundation/Contact row changes between this point and the IA steps that
  // follow it -- and ADVANCES instead.
  if (nextStepFor(run.recipe, 'verify') === null) {
    const ready = await ledger.markReady({
      runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration, expectedVersion: run.version,
      destinationRequestNumber: observation.request.akoya_requestnum,
    });
    if (!ready) return { run, step: 'verify', outcome: 'lease_lost', resources: [] };
    return { run: ready, step: 'verify', outcome: 'ready', resources: [] };
  }

  const resources = [];
  const digest = foundationBaselineDigest(foundationAfter, contactsAfter);
  // A repeated `verify` (the lease was lost after an earlier attempt recorded
  // the baseline but before it advanced) must compare against that first
  // baseline, never record a new one: re-recording would accept a
  // Foundation/Contact change made between the two attempts as the baseline.
  // The digest is written in the same insert that creates the baseline row
  // (plannedIdentity), so a lost response after that insert still leaves the
  // baseline durable; a unique index allows one baseline row per run.
  const priorBaselines = existingResources.filter((row) => row.resourceKind === 'foundation_baseline');
  if (priorBaselines.length > 0) {
    const recordedDigest = priorBaselines[0].plannedIdentity?.foundationBaselineSha256;
    if (!recordedDigest || recordedDigest !== digest) {
      throw codedError('Foundation/Contact rows changed since this run recorded its baseline, or the baseline is unreadable; resolve manually.', 'ia_verification_failed');
    }
  } else {
    const baseline = await ledger.journalPlannedResource({
      runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
      step: 'verify', resourceKind: 'foundation_baseline', system: 'dataverse',
      plannedIdentity: { foundationBaselineSha256: digest },
    });
    const recorded = await ledger.recordResourceReadback({
      resourceId: baseline.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
      responseStatus: null,
      readback: { foundationBaselineSha256: digest },
      outcome: 'verified',
    });
    resources.push(recorded);
  }

  const advanced = await completeCurrentStep(ledger, run, 'verify', { destinationRequestNumber: observation.request.akoya_requestnum });
  if (!advanced) return { run, step: 'verify', outcome: 'lease_lost', resources };
  return { run: advanced, step: 'verify', outcome: 'advanced', resources };
}

const IA_SEED_STEP = 'seed_initial_assessment';
const IA_SEED_RESOURCE_KIND = 'dataverse_request_document';

/** Read the request with formatted-lookup annotations, needed for `requestInstitution` (getRequest in basic-clone-steps.js omits them). */
/**
 * The destination Request fields every Initial Assessment render and
 * identity derive from. Shared by the seed step (which renders from them)
 * and the verify step (which re-renders the same synthetic fixture from
 * them and expects the same governed hash), so the two can never drift.
 */
async function readIaRenderInputs(client, requestId) {
  const request = await getIaSeedRequest(client, requestId);
  const requestNumber = String(request.akoya_requestnum || '').trim();
  const title = String(request.akoya_title || '').trim();
  const institution = requestInstitution(request) || '';
  const cycleCode = request.wmkf_meetingdate
    ? meetingDateToCycleCode(request.wmkf_meetingdate)?.toUpperCase()
    : null;
  if (!requestNumber || !title || !institution || !cycleCode) {
    throw codedError(
      'Destination request is missing a field required for the Initial Assessment identity (number/title/institution/cycle).',
      'ia_verification_failed',
    );
  }
  return { requestNumber, title, institution, cycleCode };
}

async function getIaSeedRequest(client, requestId) {
  const response = await client.get(
    `/akoya_requests(${requestId})?$select=akoya_requestnum,akoya_title,wmkf_meetingdate,_akoya_applicantid_value`,
    { Prefer: 'odata.include-annotations="*"' },
  );
  return processAnnotations(bodyOrThrow('destination Request readback (seed_initial_assessment)', response));
}

function iaSandboxResourceUrl(client) {
  const url = String(client.baseUrl || '');
  const suffix = '/api/data/v9.2';
  if (!url.endsWith(suffix)) {
    throw new Error(`seed_initial_assessment: client.baseUrl does not end with ${suffix}: ${url}`);
  }
  return url.slice(0, -suffix.length);
}

/**
 * `seed_initial_assessment` (Test Request Factory slice 6b, Stage B, item D):
 * produce one governed Initial Assessment for the destination request, using
 * the synthetic fixture (fixtures/initial-assessment-synthetic.js) in place
 * of a real AI proposal narrative / provider call, mirroring the producer's
 * own sequence (lib/services/initial-assessment/artifact-service.js
 * generateInitialAssessment, ~lines 94-275): create the Generating row,
 * render + hash the DOCX, ETag-PATCH the content hash and prompt identity,
 * ensure the artifact folder, upload, then commitReadyLineage. Every
 * mutating dependency is journaled before dispatch and after readback
 * (item 3): a resource with an attempt marker but no corresponding progress
 * STOPS the run rather than re-dispatching (dispatch-marker rule, mirroring
 * stepCopyFile above). This step never calls markReady -- only a recipe's
 * final step may (see RECIPE_STEP_ORDER).
 *
 * Deliberately simpler than the producer: it does not implement the
 * producer's claimExisting/prepareClaimForGeneration/recoverUploadedFile
 * branches for a claim raced by a DIFFERENT caller (impossible here -- this
 * run is the only writer of its own generation key) or for reusing partial
 * upload bytes across a changed input fingerprint (the fixture's inputs are
 * fixed, so the fingerprint never changes between attempts of the same run).
 */
/**
 * Ownership of an Initial Assessment registry row at this run's generation
 * key (Codex adversarial round 2 F5, round 3 F7). The key is deterministic
 * from the Request's own fields, so a row at it may belong to someone else
 * (a staff Generate on the sandbox request, in progress or finished). This
 * runner journals `claimTokenSha256` and `registryCreateAttemptedAt` BEFORE
 * its own create POST, and every lineage state keeps `wmkf_claimtoken` on
 * the row, so a row is this run's only if its token hashes to that journaled
 * digest. Applied to every row this step resolves, whatever its status, and
 * to the post-create reread, before anything is read from or written to it.
 * Ownership is never derived from the row itself.
 */
function assertIaRowOwnedByThisRun(row, receipt) {
  if (!row) return;
  if (!receipt.claimTokenSha256 || !receipt.registryCreateAttemptedAt) {
    throw codedError(
      'An Initial Assessment row exists at this generation key but this run never journaled a create; refusing to adopt it.',
      'ia_pointer_mismatch',
    );
  }
  const rowClaimTokenSha256 = row.wmkf_claimtoken
    ? crypto.createHash('sha256').update(String(row.wmkf_claimtoken)).digest('hex')
    : null;
  if (rowClaimTokenSha256 !== receipt.claimTokenSha256) {
    throw codedError(
      'The Initial Assessment row at this generation key does not carry this run\'s claim token; refusing to adopt it.',
      'ia_pointer_mismatch',
    );
  }
}

async function stepSeedInitialAssessment({ run, ledger, client, graph, sharePointTarget }) {
  // Bind this step's own Graph writes to the run's own verified site/drive
  // (matching every Basic step -- stepFenceSource/stepCreateRequest/
  // stepCopyFile/stepVerify all call runPreflight and compare its
  // siteId/driveId to run.expectedGraphSiteId/expectedGraphDriveId before any
  // Graph write). Without this, ensureFolderPath/uploadFile would resolve the
  // env-configured GraphService site/drive at call time with no drift check.
  const preflight = await runPreflight(client, graph, sharePointTarget);
  if (preflight.siteId !== run.expectedGraphSiteId || preflight.driveId !== run.expectedGraphDriveId) {
    throw codedError('Graph site or Request drive identity changed since prepare.', 'preflight_identity_changed');
  }
  const { siteId, driveId } = preflight;

  const { requestNumber, title, institution, cycleCode } = await readIaRenderInputs(client, run.destinationRequestId);

  const { inputFingerprint, generationKey } = buildInitialAssessmentIdentity({
    requestId: run.destinationRequestId,
    requestNumber,
    title,
    institution,
    cycleCode,
    proposalFilename: SYNTHETIC_PROPOSAL_FILENAME,
    proposalText: SYNTHETIC_PROPOSAL_TEXT,
  });

  const dependencies = createIaSandboxDeps({ resourceUrl: iaSandboxResourceUrl(client), graph });

  const existingResources = await ledger.listRunResources(run.runId);
  let resource = existingResources.find(
    (r) => r.step === IA_SEED_STEP && r.resourceKind === IA_SEED_RESOURCE_KIND,
  ) || null;
  const markers = resource?.readback || {};
  // The FULL current receipt is resent on every merge() call (not just the
  // new delta) -- the same convention flattenFileCopyEntry/journal use above
  // for copy_file -- so this is correct whether the ledger's readback column
  // merges JSONB (the real Postgres store) or replaces it wholesale.
  const receipt = { ...markers };

  async function ensureResource() {
    if (resource) return resource;
    resource = await ledger.journalPlannedResource({
      runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
      step: IA_SEED_STEP, resourceKind: IA_SEED_RESOURCE_KIND, system: 'dataverse',
      plannedIdentity: compact({
        generationKey,
        folder: INITIAL_ASSESSMENT_CONTRACT.relativeFolder,
      }),
    });
    return resource;
  }

  async function merge(patch, outcome = 'dispatched') {
    Object.assign(receipt, patch);
    resource = await ledger.recordResourceReadback({
      resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
      responseStatus: null, readback: compact(receipt), outcome,
    });
    return resource;
  }

  // Dispatch-marker rule: an upload attempted with no readable item is
  // unrecoverable automatically (never re-PUT); stop and require an operator
  // to inspect. Re-entry otherwise resolves entirely by generation key below.
  if (markers.uploadAttemptedAt && !markers.itemId) {
    throw codedError(
      `Initial Assessment DOCX upload for generation key ${generationKey.slice(0, 8)}… was attempted without a journaled item; inspect before resuming.`,
      'ia_upload_ambiguous',
    );
  }

  let row = await rereadByGenerationKey(generationKey, dependencies);
  assertIaRowOwnedByThisRun(row, markers);

  if (row?.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
    // Ready-row recovery (Codex adversarial round 1, F1): a prior invocation
    // committed the Ready lineage but died before the final receipt merge
    // below, so this receipt may lack the SharePoint item, source version and
    // content hash the snapshot and verify steps require. Recover them from
    // the Ready row itself (the same fields commitReadyLineage wrote; the
    // row's "gdc1:" governed hash re-encoded to the ledger's HEX64 form
    // exactly as the fresh-render branch does), refuse a Ready row that is
    // missing any of them or whose item disagrees with an item this run
    // already journaled, and journal the full receipt before advancing --
    // otherwise the snapshot step stops permanently with ia_pointer_mismatch
    // and no retry can repair the run.
    // Ownership, not just identity (Codex adversarial round 2, F5): the
    // generation key is deterministic from the Request's own fields, so a
    // Ready row at this key may have been produced by someone else (a staff
    // Generate on the sandbox request). This runner journals its claim-token
    // digest BEFORE its own create POST and the Ready PATCH keeps
    // wmkf_claimtoken on the row, so a Ready row is this run's only if that
    // digest matches. No pre-create receipt means this run never created
    // anything: refuse rather than adopt.
    // Ownership was asserted above (assertIaRowOwnedByThisRun).
    if (!row.wmkf_sharepointitemid || !row.wmkf_sharepointdriveid || !row.wmkf_sharepointversionid || !row.wmkf_contenthash) {
      throw codedError(
        'The Ready Initial Assessment at this generation key is missing its SharePoint item, drive, version, or content hash; inspect before resuming.',
        'ia_pointer_mismatch',
      );
    }
    // Every identity this run already journaled must agree with the row, and
    // a journaled anchor is never overwritten by the row's current value.
    const rowReceipt = {
      requestDocumentId: row.wmkf_requestdocumentid,
      itemId: row.wmkf_sharepointitemid,
      driveId: row.wmkf_sharepointdriveid,
      siteId: row.wmkf_sharepointsiteid || undefined,
      contentHash: governedHashToHex(row.wmkf_contenthash),
      sourceVersionId: String(row.wmkf_sharepointversionid),
    };
    for (const [key, rowValue] of Object.entries(rowReceipt)) {
      const journaled = markers[key];
      if (journaled == null || rowValue == null) continue;
      const same = (key === 'contentHash' || key === 'sourceVersionId')
        ? String(journaled) === String(rowValue)
        : sameSandboxId(String(journaled), String(rowValue));
      if (!same) {
        throw codedError(
          `The Ready Initial Assessment ${key} (${rowValue}) does not match the previously journaled ${key} (${journaled}); inspect before resuming.`,
          'ia_pointer_mismatch',
        );
      }
    }
    await ensureResource();
    await merge(compact({
      ...rowReceipt,
      ...compact(Object.fromEntries(Object.keys(rowReceipt).map((key) => [key, markers[key]]))),
      generationKey,
    }));
    const advanced = await completeCurrentStep(ledger, run, IA_SEED_STEP);
    if (!advanced) return { run, step: IA_SEED_STEP, outcome: 'lease_lost', resources: [] };
    return { run: advanced, step: IA_SEED_STEP, outcome: 'advanced', resources: [resource] };
  }

  if (!row && markers.registryCreateAttemptedAt) {
    // Dispatch-marker rule (matches the Basic recipe's create_request stop,
    // run-runner.js ~369): a prior invocation already journaled an attempt
    // at the registry create POST. The row not being readable now is not
    // proof the POST failed -- it may have committed and only the response
    // (or this run's own re-read) was lost. Never re-POST; an operator must
    // resolve this by hand.
    await ensureResource();
    throw codedError(
      'A prior invocation attempted the Initial Assessment registry create and the row is not readable; resolve manually, never re-POST.',
      'ambiguous_create_outcome',
    );
  }

  if (!row) {
    await ensureResource();
    const claimToken = crypto.randomUUID();
    const requestFolder = expectedRequestFolder(requestNumber, run.destinationRequestId);
    const folderPath = `${requestFolder}/${INITIAL_ASSESSMENT_CONTRACT.relativeFolder}`;
    const fileName = `${sanitizeFilePart(requestNumber)} Initial Assessment `
      + `${generationKey.slice(0, 8)}-${claimToken.slice(0, 8)}.docx`;
    // claimTokenSha256/filename land in the READBACK (not plannedIdentity):
    // the claim token/filename are only known once we decide to create (they
    // are not derivable from the generation key alone), so plannedIdentity
    // -- written by ensureResource() above, before this point -- can only
    // ever carry {generationKey, folder}.
    await merge({
      generationKey,
      filename: fileName,
      claimTokenSha256: crypto.createHash('sha256').update(claimToken).digest('hex'),
      registryCreateAttemptedAt: new Date().toISOString(),
    });
    let createError = null;
    try {
      await dependencies.createDocument({
        wmkf_name: `${requestNumber} Initial Assessment`,
        'wmkf_Request@odata.bind': `/akoya_requests(${run.destinationRequestId})`,
        wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
        wmkf_generationkey: generationKey,
        wmkf_cyclecode: cycleCode,
        wmkf_inputfingerprint: inputFingerprint,
        wmkf_claimtoken: claimToken,
        wmkf_producer: INITIAL_ASSESSMENT_CONTRACT.producer,
        wmkf_templateid: INITIAL_ASSESSMENT_CONTRACT.templateId,
        wmkf_templateversion: INITIAL_ASSESSMENT_CONTRACT.templateVersion,
        wmkf_promptname: INITIAL_ASSESSMENT_CONTRACT.promptName,
        wmkf_promptversion: INITIAL_ASSESSMENT_CONTRACT.promptVersion,
        wmkf_sharepointfolderpath: folderPath,
        wmkf_filename: fileName,
        wmkf_attemptcount: 1,
      }, {
        actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.SANDBOX_REHEARSAL,
        actorContext: {
          operation: 'test-request-factory-seed-initial-assessment',
          requestId: run.destinationRequestId,
          requestNumber,
          operationId: generationKey,
        },
      });
    } catch (error) {
      // Recovery is NEVER decided by the error's status/message (a genuine
      // duplicate-key rejection can be worded differently than expected, and
      // a network-level failure can happen after the write already
      // committed) -- the only ground truth is whether the row is now
      // readable by generation key, checked uniformly below regardless of
      // why this POST threw. The error is kept only as diagnostics.
      createError = error;
    }
    row = await rereadByGenerationKey(generationKey, dependencies);
    // A create race: if someone else's row now occupies the key, it is not
    // ours to adopt (round 3, F7). Ours carries the token we sent.
    assertIaRowOwnedByThisRun(row, receipt);
    if (!row) {
      // Fail closed (ambiguous_create_outcome, the same bare reason code the
      // Basic create stop uses) but do not discard why: the HTTP status goes
      // into the message and the original error is the `cause`; both reach
      // only the CLI's console/sidecar output, never the ledger.
      const status = Number.isInteger(createError?.httpStatus) ? createError.httpStatus
        : Number.isInteger(createError?.status) ? createError.status : null;
      throw Object.assign(codedError(
        `The Initial Assessment registry create failed${status ? ` (http ${status})` : ''} and the row is not readable; resolve manually, never re-POST.`,
        'ambiguous_create_outcome',
      ), { cause: createError });
    }
    await merge({ requestDocumentId: row.wmkf_requestdocumentid, generationKey });
  }

  // Reached when `row` pre-existed as GENERATING from an earlier invocation
  // of this step (a prior create/reread ran, but this run's own resource
  // resource row was somehow never journaled -- belt-and-suspenders).
  await ensureResource();
  if (!receipt.requestDocumentId) {
    // claimTokenSha256 is already journaled (asserted above); it is never
    // derived from the row.
    await merge(compact({
      requestDocumentId: row.wmkf_requestdocumentid,
      generationKey,
      filename: row.wmkf_filename,
    }));
  }

  if (row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
    || row.wmkf_claimtoken == null) {
    throw codedError('Initial Assessment registry row is not in a resumable Generating state.', 'ia_claim_lost');
  }
  const claimToken = row.wmkf_claimtoken;

  const generated = SYNTHETIC_GENERATED;
  const docx = await renderInitialAssessmentDocx({ requestNumber, title, institution, generated });
  // wmkf_contenthash (Dataverse field, producer parity): the governed-DOCX
  // dedup hash ("gdc1:" + base64url, governed-docx-hash.js). This hash covers
  // only the `word/` subtree, so -- unlike a raw sha256 of the whole DOCX --
  // it is IDENTICAL across independent renders of the same generated content
  // even though the `docx` Packer library stamps docProps.xml with the
  // current timestamp on every render. The ledger's `contentHash` receipt
  // key is HEX64 and cannot carry the "gdc1:"+base64url form directly, so it
  // carries the SAME digest re-encoded as hex (decode the base64url payload,
  // re-encode as hex) -- not an independent hash of different bytes, so it
  // stays stable across renders too.
  const governedContentHash = await hashGovernedDocxContent(docx);
  const contentHash = Buffer.from(governedContentHash.slice(GOVERNED_DOCX_HASH_PREFIX.length), 'base64url').toString('hex');

  await merge({ registryPatchAttemptedAt: new Date().toISOString() });
  await dependencies.updateDocument(row.wmkf_requestdocumentid, {
    wmkf_contenthash: governedContentHash,
    wmkf_promptname: INITIAL_ASSESSMENT_CONTRACT.promptName,
    wmkf_promptversion: INITIAL_ASSESSMENT_CONTRACT.promptVersion,
  }, conditionalOptions(row));
  row = await rereadByGenerationKey(generationKey, dependencies);
  if (!receipt.itemId) {
    // Never re-merge contentHash on a resume branch that does not upload:
    // once an item id is journaled, the bytes that will actually be used
    // going forward are whatever was already uploaded, not this
    // invocation's fresh (though byte-identical) render.
    await merge({ contentHash });
  }

  await merge({ graphFolderAttemptedAt: new Date().toISOString() });
  // Graph target: the run's own PREFLIGHT-VERIFIED siteId/driveId (checked
  // against run.expectedGraphSiteId/expectedGraphDriveId above), not
  // whatever GraphService would resolve on its own at call time -- matching
  // every Basic step's drift guard (stepFenceSource/stepCreateRequest/
  // stepCopyFile/stepVerify above). Never a fresh env-derived resolution.
  await dependencies.ensureFolderPath('akoya_request', row.wmkf_sharepointfolderpath, { siteId, driveId });

  // Dispatch-marker rule for the upload PUT (mirrors bundle-file-copy.js's
  // onItemCreated/itemJournaledAt convention, driven through stepCopyFile
  // above): if an earlier invocation's PUT already committed and its item id
  // was journaled, NEVER re-PUT -- re-read the exact item by stable id
  // instead. Only a genuinely unattempted or genuinely ambiguous (attempted,
  // no journaled id -- checked at the top of this function) upload reaches
  // the PUT below.
  let uploaded;
  if (receipt.itemId) {
    if (receipt.driveId !== driveId) {
      // The journaled item lives on a drive that no longer matches this
      // run's preflight-verified drive (the SharePoint target drifted
      // between invocations) -- never read or write against a drive this
      // run did not verify.
      throw codedError(
        'The journaled Initial Assessment DOCX drive no longer matches the preflight-verified Request drive; resolve manually.',
        'preflight_identity_changed',
      );
    }
    const refreshed = await dependencies.getFileMetadataById(receipt.driveId, receipt.itemId, { siteId });
    if (!refreshed) {
      // getFileMetadataById returns null on a clean 404 (files.js): the
      // journaled item no longer exists. Never re-PUT -- an upload marker
      // with a journaled id that is not readable is exactly as ambiguous as
      // one with no id at all.
      throw codedError(
        `Initial Assessment DOCX item ${receipt.itemId} was journaled but is no longer readable; inspect before resuming.`,
        'ia_upload_ambiguous',
      );
    }
    uploaded = { ...refreshed, siteId };
  } else {
    await merge({ uploadAttemptedAt: new Date().toISOString(), bytesSha256: rawSha256Hex(docx) });
    const onItemCreated = async (item) => {
      await merge({ itemId: item.id, driveId: item.driveId, siteId: item.siteId });
    };
    uploaded = await dependencies.uploadFile(
      'akoya_request',
      row.wmkf_sharepointfolderpath,
      row.wmkf_filename,
      docx,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      // conflictBehavior 'fail' (not the producer's default 'replace'): the
      // Factory's posture is fail-closed against an accidental duplicate PUT,
      // matching bundle-file-copy.js's own create-only upload above.
      // siteId/driveId: the preflight-verified pair, never a fresh resolve.
      { onItemCreated, conflictBehavior: 'fail', siteId, driveId },
    );
  }

  await merge({ changesetAttemptedAt: new Date().toISOString() });
  const ready = await commitReadyLineage(row, { metadata: uploaded, claimToken }, dependencies);

  await merge({
    requestDocumentId: ready.wmkf_requestdocumentid,
    generationKey,
    claimTokenSha256: crypto.createHash('sha256').update(claimToken).digest('hex'),
    contentHash,
    sourceVersionId: uploaded?.versionId ? String(uploaded.versionId) : undefined,
  });

  const advanced = await completeCurrentStep(ledger, run, IA_SEED_STEP);
  if (!advanced) return { run, step: IA_SEED_STEP, outcome: 'lease_lost', resources: [resource] };
  return { run: advanced, step: IA_SEED_STEP, outcome: 'advanced', resources: [resource] };
}

/**
 * Raw SHA-256 over file bytes (hex). NOT the `sha256(value)` helper imported
 * from basic-clone-steps.js, which JSON.stringifies its argument. Journaled
 * as the `bytesSha256` receipt key BEFORE each IA-recipe upload is
 * dispatched, so the verify step can require the downloaded package to be
 * byte-identical to what this run uploaded (owner decision 2026-09-24,
 * Codex adversarial round 2 F6: the governed hash ignores every non-word/
 * package part, so it alone cannot attest the complete DOCX).
 */
function rawSha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Decode the "gdc1:"+base64url governed-docx hash to the ledger's HEX64 form (same digest, re-encoded, never a different hash). */
function governedHashToHex(governedHash) {
  return Buffer.from(governedHash.slice(GOVERNED_DOCX_HASH_PREFIX.length), 'base64url').toString('hex');
}

const IA_SNAPSHOT_STEP = 'seed_initial_assessment_snapshot';

/**
 * Map a `controls-service.js` `ServiceHttpError` code from
 * `createInitialAssessmentBoardSnapshot` onto a member of LEDGER_REASON_CODES,
 * per the Stage C plan review ("Reason codes: ... or existing Basic codes
 * where they fit; add nothing to the ledger enums unless truly needed"). A
 * code this map does not recognize falls through to `describeLedgerError`'s
 * own classification (`upstream_http (http NNN)` etc.) at the call site,
 * never a bespoke unlisted code.
 */
function mapSnapshotErrorCode(code) {
  if (typeof code !== 'string') return null;
  if (code.endsWith('_stale')) return 'ia_snapshot_stale';
  // `initial_assessment_snapshot_in_progress` (controls-service.js
  // `snapshotClaimActive`, CLAIM_LEASE_MS = 15 minutes): a run that crashed
  // mid-snapshot and resumes within 15 minutes of its own last write hits
  // this every time, by design -- it is the function's OWN claim lease, not
  // a defect. `ia_claim_lost` here is an EXPECTED, self-resolving stop: an
  // operator (or the next scheduled `--advance`) simply waits out the
  // remainder of the 15-minute window and retries; no manual reconciliation
  // is needed the way it is for `ambiguous_create_outcome`/`ia_upload_ambiguous`.
  if (code.endsWith('_in_progress') || code.endsWith('_claim_lost')) return 'ia_claim_lost';
  if ([
    '_hash_mismatch', '_identity_collision', '_readback_mismatch', '_contract_mismatch',
    '_ready_invalid', '_file_invalid', '_registry_conflict', '_path_collision',
    '_cleanup_invalid', '_source_incomplete', '_row_missing', '_file_missing',
    '_identity_mismatch', '_current_version_missing',
  ].some((suffix) => code.endsWith(suffix))) return 'ia_verification_failed';
  return null;
}

/**
 * `seed_initial_assessment_snapshot` (Test Request Factory slice 6b, Stage C,
 * plan item 6): create the Board Milestones snapshot of the seed step's Ready
 * Initial Assessment via `createInitialAssessmentBoardSnapshot`
 * (controls-service.js), reusing that function's own claim/upload/publish
 * sequence UNCHANGED and wrapping every mutating dependency it calls
 * (createDocument, updateDocument, ensureFolderPath, uploadFile) with the
 * same journal-before-dispatch convention `stepSeedInitialAssessment` uses
 * above, so the function's internally computed generation key, row and file
 * are journaled before each write without any change to controls-service.js.
 *
 * `expectedCurrentVersionId` is the seed step's own journaled
 * `sourceVersionId` (the version the seed step observed the instant its own
 * upload committed) -- deliberately NOT a fresh metadata read here, because
 * `createInitialAssessmentBoardSnapshot`'s contract compares the caller's
 * BELIEF about the current version against a fresh read and throws
 * `initial_assessment_snapshot_stale` (mapped to `ia_snapshot_stale`) on
 * drift (controls-service.js ~612); passing a fresh read here would defeat
 * that check entirely by always agreeing with itself.
 *
 * Dispatch-marker rule (never re-dispatch), checked BEFORE the function is
 * ever called: a journaled `registryCreateAttemptedAt` with no
 * `requestDocumentId` is resolved once, by ground truth
 * (`findByGenerationKey`), because the function's own create-recovery only
 * rereads on a 409/412/duplicate-shaped error (controls-service.js ~711), so
 * a lost-response create with a different-shaped error would otherwise
 * re-POST if the function were simply called again. A journaled
 * `uploadAttemptedAt` with no `itemId` stops the run before the function is
 * called at all: the function's own upload recovery
 * (`getFileMetadataByPath`, path-based) is not a stable-id check and could
 * silently treat an unrelated same-named/same-path file as recovered.
 *
 * Sandbox target binding: `ensureFolderPath`/`uploadFile` are called by
 * `controls-service.js` with NO siteId/driveId option at all (unlike the seed
 * step's own direct calls), so this step's wrappers inject the run's own
 * preflight-verified `siteId`/`driveId` into every options object passed
 * through, exactly as `stepSeedInitialAssessment` binds its own Graph writes.
 *
 * This step never calls markReady -- only the recipe's final step
 * (`verify_initial_assessment`) may.
 */
async function stepSeedInitialAssessmentSnapshot({ run, ledger, client, graph, sharePointTarget }) {
  const preflight = await runPreflight(client, graph, sharePointTarget);
  if (preflight.siteId !== run.expectedGraphSiteId || preflight.driveId !== run.expectedGraphDriveId) {
    throw codedError('Graph site or Request drive identity changed since prepare.', 'preflight_identity_changed');
  }
  const { siteId, driveId } = preflight;

  const existingResources = await ledger.listRunResources(run.runId);
  const seedResource = existingResources.find(
    (r) => r.step === IA_SEED_STEP && r.resourceKind === IA_SEED_RESOURCE_KIND,
  );
  const seedRequestDocumentId = seedResource?.readback?.requestDocumentId;
  const sourceVersionId = seedResource?.readback?.sourceVersionId;
  if (!seedRequestDocumentId || !sourceVersionId) {
    throw codedError(
      'The seed_initial_assessment step did not journal a request-document id and source version id to snapshot.',
      'ia_pointer_mismatch',
    );
  }

  const sandboxDeps = createIaSandboxDeps({ resourceUrl: iaSandboxResourceUrl(client), graph });

  let resource = existingResources.find(
    (r) => r.step === IA_SNAPSHOT_STEP && r.resourceKind === IA_SEED_RESOURCE_KIND,
  ) || null;
  const markers = resource?.readback || {};
  const receipt = { ...markers };

  async function ensureResource(plannedIdentity) {
    if (resource) return resource;
    resource = await ledger.journalPlannedResource({
      runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
      step: IA_SNAPSHOT_STEP, resourceKind: IA_SEED_RESOURCE_KIND, system: 'dataverse',
      plannedIdentity: compact(plannedIdentity),
    });
    return resource;
  }

  async function merge(patch, outcome = 'dispatched') {
    Object.assign(receipt, patch);
    resource = await ledger.recordResourceReadback({
      resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
      responseStatus: null, readback: compact(receipt), outcome,
    });
    return resource;
  }

  // Dispatch-marker rule for the upload PUT -- checked before the function is
  // ever invoked (see doc comment above): never let the function's own
  // path-based recovery decide an ambiguous case.
  if (markers.uploadAttemptedAt && !markers.itemId) {
    await ensureResource({});
    throw codedError(
      'Initial Assessment Board snapshot upload was attempted without a journaled item; inspect before resuming.',
      'ia_upload_ambiguous',
    );
  }

  // Dispatch-marker rule for the registry create, resolved once by ground
  // truth before letting the function run (and potentially re-POST) again.
  if (markers.registryCreateAttemptedAt && !markers.requestDocumentId && markers.generationKey) {
    const found = await sandboxDeps.findByGenerationKey(markers.generationKey);
    const foundRow = (found.records || []).length === 1 ? found.records[0] : null;
    await ensureResource({});
    if (!foundRow) {
      throw codedError(
        'A prior invocation attempted the Board snapshot registry create and the row is not readable; resolve manually, never re-POST.',
        'ambiguous_create_outcome',
      );
    }
    await merge({ requestDocumentId: foundRow.wmkf_requestdocumentid });
  }

  async function wrappedCreateDocument(payload, options) {
    await ensureResource({
      generationKey: payload.wmkf_generationkey,
      folder: `${INITIAL_ASSESSMENT_CONTRACT.relativeFolder}/${INITIAL_ASSESSMENT_BOARD_SNAPSHOT_CONTRACT.relativeFolder}`,
    });
    await merge(compact({
      generationKey: payload.wmkf_generationkey,
      filename: payload.wmkf_filename,
      claimTokenSha256: payload.wmkf_claimtoken
        ? crypto.createHash('sha256').update(payload.wmkf_claimtoken).digest('hex')
        : undefined,
      registryCreateAttemptedAt: new Date().toISOString(),
    }));
    let created;
    let createError = null;
    try {
      created = await sandboxDeps.createDocument(payload, options);
    } catch (error) {
      createError = error;
    }
    const found = await sandboxDeps.findByGenerationKey(payload.wmkf_generationkey);
    const foundRow = (found.records || []).length === 1 ? found.records[0] : null;
    if (!foundRow) {
      const status = Number.isInteger(createError?.httpStatus) ? createError.httpStatus
        : Number.isInteger(createError?.status) ? createError.status : null;
      throw Object.assign(codedError(
        `The Board snapshot registry create failed${status ? ` (http ${status})` : ''} and the row is not readable; resolve manually, never re-POST.`,
        'ambiguous_create_outcome',
      ), { cause: createError });
    }
    await merge({ requestDocumentId: foundRow.wmkf_requestdocumentid });
    return created ?? foundRow;
  }

  async function wrappedUpdateDocument(id, patch, options) {
    // `resource` may still be null here: the function's own `claimSnapshot`
    // path (controls-service.js) reaches this PATCH directly, without ever
    // calling `wrappedCreateDocument`, whenever `rereadSnapshot` already
    // finds an existing row for this generation key -- e.g. a staff member
    // created a Board snapshot of the same source version outside this run.
    // Ensure a resource row exists before the first `merge()` call in this
    // function, the same way `wrappedCreateDocument` does, or `merge()`
    // throws on a null `resource.resourceId`.
    await ensureResource({ requestDocumentId: id });
    await merge({ requestDocumentId: id, registryPatchAttemptedAt: new Date().toISOString() });
    const result = await sandboxDeps.updateDocument(id, patch, options);
    if (patch.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
      await merge(compact({
        requestDocumentId: id,
        driveId: patch.wmkf_sharepointdriveid,
        itemId: patch.wmkf_sharepointitemid,
        siteId: patch.wmkf_sharepointsiteid,
        versionId: patch.wmkf_sharepointversionid,
        contentHash: patch.wmkf_contenthash ? governedHashToHex(patch.wmkf_contenthash) : undefined,
      }), 'verified');
    }
    return result;
  }

  async function wrappedEnsureFolderPath(library, folder) {
    await merge({ graphFolderAttemptedAt: new Date().toISOString() });
    // siteId/driveId: the preflight-verified pair, never whatever
    // controls-service.js's own (option-less) call would let Graph resolve.
    return sandboxDeps.ensureFolderPath(library, folder, { siteId, driveId });
  }

  async function wrappedUploadFile(library, folder, filename, content, contentType, options = {}) {
    await merge({ uploadAttemptedAt: new Date().toISOString(), filename, bytesSha256: rawSha256Hex(Buffer.from(content)) });
    const onItemCreated = async (item) => {
      await merge({ itemId: item.id, driveId: item.driveId, siteId: item.siteId });
    };
    return sandboxDeps.uploadFile(library, folder, filename, content, contentType, {
      ...options, siteId, driveId, onItemCreated,
    });
  }

  /**
   * `createInitialAssessmentBoardSnapshot`'s own upload-resume path
   * (controls-service.js) always recovers by PATH -- `getFileMetadataByPath`
   * -- on every invocation, regardless of whether this run already journaled
   * a stable item id for a prior invocation's committed upload. If a
   * journaled item id already exists, trust the STABLE ID over whatever the
   * path happens to resolve to right now: a mismatch means something else
   * now occupies that path (or the path resolved to an unrelated item), and
   * silently adopting it would publish the wrong file as the Board snapshot.
   * Stop `ia_upload_ambiguous` rather than let the function's path-based
   * recovery decide.
   */
  async function wrappedGetFileMetadataByPath(library, folder, filename) {
    const found = await sandboxDeps.getFileMetadataByPath(library, folder, filename);
    // A journaled item that the path no longer resolves to (moved, renamed,
    // deleted, or an inconsistent path read) must NOT fall through to the
    // function's upload branch, which would PUT a second file and let
    // onItemCreated overwrite the journaled id (Codex adversarial round 1, F2).
    if (receipt.itemId && !found) {
      throw codedError(
        `The Board snapshot path no longer resolves to the previously journaled item ${receipt.itemId}; inspect before resuming.`,
        'ia_upload_ambiguous',
      );
    }
    if (receipt.itemId && found && !sameSandboxId(found.id, receipt.itemId)) {
      throw codedError(
        `The Board snapshot path resolved to item ${found.id}, not the previously journaled item ${receipt.itemId}; inspect before resuming.`,
        'ia_upload_ambiguous',
      );
    }
    return found;
  }

  const wrappedDeps = {
    ...sandboxDeps,
    createDocument: wrappedCreateDocument,
    updateDocument: wrappedUpdateDocument,
    ensureFolderPath: wrappedEnsureFolderPath,
    uploadFile: wrappedUploadFile,
    getFileMetadataByPath: wrappedGetFileMetadataByPath,
  };

  try {
    await createInitialAssessmentBoardSnapshot(
      { requestId: run.destinationRequestId, expectedArtifactId: seedRequestDocumentId, expectedCurrentVersionId: sourceVersionId },
      { dependencies: wrappedDeps },
    );
  } catch (error) {
    if (error?.code === 'ambiguous_create_outcome' || error?.code === 'ia_upload_ambiguous') throw error;
    const mapped = mapSnapshotErrorCode(error?.code);
    if (mapped) throw codedError(error.message, mapped);
    throw error;
  }

  // Ground-truth readback: the function returns a UI-projected shape, not the
  // raw row, and the `reused: true` shortcut never touches any wrapped
  // dependency at all -- so this reads the Ready snapshot row back directly,
  // exactly the way the seed step's Ready-resume branch above re-reads by
  // generation key rather than trusting a call's return value.
  const readback = await sandboxDeps.findByRequest(run.destinationRequestId, {
    artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
  });
  const snapshotRow = (readback.records || []).find((row) => isInitialAssessmentBoardSnapshot(row)
    && sameSandboxId(row._wmkf_sourcedocument_value, seedRequestDocumentId)
    && row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY);
  if (!snapshotRow) {
    throw codedError('The Board snapshot could not be confirmed Ready after creation.', 'ia_verification_failed');
  }
  await ensureResource({
    generationKey: snapshotRow.wmkf_generationkey,
    folder: `${INITIAL_ASSESSMENT_CONTRACT.relativeFolder}/${INITIAL_ASSESSMENT_BOARD_SNAPSHOT_CONTRACT.relativeFolder}`,
  });
  await merge(compact({
    requestDocumentId: snapshotRow.wmkf_requestdocumentid,
    generationKey: snapshotRow.wmkf_generationkey,
    driveId: snapshotRow.wmkf_sharepointdriveid,
    itemId: snapshotRow.wmkf_sharepointitemid,
    siteId: snapshotRow.wmkf_sharepointsiteid,
    versionId: snapshotRow.wmkf_sharepointversionid,
    sourceVersionId: snapshotRow.wmkf_sourceversionid,
    contentHash: snapshotRow.wmkf_contenthash ? governedHashToHex(snapshotRow.wmkf_contenthash) : undefined,
  }), 'verified');

  const advanced = await completeCurrentStep(ledger, run, IA_SNAPSHOT_STEP);
  if (!advanced) return { run, step: IA_SNAPSHOT_STEP, outcome: 'lease_lost', resources: resource ? [resource] : [] };
  return { run: advanced, step: IA_SNAPSHOT_STEP, outcome: 'advanced', resources: resource ? [resource] : [] };
}

const IA_VERIFY_STEP = 'verify_initial_assessment';

/**
 * `verify_initial_assessment` (Test Request Factory slice 6b, Stage C, plan
 * item 7), the `initial_assessment` recipe's TERMINAL verifier -- the only IA
 * step that may `markReady` (asserted below via `nextStepFor`).
 *
 * Re-runs the Basic safety verification (`verifyClone`/`reverifyClone`) with
 * a folder census extended to expect exactly the Basic copies plus the IA
 * DOCX and the Board snapshot file, compares a fresh Foundation/Contact
 * digest against the DURABLE baseline the Basic `verify` step recorded
 * (`foundation_baseline` resource -- `verifyClone`'s own before/after pair is
 * taken seconds apart inside one step and cannot see a change made between
 * steps), resolves the canonical Initial Assessment through the
 * sandbox-backed reader (never a raw read), confirms its Ready state and
 * content hash against freshly downloaded bytes, and re-reads the Board
 * snapshot file's metadata twice around a download (mirroring
 * `readStableRetainedSnapshotFile`) to confirm the two reads agree and the
 * bytes hash to both the snapshot row's own and its source content hash.
 */
/**
 * Shared verification body for `verify_initial_assessment` AND (slice 6c-ii
 * Stage C) `verify_reviews`, which re-runs it verbatim (plan "Verify": "re-
 * run the Basic verifier and the IA verifier's row checks"). Everything
 * `stepVerifyInitialAssessment` used to do between its own preflight/identity
 * check and its terminal advance-or-markReady branch, extracted unchanged so
 * both callers exercise the EXACT same checks rather than a re-implementation
 * that could drift. Throws (never returns) on any failure, exactly as before
 * extraction; on success returns everything the caller's own additional
 * checks and terminal branch need.
 */
async function verifyBasicAndInitialAssessment({
  run, ledger, manifest, client, graph, sharePointTarget, preflight, extraFileCopies = [], existingResources: existingResourcesOverride,
}) {
  if (preflight.siteId !== run.expectedGraphSiteId || preflight.driveId !== run.expectedGraphDriveId) {
    throw codedError('Graph site or Request drive identity changed since prepare.', 'preflight_identity_changed');
  }
  try {
    await fenceSource(client, manifest, preflight.grantOption.value);
  } catch (error) {
    throw codedError(`Source changed before Initial Assessment verification: ${error.message}`, 'source_changed');
  }

  const observation = await observeStep(client, run.destinationRequestId, { observationMs: 0 });
  const [foundationAfter, contactsAfter] = await Promise.all([
    getFoundationSnapshot(client),
    getContactSnapshot(client, run.expectedOrganizationId),
  ]);

  const existingResources = existingResourcesOverride ?? await ledger.listRunResources(run.runId);

  const baselineRow = existingResources.find((row) => row.resourceKind === 'foundation_baseline');
  const baselineDigest = baselineRow?.plannedIdentity?.foundationBaselineSha256
    ?? baselineRow?.readback?.foundationBaselineSha256;
  if (!baselineDigest) {
    throw codedError('No Foundation/Contact baseline was recorded by the Basic verify step.', 'ia_verification_failed');
  }
  if (foundationBaselineDigest(foundationAfter, contactsAfter) !== baselineDigest) {
    throw codedError('Foundation account or Contact rows changed since the Basic verify baseline.', 'ia_verification_failed');
  }

  const seedResource = existingResources.find((row) => row.step === IA_SEED_STEP && row.resourceKind === IA_SEED_RESOURCE_KIND);
  const snapshotResource = existingResources.find((row) => row.step === IA_SNAPSHOT_STEP && row.resourceKind === IA_SEED_RESOURCE_KIND);
  const seedRequestDocumentId = seedResource?.readback?.requestDocumentId;
  const snapshotRequestDocumentId = snapshotResource?.readback?.requestDocumentId;
  if (!seedRequestDocumentId || !snapshotRequestDocumentId) {
    throw codedError('The Initial Assessment or its Board snapshot was not journaled by an earlier step.', 'ia_pointer_mismatch');
  }

  const sandboxDeps = createIaSandboxDeps({ resourceUrl: iaSandboxResourceUrl(client), graph });

  let canonical;
  try {
    canonical = await sandboxDeps.resolveCanonical({
      requestId: run.destinationRequestId, expectedArtifactId: seedRequestDocumentId,
    });
  } catch (error) {
    throw codedError(`The canonical Initial Assessment could not be resolved: ${error.message}`, 'ia_pointer_mismatch');
  }
  const iaRow = canonical.row;
  if (!iaRow.wmkf_contenthash || !iaRow.wmkf_sharepointdriveid || !iaRow.wmkf_sharepointitemid) {
    throw codedError('The Ready Initial Assessment is missing its content hash or SharePoint file identity.', 'ia_verification_failed');
  }
  // Cross-check against the seed step's OWN journaled item id (Stage C
  // round 2, P3-3): the canonical row's SharePoint item is read fresh here,
  // through resolveCanonical/findByRequest, entirely independent of what the
  // seed step itself journaled when it uploaded the file. If they disagree,
  // either a different Initial Assessment file replaced the one this run
  // seeded, or the registry row's SharePoint identity was altered out of band.
  if (seedResource.readback.itemId && !sameSandboxId(iaRow.wmkf_sharepointitemid, seedResource.readback.itemId)) {
    throw codedError(
      'The canonical Initial Assessment SharePoint item does not match the seed step\'s journaled item.',
      'ia_pointer_mismatch',
    );
  }
  // Anchor the row's content hash and SharePoint version to what the seed
  // step journaled the instant it committed the Ready lineage (Codex
  // adversarial round 1, F3): a later in-place replacement of the file AND a
  // consistent rewrite of the row's hash would otherwise still verify,
  // because every other check below compares the row to bytes read now.
  // Mandatory, not conditional: every seed producer path (fresh render and
  // Ready-row recovery) journals both fields, so their absence is itself a
  // broken receipt rather than an older run to tolerate.
  if (!seedResource.readback.contentHash || governedHashToHex(iaRow.wmkf_contenthash) !== seedResource.readback.contentHash) {
    throw codedError('The Initial Assessment content hash does not match the hash the seed step journaled.', 'ia_pointer_mismatch');
  }
  if (!seedResource.readback.sourceVersionId || String(iaRow.wmkf_sharepointversionid) !== String(seedResource.readback.sourceVersionId)) {
    throw codedError('The Initial Assessment SharePoint version does not match the version the seed step journaled.', 'ia_pointer_mismatch');
  }
  // Independent anchor (owner decision 2026-09-24, Codex adversarial round
  // 1 F3): re-render the deterministic synthetic fixture from the
  // destination Request's own fields and require the row's governed hash to
  // equal that fresh render's. The governed hash is stable across renders
  // (docProps timestamps are excluded), so this expectation exists without
  // trusting the seed step's receipt at all.
  const renderInputs = await readIaRenderInputs(client, run.destinationRequestId);
  const expectedDocx = await renderInitialAssessmentDocx({
    requestNumber: renderInputs.requestNumber, title: renderInputs.title, institution: renderInputs.institution, generated: SYNTHETIC_GENERATED,
  });
  const expectedGovernedHash = await sandboxDeps.hashDocx(expectedDocx);
  if (expectedGovernedHash !== iaRow.wmkf_contenthash) {
    throw codedError('The Initial Assessment content hash does not match a fresh render of the synthetic fixture.', 'ia_verification_failed');
  }
  const iaMetadata = await sandboxDeps.getFileMetadataById(
    iaRow.wmkf_sharepointdriveid, iaRow.wmkf_sharepointitemid, { siteId: iaRow.wmkf_sharepointsiteid || null },
  );
  if (!iaMetadata || !sameSandboxId(iaMetadata.driveId, iaRow.wmkf_sharepointdriveid) || !sameSandboxId(iaMetadata.id, iaRow.wmkf_sharepointitemid)) {
    throw codedError('The Initial Assessment file identity could not be confirmed in SharePoint.', 'ia_verification_failed');
  }
  const downloadedIa = await sandboxDeps.downloadFile(iaRow.wmkf_sharepointdriveid, iaRow.wmkf_sharepointitemid);
  let iaGovernedHash;
  try {
    iaGovernedHash = await sandboxDeps.hashDocx(downloadedIa.buffer);
  } catch (error) {
    throw codedError(`The downloaded Initial Assessment bytes could not be hashed: ${error.message}`, 'ia_verification_failed');
  }
  if (iaGovernedHash !== iaRow.wmkf_contenthash) {
    throw codedError('The downloaded Initial Assessment bytes do not match its registry content hash.', 'ia_verification_failed');
  }
  // Complete-package attestation (owner decision 2026-09-24, Codex round 2
  // F6; reshaped by the first live run: SharePoint rewrites every uploaded
  // DOCX by property promotion, so the raw journaled `bytesSha256` can never
  // match a download and stays journaled as evidence only). Every part must
  // equal the fresh render except SharePoint's characterized mutations,
  // each validated as SharePoint's -- see docx-package-attestation.js.
  try {
    await attestDocxPackageAgainstRender(downloadedIa.buffer, expectedDocx);
  } catch (error) {
    throw codedError(`The downloaded Initial Assessment package differs from the synthetic render beyond SharePoint property promotion: ${(error.failures || [error.message]).join('; ')}`, 'ia_verification_failed');
  }

  const snapshotFound = await sandboxDeps.findByRequest(run.destinationRequestId, {
    artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
  });
  const snapshotRow = (snapshotFound.records || []).find((row) => isInitialAssessmentBoardSnapshot(row)
    && sameSandboxId(row.wmkf_requestdocumentid, snapshotRequestDocumentId));
  if (!snapshotRow || snapshotRow.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
    throw codedError('The Board snapshot is not in the Ready state.', 'ia_verification_failed');
  }
  // Cross-check against the snapshot step's own journaled item id (Stage C
  // round 2, P3-3), mirroring the Initial Assessment check above.
  if (snapshotResource.readback.itemId && !sameSandboxId(snapshotRow.wmkf_sharepointitemid, snapshotResource.readback.itemId)) {
    throw codedError(
      'The canonical Board snapshot SharePoint item does not match the snapshot step\'s journaled item.',
      'ia_pointer_mismatch',
    );
  }
  if (!snapshotResource.readback.contentHash || governedHashToHex(snapshotRow.wmkf_contenthash) !== snapshotResource.readback.contentHash) {
    throw codedError('The Board snapshot content hash does not match the hash the snapshot step journaled.', 'ia_pointer_mismatch');
  }
  if (!snapshotResource.readback.versionId || String(snapshotRow.wmkf_sharepointversionid) !== String(snapshotResource.readback.versionId)) {
    throw codedError('The Board snapshot SharePoint version does not match the version the snapshot step journaled.', 'ia_pointer_mismatch');
  }
  if (snapshotRow.wmkf_sourceversionid !== iaMetadata.versionId) {
    throw codedError('The Board snapshot source version no longer matches the current Initial Assessment version.', 'ia_snapshot_stale');
  }
  if (snapshotRow.wmkf_sourcecontenthash !== iaRow.wmkf_contenthash) {
    throw codedError('The Board snapshot source content hash no longer matches the current Initial Assessment.', 'ia_snapshot_stale');
  }

  // Mirrors readStableRetainedSnapshotFile (controls-service.js): two
  // independent metadata reads around one download must agree, and the
  // downloaded bytes must hash to BOTH the snapshot row's own content hash
  // and its recorded source content hash.
  const before = await sandboxDeps.getFileMetadataById(
    snapshotRow.wmkf_sharepointdriveid, snapshotRow.wmkf_sharepointitemid, { siteId: snapshotRow.wmkf_sharepointsiteid || null },
  );
  if (!before || !sameSandboxId(before.driveId, snapshotRow.wmkf_sharepointdriveid) || !sameSandboxId(before.id, snapshotRow.wmkf_sharepointitemid)) {
    throw codedError('The Board snapshot file could not be confirmed in SharePoint.', 'ia_verification_failed');
  }
  const downloadedSnapshot = await sandboxDeps.downloadFile(snapshotRow.wmkf_sharepointdriveid, snapshotRow.wmkf_sharepointitemid);
  const after = await sandboxDeps.getFileMetadataById(
    snapshotRow.wmkf_sharepointdriveid, snapshotRow.wmkf_sharepointitemid, { siteId: snapshotRow.wmkf_sharepointsiteid || null },
  );
  if (!after
    || before.versionId !== after.versionId || before.eTag !== after.eTag
    || before.lastModified !== after.lastModified || Number(before.size) !== Number(after.size)) {
    throw codedError('The Board snapshot file changed while it was being verified.', 'ia_verification_failed');
  }
  let snapshotGovernedHash;
  try {
    snapshotGovernedHash = await sandboxDeps.hashDocx(downloadedSnapshot.buffer);
  } catch (error) {
    throw codedError(`The retained Board snapshot bytes could not be hashed: ${error.message}`, 'ia_verification_failed');
  }
  if (snapshotGovernedHash !== snapshotRow.wmkf_contenthash || snapshotGovernedHash !== snapshotRow.wmkf_sourcecontenthash) {
    throw codedError('The retained Board snapshot bytes do not match its own or its source content hash.', 'ia_verification_failed');
  }
  try {
    await attestDocxPackageAgainstRender(downloadedSnapshot.buffer, expectedDocx);
  } catch (error) {
    throw codedError(`The retained Board snapshot package differs from the synthetic render beyond SharePoint property promotion: ${(error.failures || [error.message]).join('; ')}`, 'ia_verification_failed');
  }

  let files = null;
  let graphError = null;
  try {
    files = await listSharePointFiles(graph, observation);
  } catch (error) {
    graphError = error.message;
  }
  const basicFileCopies = existingResources
    .filter((row) => row.step === 'copy_file' && row.resourceKind === 'sharepoint_file' && row.readback)
    .map(inflateFileCopyEntry);
  // A raw byte-content hash, NOT the `sha256(value)` helper imported above
  // (that one JSON.stringifies its argument -- correct for the manifest/body
  // digests it is used for elsewhere in this file, wrong for file bytes).
  // Matches bundle-file-copy.js's own local (non-exported) `sha256(buffer)`,
  // which reverifyClone/reverifyCopiedItems compares against.
  const iaBytesSha256 = rawSha256Hex(downloadedIa.buffer);
  const snapshotBytesSha256 = rawSha256Hex(downloadedSnapshot.buffer);
  const iaEntry = {
    index: 'initial-assessment', status: 'verified',
    destination: { filename: iaMetadata.name, folder: iaRow.wmkf_sharepointfolderpath, library: 'akoya_request' },
    source: { size: iaMetadata.size, contentHash: iaBytesSha256 },
    destinationDriveId: iaMetadata.driveId,
    item: { id: iaMetadata.id, eTag: iaMetadata.eTag, versionId: iaMetadata.versionId },
  };
  const snapshotEntry = {
    index: 'initial-assessment-board-snapshot', status: 'verified',
    destination: { filename: after.name, folder: snapshotRow.wmkf_sharepointfolderpath, library: 'akoya_request' },
    source: { size: after.size, contentHash: snapshotBytesSha256 },
    destinationDriveId: after.driveId,
    item: { id: after.id, eTag: after.eTag, versionId: after.versionId },
  };
  // Stage C (slice 6c-ii): `extraFileCopies` is `verify_reviews`'s own
  // seeded reviewer files, unioned into the SAME single census pass here --
  // never a second verifyClone/reverifyClone call. Two separate exact-count
  // passes cannot both pass when review files are on disk: the first (with
  // only the Basic+IA count) would see the reviewer files as `unexpected`
  // and fail before verify_reviews ever got a chance to also expect them.
  const allFileCopies = [...basicFileCopies, iaEntry, snapshotEntry, ...extraFileCopies];

  // verifyClone (unchanged) refuses unless fileCopies.length equals
  // manifest.invariants.expectedSharePointFiles exactly (basic-clone-steps.js
  // verifyClone) -- that invariant is set by buildCloneManifest to the
  // BASIC file plan's own count (plannedFiles.length), which never counts
  // the IA DOCX, the Board snapshot file, or (for the `reviews` recipe) any
  // seeded reviewer file. Pass verifyClone a shallow clone of the manifest
  // whose invariants bump that expectation by the IA recipe's own two files
  // plus however many reviewer files this call was asked to expect, rather
  // than mutating the run's own manifest object or verifyClone's
  // Basic-recipe contract.
  const iaVerifyManifest = {
    ...manifest,
    invariants: {
      ...manifest.invariants,
      expectedSharePointFiles: Number(manifest.invariants?.expectedSharePointFiles ?? 0) + 2 + extraFileCopies.length,
    },
  };
  const verification = verifyClone(iaVerifyManifest, preflight, observation, files, foundationAfter, contactsAfter, allFileCopies);
  if (graphError) {
    verification.ok = false;
    verification.failures.push(`Graph folder inspection failed: ${graphError}`);
  }
  const reverifyFailures = await reverifyClone(graph, allFileCopies);
  if (reverifyFailures.length) {
    verification.ok = false;
    verification.failures.push(...reverifyFailures.map((failure) => `final file check: ${failure}`));
  }
  if (!verification.ok) {
    throw codedError(`Initial Assessment verification failed: ${verification.failures.join('; ')}`, 'ia_verification_failed');
  }
  return {
    observation, foundationAfter, contactsAfter, allFileCopies, existingResources, files, iaVerifyManifest,
  };
}

async function stepVerifyInitialAssessment({ run, ledger, manifest, client, graph, sharePointTarget }) {
  const preflight = await runPreflight(client, graph, sharePointTarget);
  if (preflight.siteId !== run.expectedGraphSiteId || preflight.driveId !== run.expectedGraphDriveId) {
    throw codedError('Graph site or Request drive identity changed since prepare.', 'preflight_identity_changed');
  }
  const { observation } = await verifyBasicAndInitialAssessment({
    run, ledger, manifest, client, graph, sharePointTarget, preflight,
  });

  // Only a recipe's FINAL step may markReady (see RECIPE_STEP_ORDER above).
  // `initial_assessment` ends here; `reviews` is cumulative and continues
  // into its own four steps, so this step ADVANCES for `reviews` instead of
  // marking ready -- the same advance-or-ready branch stepVerify (Basic)
  // takes above, pinned by one test per recipe.
  if (nextStepFor(run.recipe, IA_VERIFY_STEP) === null) {
    const ready = await ledger.markReady({
      runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration, expectedVersion: run.version,
      destinationRequestNumber: observation.request.akoya_requestnum,
    });
    if (!ready) return { run, step: IA_VERIFY_STEP, outcome: 'lease_lost', resources: [] };
    return { run: ready, step: IA_VERIFY_STEP, outcome: 'ready', resources: [] };
  }
  const advanced = await completeCurrentStep(ledger, run, IA_VERIFY_STEP, { destinationRequestNumber: observation.request.akoya_requestnum });
  if (!advanced) return { run, step: IA_VERIFY_STEP, outcome: 'lease_lost', resources: [] };
  return { run: advanced, step: IA_VERIFY_STEP, outcome: 'advanced', resources: [] };
}

// ───────── Reviews recipe: seed_reviewers / seed_review_answers (slice
// 6c-ii Stage B). copy_review_file and verify_reviews stay
// `recipe_step_not_built` stubs (Stage C). ─────────

const SEED_REVIEWERS_STEP = 'seed_reviewers';
const SEED_ANSWERS_STEP = 'seed_review_answers';
const PERSON_RESOURCE_KIND = 'dataverse_potential_reviewer';
const SUGGESTION_RESOURCE_KIND = 'dataverse_reviewer_suggestion';
const ANSWER_RESOURCE_KIND = 'dataverse_review_answer_set';

function bundleReviewerBySourceId(bundle, sourcePersonId) {
  const reviewer = (bundle.reviewers || []).find((r) => String(r.personId).toLowerCase() === sourcePersonId);
  if (!reviewer) throw codedError(`Bundle has no reviewer for source person ${sourcePersonId}.`, 'reviewer_source_changed');
  return reviewer;
}

/** Byte-mirror of reviewer-suggestion.js#upsert's own alternate-key conflict classifier. */
function isDuplicateKeyRejection(error) {
  const status = Number.isInteger(error?.httpStatus) ? error.httpStatus : Number.isInteger(error?.status) ? error.status : null;
  return (status === 412 || status === 409)
    && /duplicate|already exists|matching key values|alternate key|Entity Key|0x80060892/i.test(String(error?.message || ''));
}

/** Read the destination Request's own grant-cycle code, the same rule the IA seed and my-candidates-service.js use. */
async function destinationGrantCycleCode(client, requestId) {
  const request = await getIaSeedRequest(client, requestId);
  return request.wmkf_meetingdate ? (meetingDateToCycleCode(request.wmkf_meetingdate)?.toUpperCase() ?? null) : null;
}

/**
 * Resolve (or create) the destination synthetic person for one reviewer
 * assignment. `assignment` is a full row from
 * `ledger.getRunReviewerAssignment` (carries the plaintext address).
 *
 * P2-2 (Opus round 1): every read and the create body are built BEFORE the
 * attempt marker is journaled -- a transient read failure here leaves no
 * marker at all, so the run simply resumes cleanly on the next `--advance`
 * rather than stranding a marker with no dispatch (which would otherwise
 * report `ambiguous_create_outcome` forever). `syntheticPersonProjection` is
 * pure and cannot itself fail, but its call is kept before the marker too,
 * for the same uniform rule.
 */
async function resolveReviewerPerson({
  run, ledger, deps, bundle, assignment, existingResources,
}) {
  const bundleReviewer = bundleReviewerBySourceId(bundle, assignment.sourcePersonId);
  const personSelect = PERSON_READ_FIELDS;

  function syntheticActiveContactless(row) {
    return !!row && row[SYNTHETIC_REVIEWER_MARKER_FIELDS.marker] === true
      && (row.statecode === undefined || row.statecode === 0) && !row._wmkf_contact_value;
  }

  let resource = existingResources.find((r) => r.step === SEED_REVIEWERS_STEP && r.resourceKind === PERSON_RESOURCE_KIND
    && r.plannedIdentity?.assignmentSequence === assignment.sequence) || null;

  async function journalIfMissing() {
    if (resource) return resource;
    resource = await ledger.journalPlannedResource({
      runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
      step: SEED_REVIEWERS_STEP, resourceKind: PERSON_RESOURCE_KIND, system: 'dataverse',
      plannedIdentity: compact({
        assignmentSequence: assignment.sequence, destinationPersonId: assignment.destinationPersonId,
        sourcePersonId: assignment.sourcePersonId, addressSha256: assignment.addressSha256,
      }),
    });
    return resource;
  }

  if (assignment.reused) {
    // Re-verified on every call, resumed or not (plan "Reserve"/"Seeder"):
    // the reservation-time check is not trusted to still hold at seed time
    // (this is also the backstop for the reservation-time provenance check
    // running outside its own transaction -- see rehearse-test-request-
    // sandbox.mjs#resolveReviewerAssignments's doc comment).
    const row = await deps.getPersonById(assignment.destinationPersonId, { select: personSelect });
    if (!syntheticActiveContactless(row)) {
      throw codedError('Reused destination person is not an active, Contact-less synthetic reviewer.', 'reviewer_person_not_synthetic');
    }
    const expected = syntheticPersonProjection(bundleReviewer, assignment.address);
    for (const [field, expectedValue] of Object.entries(expected)) {
      const actual = row[field] ?? null;
      if (actual !== (expectedValue ?? null)) {
        throw codedError(`Reused destination person field ${field} does not match the bundle's synthetic-person projection.`, 'reviewer_person_projection_drift');
      }
    }
    await journalIfMissing();
    if (resource.outcome !== 'recovered') {
      resource = await ledger.recordResourceReadback({
        resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
        responseStatus: null, readback: compact({ destinationPersonId: assignment.destinationPersonId }), outcome: 'recovered',
      });
    }
    return { resource, destinationPersonId: assignment.destinationPersonId };
  }

  await journalIfMissing();
  if (resource.outcome === 'verified' || resource.outcome === 'recovered') {
    return { resource, destinationPersonId: assignment.destinationPersonId };
  }
  // P3 (Opus round 1): resuming after a recorded reviewer_person_conflict
  // must re-report reviewer_person_conflict, never re-derive
  // ambiguous_create_outcome by attempting (and failing) the GUID recovery
  // read below -- the alternate-key rejection means the preallocated GUID
  // was never actually created, so that read would always come back empty.
  if (resource.outcome === 'rejected') {
    throw codedError('The synthetic person email alternate key was already taken; refusing to adopt the winner.', 'reviewer_person_conflict');
  }

  // P2-2: build the (pure) create body BEFORE the attempt marker.
  const body = {
    wmkf_potentialreviewersid: assignment.destinationPersonId,
    ...syntheticPersonProjection(bundleReviewer, assignment.address),
  };

  if (resource.readback?.personCreateAttemptedAt) {
    // Dispatch-marker rule: never re-POST. Recover strictly by the
    // preallocated GUID.
    const row = await deps.getPersonById(assignment.destinationPersonId, { select: personSelect });
    if (!row || row[SYNTHETIC_REVIEWER_MARKER_FIELDS.marker] !== true) {
      await ledger.recordResourceFailure({
        resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
        outcome: 'ambiguous', error: codedError('A prior invocation attempted the synthetic person POST and the row is not readable/owned; resolve manually, never re-POST.', 'ambiguous_create_outcome'),
      });
      throw codedError('A prior invocation attempted the synthetic person POST and the row is not readable/owned; resolve manually, never re-POST.', 'ambiguous_create_outcome');
    }
    resource = await ledger.recordResourceReadback({
      resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
      responseStatus: null, readback: compact({ destinationPersonId: assignment.destinationPersonId }), outcome: 'recovered',
    });
    return { resource, destinationPersonId: assignment.destinationPersonId };
  }

  resource = await ledger.recordResourceReadback({
    resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
    responseStatus: null, readback: { personCreateAttemptedAt: new Date().toISOString() }, outcome: 'dispatched',
  });
  try {
    await deps.createPerson(body);
  } catch (error) {
    if (isDuplicateKeyRejection(error)) {
      await ledger.recordResourceFailure({
        resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
        outcome: 'rejected', error: codedError('The synthetic person email alternate key was already taken; refusing to adopt the winner.', 'reviewer_person_conflict'),
      });
      throw codedError('The synthetic person email alternate key was already taken; refusing to adopt the winner.', 'reviewer_person_conflict');
    }
    // Not a conflict: fall through to the unified readback below, which
    // recovers an ambiguous create by re-reading the preallocated GUID.
  }
  // P3 (Opus round 1): read back by the preallocated GUID before marking
  // verified -- covers BOTH a create that returned success (previously
  // trusted unconditionally) and the ambiguous-recovery path above.
  const createdRow = await deps.getPersonById(assignment.destinationPersonId, { select: personSelect });
  if (!createdRow || createdRow[SYNTHETIC_REVIEWER_MARKER_FIELDS.marker] !== true) {
    await ledger.recordResourceFailure({
      resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
      outcome: 'ambiguous', error: codedError('The synthetic person create failed and the row is not readable/owned; resolve manually, never re-POST.', 'ambiguous_create_outcome'),
    });
    throw codedError('The synthetic person create failed and the row is not readable/owned; resolve manually, never re-POST.', 'ambiguous_create_outcome');
  }
  resource = await ledger.recordResourceReadback({
    resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
    responseStatus: null, readback: compact({ destinationPersonId: assignment.destinationPersonId }), outcome: 'verified',
  });
  return { resource, destinationPersonId: assignment.destinationPersonId };
}

/** Resolve (or create) the destination suggestion for one reviewer assignment. */
async function resolveReviewerSuggestion({
  run, ledger, deps, client, bundle, assignment, destinationPersonId, existingResources,
}) {
  const bundleReviewer = bundleReviewerBySourceId(bundle, assignment.sourcePersonId);
  const suggestionSelect = ['wmkf_appreviewersuggestionid', '_wmkf_potentialreviewer_value', '_wmkf_request_value'];
  let resource = existingResources.find((r) => r.step === SEED_REVIEWERS_STEP && r.resourceKind === SUGGESTION_RESOURCE_KIND
    && r.plannedIdentity?.assignmentSequence === assignment.sequence) || null;

  if (resource?.outcome === 'verified' || resource?.outcome === 'recovered') {
    return { resource, suggestionId: resource.plannedIdentity.suggestionId };
  }
  // P3: resuming after a recorded reviewer_suggestion_present_not_owned must
  // re-report that same code, never re-derive a different one by re-running
  // the (identical) ownership check below -- kept as an explicit short-
  // circuit for symmetry with the person path and to avoid a redundant read.
  if (resource?.outcome === 'rejected') {
    throw codedError('A suggestion exists at this preallocated id but is not bound to this run\'s person/request; refusing to adopt it.', 'reviewer_suggestion_present_not_owned');
  }

  const suggestionId = resource?.plannedIdentity?.suggestionId || crypto.randomUUID();
  function owned(row) {
    return row && guidEqual(row._wmkf_potentialreviewer_value, destinationPersonId) && guidEqual(row._wmkf_request_value, run.destinationRequestId);
  }
  if (!resource) {
    resource = await ledger.journalPlannedResource({
      runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
      step: SEED_REVIEWERS_STEP, resourceKind: SUGGESTION_RESOURCE_KIND, system: 'dataverse',
      plannedIdentity: compact({ assignmentSequence: assignment.sequence, suggestionId, destinationPersonId }),
    });
  }

  if (resource.readback?.suggestionCreateAttemptedAt) {
    const row = await deps.getSuggestionById(suggestionId, { select: suggestionSelect });
    if (!row) {
      await ledger.recordResourceFailure({
        resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
        outcome: 'ambiguous', error: codedError('A prior invocation attempted the suggestion POST and the row is not readable; resolve manually, never re-POST.', 'ambiguous_create_outcome'),
      });
      throw codedError('A prior invocation attempted the suggestion POST and the row is not readable; resolve manually, never re-POST.', 'ambiguous_create_outcome');
    }
    if (!owned(row)) {
      await ledger.recordResourceFailure({
        resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
        outcome: 'rejected', error: codedError('A suggestion exists at this preallocated id but is not bound to this run\'s person/request; refusing to adopt it.', 'reviewer_suggestion_present_not_owned'),
      });
      throw codedError('A suggestion exists at this preallocated id but is not bound to this run\'s person/request; refusing to adopt it.', 'reviewer_suggestion_present_not_owned');
    }
    resource = await ledger.recordResourceReadback({
      resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
      responseStatus: null, readback: {}, outcome: 'recovered',
    });
    return { resource, suggestionId };
  }

  // P2-2: perform the read (destinationGrantCycleCode) and build the create
  // body BEFORE the attempt marker -- a transient Request read failure here
  // leaves no marker, so the run resumes cleanly rather than stranding a
  // dispatched marker with no POST.
  const grantCycleCode = await destinationGrantCycleCode(client, run.destinationRequestId);
  const body = {
    wmkf_appreviewersuggestionid: suggestionId,
    ...buildSuggestionCreateBody(bundleReviewer, {
      destinationRequestId: run.destinationRequestId, destinationPersonId, grantCycleCode,
    }),
  };
  resource = await ledger.recordResourceReadback({
    resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
    responseStatus: null, readback: { suggestionCreateAttemptedAt: new Date().toISOString() }, outcome: 'dispatched',
  });
  try {
    await deps.createSuggestion(body);
  } catch {
    // Fall through to the unified readback below, which recovers an
    // ambiguous create by re-reading the preallocated GUID.
  }
  // P3: read back by the preallocated GUID before marking verified -- covers
  // BOTH a create that returned success (previously trusted unconditionally)
  // and the ambiguous-recovery path above.
  const createdRow = await deps.getSuggestionById(suggestionId, { select: suggestionSelect });
  if (!createdRow) {
    await ledger.recordResourceFailure({
      resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
      outcome: 'ambiguous', error: codedError('The suggestion create failed and the row is not readable; resolve manually, never re-POST.', 'ambiguous_create_outcome'),
    });
    throw codedError('The suggestion create failed and the row is not readable; resolve manually, never re-POST.', 'ambiguous_create_outcome');
  }
  if (!owned(createdRow)) {
    await ledger.recordResourceFailure({
      resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
      outcome: 'rejected', error: codedError('A suggestion exists at this preallocated id but is not bound to this run\'s person/request; refusing to adopt it.', 'reviewer_suggestion_present_not_owned'),
    });
    throw codedError('A suggestion exists at this preallocated id but is not bound to this run\'s person/request; refusing to adopt it.', 'reviewer_suggestion_present_not_owned');
  }
  resource = await ledger.recordResourceReadback({
    resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
    responseStatus: null, readback: compact({ suggestionId }), outcome: 'verified',
  });
  return { resource, suggestionId };
}

/**
 * `seed_reviewers`: one source reviewer per `--advance`, in assignment
 * `sequence` order, resuming by the ledger's resources (plan "Seeder"). Only
 * advances to `copy_review_file` after the LAST reviewer's suggestion is
 * verified/recovered; otherwise releases the lease and reports `advanced`
 * with the step unchanged, so a further `--advance` processes the next
 * reviewer.
 */
async function stepSeedReviewers({
  run, ledger, bundle, client,
}) {
  const assignments = await ledger.listRunReviewerAssignments(run.runId);
  if (assignments.length === 0) {
    throw codedError('The reviews recipe requires at least one reviewer assignment.', 'reviewer_source_changed');
  }
  const existingResources = await ledger.listRunResources(run.runId);
  const doneSequences = new Set(
    existingResources
      .filter((r) => r.step === SEED_REVIEWERS_STEP && r.resourceKind === SUGGESTION_RESOURCE_KIND
        && (r.outcome === 'verified' || r.outcome === 'recovered'))
      .map((r) => r.plannedIdentity?.assignmentSequence),
  );
  const next = assignments.find((a) => !doneSequences.has(a.sequence));
  const resources = [];
  if (next) {
    const full = await ledger.getRunReviewerAssignment(run.runId, next.sequence);
    const deps = createReviewsSandboxDeps({ resourceUrl: iaSandboxResourceUrl(client) });
    const person = await resolveReviewerPerson({
      run, ledger, deps, bundle, assignment: full, existingResources,
    });
    resources.push(person.resource);
    const suggestion = await resolveReviewerSuggestion({
      run, ledger, deps, client, bundle, assignment: full, destinationPersonId: person.destinationPersonId, existingResources,
    });
    resources.push(suggestion.resource);
  }
  const stillRemaining = next ? assignments.some((a) => a.sequence !== next.sequence && !doneSequences.has(a.sequence)) : false;
  if (!next || !stillRemaining) {
    const advanced = await completeCurrentStep(ledger, run, SEED_REVIEWERS_STEP);
    if (!advanced) return { run, step: SEED_REVIEWERS_STEP, outcome: 'lease_lost', resources };
    return { run: advanced, step: SEED_REVIEWERS_STEP, outcome: 'advanced', resources };
  }
  const released = await ledger.releaseLease({ runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration });
  if (!released) return { run, step: SEED_REVIEWERS_STEP, outcome: 'lease_lost', resources };
  return { run: released, step: SEED_REVIEWERS_STEP, outcome: 'advanced', resources };
}

const COPY_REVIEW_FILE_STEP = 'copy_review_file';
const REVIEW_FOLDER_RESOURCE_KIND = 'sharepoint_folder';
const REVIEW_FILE_RESOURCE_KIND = 'sharepoint_file';
const ATTEMPT_ID_FROM_FOLDER = /attempt_([0-9a-f]{32})$/;

/** Extract the 32-hex attempt id embedded in a journaled review folder path (`Reviewer_Uploads/.../attempt_<32hex>`), recovering it across resumes without a dedicated receipt key. */
function attemptIdFromFolder(folder) {
  const match = ATTEMPT_ID_FROM_FOLDER.exec(String(folder || ''));
  return match ? match[1] : null;
}

/**
 * `copy_review_file`: one uploaded file per `--advance` (plan "Recipe
 * dimension"/"Seeder" 3a). Reviews with `reviewForm !== 'uploaded'` have no
 * files and are skipped entirely -- with zero uploaded reviews in the whole
 * bundle, this step advances immediately with no journal at all. Mirrors
 * `stepCopyFile`'s create-only, journal-before-dispatch shape via the same
 * `copyBundleFiles` engine (bundle-file-copy.js), which already derives the
 * per-MIME integrity mode (PDF/DOC exact-hash, DOCX package attestation)
 * from `mimeType` alone.
 *
 * Per review (one at a time, in assignment `sequence` order): the
 * destination folder's 32-hex attempt id is journaled ONCE as a
 * `sharepoint_folder` resource (`REVIEW_FOLDER_RESOURCE_KIND`), keyed by
 * `assignmentSequence`, embedded in the folder path itself and recovered
 * from that same journaled string on resume (`attemptIdFromFolder`) --
 * never re-generated. Its destination subfolder name is computed from
 * `syntheticPersonProjection` (pure; the same projection the person create
 * body used, so the subfolder name is deterministic and never requires a
 * live read). Once every file in a review is verified, the folder
 * resource's readback is updated with the review's primary filename
 * (`filename` -- an already-allowlisted receipt key, `run-ledger.js`'s
 * `FILENAME` grammar; no new receipt key was added) so `seed_review_answers`
 * can read the destination
 * folder + primary filename straight off this resource for its
 * `filePointers`.
 */
async function stepCopyReviewFile({
  run, ledger, bundle, client, graph, sharePointTarget,
}) {
  const request = await getRequest(client, run.destinationRequestId);
  const requestFolder = expectedRequestFolder(request.akoya_requestnum, request.akoya_requestid);
  const assignments = await ledger.listRunReviewerAssignments(run.runId);
  const uploadedAssignments = assignments.filter(
    (a) => bundleReviewerBySourceId(bundle, a.sourcePersonId).reviewForm === 'uploaded',
  );

  if (uploadedAssignments.length === 0) {
    // Zero uploaded reviews in this bundle: advance with no write, no
    // journal at all (P3, Stage C brief).
    const advanced = await completeCurrentStep(ledger, run, COPY_REVIEW_FILE_STEP);
    if (!advanced) return { run, step: COPY_REVIEW_FILE_STEP, outcome: 'lease_lost', resources: [] };
    return { run: advanced, step: COPY_REVIEW_FILE_STEP, outcome: 'advanced', resources: [] };
  }

  // Whole-bundle byte budget, checked up front against every uploaded
  // review's OWN files (never journaled -- a pure pre-check, mirroring
  // planBundleFileCopies/planReviewFileCopies' own uncoded thrown Errors).
  const totalBytes = uploadedAssignments.reduce((sum, a) => {
    const reviewer = bundleReviewerBySourceId(bundle, a.sourcePersonId);
    return sum + (reviewer.files || []).reduce((fileSum, file) => fileSum + (Number(file.size) || 0), 0);
  }, 0);
  if (totalBytes > REVIEW_FILE_COPY_POLICY.maxTotalBytes) {
    throw new Error(`Review file plan totals ${totalBytes} bytes, exceeding the ${REVIEW_FILE_COPY_POLICY.maxTotalBytes}-byte ceiling.`);
  }

  const existingResources = await ledger.listRunResources(run.runId);
  const doneSequences = new Set(
    existingResources
      .filter((r) => r.step === COPY_REVIEW_FILE_STEP && r.resourceKind === REVIEW_FOLDER_RESOURCE_KIND && r.readback?.filename)
      .map((r) => r.plannedIdentity?.assignmentSequence),
  );
  const next = uploadedAssignments.find((a) => !doneSequences.has(a.sequence));
  const resources = [];
  let reviewCompletedThisCall = false;

  if (next) {
    const full = await ledger.getRunReviewerAssignment(run.runId, next.sequence);
    const bundleReviewer = bundleReviewerBySourceId(bundle, full.sourcePersonId);
    const suggestionResource = existingResources.find((r) => r.step === SEED_REVIEWERS_STEP && r.resourceKind === SUGGESTION_RESOURCE_KIND
      && r.plannedIdentity?.assignmentSequence === full.sequence);
    if (!suggestionResource?.plannedIdentity?.suggestionId) {
      throw codedError('copy_review_file: no seeded suggestion found for this reviewer; seed_reviewers must complete first.', 'reviewer_answers_ambiguous');
    }
    const destinationSuggestionId = suggestionResource.plannedIdentity.suggestionId;
    const destinationPersonName = syntheticPersonProjection(bundleReviewer, full.address);

    let folderResource = existingResources.find((r) => r.step === COPY_REVIEW_FILE_STEP && r.resourceKind === REVIEW_FOLDER_RESOURCE_KIND
      && r.plannedIdentity?.assignmentSequence === full.sequence) || null;
    let attemptId;
    if (folderResource) {
      attemptId = attemptIdFromFolder(folderResource.plannedIdentity?.folder);
      if (!attemptId) throw codedError('copy_review_file: the journaled review folder has no recoverable attempt id.', 'file_journal_unverified');
    } else {
      attemptId = crypto.randomBytes(16).toString('hex');
      const subfolder = buildReviewerSubfolder(destinationSuggestionId, destinationPersonName);
      const folder = `Reviewer_Uploads/${subfolder}/attempt_${attemptId}`;
      folderResource = await ledger.journalPlannedResource({
        runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
        step: COPY_REVIEW_FILE_STEP, resourceKind: REVIEW_FOLDER_RESOURCE_KIND, system: 'sharepoint',
        plannedIdentity: compact({ assignmentSequence: full.sequence, folder }),
      });
    }
    resources.push(folderResource);

    const plannedFiles = planReviewFileCopies(bundle, {
      reviews: [{
        sourcePersonId: full.sourcePersonId, destinationSuggestionId, destinationPersonName, attemptId,
      }],
    });

    const fileResources = existingResources.filter((r) => r.step === COPY_REVIEW_FILE_STEP && r.resourceKind === REVIEW_FILE_RESOURCE_KIND
      && r.plannedIdentity?.assignmentSequence === full.sequence);
    const verifiedCount = fileResources.filter((r) => r.outcome === 'verified').length;

    if (verifiedCount >= plannedFiles.length) {
      // Every file already verified (e.g. a crash between the last file's
      // verify and this bookkeeping write): just record completion.
      folderResource = await ledger.recordResourceReadback({
        resourceId: folderResource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
        responseStatus: null, readback: compact({ filename: plannedFiles[0].destination.filename }), outcome: 'verified',
      });
      resources[0] = folderResource;
      reviewCompletedThisCall = true;
    } else {
      const index = verifiedCount;
      const pending = fileResources.find((r) => r.plannedIdentity?.index === index && r.outcome !== 'verified');
      if (pending && pending.readback?.itemId) {
        throw codedError(`Review file copy at index ${index} has an unverified journaled item (${pending.readback.itemId}); inspect before resuming.`, 'file_journal_unverified');
      }
      if (pending && pending.readback?.uploadAttemptedAt) {
        throw codedError(`Review file copy at index ${index} was attempted without a journaled item; inspect before resuming.`, 'file_ambiguous_unrecovered');
      }
      const fileResource = pending ?? await ledger.journalPlannedResource({
        runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
        step: COPY_REVIEW_FILE_STEP, resourceKind: REVIEW_FILE_RESOURCE_KIND, system: 'sharepoint',
        plannedIdentity: compact({ assignmentSequence: full.sequence, index, filename: plannedFiles[index]?.destination?.filename }),
      });

      const dependencies = {
        clearGraphCaches: () => graph.clearGraphCaches(),
        configuredSharePointTarget: () => graph.configuredSharePointTarget(),
        getSiteId: () => graph.getSiteId(),
        getDriveId: (library, options) => graph.getDriveId(library, options),
        getFileMetadataById: (driveId, itemId) => graph.getFileMetadataById(driveId, itemId),
        downloadFile: (driveId, itemId) => graph.downloadFile(driveId, itemId),
        getFileMetadataByPath: (library, folder, filename, options) => graph.getFileMetadataByPath(library, folder, filename, options),
        ensureFolderPath: (library, folder, options) => graph.ensureFolderPath(library, folder, options),
        uploadFile: (library, folder, filename, content, contentType, options) => (
          graph.uploadFile(library, folder, filename, content, contentType, options)
        ),
      };
      const fileResources2 = [];
      const journal = async (copies) => {
        const entry = copies[0];
        const flat = flattenFileCopyEntry(entry, index);
        if (entry.status === 'failed') {
          const row = await ledger.recordResourceFailure({
            resourceId: fileResource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
            outcome: 'failed', error: codedError(entry.error, 'file_copy_failed'),
          });
          fileResources2.push(row);
          return;
        }
        const row = await ledger.recordResourceReadback({
          resourceId: fileResource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
          responseStatus: null, readback: flat, outcome: entry.status === 'verified' ? 'verified' : 'dispatched',
        });
        fileResources2.push(row);
      };
      const preflight = await runPreflight(client, graph, sharePointTarget);
      await copyBundleFiles(
        { plannedFiles: [plannedFiles[index]], requestFolder, expectedSiteId: preflight.siteId, expectedDestinationDriveId: preflight.driveId },
        dependencies,
        journal,
      );
      resources.push(...fileResources2);

      if (index + 1 >= plannedFiles.length) {
        folderResource = await ledger.recordResourceReadback({
          resourceId: folderResource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
          responseStatus: null, readback: compact({ filename: plannedFiles[0].destination.filename }), outcome: 'verified',
        });
        resources[0] = folderResource;
        reviewCompletedThisCall = true;
      }
    }
  }

  const stillRemaining = next
    ? uploadedAssignments.some((a) => (a.sequence === next.sequence ? !reviewCompletedThisCall : !doneSequences.has(a.sequence)))
    : false;
  if (!next || !stillRemaining) {
    const advanced = await completeCurrentStep(ledger, run, COPY_REVIEW_FILE_STEP);
    if (!advanced) return { run, step: COPY_REVIEW_FILE_STEP, outcome: 'lease_lost', resources };
    return { run: advanced, step: COPY_REVIEW_FILE_STEP, outcome: 'advanced', resources };
  }
  const released = await ledger.releaseLease({ runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration });
  if (!released) return { run, step: COPY_REVIEW_FILE_STEP, outcome: 'lease_lost', resources };
  return { run: released, step: COPY_REVIEW_FILE_STEP, outcome: 'advanced', resources };
}

/**
 * `seed_review_answers`: one suggestion per `--advance` (plan "Seeder").
 * Stage C wires an `uploaded` review's `filePointers` into this SAME
 * completion write (not a second write): the destination folder and primary
 * filename are read off `copy_review_file`'s own journaled folder resource,
 * never re-derived here.
 */
async function stepSeedReviewAnswers({
  run, ledger, bundle, client,
}) {
  // Lazy: only an `uploaded` review needs the destination request folder
  // (to prefix copy_review_file's relative folder into
  // wmkf_reviewsharepointfolder's full-path convention,
  // review-upload.js:223-233), so this is not read on every call.
  let requestFolderForPointersCache;
  async function requestFolderForPointers() {
    if (requestFolderForPointersCache) return requestFolderForPointersCache;
    const request = await getRequest(client, run.destinationRequestId);
    requestFolderForPointersCache = expectedRequestFolder(request.akoya_requestnum, request.akoya_requestid);
    return requestFolderForPointersCache;
  }
  const assignments = await ledger.listRunReviewerAssignments(run.runId);
  const existingResources = await ledger.listRunResources(run.runId);
  const doneSequences = new Set(
    existingResources
      .filter((r) => r.step === SEED_ANSWERS_STEP && r.resourceKind === ANSWER_RESOURCE_KIND
        && (r.outcome === 'verified' || r.outcome === 'recovered'))
      .map((r) => r.plannedIdentity?.assignmentSequence),
  );
  const suggestionResources = existingResources.filter((r) => r.step === SEED_REVIEWERS_STEP && r.resourceKind === SUGGESTION_RESOURCE_KIND);
  const next = assignments.find((a) => !doneSequences.has(a.sequence));
  const resources = [];
  if (next) {
    const suggestionResource = suggestionResources.find((r) => r.plannedIdentity?.assignmentSequence === next.sequence);
    if (!suggestionResource?.plannedIdentity?.suggestionId) {
      throw codedError('seed_review_answers: no seeded suggestion found for this reviewer; seed_reviewers must complete first.', 'reviewer_answers_ambiguous');
    }
    const { suggestionId } = suggestionResource.plannedIdentity;
    const bundleReviewer = bundleReviewerBySourceId(bundle, next.sourcePersonId);
    const deps = createReviewsSandboxDeps({ resourceUrl: iaSandboxResourceUrl(client) });
    let resource = existingResources.find((r) => r.step === SEED_ANSWERS_STEP && r.resourceKind === ANSWER_RESOURCE_KIND
      && r.plannedIdentity?.assignmentSequence === next.sequence) || null;

    async function journalIfMissing(extra) {
      if (resource) return resource;
      resource = await ledger.journalPlannedResource({
        runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
        step: SEED_ANSWERS_STEP, resourceKind: ANSWER_RESOURCE_KIND, system: 'dataverse',
        plannedIdentity: compact({ assignmentSequence: next.sequence, suggestionId, reviewForm: bundleReviewer.reviewForm, ...extra }),
      });
      return resource;
    }

    if (bundleReviewer.reviewForm === 'unreceived') {
      await journalIfMissing({});
      if (resource.outcome !== 'verified') {
        resource = await ledger.recordResourceReadback({
          resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
          responseStatus: null, readback: compact({ suggestionId, answerCount: 0 }), outcome: 'verified',
        });
      }
      resources.push(resource);
    } else {
      await journalIfMissing({ answerCount: (bundleReviewer.answers || []).length });
      if (resource.outcome === 'verified' || resource.outcome === 'recovered') {
        resources.push(resource);
      } else if (resource.readback?.changesetAttemptedAt) {
        // Dispatch-marker rule: never re-dispatch. Re-read the suggestion's
        // current state to resolve.
        const row = await deps.getSuggestionById(suggestionId, { select: ['wmkf_appreviewersuggestionid', 'wmkf_reviewreceivedat'] });
        if (!row || row.wmkf_reviewreceivedat == null) {
          await ledger.recordResourceFailure({
            resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
            outcome: 'ambiguous', error: codedError('A prior invocation dispatched the answers/completion changeset and the outcome is not confirmed; resolve manually, never re-dispatch.', 'reviewer_answers_ambiguous'),
          });
          throw codedError('A prior invocation dispatched the answers/completion changeset and the outcome is not confirmed; resolve manually, never re-dispatch.', 'reviewer_answers_ambiguous');
        }
        resource = await ledger.recordResourceReadback({
          resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
          responseStatus: null, readback: compact({ eTagAfter: row._etag || undefined }), outcome: 'recovered',
        });
        resources.push(resource);
      } else {
        const current = await deps.getSuggestionById(suggestionId, { select: ['wmkf_appreviewersuggestionid'] });
        if (!current?._etag) {
          throw codedError('seed_review_answers: the seeded suggestion has no readable ETag to guard the completion write.', 'reviewer_answers_ambiguous');
        }
        // Stage C: an `uploaded` review's pointers are read off
        // copy_review_file's own journaled folder resource (its readback
        // carries `folder` from plannedIdentity and `filename` set once
        // every file verified) -- never re-derived here. Refuse rather
        // than seed a pointerless "uploaded" review.
        let filePointers = null;
        if (bundleReviewer.reviewForm === 'uploaded') {
          const folderResource = existingResources.find((r) => r.step === COPY_REVIEW_FILE_STEP && r.resourceKind === REVIEW_FOLDER_RESOURCE_KIND
            && r.plannedIdentity?.assignmentSequence === next.sequence);
          const folder = folderResource?.plannedIdentity?.folder;
          const filename = folderResource?.readback?.filename;
          if (!folder || !filename) {
            throw codedError('seed_review_answers: an uploaded review has no journaled file pointers; copy_review_file must complete first.', 'reviews_verification_failed');
          }
          filePointers = { folder: `${await requestFolderForPointers()}/${folder}`, filename };
        }
        // P2-2: build the (pure) completion write BEFORE the attempt marker.
        const write = buildCompletionWrite(bundleReviewer, { suggestionId, ifMatch: current._etag, filePointers });
        resource = await ledger.recordResourceReadback({
          resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
          responseStatus: null,
          readback: compact({ changesetAttemptedAt: new Date().toISOString(), eTagBefore: current._etag }),
          outcome: 'dispatched',
        });
        try {
          await deps.runChangeset(write.operations);
        } catch (error) {
          await ledger.recordResourceFailure({
            resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
            outcome: 'ambiguous', error: codedError('The answers/completion changeset failed with no confirmed outcome; resolve manually, never re-dispatch.', 'reviewer_answers_ambiguous'),
          });
          throw Object.assign(codedError('The answers/completion changeset failed with no confirmed outcome; resolve manually, never re-dispatch.', 'reviewer_answers_ambiguous'), { cause: error });
        }
        const after = await deps.getSuggestionById(suggestionId, { select: ['wmkf_appreviewersuggestionid'] });
        resource = await ledger.recordResourceReadback({
          resourceId: resource.resourceId, runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration,
          responseStatus: null, readback: compact({ eTagAfter: after?._etag, answerCount: write.answerCount }), outcome: 'verified',
        });
        resources.push(resource);
      }
    }
  }
  const stillRemaining = next ? assignments.some((a) => a.sequence !== next.sequence && !doneSequences.has(a.sequence)) : false;
  if (!next || !stillRemaining) {
    const advanced = await completeCurrentStep(ledger, run, SEED_ANSWERS_STEP);
    if (!advanced) return { run, step: SEED_ANSWERS_STEP, outcome: 'lease_lost', resources };
    return { run: advanced, step: SEED_ANSWERS_STEP, outcome: 'advanced', resources };
  }
  const released = await ledger.releaseLease({ runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration });
  if (!released) return { run, step: SEED_ANSWERS_STEP, outcome: 'lease_lost', resources };
  return { run: released, step: SEED_ANSWERS_STEP, outcome: 'advanced', resources };
}

const VERIFY_REVIEWS_STEP = 'verify_reviews';
// Every field a destination suggestion select must read for the verifier:
// identity/bind columns, every candidate+lifecycle field the bundle carries
// (REVIEWER_SUGGESTION_FIELDS, source-bundle.js), the derived grant-cycle
// code, and the two file pointers. Deliberately NEVER a token, honorarium or
// proposal-access field -- the selection itself is the guard (plan
// "Verify": "no token, honorarium or proposal-access fields").
const SUGGESTION_VERIFY_FIELDS = Object.freeze([
  'wmkf_appreviewersuggestionid', '_wmkf_potentialreviewer_value', '_wmkf_request_value',
  ...REVIEWER_SUGGESTION_FIELDS,
  'wmkf_grantcyclecode', 'wmkf_reviewsharepointfolder', 'wmkf_reviewfilename',
]);
// The five fields ONLY the completion changeset (buildCompletionWrite) ever
// writes; every other member of SUGGESTION_COPY_FIELDS is a "candidate"
// field the CREATE wrote and never changes again.
const COMPLETION_FIELDS = Object.freeze([
  'wmkf_reviewreceivedat', 'wmkf_reviewstatus', 'wmkf_completedat', 'wmkf_thankyousentat', 'wmkf_reviewuploadedbystaff',
]);
const CANDIDATE_SUGGESTION_FIELDS = SUGGESTION_COPY_FIELDS.filter((field) => !COMPLETION_FIELDS.includes(field));

/** Parse a JSON-string field back to its value for canonical comparison; null-preserving, matches seed-synthetic-review.js#parseBundleJsonField. */
function parseVerifyJsonField(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    // An unparseable string never canonically-equals a parsed value on
    // either side, so this sentinel always causes a mismatch rather than a
    // thrown error mid-verification.
    return { __unparseable__: value };
  }
}

/** Field-by-field equality, null-preserving; returns the list of mismatched field names (empty = match). */
function mismatchedFields(expected, actual, fields) {
  const mismatches = [];
  for (const field of fields) {
    if ((expected?.[field] ?? null) !== (actual?.[field] ?? null)) mismatches.push(field);
  }
  return mismatches;
}

/** Canonical (parsed) equality for a JSON-string-valued field pair. */
function canonicalJsonFieldsEqual(expected, actual) {
  return JSON.stringify(parseVerifyJsonField(expected)) === JSON.stringify(parseVerifyJsonField(actual));
}

function verificationFailed(message) {
  return codedError(`verify_reviews: ${message}`, 'reviews_verification_failed');
}

/** Verify one destination synthetic person against `syntheticPersonProjection`, marker true, no Contact link (plan "Verify"). */
async function verifyReviewerPerson(deps, assignment, bundleReviewer) {
  const row = await deps.getPersonById(assignment.destinationPersonId, { select: PERSON_READ_FIELDS });
  if (!row) throw verificationFailed(`destination person ${assignment.destinationPersonId} could not be read.`);
  const expected = syntheticPersonProjection(bundleReviewer, assignment.address);
  const mismatches = mismatchedFields(expected, row, Object.keys(expected));
  if (mismatches.length) {
    throw verificationFailed(`synthetic person field(s) do not match the bundle projection: ${mismatches.join(', ')}.`);
  }
  if (row[SYNTHETIC_REVIEWER_MARKER_FIELDS.marker] !== true) {
    throw verificationFailed('destination person is not marker-true.');
  }
  if (row._wmkf_contact_value) {
    throw verificationFailed('destination person carries a Contact link.');
  }
}

/** Verify one destination suggestion's answer rows against the bundle, keyed by question key (plan "Verify", Codex plan round 2). */
async function verifyReviewerAnswers(deps, destinationSuggestionId, bundleReviewer) {
  const expectedByKey = new Map();
  for (const row of bundleReviewer.answers || []) {
    if (expectedByKey.has(row.wmkf_questionkey)) throw verificationFailed(`the bundle itself carries a duplicate answer key (${row.wmkf_questionkey}).`);
    expectedByKey.set(row.wmkf_questionkey, row);
  }
  const actualRows = await deps.getAnswersBySuggestion(destinationSuggestionId);
  const actualByKey = new Map();
  for (const row of actualRows) {
    if (actualByKey.has(row.wmkf_questionkey)) throw verificationFailed(`destination has a duplicate answer row (${row.wmkf_questionkey}).`);
    actualByKey.set(row.wmkf_questionkey, row);
  }
  const missing = [...expectedByKey.keys()].filter((key) => !actualByKey.has(key));
  const extra = [...actualByKey.keys()].filter((key) => !expectedByKey.has(key));
  if (missing.length) throw verificationFailed(`answer row(s) missing: ${missing.join(', ')}.`);
  if (extra.length) throw verificationFailed(`unexpected answer row(s): ${extra.join(', ')}.`);
  for (const [key, expected] of expectedByKey) {
    const actual = actualByKey.get(key);
    for (const field of REVIEWER_ANSWER_FIELDS) {
      if (field === 'wmkf_questionkey') continue;
      const equal = field === 'wmkf_answervalues' || field === 'wmkf_questionoptions'
        ? canonicalJsonFieldsEqual(expected[field], actual[field])
        : (expected[field] ?? null) === (actual[field] ?? null);
      if (!equal) throw verificationFailed(`answer row ${key} field ${field} does not match the bundle.`);
    }
  }
}

/**
 * Verify one seeded reviewer end to end: person, suggestion (candidate,
 * derived and completion fields), answers, and the mutually exclusive file
 * branch (an uploaded review's own copied files are re-verified here via
 * `reverifyCopiedItems`, independent of the caller's combined folder census,
 * which `stepVerifyReviews` builds directly from the ledger's
 * copy_review_file resources before calling this function). Returns the
 * destination suggestion id, for the caller's "no suggestion beyond the
 * seeded set" check.
 */
async function verifyOneReview({
  run, deps, client, graph, bundle, assignment, existingResources, requestFolder,
}) {
  const bundleReviewer = bundleReviewerBySourceId(bundle, assignment.sourcePersonId);
  await verifyReviewerPerson(deps, assignment, bundleReviewer);

  const suggestionResource = existingResources.find((r) => r.step === SEED_REVIEWERS_STEP && r.resourceKind === SUGGESTION_RESOURCE_KIND
    && r.plannedIdentity?.assignmentSequence === assignment.sequence);
  const destinationSuggestionId = suggestionResource?.plannedIdentity?.suggestionId;
  if (!destinationSuggestionId) throw verificationFailed('no seeded suggestion resource for this reviewer.');

  const row = await deps.getSuggestionById(destinationSuggestionId, { select: SUGGESTION_VERIFY_FIELDS });
  if (!row) throw verificationFailed('destination suggestion could not be read.');
  if (!guidEqual(row._wmkf_potentialreviewer_value, assignment.destinationPersonId) || !guidEqual(row._wmkf_request_value, run.destinationRequestId)) {
    throw verificationFailed('destination suggestion is not bound to the expected person/request.');
  }

  const answersResource = existingResources.find((r) => r.step === SEED_ANSWERS_STEP && r.resourceKind === ANSWER_RESOURCE_KIND
    && r.plannedIdentity?.assignmentSequence === assignment.sequence);
  const journaledEtagAfter = answersResource?.readback?.eTagAfter;
  if (journaledEtagAfter && row._etag !== journaledEtagAfter) {
    throw verificationFailed('destination suggestion eTag does not match the journaled post-changeset eTag.');
  }

  const candidateMismatches = mismatchedFields(bundleReviewer.suggestion, row, CANDIDATE_SUGGESTION_FIELDS);
  if (candidateMismatches.length) {
    throw verificationFailed(`suggestion candidate field(s) do not match the bundle: ${candidateMismatches.join(', ')}.`);
  }
  const expectedGrantCycleCode = await destinationGrantCycleCode(client, run.destinationRequestId);
  if ((row.wmkf_grantcyclecode ?? null) !== (expectedGrantCycleCode ?? null)) {
    throw verificationFailed('wmkf_grantcyclecode does not match the destination meeting date.');
  }

  await verifyReviewerAnswers(deps, destinationSuggestionId, bundleReviewer);

  const folderResource = existingResources.find((r) => r.step === COPY_REVIEW_FILE_STEP && r.resourceKind === REVIEW_FOLDER_RESOURCE_KIND
    && r.plannedIdentity?.assignmentSequence === assignment.sequence);
  let filePointers = null;
  if (bundleReviewer.reviewForm === 'uploaded') {
    if (!folderResource?.readback?.filename) throw verificationFailed('an uploaded review has no journaled file pointers.');
    filePointers = { folder: `${requestFolder}/${folderResource.plannedIdentity.folder}`, filename: folderResource.readback.filename };
  }
  const write = buildCompletionWrite(bundleReviewer, { suggestionId: destinationSuggestionId, ifMatch: 'W/"ignored"', filePointers });
  if (bundleReviewer.reviewForm === 'unreceived') {
    if (write !== null) throw verificationFailed('an unreceived review unexpectedly has a completion write.');
    const nullish = ['wmkf_reviewreceivedat', 'wmkf_reviewstatus', 'wmkf_completedat', 'wmkf_thankyousentat']
      .filter((field) => row[field] != null);
    const uploadedByStaffOk = row.wmkf_reviewuploadedbystaff === null || row.wmkf_reviewuploadedbystaff === false;
    if (nullish.length || !uploadedByStaffOk) {
      throw verificationFailed(`unreceived review has a non-null completion field: ${[...nullish, ...(uploadedByStaffOk ? [] : ['wmkf_reviewuploadedbystaff'])].join(', ')}.`);
    }
  } else {
    const expectedParent = write.operations[write.operations.length - 1].body;
    const completionMismatches = mismatchedFields(expectedParent, row, COMPLETION_FIELDS);
    if (completionMismatches.length) {
      throw verificationFailed(`suggestion completion field(s) do not match the journaled seed values: ${completionMismatches.join(', ')}.`);
    }
  }

  if (bundleReviewer.reviewForm === 'uploaded') {
    if (row.wmkf_reviewsharepointfolder !== filePointers.folder || row.wmkf_reviewfilename !== filePointers.filename) {
      throw verificationFailed('uploaded review pointers do not match the journaled destination folder/filename.');
    }
    const fileResources = existingResources
      .filter((r) => r.step === COPY_REVIEW_FILE_STEP && r.resourceKind === REVIEW_FILE_RESOURCE_KIND
        && r.plannedIdentity?.assignmentSequence === assignment.sequence)
      .map((resource) => inflateFileCopyEntry(resource));
    const reverifyFailures = await reverifyCopiedItems(fileResources, graph);
    if (reverifyFailures.length) {
      throw verificationFailed(`uploaded review file(s) failed re-verification: ${reverifyFailures.join('; ')}`);
    }
    return { destinationSuggestionId };
  }
  if (row.wmkf_reviewsharepointfolder !== null || row.wmkf_reviewfilename !== null) {
    throw verificationFailed(`a ${bundleReviewer.reviewForm} review must have null file pointers.`);
  }
  return { destinationSuggestionId };
}

/**
 * `verify_reviews` (slice 6c-ii Stage C, plan "Verify") -- the `reviews`
 * recipe's TERMINAL verifier, the only reviews step that may `markReady`.
 * Re-runs the Basic verifier and the IA verifier's row checks verbatim
 * (`verifyBasicAndInitialAssessment`, shared with `verify_initial_assessment`
 * above), then verifies every seeded reviewer through the sandbox-bound
 * reader: person, suggestion (candidate/derived/completion fields, eTag),
 * answer rows keyed by question key, and the mutually exclusive file branch
 * (`uploaded`/`received_no_file`/`unreceived`). Finally confirms no
 * suggestion exists on the destination Request beyond the seeded set, and
 * extends the folder census with every reviewer's copied files.
 */
async function stepVerifyReviews({ run, ledger, manifest, bundle, client, graph, sharePointTarget }) {
  const preflight = await runPreflight(client, graph, sharePointTarget);
  if (preflight.siteId !== run.expectedGraphSiteId || preflight.driveId !== run.expectedGraphDriveId) {
    throw codedError('Graph site or Request drive identity changed since prepare.', 'preflight_identity_changed');
  }
  const existingResources = await ledger.listRunResources(run.runId);
  // Census prep only (no verification of its content yet): every already-
  // journaled copy_review_file file resource, across every reviewer,
  // inflated to the shape verifyClone/reverifyClone expect and unioned into
  // the SAME single Basic+IA+reviews census pass below. Two SEPARATE exact-
  // count passes cannot both pass once review files are on disk (the first,
  // Basic+IA-only pass would see them as "unexpected"), so this is the only
  // pass -- `verifyBasicAndInitialAssessment` bumps its own expected count
  // by `extraFileCopies.length` and reverifies these bytes right alongside
  // the IA artifact's.
  const reviewFileCopies = existingResources
    .filter((r) => r.step === COPY_REVIEW_FILE_STEP && r.resourceKind === REVIEW_FILE_RESOURCE_KIND && r.outcome === 'verified')
    .map((resource) => inflateFileCopyEntry(resource));

  const { observation } = await verifyBasicAndInitialAssessment({
    run, ledger, manifest, client, graph, sharePointTarget, preflight, existingResources, extraFileCopies: reviewFileCopies,
  });

  const request = await getRequest(client, run.destinationRequestId);
  const requestFolder = expectedRequestFolder(request.akoya_requestnum, request.akoya_requestid);
  const deps = createReviewsSandboxDeps({ resourceUrl: iaSandboxResourceUrl(client) });
  const assignments = await ledger.listRunReviewerAssignments(run.runId);
  if (assignments.length === 0) throw verificationFailed('the run has no reviewer assignments.');

  const destinationSuggestionIds = [];
  for (const assignment of assignments) {
    const full = await ledger.getRunReviewerAssignment(run.runId, assignment.sequence);
    // eslint-disable-next-line no-await-in-loop -- each reviewer's checks
    // must complete (and fail closed) before the next one is read.
    const result = await verifyOneReview({
      run, deps, client, graph, bundle, assignment: full, existingResources, requestFolder,
    });
    destinationSuggestionIds.push(result.destinationSuggestionId);
  }

  // No suggestion on the destination Request beyond the seeded set.
  const liveSuggestionIds = await deps.listSuggestionsByRequest(run.destinationRequestId);
  const seededSet = new Set(destinationSuggestionIds.map((id) => id.toLowerCase()));
  const unexpected = liveSuggestionIds.filter((id) => !seededSet.has(String(id).toLowerCase()));
  if (unexpected.length) {
    throw verificationFailed(`the destination Request has suggestion(s) beyond the seeded set: ${unexpected.join(', ')}.`);
  }
  if (liveSuggestionIds.length !== destinationSuggestionIds.length) {
    throw verificationFailed('the destination Request is missing a seeded suggestion.');
  }

  // Foundation account and Contact rows unchanged: asserted by
  // verifyBasicAndInitialAssessment's own baseline compare above.

  // Only `verify_reviews` may markReady for this recipe (asserted by
  // nextStepFor below), mirroring stepVerify/stepVerifyInitialAssessment's
  // own terminal branch.
  if (nextStepFor(run.recipe, VERIFY_REVIEWS_STEP) !== null) {
    throw new Error('verify_reviews must be the terminal step of its recipe.');
  }
  const ready = await ledger.markReady({
    runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration, expectedVersion: run.version,
    destinationRequestNumber: observation.request.akoya_requestnum,
  });
  if (!ready) return { run, step: VERIFY_REVIEWS_STEP, outcome: 'lease_lost', resources: [] };
  return { run: ready, step: VERIFY_REVIEWS_STEP, outcome: 'ready', resources: [] };
}

// Slice 6a's `recipe_step_not_built` stub (`notBuiltStep`) covered the two IA
// snapshot/seed steps before their bodies landed (Stage C); both are now
// built above and wired into STEP_HANDLERS below. `copy_review_file` and
// `verify_reviews` are now built too (Stage C); `seed_reviewers` and
// `seed_review_answers` were built in slice 6c-ii Stage B.
function notBuiltStep(step) {
  return async function stepNotBuilt({ run, ledger }) {
    const attended = await ledger.markNeedsAttention({
      runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration, expectedVersion: run.version,
      reason: 'recipe_step_not_built',
    });
    if (!attended) return { run, step, outcome: 'lease_lost', resources: [] };
    return { run: attended, step, outcome: 'needs_attention', resources: [] };
  };
}

const STEP_HANDLERS = {
  fence_source: stepFenceSource,
  create_request: stepCreateRequest,
  correct_meeting_date: stepCorrectMeetingDate,
  provision_location: stepProvisionLocation,
  copy_file: stepCopyFile,
  observe: stepObserve,
  verify: stepVerify,
  seed_initial_assessment: stepSeedInitialAssessment,
  seed_initial_assessment_snapshot: stepSeedInitialAssessmentSnapshot,
  verify_initial_assessment: stepVerifyInitialAssessment,
  seed_reviewers: stepSeedReviewers,
  copy_review_file: stepCopyReviewFile,
  seed_review_answers: stepSeedReviewAnswers,
  verify_reviews: stepVerifyReviews,
};

/**
 * Advance one Test Request Factory run by exactly one bounded step.
 *
 * `deps`: `{ client, graph, sharePointTarget, observationOverrides }`.
 * `options`: `{ bypassGoverify, leaseSeconds }`.
 *
 * Returns `{ run, step, outcome, resources }`. `outcome` is one of:
 *   - `'advanced'` -- the step completed and the run moved to the next step.
 *   - `'ready'` -- the final `verify` step passed and the run is complete.
 *   - `'lease_unavailable'` -- claimLease returned null; no work was done.
 *   - `'lease_lost'` -- the lease fence was lost between claiming it and
 *     recording the step's outcome (advanceStep/markReady returned null);
 *     the caller should re-claim and retry. Also returned when a step threw
 *     but the needs_attention transition lost the fence, so nothing was
 *     recorded and the run is reported as the ledger currently holds it.
 *   - `'needs_attention'` -- the step threw; the error was recorded and the
 *     run was marked needs_attention.
 *
 * Never loops: exactly one lease claim, one step, one release (or one
 * needs_attention transition) per call.
 */
export async function advanceRun({ runId, ledger, manifest, bundle, deps, options = {} }) {
  const { client, graph, sharePointTarget, observationOverrides } = deps;
  const { bypassGoverify = false, leaseSeconds = 300 } = options;

  const run = await ledger.getRun(runId);
  if (!run) throw new Error(`No test request run found for ${runId}.`);
  assertRunMatchesManifestAndBundle(run, manifest, bundle);

  const claimed = await ledger.claimLease({ runId, expectedVersion: run.version, leaseSeconds });
  if (!claimed) return { run, step: run.currentStep, outcome: 'lease_unavailable', resources: [] };

  const handler = STEP_HANDLERS[claimed.currentStep];
  if (!handler) throw new Error(`Unknown Test Request Factory run step: ${claimed.currentStep}.`);

  try {
    return await handler({
      run: claimed, ledger, manifest, bundle, client, graph, sharePointTarget, bypassGoverify, observationOverrides,
    });
  } catch (error) {
    // The ledger discards message text entirely (it reduces `error` to a
    // code); the full message is surfaced here to the caller only, never
    // written to the ledger. The CLI prints it and writes it to a private
    // sidecar file, never to Postgres.
    const errorMessage = error?.message ?? String(error);
    // One fenced UPDATE records last_error and the needs_attention stop
    // together; there is no window in which one is persisted without the other.
    const attended = await ledger.markNeedsAttention({
      runId, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration,
      expectedVersion: claimed.version, reason: error, error,
    });
    if (!attended) {
      // Fence lost (lease expired or taken over): nothing was recorded, so do
      // not claim the run is stopped; report the durable row as it is now.
      const current = await ledger.getRun(runId);
      return { run: current ?? claimed, step: claimed.currentStep, outcome: 'lease_lost', resources: [], errorMessage };
    }
    return { run: attended, step: claimed.currentStep, outcome: 'needs_attention', resources: [], errorMessage };
  }
}
