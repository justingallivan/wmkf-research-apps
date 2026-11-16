import { j27IntegrityTarget, j27ChairsRecommendationEnabled, j27ChairsRecommendationRehearsalRequestId, j27IntegritySimulationRequestIds } from '../../utils/j27-integrity-readiness';
import { isJ27SandboxFactoryRequest } from './j27-integrity-jobs';
import { isGuid } from '../../utils/guid';
import { getUserRole } from '../../utils/auth';
import { getById, updateById } from '../../dataverse/adapters/grant-request';
import { linkedCycleCode, linkedCycleExpand } from '../../dataverse/adapters/operations-grant-cycle';
import { isJ27ScopeCycle } from './j27-read-model';
import { SCORING_STATUS, isScoringEditable, CHAIRS_RECOMMENDATION_STATUS, isChairsRecommendationEditable } from '../../../shared/config/j27Scoring';
import { isDataverseRecordNotFound } from '../../dataverse/core/errors';
import { ServiceHttpError } from '../service-http-error';

const conflict = () => new ServiceHttpError(
  'This request changed. Refresh the request and review its status before saving again.',
  { httpStatus: 409 },
);

export function saveScoring(input) {
  return savePhaseIDecision(input, SCORING_STATUS, isScoringEditable, 'the scoring decision');
}

export function saveChairsRecommendation(input) {
  if (!j27ChairsRecommendationEnabled()) {
    throw new ServiceHttpError('Recommendations to Chairs are unavailable here.', { httpStatus: 409 });
  }
  return savePhaseIDecision(input, CHAIRS_RECOMMENDATION_STATUS, isChairsRecommendationEditable, 'the recommendation to Chairs');
}

async function savePhaseIDecision(
  { requestId, decision, version, profileId, callerSystemId },
  decisions, isEditable, label,
) {
  const chairsRecommendation = decisions === CHAIRS_RECOMMENDATION_STATUS;
  const fields = 'akoya_requestid,_wmkf_programdirector_value,wmkf_phaseistatus';
  const request = await getById(requestId, {
    select: chairsRecommendation ? `${fields},wmkf_istestrequest,wmkf_testcreationrunid` : fields,
    expand: linkedCycleExpand(),
  }).catch((error) => {
    if (isDataverseRecordNotFound(error)) return null;
    throw error;
  });
  if (!request?.akoya_requestid) {
    throw new ServiceHttpError('Request not found.', { httpStatus: 404 });
  }
  const lead = request._wmkf_programdirector_value;
  const isLeadPd = lead && callerSystemId && lead.toLowerCase() === callerSystemId.toLowerCase();
  if (!isLeadPd && await getUserRole(profileId) !== 'superuser') {
    throw new ServiceHttpError(`Only the lead Program Director or a superuser can save ${label}.`, { httpStatus: 403 });
  }
  const current = request.wmkf_phaseistatus ?? null;
  if (!isJ27ScopeCycle(linkedCycleCode(request)) || !isEditable(current)
      || request._etag !== version) throw conflict();

  // Preview can share Postgres with Production. Only factory test requests
  // can produce screening history here, even if other records exist in sandbox.
  const dropdownRehearsalId = chairsRecommendation ? j27ChairsRecommendationRehearsalRequestId() : null;
  const simulationIds = chairsRecommendation ? j27IntegritySimulationRequestIds() : [];
  const rehearsalIds = dropdownRehearsalId ? [dropdownRehearsalId] : simulationIds;
  if (rehearsalIds.length && !rehearsalIds.includes(requestId.toLowerCase())) {
    throw new ServiceHttpError('This Preview is limited to the designated rehearsal request.', { httpStatus: 403 });
  }
  if (simulationIds.length && decision === 'yes' && requestId.toLowerCase() !== simulationIds[0]) {
    throw new ServiceHttpError('This request is designated for the No screening rehearsal.', { httpStatus: 409 });
  }
  if (chairsRecommendation && !rehearsalIds.length) {
    const runId = request.wmkf_testcreationrunid;
    const target = new URL(process.env.DYNAMICS_URL).hostname;
    if (request.wmkf_istestrequest !== true || !isGuid(runId)
      || !await isJ27SandboxFactoryRequest({ target, requestId, runId })) {
      throw new ServiceHttpError('Use a ready sandbox factory test request to rehearse this decision.', { httpStatus: 409 });
    }
  }

  const status = decisions[decision];
  if (current !== status) {
    const target = status === CHAIRS_RECOMMENDATION_STATUS.yes ? j27IntegrityTarget() : null;
    const screen = target ? await import('./j27-integrity-dispatch') : null;
    const intent = { target, requestId, profileId, version };
    const dispatch = screen && await screen.scheduleJ27IntegrityScreen(intent);
    try {
      await updateById(requestId, { wmkf_phaseistatus: status }, {
        ifMatch: version,
        actingUserSystemId: callerSystemId,
      });
    } catch (error) {
      if (error?.status === 412) throw conflict();
      throw error;
    }
    if (dispatch === 'started') {
      return { success: true, automaticScreen: await screen.confirmJ27IntegrityDecision(intent) };
    }
    if (dispatch === 'unconfirmed') return { success: true, automaticScreen: 'unconfirmed' };
  }
  return { success: true };
}
