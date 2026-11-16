/**
 * Optional Request narrative text: explicit staff saves only, no generation.
 * Caller supplies a trusted DAL context and session-derived identity. Reads are
 * organization-open like resolve-request; writes require the lead PD/superuser.
 * A concrete request ETag fences authorization and text together; no retries.
 */
import { getById, updateById } from '../../dataverse/adapters/grant-request';
import { getUserRole } from '../../utils/auth';
import { isGuid } from '../../utils/guid';
import { isDataverseRecordNotFound } from '../../dataverse/core/errors';
import { ServiceHttpError } from '../service-http-error';
import { resolvePreviewReadOnly } from './preview-read-only';
import { REQUEST_NARRATIVE_FIELDS, REQUEST_NARRATIVE_MAX_LENGTH } from '../../../shared/config/requestNarratives';

const SELECT = ['akoya_requestid', '_wmkf_programdirector_value',
  ...Object.values(REQUEST_NARRATIVE_FIELDS).map(field => field.column)].join(',');
const conflict = () => new ServiceHttpError(
  'The request changed. Your draft has been kept. Reload the saved text and review it before saving again.',
  { httpStatus: 409 },
);

async function readRequest(requestId) {
  if (!isGuid(requestId)) throw new ServiceHttpError('requestId must be a GUID.', { httpStatus: 400 });
  const row = await getById(requestId, { select: SELECT }).catch(error => {
    if (isDataverseRecordNotFound(error)) return null;
    throw error;
  });
  if (!row?.akoya_requestid) throw new ServiceHttpError('Request not found.', { httpStatus: 404 });
  return row;
}

async function canEdit(row, profileId, callerSystemId) {
  if (!isGuid(callerSystemId) || resolvePreviewReadOnly()
    || process.env.DYNAMICS_IMPERSONATION_ENABLED !== 'true') return false;
  return row._wmkf_programdirector_value?.toLowerCase() === callerSystemId.toLowerCase()
    || await getUserRole(profileId) === 'superuser';
}

export async function readRequestNarratives({ requestId, profileId, callerSystemId }) {
  const row = await readRequest(requestId);
  return {
    success: true, requestId: row.akoya_requestid, version: row._etag || null,
    canEdit: await canEdit(row, profileId, callerSystemId),
    ...Object.fromEntries(Object.entries(REQUEST_NARRATIVE_FIELDS).map(([key, field]) => [key, row[field.column] ?? null])),
  };
}

export async function saveRequestNarratives({ requestId, profileId, callerSystemId, version, changes }) {
  if (typeof version !== 'string' || !/^W\/"[0-9]+"$/.test(version)) {
    throw new ServiceHttpError('A concrete request version is required.', { httpStatus: 400 });
  }
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)
    || !Object.keys(changes).length || Object.entries(changes).some(([key, value]) => (
      !Object.hasOwn(REQUEST_NARRATIVE_FIELDS, key)
      || (value !== null && (typeof value !== 'string' || value.length > REQUEST_NARRATIVE_MAX_LENGTH))
    ))) throw new ServiceHttpError('Supply only the optional narrative text fields (up to 100,000 characters each).', { httpStatus: 400 });
  const row = await readRequest(requestId);
  if (!await canEdit(row, profileId, callerSystemId)) {
    throw new ServiceHttpError('Only the lead Program Director or a superuser with a linked staff identity can edit these fields.', { httpStatus: 403 });
  }
  if (row._etag !== version) throw conflict();
  // Only explicitly changed keys participate. Omitted fields and other Request
  // content are never sent to Dataverse, and whitespace is preserved verbatim.
  const patch = Object.fromEntries(Object.entries(changes)
    .filter(([key, value]) => (row[REQUEST_NARRATIVE_FIELDS[key].column] ?? '') !== (value ?? ''))
    .map(([key, value]) => [REQUEST_NARRATIVE_FIELDS[key].column, value === '' ? null : value]));
  if (Object.keys(patch).length) {
    try {
      await updateById(requestId, patch, { ifMatch: version, actingUserSystemId: callerSystemId, noFallback: true });
    } catch (error) {
      if (error?.status === 412) throw conflict();
      throw error;
    }
  }
  // Do not turn a successful PATCH into a reported failed save if a second read
  // fails. The client separately reloads and requires a fresh version to save.
  return { success: true, requestId };
}
