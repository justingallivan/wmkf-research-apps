/**
 * API: /api/workbench/pre-site-visit
 *
 * GET ?requestId=... -> read the current/pending governed Pre-Site artifact.
 * POST { requestId } -> generate, recover, or reuse one governed Pre-Site
 * Visit Word draft and return its registry/SharePoint identity.
 */

import { getUserRole, requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { isGuid } from '../../../lib/utils/guid';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import {
  generatePreSiteVisitArtifact,
  getPreSiteVisitArtifactStatus,
} from '../../../lib/services/pre-site-visit/artifact-service';
import { readDeliberationStageLabels } from '../../../lib/services/deliberation-stage-labels';
import { getDeliberationSessionForRequest } from '../../../lib/services/deliberation-briefing/session-reader';
import { projectDeliberationSession } from '../../../shared/utils/deliberation-stage';
import { getMaterialsSummaryForRequest } from '../../../lib/services/site-visit-materials/summary-reader';
import { REQUEST_DOCUMENT_OPERATION_STATUS } from '../../../shared/config/requestDocument';
import * as grantRequestAdapter from '../../../lib/dataverse/adapters/grant-request';
import * as requestDocumentAdapter from '../../../lib/dataverse/adapters/request-document';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE, REQUEST_DOCUMENT_LIFECYCLE_STATE } from '../../../shared/config/requestDocument';
import { getPreparationForRequest } from '../../../lib/services/pre-site-visit/preparation-worker';
import { getFinalWriteupStatus } from '../../../lib/services/final-writeup/transition-service';

export const config = {
  api: {
    responseLimit: false,
    bodyParser: { sizeLimit: '16kb' },
  },
  maxDuration: 300,
};

function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? {
      error: error.message,
      code: error.code || 'pre_site_visit_failed',
    });
  }
  console.error('workbench pre-site-visit error:', error);
  return res.status(500).json({
    error: 'Pre-Site Visit draft generation failed.',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined,
  });
}

function withoutCorrection(artifact) {
  if (!artifact) return artifact;
  const sanitized = { ...artifact };
  delete sanitized.correction;
  return sanitized;
}

function staffSafePayload(payload) {
  const pendingIsReopenAudit = Boolean(payload.pendingArtifact?.correction?.reasonCode);
  const sanitized = {
    ...payload,
    correctionInProgress: payload.currentArtifact?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT
      && Boolean(payload.currentArtifact?.correction?.cycleId),
    currentArtifact: withoutCorrection(payload.currentArtifact),
    pendingArtifact: pendingIsReopenAudit ? null : withoutCorrection(payload.pendingArtifact),
    artifact: withoutCorrection(payload.artifact),
  };
  delete sanitized.reopenHistory;
  return sanitized;
}

async function readBriefFact(requestId) {
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

async function readFinalFact({ requestId, currentArtifact, role, actingUserSystemId }) {
  try {
    const status = await getFinalWriteupStatus({
      requestId, isSuperuser: role === 'superuser', actingUserSystemId,
    });
    return status.available ? {
      availability: status.phase === 'ready' && !status.artifact ? 'missing' : 'available',
      phase: status.phase,
      artifactId: status.artifact?.artifactId || null,
      file: status.artifact?.file || null,
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

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;
  const role = access.profileId === null ? 'superuser' : await getUserRole(access.profileId);
  const includeCorrectionAudit = role === 'superuser';

  return withDalContext('workbench-pre-site-visit', async () => {
    try {
      if (req.method === 'GET') {
        const requestId = String(req.query?.requestId || '').trim();
        if (!isGuid(requestId)) {
          return res.status(400).json({ error: 'requestId is required and must be a GUID' });
        }
        const status = await getPreSiteVisitArtifactStatus({ requestId });
        const payload = includeCorrectionAudit ? status : staffSafePayload(status);
        // Session line (tracker §5.4 via the briefing seam): fail-open null
        // until the tracker is enabled or a slot exists.
        // Applicant materials summary (plan §16.3, PR 3): counts and window
        // only, never the contributor link or contacts; null when off and an
        // unavailable sentinel when a runtime read fails.
        const [stageLabels, session, materials, preparation, brief, final] = await Promise.all([
          readDeliberationStageLabels(),
          getDeliberationSessionForRequest(requestId).catch(() => null),
          getMaterialsSummaryForRequest({ requestId }),
          getPreparationForRequest(requestId).catch(() => ({
            timing: { availability: 'unavailable', startIso: null, endIso: null, timeZone: null },
            preparation: { state: 'unavailable', due: false, availability: 'unavailable', automationActive: false, blockedBy: [] },
            writeup: { availability: 'unavailable', artifactId: null, file: null, milestone: null },
          })),
          readBriefFact(requestId).catch(() => ({ availability: 'unavailable', artifactId: null, lifecycleState: null, file: null, milestone: null })),
          readFinalFact({ requestId, currentArtifact: payload.currentArtifact, role,
            actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null }),
        ]);
        // Tracker §5.6: the session's attendees are the Share email's default
        // recipients, so the tab gets their addresses alongside the card shape.
        const sessionAttendees = Array.isArray(session?.attendees)
          ? session.attendees.map((person) => ({ name: person?.name || '', email: String(person?.email || '').trim().toLowerCase() })).filter((person) => person.email)
          : [];
        const finalReview = final;
        return res.status(200).json({ success: true, ...payload, stageLabels,
          timing: preparation.timing, preparation: preparation.preparation,
          writeup: preparation.writeup, brief, finalReview, finalPhase: finalReview.phase,
          correctionInProgress: status.currentArtifact?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT
            && Boolean(status.currentArtifact?.correction?.cycleId),
          session: projectDeliberationSession(session), sessionAttendees, materials });
      }

      if (!req.body
        || typeof req.body !== 'object'
        || Array.isArray(req.body)
        || Object.keys(req.body).some((key) => key !== 'requestId')) {
        return res.status(400).json({ error: 'POST body must contain only requestId' });
      }
      const requestId = String(req.body.requestId || '').trim();
      if (!isGuid(requestId)) {
        return res.status(400).json({ error: 'requestId is required and must be a GUID' });
      }

      const result = await generatePreSiteVisitArtifact({
        requestId,
        actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
      });
      const generating = result.artifact.operationStatus
        === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING;
      const payload = includeCorrectionAudit ? result : staffSafePayload(result);
      return res.status(generating ? 202 : 200).json({ success: true, ...payload });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
