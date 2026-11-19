/**
 * Proposal list snapshot: every submitted Research proposal in one grant cycle,
 * read the same way for every caller (no Program Director, "my proposals", or
 * program picker scope), so a list never depends on who built it
 * (docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md).
 *
 * Membership mirrors the staff program briefing: Science and Engineering plus
 * Medical Research requests linked to the cycle that pass the Workbench
 * discovery predicate (for J27 and later, Power Automate readiness). An
 * incomplete or oversized read fails the whole snapshot; it is never truncated.
 *
 * `listKind` separates real proposals from Factory test requests. `ordinary`
 * keeps only ordinary requests; `test` keeps only marked test requests and
 * needs test-request isolation on, because the marker columns are selected
 * only then. Anomalous and unknown rows are left out of both.
 *
 * ASSUMES a trusted DAL context already exists.
 */
import * as grantRequests from '../../dataverse/adapters/grant-request.js';
import * as grantPrograms from '../../dataverse/adapters/grant-program.js';
import { RESEARCH_PROGRAM_IDS } from '../../../shared/config/researchPrograms.js';
import { withRequestReadinessSelect } from '../../../shared/config/requestReadiness.js';
import { buildDiscoveryFilter, isDiscoverableRequestRow, withDiscoverySelect } from '../../../shared/config/workbenchVisibility.js';
import { resolveDiscoveryScope } from '../workbench/program-scope-service.js';
import { requestInstitution } from '../../../shared/utils/institution.js';
import { linkedCycleCode, linkedCycleExpand, linkedCycleFilter } from '../../dataverse/adapters/operations-grant-cycle.js';
import {
  classifyTestRequestSnapshot,
  testRequestCountsAsOrdinary,
  testRequestIsolationEnabled,
  withTestRequestIsolationSelect,
} from '../test-requests/isolation.js';
import { ServiceHttpError } from '../service-http-error.js';
import { isGuid } from '../../utils/guid.js';
import { parseCycleCode } from '../../utils/cycle-code.js';

export const PROPOSAL_LIST_KINDS = Object.freeze(['ordinary', 'test']);
export const PROPOSAL_LIST_MAX_PROPOSALS = 600;
export const UNASSIGNED_SECTION = 'Unassigned';

/**
 * Where a proposal's section comes from. PLACEHOLDER: the request's program
 * area stands in until the keyword field and grouping from the intake flow are
 * known (plan, "Sections"). Staff see this label on the compose page so the
 * placeholder cannot quietly become the source for a real send.
 */
export const SECTION_SOURCE = Object.freeze({
  key: 'placeholder_program_area',
  label: 'Placeholder: the request’s program area. Keyword sections are not connected yet.',
  placeholder: true,
});

const SELECT = 'akoya_requestid,akoya_requestnum,akoya_title,_akoya_programid_value,_akoya_applicantid_value,_wmkf_projectleader_value,_wmkf_programareaserved_value,akoya_requeststatus,wmkf_triagestatus';

const DEFAULTS = Object.freeze({
  queryRequests: (options) => grantRequests.queryAllRequests(options),
  listPrograms: () => grantPrograms.listActive({ top: 100 }),
  isolationEnabled: () => testRequestIsolationEnabled(),
});

function fail(message, code, httpStatus = 503) {
  return new ServiceHttpError(message, { httpStatus, code, body: { error: message, code } });
}

export function sectionForRequest(row) {
  return String(row?._wmkf_programareaserved_value_formatted || '').trim() || UNASSIGNED_SECTION;
}

function keepRow(row, listKind) {
  if (listKind === 'test') return classifyTestRequestSnapshot(row).kind === 'synthetic';
  return testRequestCountsAsOrdinary(row);
}

/**
 * @param {{ cycleCode: string, listKind: 'ordinary'|'test' }} args
 * @returns {Promise<Array<{ requestId, requestNumber, title, institution, projectLeader, section }>>}
 */
export async function loadCycleProposalSnapshot({ cycleCode, listKind }, dependencies = DEFAULTS) {
  const code = String(cycleCode || '').trim().toUpperCase();
  if (!/^[JD]\d{2}$/.test(code)) throw fail('Choose a valid grant cycle.', 'proposal_list_cycle_invalid', 400);
  if (!PROPOSAL_LIST_KINDS.includes(listKind)) throw fail('Choose a valid list type.', 'proposal_list_kind_invalid', 400);
  if (listKind === 'test' && !dependencies.isolationEnabled()) {
    throw fail('Test request lists are not available in this environment.', 'proposal_list_test_unavailable', 409);
  }

  const programFilter = `(${RESEARCH_PROGRAM_IDS.map((id) => `_akoya_programid_value eq ${id}`).join(' or ')})`;
  const discoveryScope = await resolveDiscoveryScope({ listPrograms: dependencies.listPrograms });
  // For 2027 and later cycles a proposal is "submitted" by readiness alone. The
  // scope read falls back to an empty scope when the program catalog cannot be
  // read (or the phase release is not admitted); the legacy filter would then
  // return only triaged rows, and a rebuild would quietly drop the rest. Refuse.
  if (parseCycleCode(code).year >= 2027 && !(discoveryScope?.readinessOnlyProgramIds || []).length) {
    throw fail('The list of submitted proposals cannot be read right now. Try again.', 'proposal_list_scope_unavailable');
  }
  const result = await dependencies.queryRequests({
    select: withDiscoverySelect(withRequestReadinessSelect(withTestRequestIsolationSelect(SELECT))),
    expand: linkedCycleExpand(),
    filter: `${programFilter} and ${buildDiscoveryFilter(false, discoveryScope)} and (${linkedCycleFilter(code)})`,
    orderby: 'akoya_requestnum asc',
  });
  if (!Array.isArray(result?.records) || result.capped || result.hasMore) {
    throw fail('The proposal list is incomplete. Try again.', 'proposal_list_membership_incomplete');
  }
  if (result.records.some((row) => !isGuid(row.akoya_requestid)
    || !/^\d{1,12}$/.test(String(row.akoya_requestnum ?? ''))
    || linkedCycleCode(row) !== code)) {
    throw fail('The proposal list could not be verified. Try again.', 'proposal_list_membership_invalid');
  }
  const rows = result.records
    .filter((row) => isDiscoverableRequestRow(row, false, discoveryScope))
    .filter((row) => keepRow(row, listKind));
  if (rows.length > PROPOSAL_LIST_MAX_PROPOSALS) {
    throw fail('This cycle has more proposals than one list supports.', 'proposal_list_too_large', 413);
  }
  return rows.map((row) => ({
    requestId: row.akoya_requestid.toLowerCase(),
    requestNumber: String(row.akoya_requestnum),
    title: String(row.akoya_title || '').trim() || `Request ${row.akoya_requestnum}`,
    institution: requestInstitution(row),
    projectLeader: String(row._wmkf_projectleader_value_formatted || '').trim() || null,
    section: sectionForRequest(row),
  }));
}
