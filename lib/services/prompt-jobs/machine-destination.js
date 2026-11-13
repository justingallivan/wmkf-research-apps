/** Direct Request text destinations. Prompt metadata selects; server grant authorizes. No I/O. */
import { EXECUTIVE_SUMMARY_FIELD } from '../executive-summary-field.js';
export const LEGACY_TITLE_FIELD = 'wmkf_wmkfprojectdescription';
const FIELD = /^wmkf_[a-z0-9_]{1,122}$/;
export function validMachineDestination(field) {
  return typeof field === 'string' && field === field.trim() && FIELD.test(field) && field !== EXECUTIVE_SUMMARY_FIELD;
}
export function validateDestinationGrant(grant) {
  if (!grant || Object.keys(grant).sort().join(',') !== 'field,maxLength,type'
    || !validMachineDestination(grant.field) || !['String', 'Memo'].includes(grant.type)
    || !Number.isSafeInteger(grant.maxLength) || grant.maxLength < 2000 || grant.maxLength > 1000000) {
    throw new Error('Invalid machine destination grant');
  }
  return grant;
}
export function titleDestinationTarget(target) {
  if (target?.kind === 'none' && Object.keys(target).length === 1) return { field: LEGACY_TITLE_FIELD, legacy: true };
  if (target?.kind === 'akoya_request' && Object.keys(target).sort().join(',') === 'field,kind'
    && validMachineDestination(target.field)) return { field: target.field, legacy: false };
  throw new Error('Invalid machine destination target');
}
export function titlePromptDestination(promptRow) {
  const schema = JSON.parse(promptRow.wmkf_ai_promptoutputschema);
  if (!Array.isArray(schema?.outputs) || schema.outputs.length !== 1) throw new Error('Invalid machine output schema');
  return titleDestinationTarget(schema.outputs[0].target);
}
export function authorizedTitleDestination(promptRow, policy) {
  const destination = titlePromptDestination(promptRow);
  if (Object.hasOwn(policy, 'destinationGrant')) {
    const grant = validateDestinationGrant(policy.destinationGrant);
    if (destination.legacy || destination.field !== grant.field) throw new Error('Machine destination is not granted');
  } else if (!destination.legacy) throw new Error('Explicit machine destination requires a grant');
  return destination.field;
}
export function policyDestinationField(policy) {
  return Object.hasOwn(policy, 'destinationGrant') ? validateDestinationGrant(policy.destinationGrant).field : LEGACY_TITLE_FIELD;
}
export function validateDestinationMetadata(metadata, grant) {
  validateDestinationGrant(grant);
  if (!metadata || metadata.LogicalName !== grant.field || metadata.AttributeType !== grant.type
    || metadata.IsValidForRead !== true || metadata.IsValidForUpdate !== true || metadata.IsSecured !== false
    || metadata.RequiredLevel?.Value !== 'None' || metadata.AttributeOf !== null || metadata.SourceType !== 0
    || metadata.Format !== 'Text' || !Number.isSafeInteger(metadata.MaxLength) || metadata.MaxLength < grant.maxLength) {
    throw new Error('Machine destination metadata is incompatible');
  }
  return true;
}
