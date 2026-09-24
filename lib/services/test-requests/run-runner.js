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
import { copyBundleFiles, planBundleFileCopies } from './bundle-file-copy.js';
import { LEDGER_REASON_CODES } from './run-ledger.js';
import { createIaSandboxDeps } from './ia-sandbox-deps.js';
import {
  SYNTHETIC_GENERATED,
  SYNTHETIC_PROPOSAL_FILENAME,
  SYNTHETIC_PROPOSAL_TEXT,
} from './fixtures/initial-assessment-synthetic.js';
import {
  buildInitialAssessmentIdentity,
  sanitizeFilePart,
} from '../initial-assessment/artifact-model.js';
import {
  commitReadyLineage,
  conditionalOptions,
  rereadByGenerationKey,
} from '../initial-assessment/artifact-lineage.js';
import { renderInitialAssessmentDocx } from '../initial-assessment/template.js';
import { hashGovernedDocxContent } from '../documents/governed-docx-hash.js';
import { REQUEST_DOCUMENT_ACTOR_POLICY } from '../request-document-actor-service.js';
import {
  INITIAL_ASSESSMENT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';
import { requestInstitution } from '../../../shared/utils/institution.js';
import { meetingDateToCycleCode } from '../../utils/cycle-code.js';

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
export const RECIPE_STEP_ORDER = Object.freeze({
  basic: Object.freeze(BASIC_STEP_ORDER),
  initial_assessment: Object.freeze([
    ...BASIC_STEP_ORDER, 'seed_initial_assessment', 'seed_initial_assessment_snapshot', 'verify_initial_assessment',
  ]),
});

/** Fail closed on an unrecognized recipe, rather than silently defaulting. */
function stepOrderForRecipe(recipe) {
  const order = RECIPE_STEP_ORDER[recipe];
  if (!order) throw new Error(`Unknown Test Request Factory recipe: ${recipe}.`);
  return order;
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
    sourceDriveId: entry.source?.snapshotDriveId,
    driveId: entry.destinationDriveId,
    itemId: entry.item?.id,
    eTag: entry.item?.eTag,
    versionId: entry.item?.versionId,
    uploadAttemptedAt: entry.uploadAttemptedAt,
    itemJournaledAt: entry.itemJournaledAt,
    verifiedAt: entry.verifiedAt,
  });
}

/** Reconstruct the shape bundle-file-copy.js's verifyCopiedFiles/reverifyCopiedItems expect from a ledger resource row. */
function inflateFileCopyEntry(row) {
  const flat = row.readback || {};
  return {
    index: flat.index,
    status: row.outcome === 'verified' ? 'verified' : row.outcome,
    destination: { filename: flat.filename ?? null, folder: flat.folder ?? null, library: flat.library ?? null },
    source: { size: flat.size ?? null, contentHash: flat.contentHash ?? null },
    destinationDriveId: flat.driveId ?? null,
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
async function getIaSeedRequest(client, requestId) {
  const response = await client.get(
    `/akoya_requests(${requestId})?$select=akoya_requestnum,akoya_title,wmkf_meetingdate,_akoya_applicantid_value`,
    { Prefer: 'odata.include-annotations="*"' },
  );
  return bodyOrThrow('destination Request readback (seed_initial_assessment)', response);
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
async function stepSeedInitialAssessment({ run, ledger, client, graph }) {
  const request = await getIaSeedRequest(client, run.destinationRequestId);
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

  if (row?.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
    await ensureResource();
    // wmkf_contenthash is the governed-DOCX dedup hash (governed-docx-hash.js,
    // "gdc1:" + base64url) -- not the ledger's HEX64 contentHash grammar (a
    // plain sha256 hex, see the fresh-render branch below), and the DOCX
    // bytes are not re-rendered on this resume path, so it is left out here.
    await merge({
      requestDocumentId: row.wmkf_requestdocumentid,
      generationKey,
    });
    const advanced = await completeCurrentStep(ledger, run, IA_SEED_STEP);
    if (!advanced) return { run, step: IA_SEED_STEP, outcome: 'lease_lost', resources: [] };
    return { run: advanced, step: IA_SEED_STEP, outcome: 'advanced', resources: [resource] };
  }

  if (!row) {
    // Unlike the SharePoint PUT below, a registry create attempted with no
    // readable row is always safe to retry: Dataverse's alternate key on
    // wmkf_generationkey makes create idempotent (a genuine duplicate POST
    // fails 409/412 and is recovered by the reread right after, below).
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
        actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.ALLOW_UNATTRIBUTED,
        actorContext: {
          operation: 'test-request-factory-seed-initial-assessment',
          requestId: run.destinationRequestId,
          requestNumber,
          operationId: generationKey,
        },
      });
    } catch (error) {
      if (!(([409, 412].includes(error?.status)) || /duplicate|alternate key/i.test(error?.message || ''))) {
        throw error;
      }
      // fall through: reread below recovers the row created by this or a prior attempt.
    }
    row = await rereadByGenerationKey(generationKey, dependencies);
    if (!row) {
      throw codedError('Initial Assessment registry row is missing immediately after create.', 'ia_claim_lost');
    }
    await merge({ requestDocumentId: row.wmkf_requestdocumentid, generationKey });
  }

  // Reached when `row` pre-existed as GENERATING from an earlier invocation
  // of this step (a prior create/reread ran, but this run's own resource
  // resource row was somehow never journaled -- belt-and-suspenders).
  await ensureResource();
  if (!receipt.requestDocumentId) {
    await merge(compact({
      requestDocumentId: row.wmkf_requestdocumentid,
      generationKey,
      filename: row.wmkf_filename,
      claimTokenSha256: row.wmkf_claimtoken
        ? crypto.createHash('sha256').update(row.wmkf_claimtoken).digest('hex')
        : undefined,
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
  // dedup hash ("gdc1:" + base64url, governed-docx-hash.js).
  const governedContentHash = await hashGovernedDocxContent(docx);
  // Ledger receipt: a plain sha256 hex of the same bytes -- the ledger's
  // `contentHash` key grammar is HEX64 and cannot carry the "gdc1:" form.
  const contentHash = crypto.createHash('sha256').update(docx).digest('hex');

  await merge({ registryPatchAttemptedAt: new Date().toISOString() });
  await dependencies.updateDocument(row.wmkf_requestdocumentid, {
    wmkf_contenthash: governedContentHash,
    wmkf_promptname: INITIAL_ASSESSMENT_CONTRACT.promptName,
    wmkf_promptversion: INITIAL_ASSESSMENT_CONTRACT.promptVersion,
  }, conditionalOptions(row));
  row = await rereadByGenerationKey(generationKey, dependencies);
  await merge({ contentHash });

  await merge({ graphFolderAttemptedAt: new Date().toISOString() });
  // Graph target: the runner's own `graph` dependency, already bound to this
  // run's sharePointTarget/manifest by the caller (the same object every
  // other step -- e.g. stepCopyFile above -- uses for the Basic recipe's own
  // folder/upload work). Never a fresh env-derived GraphService.
  await dependencies.ensureFolderPath('akoya_request', row.wmkf_sharepointfolderpath);

  // Dispatch-marker rule for the upload PUT (mirrors bundle-file-copy.js's
  // onItemCreated/itemJournaledAt convention, driven through stepCopyFile
  // above): if an earlier invocation's PUT already committed and its item id
  // was journaled, NEVER re-PUT -- re-read the exact item by stable id
  // instead. Only a genuinely unattempted or genuinely ambiguous (attempted,
  // no journaled id -- checked at the top of this function) upload reaches
  // the PUT below.
  let uploaded;
  if (receipt.itemId) {
    const refreshed = await dependencies.getFileMetadataById(receipt.driveId, receipt.itemId);
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
    uploaded = { ...refreshed, siteId: receipt.siteId };
  } else {
    await merge({ uploadAttemptedAt: new Date().toISOString() });
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
      { onItemCreated, conflictBehavior: 'fail' },
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
 * Slice 6a registers the Initial Assessment recipe's step ORDER but not its
 * step BODIES (build-order item 6, slice 6b). Reaching one of these three
 * steps stops the run cleanly with needs_attention and a dedicated reason
 * (`recipe_step_not_built`) -- never an unhandled throw, and never markReady.
 */
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
  seed_initial_assessment_snapshot: notBuiltStep('seed_initial_assessment_snapshot'),
  verify_initial_assessment: notBuiltStep('verify_initial_assessment'),
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
