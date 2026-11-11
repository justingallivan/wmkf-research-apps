import { getById, updateById } from '../../dataverse/adapters/grant-request';
import { linkedCycleCode, linkedCycleExpand } from '../../dataverse/adapters/operations-grant-cycle';
import { isJ27ScopeCycle } from './j27-read-model';
import { isDataverseRecordNotFound } from '../../dataverse/core/errors';
import { ServiceHttpError } from '../service-http-error';

const conflict = () => new ServiceHttpError('The request changed. Review the saved rationale before trying again.', { httpStatus: 409 });

export async function getInitialAssessmentRationale(requestId) {
  const row = await getById(requestId, {
    select: 'akoya_requestid,wmkf_initialassessmentrationale',
    expand: linkedCycleExpand(),
  }).catch(error => {
    if (isDataverseRecordNotFound(error)) return null;
    throw error;
  });
  if (!row?.akoya_requestid || !isJ27ScopeCycle(linkedCycleCode(row))) {
    throw new ServiceHttpError('Request not found.', { httpStatus: 404 });
  }
  return { rationale: row.wmkf_initialassessmentrationale ?? '', version: row._etag ?? null };
}

export async function saveInitialAssessmentRationale({ requestId, rationale, version, actor }) {
  const current = await getInitialAssessmentRationale(requestId);
  if (current.version !== version) throw conflict();
  if (current.rationale === rationale) return;
  try {
    await updateById(requestId, { wmkf_initialassessmentrationale: rationale || null }, {
      ifMatch: version, actingUserSystemId: actor, noFallback: true,
    });
  } catch (error) {
    if (error?.status === 412) throw conflict();
    throw error;
  }
}
