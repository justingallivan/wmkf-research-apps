/**
 * Read-only Pre-Site status projection from authoritative request and registry state.
 * Status reads do not generate, upload, or mutate persisted artifacts.
 */
import { ServiceHttpError } from '../service-http-error.js';
import { isGuid } from '../../utils/guid.js';
import {
  isPreSiteDistributionSnapshot,
  PRE_SITE_VISIT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';
import {
  projectPreSiteVisitArtifact,
  projectReopenHistory,
} from './artifact-model.js';
import { DEFAULT_DEPENDENCIES } from './artifact-dependencies.js';

export async function getPreSiteVisitArtifactStatus(
  { requestId },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!isGuid(requestId)) {
    throw new ServiceHttpError('A valid requestId is required.', {
      httpStatus: 400,
      code: 'invalid_request_id',
    });
  }

  const [request, result] = await Promise.all([
    dependencies.getRequest(requestId),
    dependencies.findByRequest(requestId, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
    }),
  ]);
  if (!request || String(request.akoya_requestid || '').toLowerCase() !== requestId.toLowerCase()) {
    throw new ServiceHttpError('The Pre-Site request could not be resolved.', {
      httpStatus: 404,
      code: 'pre_site_visit_request_not_found',
    });
  }

  const rows = (result?.records || []).filter((row) => (
    String(row?._wmkf_request_value || '').toLowerCase() === requestId.toLowerCase()
    && row.wmkf_artifacttype === REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT
  ));
  const activeRows = rows.filter((row) => (
    row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
  ));
  const unknownContent = activeRows.find((row) => (
    ![PRE_SITE_VISIT_CONTRACT.contentType, 'application/pdf'].includes(row.wmkf_contenttype)
  ));
  if (unknownContent) {
    throw new ServiceHttpError('An active Pre-Site artifact has an unknown content type.', {
      httpStatus: 409,
      code: 'pre_site_visit_content_type_unknown',
    });
  }

  const wordRows = activeRows.filter((row) => (
    row.wmkf_contenttype === PRE_SITE_VISIT_CONTRACT.contentType
    && !isPreSiteDistributionSnapshot(row)
  ));
  const pointerId = request._wmkf_currentpresitevisit_value
    ? String(request._wmkf_currentpresitevisit_value).toLowerCase()
    : null;
  let currentRow = null;
  let currentArtifact = null;
  if (pointerId) {
    currentRow = wordRows.find((row) => (
      String(row.wmkf_requestdocumentid || '').toLowerCase() === pointerId
    ));
    if (!currentRow
      || currentRow.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
      throw new ServiceHttpError('The current Pre-Site request pointer requires reconciliation.', {
        httpStatus: 409,
        code: 'pre_site_visit_pointer_invalid',
      });
    }
    currentArtifact = projectPreSiteVisitArtifact(currentRow);
  } else if (wordRows.some((row) => row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY)) {
    throw new ServiceHttpError('A Ready Pre-Site Word document has no current request pointer.', {
      httpStatus: 409,
      code: 'pre_site_visit_pointer_missing',
    });
  }

  const currentCreatedAt = currentRow
    ? Date.parse(currentRow.createdon || '')
    : null;
  const pendingRow = wordRows.find((row) => {
    if (String(row.wmkf_requestdocumentid || '').toLowerCase() === pointerId
      || row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
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
    pendingArtifact: pendingRow ? projectPreSiteVisitArtifact(pendingRow) : null,
    reopenHistory: projectReopenHistory(rows),
  };
}

