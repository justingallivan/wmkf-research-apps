/**
 * Governed Initial Assessment producer + read model.
 *
 * Cross-store success invariant:
 * - SharePoint owns DOCX bytes and version history.
 * - wmkf_requestdocument owns stable site/drive/item identity and provenance.
 * - callers receive Ready only after the final registry PATCH succeeds.
 *
 * Exact retries converge on one generation key. A Ready row is immutable to
 * this producer, so staff edits in Word are never overwritten. When changed
 * authoritative inputs create a replacement, its Ready transition and the
 * supersession of prior Ready rows commit in one ETag-guarded changeset.
 * Reverting inputs atomically reactivates the exact earlier Ready artifact.
 * Recovery hashes governed `word/` content rather than ZIP/container metadata
 * so SharePoint package normalization does not impersonate a staff edit.
 * Governed writes require a positively resolved request-library parent.
 * Reads refresh response-only file metadata by stable Graph drive/item ID;
 * Dataverse remains the upload/finalization snapshot and is never updated by
 * that read-through.
 */

import crypto from 'crypto';
import JSZip from 'jszip';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { runChangeset } from '../../dataverse/core/changeset.js';
import { executePrompt } from '../execute-prompt.js';
import { GraphService } from '../graph-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import { getProposalText } from '../workbench-proposal-documents.js';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets.js';
import { isGuid } from '../../utils/guid.js';
import { meetingDateToCycleCode } from '../../utils/cycle-code.js';
import {
  INITIAL_ASSESSMENT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_LABEL,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_LABEL,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_LABEL,
  REQUEST_DOCUMENT_OPERATION_STATUS,
  requestDocumentLabel,
} from '../../../shared/config/requestDocument.js';
import { INITIAL_ASSESSMENT_REQUIRED_OUTPUTS } from '../../../shared/config/prompts/initial-assessment.js';
import { renderInitialAssessmentDocx } from './template.js';

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_meetingdate',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
].join(',');
const REQUEST_DASHBOARD_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
  '_wmkf_programdirector_value',
  '_wmkf_currentinitialassessment_value',
].join(',');
const REQUEST_LINEAGE_SELECT = [
  'akoya_requestid',
  '_wmkf_currentinitialassessment_value',
].join(',');
const CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const GOVERNED_DOCX_HASH_PREFIX = 'gdc1:';
const GENERATING_LEASE_MS = 15 * 60 * 1000;
const FILE_METADATA_READ_CONCURRENCY = 8;
const FILE_METADATA_READ_BUDGET_MS = 10_000;
const REQUIRED_OUTPUTS = INITIAL_ASSESSMENT_REQUIRED_OUTPUTS;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function canonicalizeDocumentRelationships(xml) {
  const relationships = [];
  const declaredCount = Array.from(xml.matchAll(/<Relationship\b/g)).length;
  const relationshipPattern = /<Relationship\b([^>]*?)(?:\/>|>\s*<\/Relationship>)/g;
  const attributePattern = /([A-Za-z_][\w:.-]*)\s*=\s*(["'])(.*?)\2/g;
  let parsedCount = 0;

  for (const match of xml.matchAll(relationshipPattern)) {
    parsedCount += 1;
    const attributes = {};
    for (const attribute of match[1].matchAll(attributePattern)) {
      attributes[attribute[1]] = attribute[3];
    }
    if (!attributes.Type || !attributes.Target || !attributes.Id) {
      throw new Error('Initial Assessment DOCX contains an invalid document relationship.');
    }
    // SharePoint injects customXml relationships when it ingests an Office
    // package. They describe platform metadata, not governed document content.
    if (/\/customXml$/i.test(attributes.Type)) continue;
    relationships.push(
      Object.entries(attributes)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join('&'),
    );
  }

  if (parsedCount !== declaredCount) {
    throw new Error('Initial Assessment DOCX contains an unrecognized document relationship.');
  }
  if (relationships.length === 0) {
    throw new Error('Initial Assessment DOCX has no governed document relationships.');
  }
  return relationships.sort(compareText).join('\n');
}

/**
 * Hash the governed Word content rather than ZIP-container bytes.
 *
 * SharePoint legitimately repacks DOCX containers and injects customXml,
 * docProps, and [trash] metadata. Every `word/` part remains covered, and the
 * document relationship part is canonicalized only to ignore injected
 * customXml relationships and XML ordering/whitespace.
 */
export async function hashGovernedDocxContent(value) {
  if (!Buffer.isBuffer(value)) {
    throw new Error('Initial Assessment content hash requires a DOCX Buffer.');
  }
  let archive;
  try {
    archive = await JSZip.loadAsync(value);
  } catch (error) {
    throw new Error('Initial Assessment producer returned an invalid DOCX package.', {
      cause: error,
    });
  }

  const entries = Object.entries(archive.files)
    .filter(([name, entry]) => !entry.dir && name.startsWith('word/'))
    .sort(([left], [right]) => compareText(left, right));
  if (!archive.file('word/document.xml') || entries.length === 0) {
    throw new Error('Initial Assessment DOCX is missing word/document.xml.');
  }

  const hash = crypto.createHash('sha256');
  hash.update('wmkf-governed-docx-content-v1\0');
  for (const [name, entry] of entries) {
    let bytes = await entry.async('nodebuffer');
    if (name === 'word/_rels/document.xml.rels') {
      bytes = Buffer.from(canonicalizeDocumentRelationships(bytes.toString('utf8')), 'utf8');
    }
    hash.update(`${name}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return `${GOVERNED_DOCX_HASH_PREFIX}${hash.digest('base64url')}`;
}

function sanitizeFilePart(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function sanitizeError(error) {
  const code = String(error?.code || error?.status || 'initial_assessment_failed').slice(0, 100);
  const message = String(error?.message || 'Initial Assessment generation failed')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9_~.-]{40,}/g, '[redacted]')
    .slice(0, 2000);
  return { code, message };
}

function validateGenerated(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Initial Assessment prompt returned a non-object result.');
  }
  const keys = Object.keys(value);
  const unexpected = keys.filter((key) => !REQUIRED_OUTPUTS.includes(key));
  const missing = REQUIRED_OUTPUTS.filter((key) => typeof value[key] !== 'string' || !value[key].trim());
  if (unexpected.length || missing.length) {
    throw new Error(
      `Initial Assessment output contract mismatch (missing=${missing.join('|') || 'none'}, unexpected=${unexpected.join('|') || 'none'}).`,
    );
  }
  return Object.fromEntries(REQUIRED_OUTPUTS.map((key) => [key, value[key].trim()]));
}

function assertKnownRegistryRow(row) {
  const artifactLabel = requestDocumentLabel(REQUEST_DOCUMENT_ARTIFACT_LABEL, row.wmkf_artifacttype);
  const operationLabel = requestDocumentLabel(REQUEST_DOCUMENT_OPERATION_LABEL, row.wmkf_operationstatus);
  const lifecycleLabel = requestDocumentLabel(REQUEST_DOCUMENT_LIFECYCLE_LABEL, row.wmkf_lifecyclestate);
  if (!artifactLabel || !operationLabel || !lifecycleLabel) {
    throw new ServiceHttpError('Request document registry contains an unknown contract value.', {
      httpStatus: 500,
    });
  }
  return { artifactLabel, operationLabel, lifecycleLabel };
}

function projectArtifact(row, request = null) {
  const labels = assertKnownRegistryRow(row);
  const modifiedAt = Date.parse(row.modifiedon || row.createdon || '');
  const generatingRetryAt = row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
    && Number.isFinite(modifiedAt)
    ? new Date(modifiedAt + GENERATING_LEASE_MS).toISOString()
    : null;
  const retryable = row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED
    || (generatingRetryAt ? Date.now() >= Date.parse(generatingRetryAt) : false);
  return {
    artifactId: row.wmkf_requestdocumentid,
    requestId: row._wmkf_request_value,
    requestNumber: request?.akoya_requestnum || null,
    title: request?.akoya_title || null,
    institution: request?.wmkf_organizationname
      || request?._akoya_applicantid_value_formatted
      || null,
    programDirector: request?._wmkf_programdirector_value_formatted || null,
    artifactType: row.wmkf_artifacttype,
    artifactLabel: labels.artifactLabel,
    operationStatus: row.wmkf_operationstatus,
    operationLabel: labels.operationLabel,
    lifecycleState: row.wmkf_lifecyclestate,
    lifecycleLabel: labels.lifecycleLabel,
    cycleCode: row.wmkf_cyclecode,
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
      metadataStatus: 'registry_snapshot',
      metadataCheckedAt: null,
    } : null,
    provenance: {
      producer: row.wmkf_producer,
      inputFingerprint: row.wmkf_inputfingerprint,
      templateId: row.wmkf_templateid,
      templateVersion: row.wmkf_templateversion,
      promptName: row.wmkf_promptname,
      promptVersion: row.wmkf_promptversion,
      promptId: row._wmkf_aiprompt_value || null,
      runId: row._wmkf_airun_value || null,
      contentHash: row.wmkf_contenthash || null,
      sourceDocumentId: row._wmkf_sourcedocument_value || null,
      sourceVersionId: row.wmkf_sourceversionid || null,
      sourceContentHash: row.wmkf_sourcecontenthash || null,
      milestoneVersionId: row.wmkf_milestoneversionid || null,
      milestoneContentHash: row.wmkf_milestonecontenthash || null,
      milestoneCreatedAt: row.wmkf_milestonecreatedat || null,
    },
    attemptCount: row.wmkf_attemptcount || 0,
    retryable,
    retryAfterAt: generatingRetryAt,
    lastError: row.wmkf_lasterrormessage ? {
      code: row.wmkf_lasterrorcode || null,
      message: row.wmkf_lasterrormessage,
      at: row.wmkf_lastfailedat || null,
    } : null,
    cleanupRequired: [
      ...parseOrphanCleanup(row.wmkf_orphancleanupjson),
      ...parseOrphanCleanup(row.wmkf_orphancleanupoverflowjson),
    ],
    createdAt: row.createdon || null,
    modifiedAt: row.modifiedon || null,
  };
}

async function refreshArtifactFileMetadata(artifacts) {
  if (!artifacts.length) return artifacts;
  const refreshed = new Array(artifacts.length);
  const metadataByIdentity = new Map();
  const deadline = Date.now() + FILE_METADATA_READ_BUDGET_MS;
  let nextIndex = 0;

  function currentMetadata(file, artifactId) {
    if (!file?.driveId || !file?.itemId) {
      return Promise.resolve({
        status: 'unavailable',
        checkedAt: new Date().toISOString(),
        metadata: null,
      });
    }
    const identity = JSON.stringify([file.driveId, file.itemId]);
    if (metadataByIdentity.has(identity)) {
      return metadataByIdentity.get(identity);
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return Promise.resolve({
        status: 'unavailable',
        checkedAt: new Date().toISOString(),
        metadata: null,
      });
    }
    metadataByIdentity.set(identity, (async () => {
      const checkedAt = new Date().toISOString();
      try {
        const metadata = await GraphService.getFileMetadataById(
          file.driveId,
          file.itemId,
          {
            siteId: file.siteId || null,
            timeoutMs: remainingMs,
          },
        );
        return {
          status: metadata ? 'current' : 'missing',
          checkedAt,
          metadata,
        };
      } catch (error) {
        console.warn('[initial-assessment] current SharePoint metadata unavailable', {
          artifactId,
          status: error?.status || null,
          code: error?.code || error?.name || null,
        });
        return {
          status: 'unavailable',
          checkedAt,
          metadata: null,
        };
      }
    })());
    return metadataByIdentity.get(identity);
  }

  async function worker() {
    while (nextIndex < artifacts.length) {
      const index = nextIndex;
      nextIndex += 1;
      const artifact = artifacts[index];
      if (!artifact.file) {
        refreshed[index] = artifact;
        continue;
      }
      const current = await currentMetadata(artifact.file, artifact.artifactId);
      refreshed[index] = {
        ...artifact,
        file: {
          ...artifact.file,
          ...(current.metadata ? {
            siteId: current.metadata.siteId || artifact.file.siteId,
            driveId: current.metadata.driveId,
            itemId: current.metadata.id,
            webUrl: current.metadata.webUrl,
            versionId: current.metadata.versionId,
            eTag: current.metadata.eTag,
            name: current.metadata.name,
            size: current.metadata.size,
            lastModified: current.metadata.lastModified,
          } : {}),
          metadataStatus: current.status,
          metadataCheckedAt: current.checkedAt,
        },
      };
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(FILE_METADATA_READ_CONCURRENCY, artifacts.length) },
    worker,
  ));
  return refreshed;
}

function parseOrphanCleanup(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed.map((entry) => {
      const normalized = {
        driveId: String(entry?.driveId || ''),
        itemId: String(entry?.itemId || ''),
        name: entry?.name ? String(entry.name) : null,
        recordedAt: entry?.recordedAt ? String(entry.recordedAt) : null,
        reason: entry?.reason ? String(entry.reason) : null,
        error: entry?.error ? String(entry.error) : null,
      };
      if (!normalized.driveId || !normalized.itemId) {
        throw new Error('cleanup entry has no stable drive/item identity');
      }
      return normalized;
    });
  } catch {
    throw new ServiceHttpError(
      'Initial Assessment registry contains unreadable SharePoint cleanup work.',
      { httpStatus: 500 },
    );
  }
}

async function getRequestOrThrow(requestId) {
  try {
    const request = await grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT });
    if (request) return request;
  } catch (error) {
    if (error?.status !== 404) throw error;
  }
  throw new ServiceHttpError(`No request found for ${requestId}.`, { httpStatus: 404 });
}

async function getActiveRequestBucket(requestId, requestNumber) {
  const buckets = await getRequestSharePointBuckets(
    requestId,
    requestNumber,
    { requireResolvedParents: true },
  );
  const active = buckets.filter((bucket) => (
    bucket.source === 'dynamics' && String(bucket.library).toLowerCase() === 'akoya_request'
  ));
  if (active.length !== 1) {
    throw new ServiceHttpError(
      `Expected exactly one active akoya_request SharePoint location; found ${active.length}.`,
      { httpStatus: 409 },
    );
  }
  return active[0];
}

async function rereadByGenerationKey(generationKey) {
  const { records } = await requestDocumentAdapter.findByGenerationKey(generationKey);
  if (records.length > 1) {
    throw new ServiceHttpError('Duplicate request-document generation keys require reconciliation.', {
      httpStatus: 500,
    });
  }
  return records[0] || null;
}

function conditionalOptions(row, actingUserSystemId = null) {
  if (!row?._etag) {
    throw new ServiceHttpError('Request-document row is missing the ETag required for a fenced write.', {
      httpStatus: 500,
    });
  }
  return {
    ifMatch: row._etag,
    ...(actingUserSystemId ? { actingUserSystemId } : {}),
  };
}

function generatingLeaseActive(row) {
  if (row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) return false;
  const modifiedAt = Date.parse(row.modifiedon || row.createdon || '');
  return Number.isFinite(modifiedAt) && Date.now() - modifiedAt < GENERATING_LEASE_MS;
}

async function assertOwnedClaim(generationKey, claimToken) {
  const current = await rereadByGenerationKey(generationKey);
  if (!current
    || current.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
    || current.wmkf_claimtoken !== claimToken) {
    throw new ServiceHttpError('Initial Assessment generation claim was superseded.', {
      httpStatus: 409,
      body: { error: 'Initial Assessment generation claim was superseded.', code: 'claim_lost' },
    });
  }
  if (parseOrphanCleanup(current.wmkf_orphancleanupoverflowjson).length > 0) {
    throw new ServiceHttpError(
      'Initial Assessment generation is blocked until overflow SharePoint cleanup work is resolved.',
      {
        httpStatus: 409,
        body: {
          error: 'Initial Assessment generation is blocked until overflow SharePoint cleanup work is resolved.',
          code: 'orphan_cleanup_required',
        },
      },
    );
  }
  return current;
}

async function verifyReadyLineage(generationKey, targetId, requestId) {
  const [target, request, rows] = await Promise.all([
    rereadByGenerationKey(generationKey),
    grantRequestAdapter.getById(requestId, { select: REQUEST_LINEAGE_SELECT }),
    requestDocumentAdapter.findByRequest(requestId, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
    }),
  ]);
  const duplicateReady = (rows.records || []).some((candidate) => (
    candidate.wmkf_requestdocumentid !== targetId
    && candidate.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && candidate.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
  ));
  if (target
    && target.wmkf_requestdocumentid === targetId
    && target.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && target.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
    && target.wmkf_sharepointdriveid
    && target.wmkf_sharepointitemid
    && request?._wmkf_currentinitialassessment_value === targetId
    && !duplicateReady) {
    return target;
  }
  return null;
}

async function commitReadyLineage(
  row,
  { metadata = null, claimToken = null, actingUserSystemId = null } = {},
) {
  for (let pass = 0; pass < 3; pass += 1) {
    const target = claimToken
      ? await assertOwnedClaim(row.wmkf_generationkey, claimToken)
      : await rereadByGenerationKey(row.wmkf_generationkey);
    if (!target || target.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED) {
      throw new ServiceHttpError('Initial Assessment Ready transition has no eligible target.', {
        httpStatus: 409,
      });
    }
    const result = await requestDocumentAdapter.findByRequest(target._wmkf_request_value, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
    });
    const request = await grantRequestAdapter.getById(target._wmkf_request_value, {
      select: REQUEST_LINEAGE_SELECT,
    });
    const requestOptions = conditionalOptions(request);
    const priorReady = (result.records || []).filter((candidate) => (
      candidate.wmkf_requestdocumentid !== target.wmkf_requestdocumentid
        && candidate.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
        && candidate.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
    ));
    if (!metadata
      && target.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
      && priorReady.length === 0
      && request._wmkf_currentinitialassessment_value === target.wmkf_requestdocumentid) {
      return target;
    }
    const targetPatch = {
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
    };
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
        body: targetPatch,
        ifMatch: conditionalOptions(target).ifMatch,
      },
      {
        method: 'PATCH',
        entitySet: grantRequestAdapter.ENTITY_SET_NAME,
        key: target._wmkf_request_value,
        body: {
          'wmkf_CurrentInitialAssessment@odata.bind':
            `/wmkf_requestdocuments(${target.wmkf_requestdocumentid})`,
        },
        ifMatch: requestOptions.ifMatch,
      },
    ];
    try {
      await runChangeset(operations, {
        ...(actingUserSystemId ? { actingUserSystemId } : {}),
      });
    } catch (error) {
      const conflict = error?.status === 412 || /\b412\b/.test(error?.message || '');
      if (conflict) {
        if (claimToken) {
          const current = await rereadByGenerationKey(row.wmkf_generationkey);
          if (!current
            || current.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
            || current.wmkf_claimtoken !== claimToken) {
            throw new ServiceHttpError('Initial Assessment generation claim was superseded.', {
              httpStatus: 409,
              body: {
                error: 'Initial Assessment generation claim was superseded.',
                code: 'claim_lost',
              },
            });
          }
        }
        continue;
      }
      const afterError = await verifyReadyLineage(
        row.wmkf_generationkey,
        target.wmkf_requestdocumentid,
        target._wmkf_request_value,
      ).catch(() => null);
      if (afterError) return afterError;
      // A non-412 response can still mean the atomic changeset committed but
      // its response (and even the first verification read) was lost or lagged.
      // Delete this claimant's upload only after positively observing a newer
      // GENERATING claimant. Ready, same-claim, missing, and failed-read states
      // remain ambiguous and preserve the uploaded item for retry/reconciliation.
      if (claimToken) {
        const observed = await rereadByGenerationKey(row.wmkf_generationkey)
          .catch(() => null);
        if (observed
          && observed.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
          && observed.wmkf_claimtoken !== claimToken) {
          throw new ServiceHttpError('Initial Assessment generation claim was superseded.', {
            httpStatus: 409,
            body: {
              error: 'Initial Assessment generation claim was superseded.',
              code: 'claim_lost',
            },
          });
        }
      }
      throw error;
    }
    const ready = await verifyReadyLineage(
      row.wmkf_generationkey,
      target.wmkf_requestdocumentid,
      target._wmkf_request_value,
    );
    if (ready) return ready;
    throw new Error('Registry read-back did not confirm the current Ready SharePoint identity.');
  }
  throw new ServiceHttpError(
    'Initial Assessment Ready transition conflicted repeatedly; retry is safe.',
    {
      httpStatus: 409,
      body: {
        error: 'Initial Assessment Ready transition conflicted repeatedly.',
        code: 'ready_lineage_conflict',
      },
    },
  );
}

async function recordOrphanCleanup(
  generationKey,
  uploaded,
  cleanupError,
  actingUserSystemId = null,
  reason = 'claim_lost_delete_failed',
) {
  for (let pass = 0; pass < 3; pass += 1) {
    const current = await rereadByGenerationKey(generationKey);
    if (!current) break;
    const existing = parseOrphanCleanup(current.wmkf_orphancleanupjson);
    const overflow = parseOrphanCleanup(current.wmkf_orphancleanupoverflowjson);
    if ([...existing, ...overflow].some((item) => (
      item.driveId === uploaded.driveId
      && item.itemId === uploaded.id
      && item.reason === reason
    ))) {
      return;
    }
    const entry = {
      driveId: uploaded.driveId,
      itemId: uploaded.id,
      name: uploaded.name || null,
      recordedAt: new Date().toISOString(),
      reason,
      error: sanitizeError(cleanupError).message.slice(0, 1000),
    };
    const queue = [...existing, entry];
    const value = JSON.stringify(queue);
    const overflowed = overflow.length > 0 || value.length > 10000;
    const patch = overflowed
      ? { wmkf_orphancleanupoverflowjson: JSON.stringify([...overflow, entry]) }
      : { wmkf_orphancleanupjson: value };
    try {
      await requestDocumentAdapter.update(
        current.wmkf_requestdocumentid,
        patch,
        conditionalOptions(current, actingUserSystemId),
      );
      if (!overflowed) return;
      throw new ServiceHttpError(
        'Initial Assessment SharePoint cleanup queue is full; exact overflow work was retained and operator intervention is required.',
        {
          httpStatus: 500,
          body: {
            error: 'Initial Assessment SharePoint cleanup queue is full; exact overflow work was retained and operator intervention is required.',
            code: 'orphan_cleanup_capacity_exceeded',
          },
        },
      );
    } catch (error) {
      if (error?.status === 412) continue;
      throw error;
    }
  }
  throw new Error('Unable to persist claim-lost SharePoint cleanup work.');
}

async function cleanupSupersededUpload(
  uploaded,
  generationKey,
  actingUserSystemId = null,
  {
    reason = 'claim_lost_delete_failed',
    errorCode = 'claim_lost_cleanup_required',
    message = 'A superseded Initial Assessment upload could not be removed from SharePoint.',
  } = {},
) {
  try {
    await GraphService.deleteFile(uploaded.driveId, uploaded.id);
    return;
  } catch (error) {
    await recordOrphanCleanup(
      generationKey,
      uploaded,
      error,
      actingUserSystemId,
      reason,
    );
    throw new ServiceHttpError(
      message,
      {
        httpStatus: 500,
        body: {
          error: message,
          code: errorCode,
        },
        cause: error,
      },
    );
  }
}

async function recoverUploadedFile(row, claimToken, actingUserSystemId = null) {
  if (!row.wmkf_contenthash || !row.wmkf_sharepointfolderpath || !row.wmkf_filename) {
    return null;
  }
  const metadata = await GraphService.getFileMetadataByPath(
    'akoya_request',
    row.wmkf_sharepointfolderpath,
    row.wmkf_filename,
  );
  if (!metadata) return null;
  const downloaded = await GraphService.downloadFile(metadata.driveId, metadata.id);
  let downloadedHash;
  try {
    downloadedHash = await hashGovernedDocxContent(downloaded.buffer);
  } catch (error) {
    await recordOrphanCleanup(
      row.wmkf_generationkey,
      metadata,
      error,
      actingUserSystemId,
      'invalid_docx_retained',
    );
    return null;
  }
  const storedHash = String(row.wmkf_contenthash);
  if (!storedHash.startsWith(GOVERNED_DOCX_HASH_PREFIX)) {
    if (/^[a-f0-9]{64}$/i.test(storedHash) && sha256(downloaded.buffer) === storedHash) {
      return commitReadyLineage(row, {
        metadata,
        claimToken,
        actingUserSystemId,
      });
    }
    const legacy = /^[a-f0-9]{64}$/i.test(storedHash);
    const reason = legacy
      ? 'legacy_content_hash_unverifiable_retained'
      : 'unknown_content_hash_scheme_retained';
    const code = legacy
      ? 'legacy_content_hash_unverifiable'
      : 'unknown_content_hash_scheme';
    const message = legacy
      ? 'The prior upload uses a legacy whole-package hash that cannot verify SharePoint-normalized content.'
      : 'The prior upload uses an unknown content-hash scheme.';
    await recordOrphanCleanup(
      row.wmkf_generationkey,
      metadata,
      new Error(message),
      actingUserSystemId,
      reason,
    );
    throw new ServiceHttpError(
      `${message} Operator reconciliation is required before retrying.`,
      {
        httpStatus: 409,
        body: {
          error: `${message} Operator reconciliation is required before retrying.`,
          code,
        },
      },
    );
  }
  if (downloadedHash !== storedHash) {
    await recordOrphanCleanup(
      row.wmkf_generationkey,
      metadata,
      new Error('The prior upload content hash no longer matches the governed producer output.'),
      actingUserSystemId,
      'content_hash_mismatch_retained',
    );
    return null;
  }
  return commitReadyLineage(row, {
    metadata,
    claimToken,
    actingUserSystemId,
  });
}

/*
 * A failed or stale deterministic row can be reclaimed. Ready rows are handled
 * above by the atomic lineage activation path and never reach this function.
 */
async function claimExisting(row, actingUserSystemId = null) {
  if (generatingLeaseActive(row)) return null;
  if (parseOrphanCleanup(row.wmkf_orphancleanupoverflowjson).length > 0) {
    throw new ServiceHttpError(
      'Initial Assessment generation is blocked until overflow SharePoint cleanup work is resolved.',
      {
        httpStatus: 409,
        body: {
          error: 'Initial Assessment generation is blocked until overflow SharePoint cleanup work is resolved.',
          code: 'orphan_cleanup_required',
        },
      },
    );
  }
  const claimToken = crypto.randomUUID();
  try {
    await requestDocumentAdapter.update(row.wmkf_requestdocumentid, {
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

/*
 * The following function starts a fresh claim-specific filename only after
 * recovery of a prior uploaded item was ruled out.
 */
async function prepareClaimForGeneration(
  row,
  requestNumber,
  generationKey,
  claimToken,
  actingUserSystemId = null,
) {
  const current = await assertOwnedClaim(generationKey, claimToken);
  const fileName = `${sanitizeFilePart(requestNumber)} Initial Assessment `
    + `${generationKey.slice(0, 8)}-${claimToken.slice(0, 8)}.docx`;
  await requestDocumentAdapter.update(current.wmkf_requestdocumentid, {
    wmkf_filename: fileName,
    wmkf_contenthash: null,
    wmkf_sharepointsiteid: null,
    wmkf_sharepointdriveid: null,
    wmkf_sharepointitemid: null,
    wmkf_sharepointweburl: null,
    wmkf_sharepointversionid: null,
    wmkf_sharepointetag: null,
    wmkf_filesize: null,
    wmkf_sharepointlastmodified: null,
  }, conditionalOptions(current, actingUserSystemId));
  return assertOwnedClaim(generationKey, claimToken);
}

async function markFailedIfOwned(
  generationKey,
  claimToken,
  patch,
  actingUserSystemId = null,
) {
  const current = await rereadByGenerationKey(generationKey);
  if (!current
    || current.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
    || current.wmkf_claimtoken !== claimToken) {
    return false;
  }
  try {
    await requestDocumentAdapter.update(
      current.wmkf_requestdocumentid,
      patch,
      conditionalOptions(current, actingUserSystemId),
    );
    return true;
  } catch (error) {
    if (error?.status === 412) return false;
    throw error;
  }
}

function buildInitialAssessmentIdentity({
  requestId,
  requestNumber,
  title,
  institution,
  cycleCode,
  proposalFilename,
  proposalText,
}) {
  const inputFingerprint = sha256(JSON.stringify({
    requestId: requestId.toLowerCase(),
    requestNumber,
    title,
    institution,
    cycleCode: String(cycleCode).toUpperCase(),
    proposalFilename,
    proposalText,
  }));
  const generationKey = sha256(JSON.stringify({
    requestId: requestId.toLowerCase(),
    artifactType: INITIAL_ASSESSMENT_CONTRACT.artifactType,
    inputFingerprint,
    promptName: INITIAL_ASSESSMENT_CONTRACT.promptName,
    promptVersion: INITIAL_ASSESSMENT_CONTRACT.promptVersion,
    templateId: INITIAL_ASSESSMENT_CONTRACT.templateId,
    templateVersion: INITIAL_ASSESSMENT_CONTRACT.templateVersion,
  }));
  return { inputFingerprint, generationKey };
}

/**
 * Generate or safely reuse one governed Initial Assessment.
 */
export async function generateInitialAssessment({ requestId, actingUserSystemId = null }) {
  const request = await getRequestOrThrow(requestId);
  const requestNumber = String(request.akoya_requestnum || '').trim();
  const title = String(request.akoya_title || '').trim();
  const institution = String(
    request.wmkf_organizationname || request._akoya_applicantid_value_formatted || '',
  ).trim();
  const cycleCode = request.wmkf_meetingdate
    ? meetingDateToCycleCode(request.wmkf_meetingdate)?.toUpperCase()
    : null;
  if (!requestNumber || !title || !institution || !cycleCode) {
    throw new ServiceHttpError(
      'The request must have a request number, title, institution, and meeting-date cycle before generation.',
      { httpStatus: 409 },
    );
  }

  const proposal = await getProposalText(requestId, requestNumber);
  if (!proposal?.text || proposal.text.trim().length < 60) {
    throw new ServiceHttpError(
      `No usable canonical reviewer proposal was found at Reviewer Materials/Proposal_${requestNumber}.pdf.`,
      { httpStatus: 409 },
    );
  }

  const { inputFingerprint, generationKey } = buildInitialAssessmentIdentity({
    requestId,
    requestNumber,
    title,
    institution,
    cycleCode,
    proposalFilename: proposal.filename,
    proposalText: proposal.text,
  });

  let row = await rereadByGenerationKey(generationKey);
  let claimToken = null;
  if (row?.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
    const current = await commitReadyLineage(row, { actingUserSystemId });
    return { artifact: projectArtifact(current, request), reused: true, recovered: false };
  }

  let runId = null;
  try {
    if (row) {
      claimToken = await claimExisting(row, actingUserSystemId);
      if (!claimToken) {
        const current = await rereadByGenerationKey(generationKey);
        return {
          artifact: current ? projectArtifact(current, request) : projectArtifact(row, request),
          reused: true,
          recovered: false,
        };
      }
      row = await assertOwnedClaim(generationKey, claimToken);
      const recovered = await recoverUploadedFile(row, claimToken, actingUserSystemId);
      if (recovered) {
        return { artifact: projectArtifact(recovered, request), reused: true, recovered: true };
      }
      row = await prepareClaimForGeneration(
        row,
        requestNumber,
        generationKey,
        claimToken,
        actingUserSystemId,
      );
    } else {
      const bucket = await getActiveRequestBucket(requestId, requestNumber);
      const folderPath = `${bucket.folder}/${INITIAL_ASSESSMENT_CONTRACT.relativeFolder}`;
      claimToken = crypto.randomUUID();
      const fileName = `${sanitizeFilePart(requestNumber)} Initial Assessment `
        + `${generationKey.slice(0, 8)}-${claimToken.slice(0, 8)}.docx`;
      await requestDocumentAdapter.create({
        wmkf_name: `${requestNumber} Initial Assessment`,
        'wmkf_Request@odata.bind': `/akoya_requests(${requestId})`,
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
      }, { actingUserSystemId });
      row = await assertOwnedClaim(generationKey, claimToken);
    }
  } catch (error) {
    if (!row && (
      [409, 412].includes(error?.status)
      || /duplicate|alternate key/i.test(error?.message || '')
    )) {
      row = await rereadByGenerationKey(generationKey);
      if (row) {
        return { artifact: projectArtifact(row, request), reused: true, recovered: false };
      }
    }
    const safe = sanitizeError(error);
    try {
      await markFailedIfOwned(generationKey, claimToken, {
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
        wmkf_lasterrorcode: safe.code,
        wmkf_lasterrormessage: safe.message,
        wmkf_lastfailedat: new Date().toISOString(),
      }, actingUserSystemId);
    } catch (patchError) {
      console.error('[initial-assessment] failed to persist failure state:', patchError.message);
    }
    if (error instanceof ServiceHttpError) throw error;
    throw new ServiceHttpError('Initial Assessment generation did not complete.', {
      httpStatus: 500,
      body: {
        error: 'Initial Assessment generation did not complete.',
        code: safe.code,
        runId: null,
      },
    });
  }

  try {
    const result = await executePrompt({
      promptName: INITIAL_ASSESSMENT_CONTRACT.promptName,
      requestId,
      requireNoPersistence: true,
      overrideVariables: { proposal_text: proposal.text },
      runSource: 'Vercel Interactive',
      actingUserSystemId,
    });
    runId = result.runId;
    if (result.blocked) throw new Error('Initial Assessment prompt was unexpectedly blocked.');
    if (result.meta?.promptVersion !== INITIAL_ASSESSMENT_CONTRACT.promptVersion) {
      throw new Error(
        `Initial Assessment prompt version ${result.meta?.promptVersion} does not match producer contract ${INITIAL_ASSESSMENT_CONTRACT.promptVersion}.`,
      );
    }
    const generated = validateGenerated(result.parsed);
    const docx = await renderInitialAssessmentDocx({
      requestNumber,
      title,
      institution,
      generated,
    });
    const contentHash = await hashGovernedDocxContent(docx);

    row = await assertOwnedClaim(generationKey, claimToken);
    await requestDocumentAdapter.update(row.wmkf_requestdocumentid, {
      wmkf_contenthash: contentHash,
      wmkf_promptname: result.meta.promptName,
      wmkf_promptversion: result.meta.promptVersion,
      ...(result.meta.promptId
        ? { 'wmkf_AIPrompt@odata.bind': `/wmkf_ai_prompts(${result.meta.promptId})` }
        : {}),
      ...(runId ? { 'wmkf_AIRun@odata.bind': `/wmkf_ai_runs(${runId})` } : {}),
    }, conditionalOptions(row, actingUserSystemId));
    row = await assertOwnedClaim(generationKey, claimToken);

    await GraphService.ensureFolderPath('akoya_request', row.wmkf_sharepointfolderpath);
    row = await assertOwnedClaim(generationKey, claimToken);
    const uploaded = await GraphService.uploadFile(
      'akoya_request',
      row.wmkf_sharepointfolderpath,
      row.wmkf_filename,
      docx,
      CONTENT_TYPE,
    );
    let ready;
    try {
      ready = await commitReadyLineage(row, {
        metadata: uploaded,
        claimToken,
        actingUserSystemId,
      });
    } catch (error) {
      if (error instanceof ServiceHttpError && error.body?.code === 'claim_lost') {
        await cleanupSupersededUpload(
          uploaded,
          generationKey,
          actingUserSystemId,
        );
      } else if (error instanceof ServiceHttpError
        && error.body?.code === 'orphan_cleanup_required') {
        await cleanupSupersededUpload(
          uploaded,
          generationKey,
          actingUserSystemId,
          {
            reason: 'cleanup_overflow_race_delete_failed',
            errorCode: 'orphan_cleanup_overflow_upload_cleanup_required',
            message: 'An Initial Assessment upload raced with unresolved cleanup overflow and could not be removed from SharePoint.',
          },
        );
      }
      throw error;
    }
    return {
      artifact: projectArtifact(ready, request),
      reused: false,
      recovered: false,
    };
  } catch (error) {
    const safe = sanitizeError(error);
    const failureRunId = error?.runId || runId || null;
    try {
      await markFailedIfOwned(generationKey, claimToken, {
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
        wmkf_lasterrorcode: safe.code,
        wmkf_lasterrormessage: safe.message,
        wmkf_lastfailedat: new Date().toISOString(),
        ...(failureRunId
          ? { 'wmkf_AIRun@odata.bind': `/wmkf_ai_runs(${failureRunId})` }
          : {}),
      }, actingUserSystemId);
    } catch (patchError) {
      console.error('[initial-assessment] failed to persist failure state:', patchError.message);
    }
    if (error instanceof ServiceHttpError) throw error;
    throw new ServiceHttpError('Initial Assessment generation did not complete.', {
      httpStatus: 500,
      body: {
        error: 'Initial Assessment generation did not complete.',
        code: safe.code,
        runId: failureRunId,
      },
    });
  }
}

export async function listInitialAssessmentArtifacts({ requestId = null, cycleCode = null }) {
  if (!!requestId === !!cycleCode) {
    throw new ServiceHttpError('Provide exactly one of requestId or cycleCode.', { httpStatus: 400 });
  }
  const result = requestId
    ? await requestDocumentAdapter.findByRequest(requestId, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
    })
    : await requestDocumentAdapter.findByCycle(String(cycleCode).toUpperCase(), {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
    });
  const byRequest = new Map();
  for (const row of result.records || []) {
    const key = row._wmkf_request_value;
    if (!key) continue;
    if (!byRequest.has(key)) byRequest.set(key, []);
    byRequest.get(key).push(row);
  }
  const requestIds = [...byRequest.keys()];
  const requests = [];
  // DynamicsService.queryRecords intentionally clamps a page to 100 rows.
  // Keep both the OR filter and requested page below that boundary so a
  // cycle-wide locator cannot silently omit request pointers.
  for (let index = 0; index < requestIds.length; index += 50) {
    const batch = requestIds.slice(index, index + 50);
    const resultForBatch = await grantRequestAdapter.findByIds(batch, {
      select: REQUEST_DASHBOARD_SELECT,
      top: batch.length,
    });
    requests.push(...(resultForBatch.records || []));
  }
  const byId = new Map(requests.map((request) => [request.akoya_requestid, request]));
  const artifacts = [];
  const latestAttempts = [];
  for (const [ownerRequestId, rows] of byRequest.entries()) {
    if (!byId.has(ownerRequestId)) {
      throw new ServiceHttpError(
        'Initial Assessment registry owner request could not be resolved.',
        { httpStatus: 500 },
      );
    }
    rows.sort((left, right) => {
      const time = Date.parse(right.createdon || '') - Date.parse(left.createdon || '');
      if (Number.isFinite(time) && time !== 0) return time;
      return String(right.wmkf_requestdocumentid)
        .localeCompare(String(left.wmkf_requestdocumentid));
    });
    const activeRows = rows.filter((row) => (
      row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
    ));
    const pointerId = byId.get(ownerRequestId)?._wmkf_currentinitialassessment_value || null;
    const currentReady = activeRows.find((row) => (
      row.wmkf_requestdocumentid === pointerId
      && row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    ));
    const activeReady = activeRows.filter((row) => (
      row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    ));
    if ((pointerId && (activeReady.length !== 1 || !currentReady))
      || (!pointerId && activeReady.length > 0)) {
      throw new ServiceHttpError(
        'Initial Assessment registry has an invalid request-level canonical pointer.',
        { httpStatus: 500 },
      );
    }
    const latest = activeRows[0] || null;
    if (!latest) continue;
    if (currentReady || latest) artifacts.push(currentReady || latest);
    if (currentReady
      && latest.wmkf_requestdocumentid !== currentReady.wmkf_requestdocumentid
      && latest.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
      latestAttempts.push(latest);
    }
  }
  const projected = [
    ...artifacts.map((row) => (
      projectArtifact(row, byId.get(row._wmkf_request_value) || null)
    )),
    ...latestAttempts.map((row) => (
      projectArtifact(row, byId.get(row._wmkf_request_value) || null)
    )),
  ];
  const refreshed = await refreshArtifactFileMetadata(projected);
  return {
    success: true,
    artifacts: refreshed.slice(0, artifacts.length),
    latestAttempts: refreshed.slice(artifacts.length),
  };
}

/**
 * Read the native SharePoint version history for one request's canonical
 * Initial Assessment artifact.
 *
 * `requestId` resolves the canonical Ready row, while `expectedArtifactId`
 * binds that resolution to the artifact DTO the Workbench already rendered.
 * A replacement between the page read and this lazy history read returns 409.
 * **The drive and item identity always come from the selected row, never from
 * the caller**, so a client cannot point this read at an arbitrary SharePoint
 * item.
 *
 * Failure semantics deliberately mirror `refreshArtifactFileMetadata` so the UI
 * has one vocabulary: `current` (list read), `missing` (item is gone),
 * `unavailable` (Graph refused or timed out). A Graph failure is NOT an error
 * here — version history is supplementary to a page that already rendered.
 *
 * Read-only: no restore. That is the administrator half and is blocked on the
 * outstanding SharePoint permission evidence.
 */
export async function listInitialAssessmentArtifactVersions({
  requestId,
  expectedArtifactId = null,
  limit = 20,
}) {
  if (!isGuid(requestId)) {
    throw new ServiceHttpError('requestId is not a valid GUID', { httpStatus: 400 });
  }
  const result = await requestDocumentAdapter.findByRequest(requestId, {
    artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
  });
  const rows = (result.records || []).filter((row) => (
    row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
  ));
  rows.sort((left, right) => {
    const time = Date.parse(right.createdon || '') - Date.parse(left.createdon || '');
    if (Number.isFinite(time) && time !== 0) return time;
    return String(right.wmkf_requestdocumentid).localeCompare(String(left.wmkf_requestdocumentid));
  });
  const row = rows[0] || null;
  if (!row) {
    throw new ServiceHttpError(
      'No Ready Initial Assessment artifact exists for this request.',
      { httpStatus: 404 },
    );
  }
  if (expectedArtifactId
    && String(row.wmkf_requestdocumentid).toLowerCase() !== expectedArtifactId.toLowerCase()) {
    throw new ServiceHttpError(
      'This Initial Assessment document was replaced. Refresh the page before viewing version history.',
      {
        httpStatus: 409,
        code: 'artifact_replaced',
        body: {
          error: 'This Initial Assessment document was replaced. Refresh the page before viewing version history.',
          code: 'artifact_replaced',
        },
      },
    );
  }
  const checkedAt = new Date().toISOString();
  if (!row.wmkf_sharepointdriveid || !row.wmkf_sharepointitemid) {
    return {
      success: true,
      status: 'unavailable',
      checkedAt,
      versions: [],
      hasMore: false,
      limit: 0,
    };
  }

  try {
    const listed = await GraphService.listFileVersions(
      row.wmkf_sharepointdriveid,
      row.wmkf_sharepointitemid,
      { siteId: row.wmkf_sharepointsiteid || null, limit },
    );
    if (!listed) {
      return {
        success: true, status: 'missing', checkedAt, versions: [], hasMore: false, limit: 0,
      };
    }
    return {
      success: true,
      status: 'current',
      checkedAt,
      // Graph binds isCurrent to the drive item's authoritative publication version.
      versions: listed.versions,
      hasMore: listed.hasMore,
      limit: listed.limit,
    };
  } catch (error) {
    console.warn('[initial-assessment] SharePoint version history unavailable', {
      requestId,
      status: error?.status || null,
      code: error?.code || error?.name || null,
    });
    return {
      success: true, status: 'unavailable', checkedAt, versions: [], hasMore: false, limit: 0,
    };
  }
}

export async function listInitialAssessmentCycles() {
  const result = await requestDocumentAdapter.findArtifactCycles(
    REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
  );
  const cycles = [];
  const seen = new Set();
  for (const row of result.records || []) {
    if (row.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED) continue;
    const code = String(row.wmkf_cyclecode || '').toUpperCase();
    if (!/^[A-Z]\d{2}$/.test(code)) {
      throw new ServiceHttpError('Initial Assessment registry contains an invalid cycle code.', {
        httpStatus: 500,
      });
    }
    if (!seen.has(code)) {
      seen.add(code);
      cycles.push({ code, label: code });
    }
  }
  return {
    success: true,
    cycles,
    defaultCycleCode: cycles[0]?.code || null,
  };
}

export {
  buildInitialAssessmentIdentity,
  commitReadyLineage,
  projectArtifact,
  validateGenerated,
};
