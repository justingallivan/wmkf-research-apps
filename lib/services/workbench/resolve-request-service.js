/**
 * Workbench — request resolution + header/Proposal-tab context service
 * (Route→Service Consolidation Plan, Stage 4 wave).
 *
 * Holds ALL business logic for GET /api/workbench/resolve-request; the route
 * is a thin shell (method dispatch, auth, input validation, DAL context, HTTP
 * mapping). Resolves a human-typed/linked request NUMBER (akoya_requestnum, a
 * STRING field) or GUID to the record the Workbench page is keyed on, plus
 * light context for the header, the Overview tab, and the Proposal tab.
 *
 * Contract (plan Decision 3): plain args, plain 200 body, ServiceHttpError
 * 404 (default `{ error }` envelope) when nothing resolves; ASSUMES a trusted
 * DAL context already exists.
 */

import { workbenchPhaseReleaseAdmitted } from '../../utils/workbench-phase-release.js';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request';
import { cycleCodeToLabel } from '../../utils/cycle-code';
import { getCycleDatesById, LINKED_CYCLE_ID_FIELD, linkedCycleCode, linkedCycleExpand } from '../../dataverse/adapters/operations-grant-cycle';
import { CYCLE_CALENDAR_BOARD_DATE } from '../../../shared/config/cycleCalendar';
import { fetchCoPIs } from '../proposal-participants';
import { classifyStatus, STATUS_CLASS } from '../dataverse-export/constants';
import { ServiceHttpError } from '../service-http-error';
import { requestInstitution } from '../../../shared/utils/institution';
import { testRequestVisibilityDto, withTestRequestIsolationSelect } from '../test-requests/isolation.js';
import { isJ27ScopeCycle } from './j27-read-model';
import { loadJ27LaterFacts } from './j27-later-facts';
import { deriveJ27ForRow, j27CalendarInput, loadJ27Facts, isoDate, withJ27ReadModelSelect } from './j27-read-model-inputs';
import { resolveDiscoveryScope } from './program-scope-service';

const SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  LINKED_CYCLE_ID_FIELD,
  'akoya_requeststatus',
  'wmkf_phaseistatus',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
  '_wmkf_projectleader_value',
  '_wmkf_grantprogram_value',
  '_wmkf_programdirector_value',
  // Proposal-tab top section (S258). akoya_request = Requested Amount,
  // akoya_expenses = Total Project Budget (verified live on 1002836). Use the
  // non-_base fields; _base are the transaction-currency shadows.
  'wmkf_abstract',
  'akoya_request',
  'akoya_expenses',
  // Proposal-tab AI section.
  'wmkf_ai_fitrationale',
  'wmkf_ai_summary',
  'wmkf_ai_dataextract',
  // Persisted Field Primer JSON envelope (PD-triggered generate writes it via
  // /api/field-primer/generate; null until generated).
  'wmkf_ai_fieldprimer',
].join(',');

/**
 * Resolve by GUID (the Workbench route always has it) OR by human request
 * number (dashboard links / typed). GUID is preferred so the per-request shell
 * can always load context (Codex S209 catch). Exactly one of the two is
 * required (the shell enforces presence + GUID validity).
 *
 * @param {Object} args
 * @param {string} args.requestId - GUID or '' (already validated by the shell)
 * @param {string} args.requestNumber - human number or ''
 * @returns {Promise<Object>} the 200 response body
 * @throws {ServiceHttpError} 404 when nothing resolves
 */
export async function resolveWorkbenchRequest({ requestId, requestNumber, today = new Date() }) {
  let r = null;
  // Outside the try: a restriction refusal is not a missing request.
  const expand = linkedCycleExpand();
  // The J27 read model's request fields and the provisioned memo columns ride
  // the same read (plan C7: no extra Dataverse read for them).
  const select = withJ27ReadModelSelect(withTestRequestIsolationSelect(SELECT));
  if (requestId) {
    try {
      r = await grantRequestAdapter.getById(requestId, { select, expand });
    } catch (e) {
      r = null; // fall through to 404
    }
  } else {
    const { records } = await grantRequestAdapter.findByRequestNumber(requestNumber, {
      select, expand, top: 1,
    });
    r = records[0];
  }
  if (!r) {
    throw new ServiceHttpError(`No request found for ${requestId || `number ${requestNumber}`}`, { httpStatus: 404 });
  }

  const cycleCode = linkedCycleCode(r);
  // Overview "Board Meeting" is the linked cycle's calendar Board date; no
  // cycle, no calendar date, or a failed calendar read shows "Not set". Co-PIs
  // from the junction (names only). Both are non-critical — a failure must not
  // 500 the header/context load.
  // The J27 read model adds two Dataverse reads (any suggestion; the program
  // catalog for the Research scope, plan F1) and
  // one Postgres read (latest integrity state), both only for J27+ rows; the
  // calendar keys come from the cycle read already made here.
  const inScope = workbenchPhaseReleaseAdmitted() && isJ27ScopeCycle(cycleCode);
  const [cycle, coPIs, facts, later, scope] = await Promise.all([
    cycleCode ? getCycleDatesById(r[LINKED_CYCLE_ID_FIELD]).catch(() => null) : null,
    fetchCoPIs(r.akoya_requestid).catch(() => []),
    inScope ? loadJ27Facts([r.akoya_requestid]) : null,
    // Later-phase facts (three reads), so the page's first render has what the cycle list has.
    inScope ? loadJ27LaterFacts([r], { now: () => today.getTime() }) : null,
    // Readiness-only program scope (Research by catalog name); a failed read yields no stage.
    inScope ? resolveDiscoveryScope().catch(() => ({ readinessOnlyProgramIds: [] })) : null,
  ]);
  const boardDate = cycle?.[CYCLE_CALENDAR_BOARD_DATE.column] || null;
  const j27 = inScope ? deriveJ27ForRow(r, facts, { calendar: j27CalendarInput(cycle, isoDate(today)), scope, later }) : null;
  return {
    success: true,
    requestId: r.akoya_requestid,
    requestNumber: r.akoya_requestnum,
    title: r.akoya_title || null,
    cycleCode,
    ...(isJ27ScopeCycle(cycleCode) ? {
      phaseIStatus: r.wmkf_phaseistatus ?? null,
      phaseIStatusLabel: r.wmkf_phaseistatus_formatted || null,
      requestVersion: r._etag || null,
    } : {}),
    cycleLabel: cycleCode ? cycleCodeToLabel(cycleCode) : null,
    // The linked cycle's calendar Board date (not the request's own meeting date).
    meetingDate: boardDate,
    requestStatus: r.akoya_requeststatus || null,
    // Overview: canonical class for the read-only request status display,
    // via the shared akoya_requeststatus value→class map. A status present
    // but absent from the authoritative map ⇒ UNCLASSIFIED (shown raw, never
    // coerced); null status ⇒ null. The board decides; the Workbench only
    // reflects this string. See lib/services/dataverse-export/constants.js.
    statusClass: r.akoya_requeststatus
      ? (classifyStatus(r.akoya_requeststatus)?.class || STATUS_CLASS.UNCLASSIFIED)
      : null,
    institution: requestInstitution(r),
    applicant: r._akoya_applicantid_value_formatted || null,
    projectLeader: r._wmkf_projectleader_value_formatted || null,
    grantProgram: r._wmkf_grantprogram_value_formatted || null,
    programDirector: r._wmkf_programdirector_value_formatted || null,
    // Raw lead-PD systemuser GUID — feeds the Workbench's soft `canManage`
    // UI gate (compare against the session's dynamicsSystemuserId). Server
    // stays org-open; this is cosmetic. See REQUEST_WORKBENCH_BUILD_PLAN §Phase 2.
    programDirectorId: r._wmkf_programdirector_value || null,
    // Proposal tab — top section (S258). PI mirrors projectLeader (the
    // wmkf_projectleader lookup); amounts are Money numbers (or null).
    proposalInfo: {
      pi: r._wmkf_projectleader_value_formatted || null,
      coPIs,
      abstract: r.wmkf_abstract || null,
      requestedAmount: r.akoya_request ?? null,
      totalProjectBudget: r.akoya_expenses ?? null,
    },
    // Proposal tab — AI section (existing live fields; dataExtract is a JSON
    // string the client parses).
    aiContent: {
      fitRationale: r.wmkf_ai_fitrationale || null,
      summary: r.wmkf_ai_summary || null,
      dataExtract: r.wmkf_ai_dataextract || null,
      fieldPrimer: r.wmkf_ai_fieldprimer || null, // JSON envelope string (or null)
    },
    ...testRequestVisibilityDto(r),
    // Read model (plan C7): present only for J27+ rows so earlier cycles'
    // DTOs are unchanged. `input` is tier 1 so the page can recompute with the
    // same pure function as its own reads land (step E).
    ...(j27 ? { j27 } : {}),
  };
}
