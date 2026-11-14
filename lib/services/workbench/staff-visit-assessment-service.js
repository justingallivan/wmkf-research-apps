import { getById, updateById } from '../../dataverse/adapters/grant-request';
import { linkedCycleCode, linkedCycleExpand } from '../../dataverse/adapters/operations-grant-cycle';
import { isJ27ScopeCycle } from './j27-read-model';
import { isDataverseRecordNotFound } from '../../dataverse/core/errors';
import { ServiceHttpError } from '../service-http-error';

const conflict = () => new ServiceHttpError('The request changed. Review the saved assessment before trying again.', { httpStatus: 409 });

export async function getStaffVisitAssessment(requestId) {
  const row = await getById(requestId, {
    select: 'akoya_requestid,wmkf_staffvisitassessment',
    expand: linkedCycleExpand(),
  }).catch(error => {
    if (isDataverseRecordNotFound(error)) return null;
    throw error;
  });
  if (!row?.akoya_requestid || !isJ27ScopeCycle(linkedCycleCode(row))) {
    throw new ServiceHttpError('Request not found.', { httpStatus: 404 });
  }
  return { assessment: row.wmkf_staffvisitassessment ?? '', version: row._etag ?? null };
}

/** `beforeWrite` is required: the route's admission re-check, run just before the conditional write. */
export async function saveStaffVisitAssessment({ requestId, assessment, version, actor, beforeWrite }) {
  if (typeof beforeWrite !== 'function') throw new TypeError('beforeWrite is required');
  const current = await getStaffVisitAssessment(requestId);
  if (current.version !== version) throw conflict();
  if (current.assessment === assessment) return;
  await beforeWrite();
  try {
    await updateById(requestId, { wmkf_staffvisitassessment: assessment || null }, {
      ifMatch: version, actingUserSystemId: actor, noFallback: true,
    });
  } catch (error) {
    if (error?.status === 412) throw conflict();
    throw error;
  }
}
