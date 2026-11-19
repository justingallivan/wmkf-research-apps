/** Not Scored reasons: existing Request picklist + Invite/Decline Notes.
 * One conditional, staff-attributed PATCH; other reasons NEVER write notes.
 * Live metadata bounds the notes and gates the options before every save.
 */
import { getById, updateById } from '../../dataverse/adapters/grant-request';
import { getMetadataBatch } from '../../dataverse/adapters/metadata';
import { linkedCycleCode, linkedCycleExpand } from '../../dataverse/adapters/operations-grant-cycle';
import { isDataverseRecordNotFound } from '../../dataverse/core/errors';
import { ServiceHttpError } from '../service-http-error';
import { isJ27ScopeCycle } from './j27-read-model';
import { SCORING_STATUS } from '../../../shared/config/j27Scoring';
import { TRIAGE_REASONS, OTHER_TRIAGE_REASON } from '../../../shared/config/triageReasons';

const ROOT = "/EntityDefinitions(LogicalName='akoya_request')/Attributes";
const fail = (message, httpStatus) => { throw new ServiceHttpError(message, { httpStatus }); };
async function read(requestId) {
  const row = await getById(requestId, { select: 'akoya_requestid,wmkf_phaseistatus,wmkf_declinereason,wmkf_denialnotes', expand: linkedCycleExpand() })
    .catch(error => { if (isDataverseRecordNotFound(error)) return null; throw error; });
  if (!row?.akoya_requestid || !isJ27ScopeCycle(linkedCycleCode(row))) fail('Request not found.', 404);
  return row;
}
async function metadata() {
  const [choice, memo] = await getMetadataBatch([
    `${ROOT}(LogicalName='wmkf_declinereason')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options)`,
    `${ROOT}(LogicalName='wmkf_denialnotes')/Microsoft.Dynamics.CRM.MemoAttributeMetadata?$select=MaxLength`,
  ]);
  if (!Array.isArray(choice?.OptionSet?.Options) || !Number.isInteger(memo?.MaxLength) || memo.MaxLength < 1) {
    fail('Reason fields are unavailable. Please try again later.', 503);
  }
  return {
    options: TRIAGE_REASONS.map(option => ({ ...option, available: choice.OptionSet.Options.some(live =>
      live.Value === option.value && live.Label?.LocalizedLabels?.some(label => label.LanguageCode === 1033 && label.Label === option.label)) })),
    maxLength: Math.min(memo.MaxLength, 10000),
  };
}
export async function getNotScoredReason(requestId) {
  const row = await read(requestId);
  const schema = await metadata();
  return { reason: row.wmkf_declinereason ?? null, notes: row.wmkf_denialnotes ?? '',
    version: row._etag ?? null, editable: row.wmkf_phaseistatus === SCORING_STATUS.no, ...schema };
}
export async function saveNotScoredReason({ requestId, reason, notes, version, actor, beforeWrite }) {
  if (typeof beforeWrite !== 'function') throw new TypeError('beforeWrite is required');
  const row = await read(requestId);
  if (row._etag !== version) fail('The request changed. Reload the saved reason before trying again.', 409);
  if (row.wmkf_phaseistatus !== SCORING_STATUS.no) fail('Reasons can only be saved for Not Scored proposals.', 409);
  const schema = await metadata();
  if (!schema.options.some(option => option.value === reason && option.available)) fail('This reason is not available yet.', 400);
  const patch = { wmkf_declinereason: reason };
  if (reason === OTHER_TRIAGE_REASON) {
    if (typeof notes !== 'string' || !notes.trim() || notes.length > schema.maxLength) fail('Enter an Other rationale within the field limit.', 400);
    patch.wmkf_denialnotes = notes; // Preserve existing whitespace; edit only explicitly submitted Other notes.
  } else if (notes !== undefined) fail('Notes can only be edited when Other is selected.', 400);
  if (row.wmkf_declinereason === reason && (reason !== OTHER_TRIAGE_REASON || row.wmkf_denialnotes === notes)) return;
  await beforeWrite();
  try {
    await updateById(requestId, patch, { ifMatch: version, actingUserSystemId: actor, noFallback: true });
  } catch (error) {
    if (error?.status === 412) fail('The request changed. Reload the saved reason before trying again.', 409);
    throw error;
  }
}
