/** Initial Assessment: one staff-attributed, ETag-conditional request PATCH.
 * Only the selected branch is written; hidden notes/rationale are never cleared.
 */
import { getById, updateById } from '../../dataverse/adapters/grant-request';
import { linkedCycleCode, linkedCycleExpand } from '../../dataverse/adapters/operations-grant-cycle';
import { isDataverseRecordNotFound } from '../../dataverse/core/errors';
import { getUserRole } from '../../utils/auth';
import { ServiceHttpError } from '../service-http-error';
import { deriveRecorded, isJ27ScopeCycle } from './j27-read-model';
import { getReasonMetadata } from './not-scored-reason-service';
import { SCORING_STATUS, isScoringEditable } from '../../../shared/config/j27Scoring';
import { OTHER_TRIAGE_REASON } from '../../../shared/config/triageReasons';

const fail = (message, httpStatus) => { throw new ServiceHttpError(message, { httpStatus }); };
const decisionFor = status => {
  const scoring = deriveRecorded(status).scoring;
  return scoring === 'not-scored' ? 'no' : ['scored', 'inferred-scored'].includes(scoring) ? 'yes' : '';
};
async function read(requestId) {
  const row = await getById(requestId, {
    select: 'akoya_requestid,_wmkf_programdirector_value,wmkf_phaseistatus,wmkf_initialassessmentrationale,wmkf_declinereason,wmkf_denialnotes',
    expand: linkedCycleExpand(),
  }).catch(error => { if (isDataverseRecordNotFound(error)) return null; throw error; });
  if (!row?.akoya_requestid || !isJ27ScopeCycle(linkedCycleCode(row))) fail('Request not found.', 404);
  return row;
}
export async function getAssessment(requestId) {
  const row = await read(requestId);
  return { decision: decisionFor(row.wmkf_phaseistatus), decisionEditable: isScoringEditable(row.wmkf_phaseistatus ?? null),
    rationale: row.wmkf_initialassessmentrationale ?? '', reason: row.wmkf_declinereason ?? null,
    notes: row.wmkf_denialnotes ?? '', version: row._etag ?? null, ...await getReasonMetadata() };
}
export async function saveAssessment({ requestId, decision, rationale, reason, notes, version, actor, profileId, beforeWrite }) {
  if (typeof beforeWrite !== 'function') throw new TypeError('beforeWrite is required');
  if (!['yes', 'no'].includes(decision)) fail('Select a scoring decision.', 400);
  const row = await read(requestId);
  if (row._etag !== version) fail('The request changed. Reload the saved assessment before trying again.', 409);
  const current = row.wmkf_phaseistatus ?? null;
  const patch = {};
  if (decision !== decisionFor(current)) {
    if (!isScoringEditable(current)) fail('Scoring is closed for this request.', 409);
    const lead = row._wmkf_programdirector_value;
    if (!(lead && actor && lead.toLowerCase() === actor.toLowerCase()) && await getUserRole(profileId) !== 'superuser') {
      fail('Only the lead Program Director or a superuser can change the scoring decision.', 403);
    }
    patch.wmkf_phaseistatus = SCORING_STATUS[decision];
  }
  if (decision === 'yes') {
    if (reason !== undefined || notes !== undefined || typeof rationale !== 'string' || rationale.length > 10000) fail('A valid staff rationale is required.', 400);
    patch.wmkf_initialassessmentrationale = rationale.trim() || null;
  } else {
    if (rationale !== undefined) fail('Staff rationale is only saved for Scored proposals.', 400);
    const schema = await getReasonMetadata();
    if (!schema.options.some(option => option.value === reason && option.available)) fail('This reason is not available.', 400);
    patch.wmkf_declinereason = reason;
    if (reason === OTHER_TRIAGE_REASON) {
      if (typeof notes !== 'string' || !notes.trim() || notes.length > schema.maxLength) fail('Enter an Other rationale within the field limit.', 400);
      patch.wmkf_denialnotes = notes;
    } else if (notes !== undefined) fail('Notes can only be edited when Other is selected.', 400);
  }
  if (Object.entries(patch).every(([key, value]) => (row[key] ?? null) === value)) return;
  await beforeWrite();
  try {
    await updateById(requestId, patch, { ifMatch: version, actingUserSystemId: actor, noFallback: true });
  } catch (error) {
    if (error?.status === 412) fail('The request changed. Reload the saved assessment before trying again.', 409);
    throw error;
  }
}
