/**
 * PD discovery also requires Power Automate readiness for linked J27+ requests;
 * see shared/config/requestReadiness.js. Earlier linked cycles are unchanged.
 *
 * Reviewer Finder — my-proposals service
 * (Route→Service Consolidation Plan, Stage 3 wave).
 *
 * Holds ALL business logic for GET /api/reviewer-finder/my-proposals; the
 * route is a thin shell (method dispatch, auth, session-email check, DAL
 * context, HTTP mapping). Surfaces akoya_request rows assigned to the
 * authenticated user as program director (`wmkf_programdirector` lookup →
 * systemuser).
 *
 * No cycleCode: distinct cycle codes (Jxx/Dxx) the PD has proposals in,
 * newest first. With cycleCode: the proposals in that cycle.
 *
 * Filter: `_wmkf_programdirector_value eq {systemuserId}` — primary PD only.
 *   `wmkf_programdirector2` (secondary) does not assign reviewers; see memory
 *   `project_akoya_request_pd_fields.md`.
 *
 * Status filter (cycle mode):
 *   status=actionable (default) — proposals that need reviewers found:
 *     `akoya_requeststatus eq 'Phase II Pending'` AND no post-review disposition.
 *     Before J27: Phase II Status null only. J27 onward: null or Phase II
 *     Pending Committee Review, the pre-review value used on advanced requests.
 *     The readiness prerequisite still applies before suggestion hydration.
 *   status=all — every Phase II Pending proposal in the cycle. Concepts and
 *     Phase I-declined are always excluded since they never need outside reviewers.
 *
 * Contract (plan Decision 3):
 *   - takes a plain argument object, never req/res;
 *   - returns the exact 200 payload for either mode;
 *   - throws MyProposalsError (extends ServiceHttpError; default `{ error }`
 *     body) for 404 no-active-PD and 400 invalid-cycleCode;
 *   - other failures propagate untyped — the shell maps them to the
 *     historical sanitized 500;
 *   - ASSUMES a trusted DAL context already exists — never establishes one.
 */

import { isRequestReadyForStaff, withRequestReadinessSelect } from '../../../shared/config/requestReadiness.js';
import { PHASE_II_PENDING, isReadinessOnlyRow } from '../../../shared/config/workbenchVisibility.js';
import { resolveDiscoveryScope } from '../workbench/program-scope-service.js';
import { resolveByEmail } from '../program-director-resolver';
import { parseCycleCode } from '../../utils/cycle-code';
import {
  LINKED_CYCLE_ID_FIELD,
  linkedCycleCode,
  linkedCycleExpand,
  linkedCycleFilter,
} from '../../dataverse/adapters/operations-grant-cycle';
import { RESPONSE_TYPE_MAP, notExcludedFilter, queryAllSuggestions } from '../../dataverse/adapters/reviewer-suggestion';
import { queryAllRequests } from '../../dataverse/adapters/grant-request';
import { ServiceHttpError } from '../service-http-error';
import { chunk as chunked } from '../../utils/chunk.js';

// Verified option metadata: docs/atlas/dataverse-akoya-request.md (2026-10-26).
const PHASE_II_PENDING_COMMITTEE_REVIEW = 100000002;

/** Domain error; envelopes are plain `{ error }`, so no explicit body. */
export class MyProposalsError extends ServiceHttpError {
  constructor(message, httpStatus) {
    super(message, { httpStatus });
    this.name = 'MyProposalsError';
  }
}

/**
 * @param {Object} args
 * @param {string} args.azureEmail - session email (shell verified non-empty)
 * @param {string} [args.cycleCode] - Jxx/Dxx; absent → cycle list mode
 * @param {string} [args.status] - 'all' | anything else → 'actionable'
 * @returns {Promise<Object>} the exact 200 payload
 * @throws {MyProposalsError} 404 no active PD systemuser; 400 invalid cycleCode
 */
export async function getMyProposals({ azureEmail, cycleCode, status }) {
  const pd = await resolveByEmail(azureEmail);
  if (!pd) {
    throw new MyProposalsError(`No active Dynamics systemuser found for ${azureEmail}.`, 404);
  }

  if (!cycleCode) {
    return listCycles(pd);
  }
  const effectiveStatus = status === 'all' ? 'all' : 'actionable';
  return listProposalsInCycle(pd, String(cycleCode), effectiveStatus);
}

async function listCycles(pd) {
  // Pull all PD-owned proposals linked to a Grant Cycle and dedupe to their
  // linked cycle codes. Per Justin: ~6 proposals per cycle per PD, so even
  // across all history this is a small set. Rows with no link, or a historical
  // non-J/D linked code, have no cycle.
  const filter = `_wmkf_programdirector_value eq ${pd.systemuserid} and ${LINKED_CYCLE_ID_FIELD} ne null`;
  const result = await queryAllRequests({
    select: withRequestReadinessSelect('akoya_requestid'),
    expand: linkedCycleExpand(),
    filter,
    // Cycles are ordered in code below; this order only keeps paging deterministic.
    orderby: 'akoya_requestnum desc',
  });

  const records = readyRecords(result);
  const seen = new Map(); // code → { code, year, month, count }
  for (const r of records) {
    const code = linkedCycleCode(r);
    if (!code) continue;
    const existing = seen.get(code);
    if (existing) {
      existing.count += 1;
    } else {
      const { year, month } = parseCycleCode(code);
      seen.set(code, {
        code,
        year,
        month,
        count: 1,
      });
    }
  }

  const cycles = Array.from(seen.values()).sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
  });

  return {
    success: true,
    programDirector: { systemuserid: pd.systemuserid, fullName: pd.fullName },
    cycles,
  };
}

async function listProposalsInCycle(pd, cycleCode, status) {
  const parsedCycle = parseCycleCode(cycleCode);
  if (!parsedCycle) {
    throw new MyProposalsError(`Invalid cycleCode: ${cycleCode}`, 400);
  }
  const cycleFilter = linkedCycleFilter(cycleCode.trim().toUpperCase());

  // Always exclude concept and Phase I-declined — they never need outside
  // reviewers. Phase II Pending is the gate; for "actionable" we further
  // require no post-review disposition. J27 onward also uses an explicit
  // pre-review Phase II value. Keep the OR inside the PD/cycle/status ANDs.
  // Plan F2 / D1: a J27+ Research row (readiness-only program from the live
  // catalog) is admitted by `wmkf_readyforreview eq true` alone; every other
  // row keeps the Phase II Pending gate plus the readiness post-filter. The
  // `actionable` exclusion of a post-review Phase II disposition is a view
  // filter applied after admission on both branches, never a generic
  // Advancing / Set aside predicate.
  const discoveryScope = await resolveDiscoveryScope();
  const statusGate = `akoya_requeststatus eq '${PHASE_II_PENDING}'`;
  const researchReady = discoveryScope.readinessOnlyProgramIds.length
    ? `((${discoveryScope.readinessOnlyProgramIds.map((id) => `_wmkf_grantprogram_value eq ${id}`).join(' or ')}) and wmkf_readyforreview eq true)`
    : null;
  const admission = researchReady ? `(${researchReady} or (${statusGate}))` : `(${statusGate})`;
  const actionable = (row) => row.wmkf_phaseiistatus == null
    || (parsedCycle.year >= 2027 && row.wmkf_phaseiistatus === PHASE_II_PENDING_COMMITTEE_REVIEW);
  const admitted = (row) => (isReadinessOnlyRow(row, discoveryScope)
    ? row.wmkf_readyforreview === true
    : row.akoya_requeststatus === PHASE_II_PENDING && isRequestReadyForStaff(row));

  const filter = `_wmkf_programdirector_value eq ${pd.systemuserid} and ${cycleFilter} and ${admission}`;
  const result = await queryAllRequests({
    select: withRequestReadinessSelect([
      'akoya_requestid',
      'akoya_requestnum',
      'wmkf_abstract',
      'akoya_requeststatus',
      'wmkf_phaseiistatus',
      '_akoya_applicantid_value',
      '_wmkf_projectleader_value',
      '_wmkf_grantprogram_value',
      '_wmkf_programareaserved_value',
      '_wmkf_potentialreviewer1_value',
      '_wmkf_potentialreviewer2_value',
      '_wmkf_potentialreviewer3_value',
      '_wmkf_potentialreviewer4_value',
      '_wmkf_potentialreviewer5_value',
    ].join(',')),
    expand: linkedCycleExpand(),
    filter,
    // One cycle: its requests share the cycle's dates, so request number orders them.
    orderby: 'akoya_requestnum asc',
  });

  const records = completeRecords(result).filter(admitted).filter((row) => status !== 'actionable' || actionable(row));

  // Fetch reviewer-suggestion lifecycle counts from Dataverse, keyed by
  // request GUID. A request with no saved candidates won't have any
  // suggestion rows — treated as 0/0/0.
  const requestIds = records.map((r) => r.akoya_requestid).filter(Boolean);
  const counts = await fetchReviewerCounts(requestIds);

  const proposals = records.map((r) => {
    const slotsFilled = ['1', '2', '3', '4', '5'].filter(
      (n) => r[`_wmkf_potentialreviewer${n}_value`]
    ).length;
    const c = counts[r.akoya_requestid] || { invited: 0, accepted: 0, declined: 0, held: 0 };
    return {
      requestId: r.akoya_requestid,
      requestNumber: r.akoya_requestnum,
      reviewerInvited: c.invited,
      reviewerAccepted: c.accepted,
      reviewerDeclined: c.declined,
      reviewerHeld: c.held,
      abstract: r.wmkf_abstract || null,
      requestStatus: r.akoya_requeststatus || null,
      phaseIIStatus: r.wmkf_phaseiistatus_formatted || null,
      applicant: r._akoya_applicantid_value_formatted || null,
      projectLeader: r._wmkf_projectleader_value_formatted || null,
      grantProgram: r._wmkf_grantprogram_value_formatted || null,
      programArea: r._wmkf_programareaserved_value_formatted || null,
      reviewerSlotsFilled: slotsFilled,
      reviewerSlotsTotal: 5,
    };
  });

  return {
    success: true,
    programDirector: { systemuserid: pd.systemuserid, fullName: pd.fullName },
    cycleCode: cycleCode.toUpperCase(),
    status,
    proposals,
  };
}

/**
 * Aggregate reviewer-suggestion lifecycle counts (invited / accepted /
 * declined) by akoya_request GUID, scoped to selected=true rows in
 * `wmkf_appreviewersuggestion`. Staff-shared per the post-W1 model — no
 * per-user scoping (a request has one lead PD; the badge reflects the
 * proposal-level outreach state).
 *
 * Chunked at 25 request IDs per query to keep the OR-chain URL within
 * Dataverse limits (same pattern the suggestion adapter uses in findByPD).
 * Uses `queryAllRecords` (paginated) rather than `queryRecords` — the
 * latter silently caps `top` at 100 in `DynamicsService`, which would
 * undercount any chunk whose total rows exceed that.
 *
 * Throws on chunk failure rather than silently returning partial counts,
 * since the badges look authoritative in the UI and an undercount of
 * "invited" reviewers is worse than a clean 500.
 */
async function fetchReviewerCounts(requestIds) {
  if (!requestIds || requestIds.length === 0) return {};
  const out = {};
  const CHUNK = 25;
  for (const chunk of chunked(requestIds, CHUNK)) {
    const orChain = chunk.map((id) => `_wmkf_request_value eq ${id}`).join(' or ');
    const { records } = await queryAllSuggestions({
      select: '_wmkf_request_value,wmkf_invited,wmkf_accepted,wmkf_declined,wmkf_emailsentat,wmkf_responsetype',
      filter: `(${orChain}) and wmkf_selected eq true and ${notExcludedFilter()}`,
    });
    for (const s of records) {
      const rid = s._wmkf_request_value;
      if (!rid) continue;
      if (!out[rid]) out[rid] = { invited: 0, accepted: 0, declined: 0, held: 0 };
      if (s.wmkf_invited === true || s.wmkf_emailsentat) out[rid].invited += 1;
      if (s.wmkf_accepted === true || s.wmkf_responsetype === RESPONSE_TYPE_MAP.accepted) out[rid].accepted += 1;
      if (s.wmkf_declined === true || s.wmkf_responsetype === RESPONSE_TYPE_MAP.declined) out[rid].declined += 1;
      if (s.wmkf_responsetype === RESPONSE_TYPE_MAP.held) out[rid].held += 1;
    }
  }
  return out;
}

function completeRecords(result) {
  if (!Array.isArray(result?.records) || result.capped || result.hasMore) {
    throw new MyProposalsError('The proposal list is temporarily incomplete. Please try again later.', 503);
  }
  return result.records;
}

function readyRecords(result) {
  return completeRecords(result).filter(isRequestReadyForStaff);
}
