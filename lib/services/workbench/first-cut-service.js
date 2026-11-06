import { getUserRole } from '../../utils/auth';
import { getById, updateById } from '../../dataverse/adapters/grant-request';
import { linkedCycleCode, linkedCycleExpand } from '../../dataverse/adapters/operations-grant-cycle';
import { FIRST_CUT_STATUS, isFirstCutEditable, SEMI_FINALIST_STATUS, isSemiFinalistEditable } from '../../../shared/config/j27FirstCut';
import { isDataverseRecordNotFound } from '../../dataverse/core/errors';
import { ServiceHttpError } from '../service-http-error';

const conflict = () => new ServiceHttpError(
  'This request changed. Refresh the request and review its status before saving again.',
  { httpStatus: 409 },
);

export function saveFirstCut(input) {
  return savePhaseIDecision(input, FIRST_CUT_STATUS, isFirstCutEditable, 'First Cut');
}

export function saveSemiFinalist(input) {
  return savePhaseIDecision(input, SEMI_FINALIST_STATUS, isSemiFinalistEditable, 'the Semi-finalist recommendation');
}

async function savePhaseIDecision(
  { requestId, decision, version, profileId, callerSystemId },
  decisions, isEditable, label,
) {
  const request = await getById(requestId, {
    select: 'akoya_requestid,_wmkf_programdirector_value,wmkf_phaseistatus',
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
  if (linkedCycleCode(request) !== 'J27' || !isEditable(current)
      || request._etag !== version) throw conflict();

  const status = decisions[decision];
  if (current !== status) {
    try {
      await updateById(requestId, { wmkf_phaseistatus: status }, {
        ifMatch: version,
        actingUserSystemId: callerSystemId,
      });
    } catch (error) {
      if (error?.status === 412) throw conflict();
      throw error;
    }
  }
  return { success: true };
}
