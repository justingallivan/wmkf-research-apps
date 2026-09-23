/** Initial Assessment read model and response-only metadata refresh helpers. */
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { GraphService } from '../graph-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import { isGuid } from '../../utils/guid.js';
import {
  REQUEST_DASHBOARD_SELECT,
  REQUEST_LINEAGE_SELECT,
  FILE_METADATA_READ_BUDGET_MS,
  FILE_METADATA_READ_CONCURRENCY,
  projectArtifact,
  sameId,
} from './artifact-model.js';
import { withTestRequestIsolationSelect } from '../test-requests/isolation.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
  isInitialAssessmentBoardSnapshot,
} from '../../../shared/config/requestDocument.js';

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
      select: withTestRequestIsolationSelect(REQUEST_DASHBOARD_SELECT),
      top: batch.length,
    });
    requests.push(...(resultForBatch.records || []));
  }
  const byId = new Map(requests.map((request) => [request.akoya_requestid, request]));
  const artifacts = [];
  const latestAttempts = [];
  const milestones = [];
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
    const workingRows = rows.filter((row) => !isInitialAssessmentBoardSnapshot(row));
    const activeRows = workingRows.filter((row) => (
      row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
    ));
    const pointerId = byId.get(ownerRequestId)?._wmkf_currentinitialassessment_value || null;
    const currentReady = activeRows.find((row) => (
      sameId(row.wmkf_requestdocumentid, pointerId)
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
      && !sameId(latest.wmkf_requestdocumentid, currentReady.wmkf_requestdocumentid)
      && latest.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
      latestAttempts.push(latest);
    }
    if (requestId) {
      milestones.push(...rows.filter((row) => (
        isInitialAssessmentBoardSnapshot(row)
        && row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
        && row.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.BOARD_READY
      )));
    }
  }
  const projected = [
    ...artifacts.map((row) => (
      projectArtifact(row, byId.get(row._wmkf_request_value) || null)
    )),
    ...latestAttempts.map((row) => (
      projectArtifact(row, byId.get(row._wmkf_request_value) || null)
    )),
    ...milestones.map((row) => (
      projectArtifact(row, byId.get(row._wmkf_request_value) || null)
    )),
  ];
  const refreshed = await refreshArtifactFileMetadata(projected);
  return {
    success: true,
    artifacts: refreshed.slice(0, artifacts.length),
    latestAttempts: refreshed.slice(artifacts.length, artifacts.length + latestAttempts.length),
    milestones: refreshed.slice(artifacts.length + latestAttempts.length),
  };
}

export async function resolveCanonicalInitialAssessment({
  requestId,
  expectedArtifactId = null,
}) {
  if (!isGuid(requestId)) {
    throw new ServiceHttpError('requestId is not a valid GUID', { httpStatus: 400 });
  }
  const [request, result] = await Promise.all([
    grantRequestAdapter.getById(requestId, { select: REQUEST_LINEAGE_SELECT }),
    requestDocumentAdapter.findByRequest(requestId, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
    }),
  ]);
  if (!request || !sameId(request.akoya_requestid, requestId)) {
    throw new ServiceHttpError('Initial Assessment request could not be resolved.', {
      httpStatus: 404,
      code: 'initial_assessment_request_not_found',
    });
  }
  const pointerId = request._wmkf_currentinitialassessment_value || null;
  const activeReady = (result.records || []).filter((row) => (
    !isInitialAssessmentBoardSnapshot(row)
    && row.wmkf_artifacttype === REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT
    && row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
  ));
  const row = activeReady.find((candidate) => sameId(
    candidate.wmkf_requestdocumentid,
    pointerId,
  )) || null;
  if (!pointerId && activeReady.length === 0) {
    throw new ServiceHttpError(
      'No Ready Initial Assessment artifact exists for this request.',
      { httpStatus: 404, code: 'initial_assessment_ready_missing' },
    );
  }
  if (!pointerId || activeReady.length !== 1 || !row) {
    throw new ServiceHttpError(
      'Initial Assessment registry has an invalid request-level canonical pointer.',
      {
        httpStatus: 409,
        code: 'initial_assessment_pointer_invalid',
        body: {
          error: 'Initial Assessment registry has an invalid request-level canonical pointer.',
          code: 'initial_assessment_pointer_invalid',
        },
      },
    );
  }
  if (expectedArtifactId && !sameId(row.wmkf_requestdocumentid, expectedArtifactId)) {
    throw new ServiceHttpError(
      'This Initial Assessment document was replaced. Refresh the page before continuing.',
      {
        httpStatus: 409,
        code: 'artifact_replaced',
        body: {
          error: 'This Initial Assessment document was replaced. Refresh the page before continuing.',
          code: 'artifact_replaced',
        },
      },
    );
  }
  return { request, row, rows: result.records || [] };
}

export async function listInitialAssessmentArtifactVersions({
  requestId,
  expectedArtifactId = null,
  limit = 20,
}) {
  const { row } = await resolveCanonicalInitialAssessment({ requestId, expectedArtifactId });
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
    if (isInitialAssessmentBoardSnapshot(row)) continue;
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
