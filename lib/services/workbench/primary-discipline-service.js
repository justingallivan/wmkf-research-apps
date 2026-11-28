/**
 * A request's primary discipline: `akoya_request.wmkf_programareaserved`, a lookup
 * to a Discipline row of the Keywords table (`wmkf_programlevel3`). Power Automate
 * step 3 sets it to Claude's pick; staff may repoint it here (owner, 2026-11-27:
 * any staff with Workbench access). The proposal lists place a proposal by this
 * lookup (list-snapshot-service.js SECTION_KEYWORD_LOOKUP), so a change moves it.
 *
 * Caller supplies a trusted DAL context and session-derived identity. Writes are
 * attributed to the caller (impersonation), fenced by the request ETag, accept only
 * a Discipline keyword id, and touch only this lookup. Navigation property and
 * keyword-type value from the owner-run metadata probe, 2026-11-27:
 * `wmkf_ProgramAreaServed`, Discipline = 682090000.
 */
import { getById, updateById } from '../../dataverse/adapters/grant-request';
import { listAll, ENTITY_SET_NAME as KEYWORD_ENTITY_SET } from '../../dataverse/adapters/keyword';
import { isGuid } from '../../utils/guid';
import { isDataverseRecordNotFound } from '../../dataverse/core/errors';
import { ServiceHttpError } from '../service-http-error';
import { resolvePreviewReadOnly } from './preview-read-only';

export const DISCIPLINE_KEYWORD_TYPE = 682090000;
export const PRIMARY_DISCIPLINE_NAV = 'wmkf_ProgramAreaServed';
const SELECT = 'akoya_requestid,_wmkf_programareaserved_value';

const conflict = () => new ServiceHttpError(
  'The request changed. Reload the primary discipline and choose again.',
  { httpStatus: 409 },
);

async function readRequest(requestId) {
  if (!isGuid(requestId)) throw new ServiceHttpError('requestId must be a GUID.', { httpStatus: 400 });
  const row = await getById(requestId, { select: SELECT }).catch((error) => {
    if (isDataverseRecordNotFound(error)) return null;
    throw error;
  });
  if (!row?.akoya_requestid) throw new ServiceHttpError('Request not found.', { httpStatus: 404 });
  return row;
}

function canEdit(callerSystemId) {
  return isGuid(callerSystemId) && !resolvePreviewReadOnly()
    && process.env.DYNAMICS_IMPERSONATION_ENABLED === 'true';
}

/**
 * Research disciplines: active Discipline keywords that carry a discipline
 * branch, the rule the proposal lists use to place a proposal
 * (list-snapshot-service.js buildKeywordIndex) plus active state (statecode 0),
 * so a retired keyword cannot be newly chosen. Coined Needs Review and legacy
 * rows carry no branch, so they are not offered and would land in Unassigned.
 * A request that already points at a retired keyword still shows its name.
 * Sorted by group, then name.
 */
async function disciplineOptions() {
  const result = await listAll();
  if (!Array.isArray(result?.records) || result.capped) throw new Error('Keyword list is incomplete.');
  return result.records
    .filter((row) => row?.wmkf_keywordtype === DISCIPLINE_KEYWORD_TYPE && row.statecode === 0
      && isGuid(row.wmkf_programlevel3id)
      && typeof row.wmkf_name === 'string' && row.wmkf_name.trim()
      && typeof row.wmkf_keyworddisciplinebranch_formatted === 'string' && row.wmkf_keyworddisciplinebranch_formatted.trim())
    .map((row) => ({
      id: row.wmkf_programlevel3id.toLowerCase(),
      name: row.wmkf_name.trim(),
      group: (typeof row.wmkf_keyworddisciplinegroup_formatted === 'string' && row.wmkf_keyworddisciplinegroup_formatted.trim()) || 'Other',
    }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

/** The discipline in effect; `withOptions` adds the picker list (read only when editing starts). */
export async function readPrimaryDiscipline({ requestId, callerSystemId, withOptions = false }) {
  const [row, options] = await Promise.all([readRequest(requestId), withOptions ? disciplineOptions() : null]);
  const id = row._wmkf_programareaserved_value ? row._wmkf_programareaserved_value.toLowerCase() : null;
  return {
    success: true,
    requestId: row.akoya_requestid,
    version: row._etag || null,
    canEdit: canEdit(callerSystemId),
    current: id ? { id, name: row._wmkf_programareaserved_value_formatted || null } : null,
    ...(options ? { options } : {}),
  };
}

export async function savePrimaryDiscipline({ requestId, callerSystemId, version, disciplineId }) {
  if (typeof version !== 'string' || !/^W\/"[0-9]+"$/.test(version)) {
    throw new ServiceHttpError('A concrete request version is required.', { httpStatus: 400 });
  }
  if (!isGuid(disciplineId)) throw new ServiceHttpError('Choose a discipline from the list.', { httpStatus: 400 });
  if (!canEdit(callerSystemId)) {
    throw new ServiceHttpError('Changing the primary discipline needs a linked staff identity.', { httpStatus: 403 });
  }
  const [row, options] = await Promise.all([readRequest(requestId), disciplineOptions()]);
  const chosen = options.find((option) => option.id === disciplineId.toLowerCase());
  if (!chosen) throw new ServiceHttpError('Choose a discipline from the list.', { httpStatus: 400 });
  if (row._etag !== version) throw conflict();
  if ((row._wmkf_programareaserved_value || '').toLowerCase() !== chosen.id) {
    try {
      await updateById(requestId, { [`${PRIMARY_DISCIPLINE_NAV}@odata.bind`]: `/${KEYWORD_ENTITY_SET}(${chosen.id})` },
        { ifMatch: version, actingUserSystemId: callerSystemId, noFallback: true });
    } catch (error) {
      if (error?.status === 412) throw conflict();
      throw error;
    }
  }
  return { success: true, requestId };
}
