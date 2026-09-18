/**
 * Durable Pre-Research Presentation Brief producer.
 *
 * docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md §3, §3.4a,
 * §5 slice 3. Mirrors the Pre-Site Visit lineage
 * (lib/services/pre-site-visit/artifact-service.js) — claim under the
 * generation-key alternate key, render, upload, then atomically activate
 * with supersede + pointer move under ETags in one changeset — but without
 * any prompt/AI step: the brief renders deterministically from the frozen
 * input snapshot, so there is no separate "claim, then call the model,
 * then render" phase. Rendering happens synchronously inside the same
 * claimed-row lifecycle Pre-Site uses for its render/upload phase.
 *
 * Canonical vs. pending (plan §3): `getPreRpBriefStatus` resolves the
 * canonical brief strictly through `akoya_request.wmkf_CurrentPreRPBrief`
 * (fail closed on an invalid or missing-but-should-exist pointer), and the
 * pending brief as the newest non-Ready, non-superseded row, postdating the
 * pointer target when one exists — never a "newest row" fallback.
 */

import crypto from 'crypto';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { runChangeset } from '../../dataverse/core/changeset.js';
import { GraphService } from '../graph-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import { REQUEST_DOCUMENT_ACTOR_POLICY } from '../request-document-actor-service.js';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets.js';
import { isGuid } from '../../utils/guid.js';
import { hashGovernedDocxContent } from '../documents/governed-docx-hash.js';
import {
  hasSentAttemptForSource,
  listDistributionAttempts,
} from '../pre-site-visit/distribution-store.js';
import { loadPreRpBriefInputs } from './input-service.js';
import { briefInputFingerprint, renderBrief } from './docx-renderer.js';
import {
  isPreSiteDistributionSnapshot,
  PRE_RP_BRIEF_CONTRACT,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';

const GENERATING_LEASE_MS = 15 * 60 * 1000;

const REQUEST_LINEAGE_SELECT = [
  'akoya_requestid',
  '_wmkf_currentprerpbrief_value',
].join(',');

const DEFAULT_DEPENDENCIES = Object.freeze({
  loadInputs: loadPreRpBriefInputs,
  renderDocx: renderBrief,
  hashDocx: hashGovernedDocxContent,
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, {
    select: REQUEST_LINEAGE_SELECT,
  }),
  getBuckets: getRequestSharePointBuckets,
  findByGenerationKey: requestDocumentAdapter.findByGenerationKey,
  findByRequest: requestDocumentAdapter.findByRequest,
  hasSentAttemptForSource,
  listDistributionAttempts,
  createDocument: requestDocumentAdapter.create,
  updateDocument: requestDocumentAdapter.update,
  commitChangeset: runChangeset,
  ensureFolderPath: (...args) => GraphService.ensureFolderPath(...args),
  uploadFile: (...args) => GraphService.uploadFile(...args),
  downloadFile: (...args) => GraphService.downloadFile(...args),
  deleteFile: (...args) => GraphService.deleteFile(...args),
  newClaimToken: () => crypto.randomUUID(),
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sameId(left, right) {
  return Boolean(left) && Boolean(right)
    && String(left).toLowerCase() === String(right).toLowerCase();
}

const DISTRIBUTION_IN_FLIGHT_STATES = new Set([
  'activity_created',
  'attachments_added',
  'send_requested',
]);

function staleGenerationReplayError() {
  const message = 'This generation request belongs to an older Pre-RP Brief. Start a new regeneration.';
  return new ServiceHttpError(message, {
    httpStatus: 409,
    code: 'brief_generation_replay_stale',
    body: { error: message, code: 'brief_generation_replay_stale' },
  });
}

function distributionStartedError() {
  const message = 'This Pre-RP Brief is already being sent or has been sent to the Board and cannot be regenerated.';
  return new ServiceHttpError(message, {
    httpStatus: 409,
    code: 'brief_regeneration_distribution_started',
    body: { error: message, code: 'brief_regeneration_distribution_started' },
  });
}

function distributionStateUnavailableError() {
  const message = 'Pre-RP Brief distribution state could not be verified.';
  return new ServiceHttpError(message, {
    httpStatus: 503,
    code: 'brief_distribution_state_unavailable',
    body: { error: message, code: 'brief_distribution_state_unavailable' },
  });
}

// Codex adversarial review finding 1 (2026-09-16): the reopen-service
// validates against a specific current-row identity (`reopen.sourceArtifactId`)
// before ever calling generatePreRpBrief; a rival generation can move the
// pointer between that validation and this function's own pointer read. This
// closes the race by re-checking identity here, before any claim.
function reopenSourceStaleError() {
  const message = 'This Pre-RP Brief changed after this guarded regeneration was authorized. Reload and try again.';
  return new ServiceHttpError(message, {
    httpStatus: 409,
    code: 'brief_reopen_stale',
    body: { error: message, code: 'brief_reopen_stale' },
  });
}

// Codex adversarial review finding 2b: the generation key now binds the
// reopen tuple (cycleId/sourceArtifactId/reasonCode/reasonNote), so a
// resolved row with mismatched audit fields should be unreachable in
// practice; this is a defense-in-depth fail-closed check, not the primary
// guard.
function reopenAuditMismatchError() {
  const message = 'This guarded regeneration operation id is already bound to different reopen inputs.';
  return new ServiceHttpError(message, {
    httpStatus: 409,
    code: 'brief_reopen_audit_mismatch',
    body: { error: message, code: 'brief_reopen_audit_mismatch' },
  });
}

function reopenAuditMatches(row, reopen) {
  return sameId(row?.wmkf_reopencycleid, reopen?.cycleId)
    && row?.wmkf_reopenreasoncode === reopen?.reasonCode
    && row?.wmkf_reopenreasonnote === reopen?.reasonNote;
}

// Exported so lib/services/pre-rp-brief/reopen-service.js can reuse the exact
// same in-flight definition rather than maintaining a second copy that could
// silently drift from this one.
export function attemptIsInFlight(attempt, sourceDocumentId) {
  if (!sameId(attempt?.source_document_id, sourceDocumentId)) return false;
  // A claimed prepared attempt is already inside sendPreSiteDistribution even
  // before its first durable state transition. Later send states remain
  // resumable after a cleared/expired lease, so they also block replacement.
  return Boolean(attempt?.lease_token)
    || DISTRIBUTION_IN_FLIGHT_STATES.has(attempt?.state);
}

// `allowSent` (guarded regeneration of an already-sent brief, owner decision
// 2026-09-16) skips only the "sent" half of this gate; an in-flight
// distribution attempt still blocks unconditionally, both here and at the
// commitReadyLineage activation fence below.
async function assertCurrentBriefReplaceable(requestId, currentRow, dependencies, { allowSent = false } = {}) {
  if (!currentRow) return;
  const sourceDocumentId = currentRow.wmkf_requestdocumentid;
  let sent;
  let attempts;
  try {
    [sent, attempts] = await Promise.all([
      dependencies.hasSentAttemptForSource(requestId, sourceDocumentId),
      dependencies.listDistributionAttempts(requestId, { limit: 100 }),
    ]);
  } catch {
    throw distributionStateUnavailableError();
  }
  if (!Array.isArray(attempts)) {
    throw distributionStateUnavailableError();
  }
  if ((!allowSent && sent) || attempts.some((attempt) => attemptIsInFlight(attempt, sourceDocumentId))) {
    throw distributionStartedError();
  }
  // The shared reader is display-bounded. Refuse rather than infer absence
  // from a full page whose older rows were not inspected.
  if (attempts.length >= 100) throw distributionStateUnavailableError();
}

function sanitizeFilePart(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function sanitizeError(error) {
  return {
    code: String(error?.code || error?.status || 'pre_rp_brief_failed').slice(0, 100),
    message: String(error?.message || 'Pre-Research Presentation Brief generation failed')
      .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
      .replace(/[A-Za-z0-9_~.-]{40,}/g, '[redacted]')
      .slice(0, 2000),
  };
}

function conditionalOptions(row, actingUserSystemId = null) {
  if (!row?._etag) {
    throw new ServiceHttpError('Pre-RP Brief request-document row is missing its write fence.', {
      httpStatus: 500,
    });
  }
  return {
    ifMatch: row._etag,
    ...(actingUserSystemId ? { actingUserSystemId } : {}),
  };
}

function assertBriefRow(row) {
  if (!row
    || row.wmkf_artifacttype !== PRE_RP_BRIEF_CONTRACT.artifactType
    || row.wmkf_contenttype !== PRE_RP_BRIEF_CONTRACT.contentType) {
    throw new ServiceHttpError('Request-document row is not a governed Pre-RP Brief document.', {
      httpStatus: 500,
    });
  }
  if (!Object.values(REQUEST_DOCUMENT_OPERATION_STATUS).includes(row.wmkf_operationstatus)
    || !Object.values(REQUEST_DOCUMENT_LIFECYCLE_STATE).includes(row.wmkf_lifecyclestate)) {
    throw new ServiceHttpError('Pre-RP Brief request-document row has an unknown state.', {
      httpStatus: 500,
    });
  }
  return row;
}

function isBriefRow(row) {
  return row?.wmkf_artifacttype === PRE_RP_BRIEF_CONTRACT.artifactType
    && row?.wmkf_contenttype === PRE_RP_BRIEF_CONTRACT.contentType
    && !isPreSiteDistributionSnapshot(row);
}

// B10 client mirror (plan §3.4b): the received-review count of the row's own
// generation-input snapshot, using the same received-review test as the
// server-side share gate (`assertBriefInputsReady` in the Pre-Site
// distribution service). Tri-state: a number for a readable brief snapshot,
// `null` when the snapshot is missing or malformed (the server refuses such a
// brief with `brief_snapshot_invalid`, a different reason from zero reviews),
// never a throw, since this is a display affordance, not the gate.
function receivedReviewCountOf(row) {
  let snapshot = row?.wmkf_presiteinputsnapshotjson;
  if (!snapshot) return null;
  if (typeof snapshot === 'string') {
    try {
      snapshot = JSON.parse(snapshot);
    } catch {
      return null;
    }
  }
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
    || snapshot.schemaVersion !== PRE_RP_BRIEF_CONTRACT.snapshotSchemaVersion
    || snapshot.artifactType !== PRE_RP_BRIEF_CONTRACT.snapshotArtifactType
    || !Array.isArray(snapshot.reviews)) {
    return null;
  }
  // Same test the server applies: the stored envelope must canonicalize and
  // re-hash to the row's recorded fingerprint, else the row is unreadable.
  try {
    if (briefInputFingerprint(snapshot) !== row.wmkf_inputfingerprint) return null;
  } catch {
    return null;
  }
  return snapshot.reviews.filter((review) => !!review?.reviewReceivedAt).length;
}

function fileNameFor(requestNumber, generationKey) {
  return `Pre-RP-Brief_${sanitizeFilePart(requestNumber)}_${generationKey.slice(0, 8)}.docx`;
}

export function projectPreRpBriefArtifact(row) {
  assertBriefRow(row);
  return {
    artifactId: row.wmkf_requestdocumentid,
    requestId: row._wmkf_request_value,
    operationStatus: row.wmkf_operationstatus,
    lifecycleState: row.wmkf_lifecyclestate,
    retryable: row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
    file: row.wmkf_sharepointitemid ? {
      siteId: row.wmkf_sharepointsiteid,
      driveId: row.wmkf_sharepointdriveid,
      itemId: row.wmkf_sharepointitemid,
      webUrl: row.wmkf_sharepointweburl,
      versionId: row.wmkf_sharepointversionid,
      eTag: row.wmkf_sharepointetag,
      folderPath: row.wmkf_sharepointfolderpath,
      name: row.wmkf_filename,
      size: row.wmkf_filesize,
      lastModified: row.wmkf_sharepointlastmodified,
    } : null,
    provenance: {
      inputFingerprint: row.wmkf_inputfingerprint,
      templateId: row.wmkf_templateid,
      templateVersion: row.wmkf_templateversion,
      contentHash: row.wmkf_contenthash,
    },
    milestone: row.wmkf_milestoneversionid ? {
      versionId: row.wmkf_milestoneversionid,
      contentHash: row.wmkf_milestonecontenthash || null,
      createdAt: row.wmkf_milestonecreatedat || null,
      actorId: row._wmkf_milestonecreatedby_value || null,
      actorName: row._wmkf_milestonecreatedby_value_formatted || null,
    } : null,
    lastError: row.wmkf_lasterrormessage ? {
      code: row.wmkf_lasterrorcode || null,
      message: row.wmkf_lasterrormessage,
      at: row.wmkf_lastfailedat || null,
      supportReference: row.wmkf_requestdocumentid,
    } : null,
    receivedReviewCount: receivedReviewCountOf(row),
    // Codex adversarial review (2026-09-17, round 5 finding 2): `false` for
    // any non-GENERATING row (including a completed/failed one, where the
    // concept does not apply) or a GENERATING row whose 15-minute lease
    // (`GENERATING_LEASE_MS`, the same window `claimExisting`/
    // `generatingLeaseActive` use) has expired — an abandoned attempt.
    // Consumers (the tab's `briefRegenerationPending`) treat only an
    // active-leased GENERATING row as actually blocking, so an expired one
    // never strands the current brief's own Share/send affordances.
    leaseActive: generatingLeaseActive(row),
  };
}

/**
 * Resolve the canonical (pointer-target) raw brief row: same request, type
 * 100000009, Ready, lifecycle Draft|Review, not a distribution snapshot.
 * Fails closed (brief_pointer_invalid) on an invalid pointer or an orphaned
 * Ready row with no pointer. Shared by `getPreRpBriefStatus` and, as an
 * injected dependency, the distribution service's own source resolver
 * (plan §3) — pointer-resolution logic lives here exactly once.
 *
 * @returns {Promise<{request: object, row: object|null, briefRows: object[]}>}
 *   `row` is null only when there is no pointer and no orphaned Ready row.
 */
export async function resolveCanonicalPreRpBriefRow(
  requestId,
  dependencies = DEFAULT_DEPENDENCIES,
) {
  const [request, result] = await Promise.all([
    dependencies.getRequest(requestId),
    dependencies.findByRequest(requestId, {
      artifactType: PRE_RP_BRIEF_CONTRACT.artifactType,
    }),
  ]);
  if (!request || String(request.akoya_requestid || '').toLowerCase() !== requestId.toLowerCase()) {
    throw new ServiceHttpError('The Pre-RP Brief request could not be resolved.', {
      httpStatus: 404,
      code: 'pre_rp_brief_request_not_found',
    });
  }

  const rows = (result?.records || []).filter((row) => (
    String(row?._wmkf_request_value || '').toLowerCase() === requestId.toLowerCase()
    && row.wmkf_artifacttype === PRE_RP_BRIEF_CONTRACT.artifactType
  ));
  const briefRows = rows.filter((row) => isBriefRow(row));

  const pointerId = request._wmkf_currentprerpbrief_value
    ? String(request._wmkf_currentprerpbrief_value).toLowerCase()
    : null;
  if (pointerId) {
    const row = briefRows.find((candidate) => (
      String(candidate.wmkf_requestdocumentid || '').toLowerCase() === pointerId
    ));
    if (!row
      || row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
      || ![REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT, REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW]
        .includes(row.wmkf_lifecyclestate)) {
      throw new ServiceHttpError('The current Pre-RP Brief request pointer requires reconciliation.', {
        httpStatus: 409,
        code: 'brief_pointer_invalid',
      });
    }
    return { request, row, briefRows };
  }
  if (briefRows.some((row) => row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY)) {
    throw new ServiceHttpError('A Ready Pre-RP Brief has no current request pointer.', {
      httpStatus: 409,
      code: 'brief_pointer_invalid',
    });
  }
  return { request, row: null, briefRows };
}

/**
 * Read the canonical (pointer-resolved) and pending Pre-RP Brief rows
 * without side effects (plan §3).
 */
export async function getPreRpBriefStatus(
  { requestId },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!isGuid(requestId)) {
    throw new ServiceHttpError('A valid requestId is required.', {
      httpStatus: 400,
      code: 'invalid_request_id',
    });
  }

  const { row: currentRow, briefRows } = await resolveCanonicalPreRpBriefRow(requestId, dependencies);
  const currentArtifact = currentRow ? projectPreRpBriefArtifact(currentRow) : null;

  const currentCreatedAt = currentRow ? Date.parse(currentRow.createdon || '') : null;
  const pendingRow = briefRows.find((row) => {
    if (currentRow && String(row.wmkf_requestdocumentid || '').toLowerCase()
        === String(currentRow.wmkf_requestdocumentid || '').toLowerCase()) {
      return false;
    }
    if (row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
      || row.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED) {
      return false;
    }
    if (!currentArtifact) return true;
    const candidateCreatedAt = Date.parse(row.createdon || '');
    return Number.isFinite(currentCreatedAt)
      && Number.isFinite(candidateCreatedAt)
      && candidateCreatedAt > currentCreatedAt;
  });

  return {
    currentArtifact,
    pendingArtifact: pendingRow ? projectPreRpBriefArtifact(pendingRow) : null,
    // Plan §3.5 / H1: distinguishes "no brief rows exist at all" (legacy
    // Pre-Site rail derivation is safe) from every other case, including a
    // status fetch that threw before reaching here (that path never returns
    // this object at all, so the caller must not infer "no rows" from a
    // caught status error).
    hasBriefRows: briefRows.length > 0,
  };
}

/**
 * Resolve the current Pre-RP Brief for distribution: the canonical pointer
 * target, additionally required to be locked for Share (lifecycle Review)
 * and to match the caller's expected artifact id. Returns the RAW row (not
 * the projected DTO), since distribution needs the raw drive/item/folder
 * fields, and reuses `resolveCanonicalPreRpBriefRow` so pointer-resolution
 * logic is never duplicated between this service and distribution.
 */
export async function resolveCurrentPreRpBriefForDistribution(
  requestId,
  expectedArtifactId,
  dependencies = DEFAULT_DEPENDENCIES,
) {
  const { request, row, briefRows } = await resolveCanonicalPreRpBriefRow(requestId, dependencies);
  if (!row
    || !isGuid(expectedArtifactId)
    || String(row.wmkf_requestdocumentid).toLowerCase() !== String(expectedArtifactId).toLowerCase()) {
    throw new ServiceHttpError(
      'A different Pre-Research Presentation Brief is current. Reload before preparing the email.',
      { httpStatus: 409, code: 'distribution_stale_source' },
    );
  }
  if (row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW
    || row.wmkf_contenttype !== PRE_RP_BRIEF_CONTRACT.contentType
    || !row.wmkf_sharepointdriveid
    || !row.wmkf_sharepointitemid
    || !row.wmkf_sharepointfolderpath) {
    throw new ServiceHttpError(
      'The current Pre-Research Presentation Brief is not eligible for frozen distribution.',
      { httpStatus: 409, code: 'distribution_source_ineligible' },
    );
  }
  // Codex adversarial review (2026-09-17, round 5): a guarded regeneration
  // claims its successor under a DIFFERENT generation key while the request
  // pointer still names this (predecessor) row, so the checks above alone
  // never see it. Both distribution/prepare and the send-time freshness
  // recheck call this resolver, so refusing here closes both ends: a send
  // cannot start, and one already prepared cannot complete, while a
  // replacement is live. Same active-lease window `claimExisting`/
  // `generatingLeaseActive` use, so an abandoned (expired-lease) attempt
  // never blocks distribution forever.
  const regenerating = briefRows.some((candidate) => (
    !sameId(candidate.wmkf_requestdocumentid, row.wmkf_requestdocumentid)
    && candidate.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
    && generatingLeaseActive(candidate)
  ));
  if (regenerating) {
    throw new ServiceHttpError(
      'A replacement brief is being generated; sharing is paused until it is ready.',
      { httpStatus: 409, code: 'brief_regeneration_in_progress' },
    );
  }
  return { request, row };
}

async function rereadByGenerationKey(generationKey, dependencies) {
  const result = await dependencies.findByGenerationKey(generationKey);
  const rows = result?.records || [];
  if (rows.length > 1) {
    throw new ServiceHttpError('Duplicate Pre-RP Brief generation keys require reconciliation.', {
      httpStatus: 500,
    });
  }
  return rows[0] || null;
}

function generatingLeaseActive(row) {
  if (row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) return false;
  const modifiedAt = Date.parse(row.modifiedon || row.createdon || '');
  return Number.isFinite(modifiedAt) && Date.now() - modifiedAt < GENERATING_LEASE_MS;
}

async function assertOwnedClaim(generationKey, claimToken, dependencies) {
  const row = await rereadByGenerationKey(generationKey, dependencies);
  assertBriefRow(row);
  if (row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
    || row.wmkf_claimtoken !== claimToken) {
    throw new ServiceHttpError('Pre-RP Brief generation claim was superseded.', {
      httpStatus: 409,
      code: 'claim_lost',
      body: { error: 'Pre-RP Brief generation claim was superseded.', code: 'claim_lost' },
    });
  }
  return row;
}

async function claimExisting(row, actingUserSystemId, dependencies) {
  assertBriefRow(row);
  if (generatingLeaseActive(row)) return null;
  const claimToken = dependencies.newClaimToken();
  try {
    await dependencies.updateDocument(row.wmkf_requestdocumentid, {
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
      wmkf_claimtoken: claimToken,
      wmkf_attemptcount: Number(row.wmkf_attemptcount || 0) + 1,
      wmkf_lasterrorcode: null,
      wmkf_lasterrormessage: null,
      wmkf_lastfailedat: null,
    }, conditionalOptions(row, actingUserSystemId));
    return claimToken;
  } catch (error) {
    if (error?.status === 412) return null;
    throw error;
  }
}

async function markFailedIfOwned(generationKey, claimToken, patch, actingUserSystemId, dependencies) {
  const row = await rereadByGenerationKey(generationKey, dependencies).catch(() => null);
  if (!row
    || row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
    || row.wmkf_claimtoken !== claimToken) return false;
  try {
    await dependencies.updateDocument(
      row.wmkf_requestdocumentid,
      patch,
      conditionalOptions(row, actingUserSystemId),
    );
    return true;
  } catch (error) {
    if (error?.status === 412) return false;
    throw error;
  }
}

async function activeRequestBucket(requestId, requestNumber, dependencies) {
  const buckets = await dependencies.getBuckets(requestId, requestNumber, {
    requireResolvedParents: true,
  });
  const active = (buckets || []).filter((bucket) => (
    bucket.source === 'dynamics'
    && String(bucket.library || '').toLowerCase() === 'akoya_request'
  ));
  if (active.length !== 1) {
    throw new ServiceHttpError(
      `Expected exactly one active akoya_request SharePoint location; found ${active.length}.`,
      { httpStatus: 409 },
    );
  }
  return active[0];
}

/**
 * Atomically move the request pointer + supersede every other active brief
 * row + READY/DRAFT the target, all under their own ETags in one changeset
 * (same pattern as Pre-Site's commitReadyLineage,
 * lib/services/pre-site-visit/artifact-service.js:875-1009).
 */
async function commitReadyLineage(
  row,
  {
    metadata = null,
    claimToken = null,
    actingUserSystemId = null,
    expectedPointerId = undefined,
    reopen = null,
  } = {},
  dependencies,
) {
  for (let pass = 0; pass < 3; pass += 1) {
    const target = claimToken
      ? await assertOwnedClaim(row.wmkf_generationkey, claimToken, dependencies)
      : assertBriefRow(await rereadByGenerationKey(row.wmkf_generationkey, dependencies));
    const result = await dependencies.findByRequest(target._wmkf_request_value, {
      artifactType: PRE_RP_BRIEF_CONTRACT.artifactType,
    });
    const request = await dependencies.getRequest(target._wmkf_request_value);
    const rows = (result?.records || []).filter((candidate) => isBriefRow(candidate));
    const pointerId = request?._wmkf_currentprerpbrief_value || null;
    // Activation fence: the pointer must still be the one observed before
    // this generation claimed its row (null when there was none). A rival
    // generation that activated first wins; this one refuses instead of
    // superseding the newer current brief (e.g. an older render version
    // finishing after a newer one).
    const pointerUnchanged = (!pointerId && !expectedPointerId) || sameId(pointerId, expectedPointerId);
    if (expectedPointerId !== undefined
      && !pointerUnchanged
      && !sameId(pointerId, target.wmkf_requestdocumentid)) {
      throw new ServiceHttpError(
        'The current Pre-RP Brief changed while generation was running. Reload and try again.',
        {
          httpStatus: 409,
          code: 'brief_pointer_changed',
          body: {
            error: 'The current Pre-RP Brief changed while generation was running. Reload and try again.',
            code: 'brief_pointer_changed',
          },
        },
      );
    }
    let pointer = null;
    if (pointerId) {
      pointer = rows.find((candidate) => sameId(candidate.wmkf_requestdocumentid, pointerId));
      if (!pointer
        || !sameId(pointer._wmkf_request_value, target._wmkf_request_value)
        || pointer.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
        || pointer.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED) {
        throw new ServiceHttpError('The current Pre-RP Brief request pointer requires reconciliation.', {
          httpStatus: 409,
          code: 'brief_pointer_invalid',
        });
      }
    }
    // Recheck at the activation fence. A send can start while a replacement
    // is rendering/uploading; the send path rechecks the pointer before
    // transport, and this reciprocal check prevents us from superseding a
    // source that has already acquired send-side durable state.
    if (pointer && !sameId(pointer.wmkf_requestdocumentid, target.wmkf_requestdocumentid)) {
      await assertCurrentBriefReplaceable(target._wmkf_request_value, pointer, dependencies, {
        allowSent: Boolean(reopen),
      });
    }
    const priorReady = rows.filter((candidate) => (
      candidate.wmkf_requestdocumentid !== target.wmkf_requestdocumentid
      && candidate.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
      && candidate.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
    ));
    if (!metadata
      && target.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
      && target.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
      && priorReady.length === 0
      && sameId(request?._wmkf_currentprerpbrief_value, target.wmkf_requestdocumentid)) return target;

    const operations = [
      ...priorReady.map((prior) => ({
        method: 'PATCH',
        entitySet: requestDocumentAdapter.ENTITY_SET_NAME,
        key: prior.wmkf_requestdocumentid,
        body: { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED },
        ifMatch: conditionalOptions(prior).ifMatch,
      })),
      {
        method: 'PATCH',
        entitySet: requestDocumentAdapter.ENTITY_SET_NAME,
        key: target.wmkf_requestdocumentid,
        body: {
          wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
          wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
          wmkf_lasterrorcode: null,
          wmkf_lasterrormessage: null,
          wmkf_lastfailedat: null,
          ...(metadata ? {
            wmkf_sharepointsiteid: metadata.siteId,
            wmkf_sharepointdriveid: metadata.driveId,
            wmkf_sharepointitemid: metadata.id,
            wmkf_sharepointweburl: metadata.webUrl,
            wmkf_sharepointversionid: metadata.versionId,
            wmkf_sharepointetag: metadata.eTag,
            wmkf_filesize: metadata.size,
            wmkf_sharepointlastmodified: metadata.lastModified,
          } : {}),
        },
        ifMatch: conditionalOptions(target).ifMatch,
      },
      {
        method: 'PATCH',
        entitySet: grantRequestAdapter.ENTITY_SET_NAME,
        key: target._wmkf_request_value,
        body: {
          'wmkf_CurrentPreRPBrief@odata.bind':
            `/wmkf_requestdocuments(${target.wmkf_requestdocumentid})`,
        },
        ifMatch: conditionalOptions(request).ifMatch,
      },
    ];
    try {
      await dependencies.commitChangeset(operations, {
        ...(actingUserSystemId ? { actingUserSystemId } : {}),
      });
    } catch (error) {
      if (error?.status === 412 || /\b412\b/.test(error?.message || '')) continue;
      throw error;
    }
    return rereadByGenerationKey(row.wmkf_generationkey, dependencies);
  }
  throw new ServiceHttpError('Pre-RP Brief activation conflicted repeatedly; retry is safe.', {
    httpStatus: 409,
    code: 'ready_lineage_conflict',
  });
}

/**
 * Generate, or safely reuse, one governed Pre-Research Presentation Brief.
 * Regenerate uses the same path (B12): a changed input fingerprint or a
 * different `clientOperationId` computes a different generation key, so
 * generation always claims/creates a fresh row and activation supersedes
 * the prior one. An exact unchanged retry (same fingerprint AND same
 * `clientOperationId`) reuses the same row.
 */
// Generation identity: request, artifact type, canonical input fingerprint,
// the caller's operation id, and the template + renderer versions. Any
// change to what the renderer emits for the same inputs must bump
// `renderVersion` so the same key can never map to different bytes.
// Codex adversarial review finding 2a: `reopen` (when present) is bound into
// the key so a guarded regeneration can never resolve to, or collide with,
// an ordinary FAILED/GENERATING row that happens to share the same
// `clientOperationId` — the two lineages are cryptographically distinct
// identities. Omitted/null for ordinary generation, so ordinary keys are
// byte-identical to before this option existed (asserted in
// tests/unit/pre-rp-brief-artifact-service.test.js).
export function buildPreRpBriefGenerationKey({ requestId, inputFingerprint, clientOperationId, reopen = null }) {
  return sha256(JSON.stringify({
    requestId: String(requestId).toLowerCase(),
    artifactType: PRE_RP_BRIEF_CONTRACT.artifactType,
    inputFingerprint,
    clientOperationId: String(clientOperationId),
    templateId: PRE_RP_BRIEF_CONTRACT.templateId,
    templateVersion: PRE_RP_BRIEF_CONTRACT.templateVersion,
    renderVersion: PRE_RP_BRIEF_CONTRACT.renderVersion,
    ...(reopen ? {
      reopen: {
        cycleId: String(reopen.cycleId),
        sourceArtifactId: String(reopen.sourceArtifactId || '').toLowerCase(),
        reasonCode: String(reopen.reasonCode),
        reasonNote: String(reopen.reasonNote),
      },
    } : {}),
  }));
}

// `reopen` (owner decision 2026-09-16, docs §10): internal-only option set by
// lib/services/pre-rp-brief/reopen-service.js after it has independently
// verified the guarded-reopen preconditions (superuser, schema readiness,
// current-row identity, sent state, no in-flight attempt). The public route
// (pages/api/workbench/pre-rp-brief.js) never accepts a `reopen` body key.
export async function generatePreRpBrief(
  { requestId, clientOperationId, actingUserSystemId = null, reopen = null },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!isGuid(requestId)) {
    throw new ServiceHttpError('A valid requestId is required.', {
      httpStatus: 400,
      code: 'invalid_request_id',
    });
  }
  if (!String(clientOperationId || '').trim()) {
    throw new ServiceHttpError('A clientOperationId is required.', {
      httpStatus: 400,
      code: 'invalid_client_operation_id',
    });
  }

  // Inputs are loaded and validated (including the abstract-required check)
  // before any claim exists, so a data-completeness failure has no durable
  // side effect.
  const inputs = await dependencies.loadInputs({ requestId });
  const inputFingerprint = briefInputFingerprint(inputs.envelope);
  const generationKey = buildPreRpBriefGenerationKey({ requestId, inputFingerprint, clientOperationId, reopen });

  let row = await rereadByGenerationKey(generationKey, dependencies);
  let claimToken = null;
  if (row?.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED) {
    throw staleGenerationReplayError();
  }
  if (reopen && row && !reopenAuditMatches(row, reopen)) {
    throw reopenAuditMismatchError();
  }

  const { row: currentRow } = await resolveCanonicalPreRpBriefRow(requestId, dependencies);
  // Codex adversarial review finding 1: the reopen-service already validated
  // this exact source-row identity before calling here; a rival generation
  // (another guarded reopen, or an ordinary regenerate) can move the pointer
  // between that validation and this read. Re-check before any claim, and
  // fence activation on the CALLER's authorized identity, not merely
  // whatever this read happens to observe.
  if (reopen && !sameId(currentRow?.wmkf_requestdocumentid, reopen.sourceArtifactId)) {
    throw reopenSourceStaleError();
  }
  // Pointer observed before any claim; `commitReadyLineage` fences activation on it.
  const expectedPointerId = reopen
    ? reopen.sourceArtifactId
    : (currentRow?.wmkf_requestdocumentid || null);
  if (row?.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
    if (!currentRow || !sameId(row.wmkf_requestdocumentid, currentRow.wmkf_requestdocumentid)) {
      throw staleGenerationReplayError();
    }
    return { artifact: projectPreRpBriefArtifact(row), reused: true };
  }

  // Server-side mirror of the shared-not-sent affordance. This first check
  // prevents generation side effects in the ordinary case; activation repeats
  // it to close the render/upload send race.
  await assertCurrentBriefReplaceable(requestId, currentRow, dependencies, { allowSent: Boolean(reopen) });

  try {
    if (row) {
      claimToken = await claimExisting(row, actingUserSystemId, dependencies);
      if (!claimToken) {
        const current = await rereadByGenerationKey(generationKey, dependencies);
        return { artifact: projectPreRpBriefArtifact(current || row), reused: true };
      }
      row = await assertOwnedClaim(generationKey, claimToken, dependencies);
    } else {
      const bucket = await activeRequestBucket(requestId, inputs.requestNumber, dependencies);
      if (!String(bucket.folder || '').trim()) {
        throw new ServiceHttpError('The active request SharePoint location has no folder path.', {
          httpStatus: 409,
        });
      }
      claimToken = dependencies.newClaimToken();
      const folderPath = `${String(bucket.folder).replace(/\/+$/, '')}`
        + `/${PRE_RP_BRIEF_CONTRACT.relativeFolder}`;
      await dependencies.createDocument({
        wmkf_name: `${inputs.requestNumber} Pre-Research Presentation Brief`,
        'wmkf_Request@odata.bind': `/akoya_requests(${requestId})`,
        wmkf_artifacttype: PRE_RP_BRIEF_CONTRACT.artifactType,
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
        wmkf_generationkey: generationKey,
        wmkf_cyclecode: inputs.cycleCode,
        wmkf_inputfingerprint: inputFingerprint,
        wmkf_presiteinputsnapshotjson: JSON.stringify(inputs.envelope),
        wmkf_claimtoken: claimToken,
        ...(reopen ? {
          wmkf_reopencycleid: reopen.cycleId,
          wmkf_reopenreasoncode: reopen.reasonCode,
          wmkf_reopenreasonnote: reopen.reasonNote,
          // Codex adversarial review finding 2c: records the superseded
          // source on the successor row itself (same lookup Pre-Site's own
          // reopen and distribution snapshots already use), so a replay can
          // be bound to it independent of the mutable request pointer.
          'wmkf_SourceDocument@odata.bind': `/wmkf_requestdocuments(${reopen.sourceArtifactId})`,
        } : {}),
        wmkf_producer: PRE_RP_BRIEF_CONTRACT.producer,
        wmkf_templateid: PRE_RP_BRIEF_CONTRACT.templateId,
        wmkf_templateversion: PRE_RP_BRIEF_CONTRACT.templateVersion,
        wmkf_contenttype: PRE_RP_BRIEF_CONTRACT.contentType,
        wmkf_sharepointfolderpath: folderPath,
        wmkf_filename: fileNameFor(inputs.requestNumber, generationKey),
        wmkf_attemptcount: 1,
      }, {
        actingUserSystemId,
        actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.ALLOW_UNATTRIBUTED,
        actorContext: {
          operation: 'pre-rp-brief-generation',
          requestId,
          requestNumber: inputs.requestNumber,
          operationId: generationKey,
        },
      });
      row = await assertOwnedClaim(generationKey, claimToken, dependencies);
    }

    const { docx } = await dependencies.renderDocx(inputs.envelope);
    const contentHash = await dependencies.hashDocx(docx);
    row = await assertOwnedClaim(generationKey, claimToken, dependencies);
    await dependencies.updateDocument(row.wmkf_requestdocumentid, {
      wmkf_contenthash: contentHash,
    }, conditionalOptions(row, actingUserSystemId));
    row = await assertOwnedClaim(generationKey, claimToken, dependencies);

    await dependencies.ensureFolderPath('akoya_request', row.wmkf_sharepointfolderpath);
    row = await assertOwnedClaim(generationKey, claimToken, dependencies);
    const uploaded = await dependencies.uploadFile(
      'akoya_request',
      row.wmkf_sharepointfolderpath,
      row.wmkf_filename,
      docx,
      PRE_RP_BRIEF_CONTRACT.contentType,
    );
    if (!uploaded?.driveId || !uploaded?.id || !uploaded?.versionId) {
      throw new ServiceHttpError('SharePoint upload returned incomplete stable identity.', {
        httpStatus: 502,
        code: 'pre_rp_brief_upload_identity_incomplete',
      });
    }
    try {
      const ready = await commitReadyLineage(
        row,
        { metadata: uploaded, claimToken, actingUserSystemId, expectedPointerId, reopen },
        dependencies,
      );
      return { artifact: projectPreRpBriefArtifact(ready), reused: false };
    } catch (error) {
      // The filename is deterministic (one per generation key, plan §3) and
      // GraphService.uploadFile replaces on conflict, so the item at this
      // path may already belong to a reclaiming winner (an expired-lease
      // reclaim can upload to the same path before this attempt observes
      // anything). Delete only while this claim token still owns the row;
      // otherwise leave the file in place — the next owner's upload replaces
      // it at the same path, so nothing is orphaned invisibly.
      const code = error?.body?.code || error?.code;
      if (code === 'brief_regeneration_distribution_started' || code === 'brief_pointer_changed') {
        const current = await rereadByGenerationKey(generationKey, dependencies).catch(() => null);
        const stillOwned = current
          && current.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
          && current.wmkf_claimtoken === claimToken;
        if (stillOwned) {
          try {
            await dependencies.deleteFile(uploaded.driveId, uploaded.id);
          } catch {
            // Best-effort orphan cleanup; the outer catch marks the row Failed.
          }
        }
      }
      // claim_lost: ownership has passed by definition, so never delete.
      throw error;
    }
  } catch (error) {
    if (!row && (
      [409, 412].includes(error?.status)
      || /duplicate|alternate key/i.test(error?.message || '')
    )) {
      const winner = await rereadByGenerationKey(generationKey, dependencies);
      if (winner) return { artifact: projectPreRpBriefArtifact(winner), reused: true };
    }
    const safe = sanitizeError(error);
    try {
      await markFailedIfOwned(generationKey, claimToken, {
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
        wmkf_lasterrorcode: safe.code,
        wmkf_lasterrormessage: safe.message,
        wmkf_lastfailedat: new Date().toISOString(),
      }, actingUserSystemId, dependencies);
    } catch (patchError) {
      console.error('[pre-rp-brief] failed to persist failure state:', patchError.message);
    }
    if (error instanceof ServiceHttpError) throw error;
    throw new ServiceHttpError('Pre-Research Presentation Brief generation did not complete.', {
      httpStatus: 500,
      body: {
        error: 'Pre-Research Presentation Brief generation did not complete.',
        code: safe.code,
      },
    });
  }
}
