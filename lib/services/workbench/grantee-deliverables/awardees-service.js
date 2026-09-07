/**
 * Workbench grantee-deliverables — research-awardee list service
 * (Route→Service Consolidation Plan, Stage 4 series C).
 *
 * Holds ALL business logic for GET /api/workbench/grantee-deliverables/
 * awardees; the route is a thin shell (method, auth, cycleCode + config
 * validation, DAL context, HTTP mapping).
 *
 * Eligibility (confirmed S268 against live J26, owner-validated = 12):
 *   akoya_requeststatus = 'Active' AND akoya_programid ∈
 *   GRANTEE_RESEARCH_PROGRAM_IDS AND wmkf_projectleader present.
 * Scope (S271): defaults to the LOGGED-IN user's awardees; scope=all lists
 * every research awardee. The PD systemuserid is server-resolved from the
 * session email (resolveByEmail) — never client-supplied.
 *
 * Contract (plan Decision 3): plain args, plain 200 body (both the
 * pdResolved:false empty list and the full list are 200s). Incomplete source
 * scans throw a typed 503 so the shell can preserve an explicit retryable
 * response; other failures propagate untyped for the shell's sanitized 500.
 * ASSUMES a trusted DAL context already exists.
 */

import * as grantRequestAdapter from '../../../dataverse/adapters/grant-request.js';
import { resolveByEmail } from '../../program-director-resolver';
import { getDeliverableForRequest } from '../../grantee-deliverable-record';
import { ServiceHttpError } from '../../service-http-error';
import { cycleCodeToOdataFilter, cycleCodeToLabel } from '../../../utils/cycle-code';
import { GRANTEE_RESEARCH_PROGRAM_IDS, GRANTEE_AWARDED_STATUS } from '../../../../shared/config/granteeResearchPrograms';
import { GRANTEE_DELIVERABLE_LABEL } from '../../../../shared/config/granteeDeliverableStatus';

const SELECT = [
  'akoya_requestid', 'akoya_requestnum', 'akoya_title',
  '_wmkf_projectleader_value', '_akoya_primarycontactid_value', '_akoya_programid_value',
  'wmkf_abstractformatted',
].join(',');

const DELIVERABLE_CONCURRENCY = 4;

const normStatus = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

async function loadDeliverables(records) {
  const deliverables = new Array(records.length).fill(null);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= records.length) return;
      deliverables[index] = await getDeliverableForRequest(records[index].akoya_requestid).catch(() => null);
    }
  }

  await Promise.all(Array.from({
    length: Math.min(DELIVERABLE_CONCURRENCY, records.length || 1),
  }, () => worker()));
  return deliverables;
}

/**
 * @param {Object} args
 * @param {string} args.cycleCode - already validated by the shell
 * @param {boolean} args.showAll - ?scope=all
 * @param {string|null} args.azureEmail - session email (server-side PD anchor)
 * @returns {Promise<Object>} the 200 response body
 */
export async function listGranteeAwardees({ cycleCode, showAll, azureEmail }) {
  const cycleFilter = cycleCodeToOdataFilter(cycleCode, 'wmkf_meetingdate');
  const programClause = GRANTEE_RESEARCH_PROGRAM_IDS.map((id) => `_akoya_programid_value eq ${id}`).join(' or ');

  // Default scope = the logged-in user's awardees. PD systemuserid is
  // server-resolved from the session email (never client input).
  const pd = azureEmail ? await resolveByEmail(azureEmail).catch(() => null) : null;
  const scope = showAll ? 'all' : 'mine';

  // Mine-scope needs a resolved PD; without one we can't safely filter, so
  // return an empty list flagged so the UI can prompt "Show all".
  if (scope === 'mine' && !pd?.systemuserid) {
    return {
      cycleCode, cycleLabel: cycleCodeToLabel(cycleCode), count: 0, awardees: [],
      scope, pdResolved: false, programDirector: null,
    };
  }

  const filter =
    `${cycleFilter} and akoya_requeststatus eq '${GRANTEE_AWARDED_STATUS}'` +
    ` and _wmkf_projectleader_value ne null and (${programClause})` +
    (scope === 'mine' ? ` and _wmkf_programdirector_value eq ${pd.systemuserid}` : '');

  const result = await grantRequestAdapter.queryAllRequests({
    select: SELECT,
    filter,
    orderby: 'akoya_requestnum asc',
  });

  const records = result?.records;
  const totalCount = result?.totalCount;
  const incomplete = !Array.isArray(records)
    || result?.capped === true
    || result?.hasMore === true
    || (Number.isFinite(totalCount) && totalCount > records.length);
  if (incomplete) {
    throw new ServiceHttpError('Awardee list is temporarily incomplete. Please try again later.', {
      httpStatus: 503,
      body: { error: 'Awardee list is temporarily incomplete. Please try again later.', cycleCode },
    });
  }

  const deliverables = await loadDeliverables(records);

  const awardees = records.map((r, i) => {
    const status = normStatus(deliverables[i]?.wmkf_deliverablestatus);
    return {
      requestId: r.akoya_requestid,
      requestNumber: r.akoya_requestnum,
      title: r.akoya_title || null,
      pi: { contactId: r._wmkf_projectleader_value || null, name: r._wmkf_projectleader_value_formatted || null },
      liaison: { contactId: r._akoya_primarycontactid_value || null, name: r._akoya_primarycontactid_value_formatted || null },
      program: r._akoya_programid_value_formatted || null,
      status,
      statusLabel: status !== null ? (GRANTEE_DELIVERABLE_LABEL[status] || null) : null,
      abstractReady: Boolean(r.wmkf_abstractformatted),
    };
  });

  return {
    cycleCode, cycleLabel: cycleCodeToLabel(cycleCode), count: awardees.length, awardees,
    scope, pdResolved: scope === 'all' ? undefined : true,
    programDirector: pd?.systemuserid ? { name: pd.fullName || null } : null,
  };
}
