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

export const STEP_ORDER = [
  'fence_source', 'create_request', 'correct_meeting_date', 'provision_location', 'copy_file', 'observe', 'verify',
];

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

  const advanced = await completeStep(ledger, run, { nextStep: 'create_request', nextStepIndex: 1 });
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
        const flat = compact({
          createAttemptedAt: patch.createAttemptedAt,
          responseStatus: patch.createResponseStatus,
          createResponseReceivedAt: patch.createResponseReceivedAt,
        });
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

  const advanced = await completeStep(ledger, run, {
    nextStep: 'correct_meeting_date', nextStepIndex: 2, destinationRequestNumber,
  });
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

  const advanced = await completeStep(ledger, run, { nextStep: 'provision_location', nextStepIndex: 3 });
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

  const advanced = await completeStep(ledger, run, { nextStep: 'copy_file', nextStepIndex: 4 });
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
    const advanced = await completeStep(ledger, run, { nextStep: 'observe', nextStepIndex: 5 });
    if (!advanced) return { run, step: 'copy_file', outcome: 'lease_lost', resources: [] };
    return { run: advanced, step: 'copy_file', outcome: 'advanced', resources: [] };
  }

  const index = verifiedCount;
  const pending = fileResources.find((row) => row.plannedIdentity?.index === index && row.outcome !== 'verified');
  if (pending && pending.readback?.itemId) {
    throw codedError(`File copy at index ${index} has an unverified journaled item (${pending.readback.itemId}); inspect before resuming.`, 'file_journal_unverified');
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
  const advanced = await completeStep(ledger, run, {
    nextStep: done ? 'observe' : 'copy_file',
    nextStepIndex: done ? 5 : run.stepIndex,
  });
  if (!advanced) return { run, step: 'copy_file', outcome: 'lease_lost', resources };
  return { run: advanced, step: 'copy_file', outcome: 'advanced', resources };
}

async function stepObserve({ run, ledger, client, observationOverrides }) {
  await observeStep(client, run.destinationRequestId, observationOverrides);
  const advanced = await completeStep(ledger, run, { nextStep: 'verify', nextStepIndex: 6 });
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

  const ready = await ledger.markReady({
    runId: run.runId, leaseToken: run.leaseToken, leaseGeneration: run.leaseGeneration, expectedVersion: run.version,
    destinationRequestNumber: observation.request.akoya_requestnum,
  });
  if (!ready) return { run, step: 'verify', outcome: 'lease_lost', resources: [] };
  return { run: ready, step: 'verify', outcome: 'ready', resources: [] };
}

const STEP_HANDLERS = {
  fence_source: stepFenceSource,
  create_request: stepCreateRequest,
  correct_meeting_date: stepCorrectMeetingDate,
  provision_location: stepProvisionLocation,
  copy_file: stepCopyFile,
  observe: stepObserve,
  verify: stepVerify,
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
 *     but recordError itself lost the fence, so nothing was recorded.
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
    const afterError = await ledger.recordError({
      runId, leaseToken: claimed.leaseToken, leaseGeneration: claimed.leaseGeneration, expectedVersion: claimed.version, error,
    });
    // Fence lost (lease expired or taken over): nothing was recorded, so do
    // not claim the run is in needs_attention.
    if (!afterError) return { run: claimed, step: claimed.currentStep, outcome: 'lease_lost', resources: [], errorMessage };
    const attended = await ledger.markNeedsAttention({
      runId, leaseToken: afterError.leaseToken, leaseGeneration: afterError.leaseGeneration,
      expectedVersion: afterError.version, reason: error,
    });
    return { run: attended ?? afterError, step: claimed.currentStep, outcome: 'needs_attention', resources: [], errorMessage };
  }
}
