import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE, REQUEST_DOCUMENT_LIFECYCLE_STATE, REQUEST_DOCUMENT_OPERATION_STATUS } from '../../../shared/config/requestDocument.js';
import { getFinalWriteupStatus } from '../final-writeup/transition-service.js';

export async function readBriefFact(requestId) {
  const request = await grantRequestAdapter.getById(requestId, {
    select: 'akoya_requestid,_wmkf_currentprerpbrief_value',
  });
  const pointerId = request?._wmkf_currentprerpbrief_value || null;
  if (!pointerId) return { availability: 'missing', artifactId: null, lifecycleState: null, file: null, milestone: null };
  const result = await requestDocumentAdapter.findByIds([pointerId]);
  if (result?.capped || result?.hasMore) return { availability: 'unavailable', artifactId: pointerId, lifecycleState: null, file: null, milestone: null };
  const row = (result?.records || []).find((item) => String(item.wmkf_requestdocumentid || '').toLowerCase() === String(pointerId).toLowerCase());
  const valid = row
    && String(row._wmkf_request_value || '').toLowerCase() === requestId.toLowerCase()
    && row.wmkf_artifacttype === REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_RESEARCH_PRESENTATION_BRIEF
    && row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && [REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT, REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW, REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL].includes(row.wmkf_lifecyclestate);
  return valid ? {
    availability: 'available', artifactId: row.wmkf_requestdocumentid,
    lifecycleState: row.wmkf_lifecyclestate,
    file: row.wmkf_sharepointitemid ? {
      webUrl: row.wmkf_sharepointweburl || null,
      name: row.wmkf_filename || null,
      versionId: row.wmkf_sharepointversionid || null,
    } : null,
    milestone: row.wmkf_milestoneversionid || row.wmkf_milestonecontenthash || row.wmkf_milestonecreatedat ? {
      versionId: row.wmkf_milestoneversionid || null,
      contentHash: row.wmkf_milestonecontenthash || null,
      createdAt: row.wmkf_milestonecreatedat || null,
    } : null,
  } : { availability: 'unavailable', artifactId: pointerId, lifecycleState: null, file: null, milestone: null };
}

export async function readFinalFact({ requestId, currentArtifact, role, actingUserSystemId }) {
  try {
    const status = await getFinalWriteupStatus({
      requestId, isSuperuser: role === 'superuser', actingUserSystemId,
    });
    return status.available ? {
      availability: status.phase === 'ready' && !status.artifact ? 'missing' : 'available',
      phase: status.phase,
      artifactId: status.artifact?.artifactId || null,
      file: status.artifact?.file || null,
      // Lets Staff Deliberations step 4 offer "Ready for group review" with the
      // same authorization and schedule fence as the Final writeup tab.
      canStart: status.canStart === true,
      startBlockedReason: status.startBlockedReason || null,
      sourceArtifactId: status.sourceArtifactId || null,
      handoffEmailEnabled: status.handoffEmailEnabled === true,
    } : { availability: 'unavailable', phase: 'unavailable', artifactId: null, file: null };
  } catch (error) {
    const expectedAbsentFinal = (currentArtifact?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT
      && error?.code === 'final_writeup_source_ineligible')
      || (!currentArtifact && error?.code === 'final_writeup_source_missing');
    if (expectedAbsentFinal) {
      const request = await grantRequestAdapter.getById(requestId, {
        select: 'akoya_requestid,_wmkf_currentfinalwriteup_value',
      }).catch(() => null);
      if (request?.akoya_requestid && !request._wmkf_currentfinalwriteup_value) {
        return { availability: 'missing', phase: 'none', artifactId: null, file: null };
      }
    }
    return { availability: 'unavailable', phase: 'unavailable', artifactId: null, file: null };
  }
}
