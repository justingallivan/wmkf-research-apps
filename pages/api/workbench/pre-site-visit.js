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
import { isRequestDocumentExplicitActorSchemaReady } from '../../../lib/utils/request-document-explicit-actor-readiness';
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
import { REQUEST_DOCUMENT_LIFECYCLE_STATE } from '../../../shared/config/requestDocument';
import { getPreparationForRequest } from '../../../lib/services/pre-site-visit/preparation-worker';
import { getFinalWriteupStatus } from '../../../lib/services/final-writeup/transition-service';
import { readBriefFact } from '../../../lib/services/pre-site-visit/status-facts';
import {
  canChangeDraftWriteup, canSeeDraftWriteup, redactDraftWriteup, resolveWriteupViewer,
} from '../../../lib/services/pre-site-visit/writeup-visibility';

function sameId(left, right) {
  return Boolean(left && right) && String(left).toLowerCase() === String(right).toLowerCase();
}

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
        const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;
        const [status, viewer] = await Promise.all([
          getPreSiteVisitArtifactStatus({ requestId }),
          resolveWriteupViewer({ isSuperuser: role === 'superuser', actingUserSystemId }),
        ]);
        const { leadProgramDirectorId, ...statusWithoutLead } = status;
        let finalReview;
        try {
          const finalStatus = await getFinalWriteupStatus({
            requestId, isSuperuser: role === 'superuser', actingUserSystemId,
            writeupViewer: viewer,
          });
          finalReview = {
            ...finalStatus,
            availability: finalStatus.available
              ? (finalStatus.phase === 'ready' && !finalStatus.artifact ? 'missing' : 'available')
              : 'unavailable',
            artifactId: finalStatus.artifact?.artifactId || null,
            file: finalStatus.artifact?.file || null,
          };
        } catch (error) {
          const expectedAbsentFinal = (status.currentArtifact?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT
            && error?.code === 'final_writeup_source_ineligible')
            || (!status.currentArtifact && error?.code === 'final_writeup_source_missing');
          finalReview = expectedAbsentFinal
            ? { availability: 'missing', phase: 'none', artifactId: null, file: null }
            : { availability: 'unavailable', phase: 'unavailable', artifactId: null, file: null };
        }
        const regenerationStageEligible = (
          status.currentArtifact?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW
          && finalReview.phase === 'ready'
        ) || (
          status.currentArtifact?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL
          && finalReview.phase === 'group-review'
        );
        const visibleStatus = {
          ...statusWithoutLead,
          currentArtifact: redactDraftWriteup(status.currentArtifact, viewer, leadProgramDirectorId, status.grantProgramId),
          pendingArtifact: redactDraftWriteup(status.pendingArtifact, viewer, leadProgramDirectorId, status.grantProgramId),
          previousVersions: (status.previousVersions || []).map((version) => (
            version.stage === 'group-review' || canSeeDraftWriteup(viewer, leadProgramDirectorId, status.grantProgramId)
              ? version : { ...version, file: null, fileHidden: true }
          )),
        };
        const payload = includeCorrectionAudit ? visibleStatus : staffSafePayload(visibleStatus);
        // Session line (tracker §5.4 via the briefing seam): fail-open null
        // until the tracker is enabled or a slot exists.
        // Applicant materials summary (plan §16.3, PR 3): counts and window
        // only, never the contributor link or contacts; null when off and an
        // unavailable sentinel when a runtime read fails.
        const [stageLabels, session, materials, preparation, brief] = await Promise.all([
          readDeliberationStageLabels(),
          getDeliberationSessionForRequest(requestId).catch(() => null),
          getMaterialsSummaryForRequest({ requestId }),
          getPreparationForRequest(requestId).catch(() => ({
            timing: { availability: 'unavailable', startIso: null, endIso: null, timeZone: null },
            preparation: { state: 'unavailable', due: false, availability: 'unavailable', automationActive: false, blockedBy: [] },
            writeup: { availability: 'unavailable', artifactId: null, file: null, milestone: null },
          })),
          readBriefFact(requestId).catch(() => ({ availability: 'unavailable', artifactId: null, lifecycleState: null, file: null, milestone: null })),
        ]);
        // Tracker §5.6: the session's attendees are the Share email's default
        // recipients, so the tab gets their addresses alongside the card shape.
        const sessionAttendees = Array.isArray(session?.attendees)
          ? session.attendees.map((person) => ({ name: person?.name || '', email: String(person?.email || '').trim().toLowerCase() })).filter((person) => person.email)
          : [];
        return res.status(200).json({ success: true, ...payload, stageLabels,
          timing: preparation.timing, preparation: preparation.preparation,
          // A separate read: redacted on its own lifecycle so a draft
          // published between the two reads is never returned.
          writeup: redactDraftWriteup(preparation.writeup, viewer, leadProgramDirectorId, status.grantProgramId),
          brief, finalReview, finalPhase: finalReview.phase,
          // Mirrors the POST and start-site-visit guards so the page offers
          // only the actions the server will accept.
          writeupAccess: {
            canChange: canChangeDraftWriteup(viewer, leadProgramDirectorId),
            identityLinked: Boolean(viewer.actingUserSystemId) || viewer.isSuperuser,
            canRegenerate: isRequestDocumentExplicitActorSchemaReady()
              && isGuid(viewer.actingUserSystemId)
              && canChangeDraftWriteup(viewer, leadProgramDirectorId)
              && Boolean(status.currentArtifact)
              && regenerationStageEligible,
            regenerationBlockedReason: !status.currentArtifact ? 'writeup_missing'
                : !isRequestDocumentExplicitActorSchemaReady() ? 'schema_not_ready'
                  : !isGuid(viewer.actingUserSystemId) ? 'actor_required'
                : !regenerationStageEligible ? 'leadership_or_state_unavailable'
                  : !canChangeDraftWriteup(viewer, leadProgramDirectorId) ? 'lead_only' : null,
          },
          correctionInProgress: status.currentArtifact?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT
            && Boolean(status.currentArtifact?.correction?.cycleId),
          session: projectDeliberationSession(session), sessionAttendees, materials });
      }

      if (!req.body
        || typeof req.body !== 'object'
        || Array.isArray(req.body)) {
        return res.status(400).json({ error: 'POST body must be an object' });
      }
      const regenerating = req.body.mode === 'regenerate';
      const allowedKeys = regenerating
        ? new Set(['requestId', 'mode', 'expectedArtifactId', 'expectedFinalArtifactId', 'clientOperationId'])
        : new Set(['requestId']);
      if (Object.keys(req.body).some((key) => !allowedKeys.has(key))
        || (!regenerating && req.body.mode !== undefined)) {
        return res.status(400).json({ error: 'POST body contains unsupported fields' });
      }
      const requestId = String(req.body.requestId || '').trim();
      if (!isGuid(requestId)) {
        return res.status(400).json({ error: 'requestId is required and must be a GUID' });
      }

      const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;
      const [{ leadProgramDirectorId }, viewer] = await Promise.all([
        getPreSiteVisitArtifactStatus({ requestId }),
        resolveWriteupViewer({ isSuperuser: role === 'superuser', actingUserSystemId }),
      ]);
      if (!canChangeDraftWriteup(viewer, leadProgramDirectorId)) {
        throw new ServiceHttpError('Only the lead Program Director or a superuser can prepare this writeup.', {
          httpStatus: 403,
          code: 'pre_site_writeup_lead_only',
        });
      }
      if (regenerating) {
        if (!isGuid(req.body.expectedArtifactId) || !isGuid(req.body.clientOperationId)
          || (req.body.expectedFinalArtifactId != null && !isGuid(req.body.expectedFinalArtifactId))) {
          throw new ServiceHttpError('A confirmed writeup pair and operation id are required.', {
            httpStatus: 400, code: 'pre_site_visit_regeneration_identity_invalid',
          });
        }
        if (!isRequestDocumentExplicitActorSchemaReady()) {
          throw new ServiceHttpError('Final Writeup is unavailable until its Dataverse schema is verified.', {
            httpStatus: 503, code: 'final_writeup_schema_not_ready',
          });
        }
        if (!isGuid(actingUserSystemId)) {
          throw new ServiceHttpError('A resolved staff identity is required to regenerate this writeup.', {
            httpStatus: 403, code: 'final_writeup_actor_required',
          });
        }
      }
      const result = await generatePreSiteVisitArtifact({
        requestId, actingUserSystemId,
        ...(regenerating ? {
          generationMode: 'regenerate',
          regeneration: {
            expectedArtifactId: req.body.expectedArtifactId,
            expectedFinalArtifactId: req.body.expectedFinalArtifactId || null,
            clientOperationId: req.body.clientOperationId,
            isSuperuser: role === 'superuser',
          },
        } : {}),
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
