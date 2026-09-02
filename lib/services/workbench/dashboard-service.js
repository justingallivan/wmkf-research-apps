/**
 * Workbench — Tier-2 Request Workbench dashboard feed service
 * (Route→Service Consolidation Plan, Stage 4 wave).
 *
 * Holds ALL business logic for GET /api/workbench/dashboard; the route is a
 * thin shell (method dispatch, auth, session-email validation, DAL context,
 * HTTP mapping).
 *
 * Two modes (mirrors my-proposals.js):
 *   no cycleCode → { cycles, defaultCycleCode } the user can pick.
 *   cycleCode    → { proposals, rollup } for that cycle.
 *
 * TRIAGE-DRIVEN VISIBILITY (S261 — replaced the d26Allowlist union): the default
 * view shows the going-forward set (`wmkf_triagestatus = Advancing`) plus the
 * normal reviewer-finding surface (`akoya_requeststatus = 'Phase II Pending'`).
 * `Set aside` is hidden unless includeSetAside. An UNTRIAGED row shows ONLY if
 * it is `Phase II Pending` (the normal reviewer-finding surface); untriaged
 * NON-Phase-II rows — notably every Concept-stage row the coarse meeting-date
 * cycle filter also matches — are never shown (not reviewer-finding targets).
 * The cycle picker derives organization-wide cycles from the same visibility
 * predicate as the proposal feed. It still prefers the caller's newest active
 * assignment as its default. my-proposals.js is untouched.
 *
 * Contract (plan Decision 3):
 *   - takes a plain argument object, never req/res;
 *   - returns the plain 200 response body;
 *   - throws ServiceHttpError 404 (no active systemuser) / 400 (bad cycleCode)
 *     with the default `{ error: message }` envelope;
 *   - ASSUMES a trusted DAL context already exists — never establishes one.
 */

import { getUserRole } from '../../utils/auth';
import { resolveByEmail } from '../program-director-resolver';
import { meetingDateToCycleCode, cycleCodeToOdataFilter, cycleCodeToLabel } from '../../utils/cycle-code';
import { TRIAGE_STATUS } from '../../../shared/config/triageStatus';
// Reviewer rollup + work-remaining derivation are shared with the per-request
// Overview tab (via /api/workbench/reviewer-rollup); single source of truth.
import { fetchReviewerRollup, deriveWorkRemaining, emptyCounts, REVIEWERS_NEEDED } from '../reviewer-rollup';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import { ServiceHttpError } from '../service-http-error';

const PROPOSAL_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'wmkf_meetingdate',
  'akoya_requeststatus',
  'wmkf_phaseiistatus',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
  '_wmkf_projectleader_value',
  '_wmkf_grantprogram_value',
  '_wmkf_programareaserved_value',
  '_wmkf_programdirector_value',
  'wmkf_triagestatus',
].join(',');

/**
 * Build the dashboard feed (cycle-list mode or proposal-list mode).
 *
 * @param {Object} args
 * @param {string} args.azureEmail - session email (shell already 400s when absent)
 * @param {string|number|null} args.profileId
 * @param {string|null} args.callerSystemId - session-minted Dynamics systemuser id
 * @param {string|undefined} args.cycleCode - omit → cycle-list mode
 * @param {'my'|'all'} args.scope
 * @param {boolean} args.includeSetAside
 * @returns {Promise<Object>} the 200 response body
 * @throws {ServiceHttpError} 404 no active systemuser; 400 invalid cycleCode
 */
export async function loadDashboard({ azureEmail, profileId, callerSystemId, cycleCode, scope, includeSetAside }) {
  const pd = await resolveByEmail(azureEmail);
  if (!pd?.systemuserid) {
    throw new ServiceHttpError(`No active Dynamics systemuser found for ${azureEmail}.`, { httpStatus: 404 });
  }
  const isSuperuser = (await getUserRole(profileId)) === 'superuser';

  if (!cycleCode) {
    return listCycles(pd, callerSystemId);
  }
  return listProposals(pd, String(cycleCode), scope, includeSetAside, isSuperuser, callerSystemId);
}

/**
 * The one Workbench request-visibility predicate. Set aside wins over the
 * Phase-II branch unless the caller explicitly asks for it.
 */
function buildVisibilityFilter(includeSetAside) {
  const base = `akoya_requeststatus eq 'Phase II Pending' or wmkf_triagestatus eq ${TRIAGE_STATUS.ADVANCING}`;
  return includeSetAside
    ? `(${base} or wmkf_triagestatus eq ${TRIAGE_STATUS.SET_ASIDE})`
    : `(${base}) and (wmkf_triagestatus eq null or wmkf_triagestatus ne ${TRIAGE_STATUS.SET_ASIDE})`;
}

/**
 * Cycle-picker source: every organization-wide cycle containing a Workbench-
 * eligible request. Scope narrows the proposal list, never the picker.
 */
async function listCycles(pd, callerSystemId) {
  const result = await grantRequestAdapter.queryAllRequests({
    select: [
      'akoya_requestid',
      'wmkf_meetingdate',
      'akoya_requeststatus',
      '_wmkf_programdirector_value',
      'wmkf_triagestatus',
    ].join(','),
    filter: `wmkf_meetingdate ne null and ${buildVisibilityFilter(true)}`,
    orderby: 'wmkf_meetingdate desc',
  });
  if (result.capped) {
    throw new ServiceHttpError('The cycle list is temporarily incomplete. Please try again later.', {
      httpStatus: 503,
    });
  }
  const records = result.records || [];

  const seen = new Map(); // code → { code, label, year, month, count, setAsideCount }
  const personalActiveCycles = new Set();
  for (const r of records) {
    const code = meetingDateToCycleCode(r.wmkf_meetingdate);
    if (!code) continue;
    let existing = seen.get(code);
    if (!existing) {
      const d = new Date(r.wmkf_meetingdate);
      existing = {
        code,
        label: cycleCodeToLabel(code),
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        count: 0,
        setAsideCount: 0,
      };
      seen.set(code, existing);
    }

    const setAside = r.wmkf_triagestatus === TRIAGE_STATUS.SET_ASIDE;
    if (setAside) {
      existing.setAsideCount += 1;
    } else {
      existing.count += 1;
      const leadPd = r._wmkf_programdirector_value;
      if (leadPd && callerSystemId
        && String(leadPd).toLowerCase() === String(callerSystemId).toLowerCase()) {
        personalActiveCycles.add(code);
      }
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
    defaultCycleCode: cycles.find((cycle) => personalActiveCycles.has(cycle.code))?.code
      || cycles.find((cycle) => cycle.count > 0)?.code
      || cycles[0]?.code
      || null,
  };
}

async function listProposals(pd, cycleCode, scope, includeSetAside, isSuperuser, callerSystemId) {
  const cycleFilter = cycleCodeToOdataFilter(cycleCode);
  if (!cycleFilter) {
    throw new ServiceHttpError(`Invalid cycleCode: ${cycleCode}`, { httpStatus: 400 });
  }

  // ── Triage-driven visibility (S261 — replaces the d26Allowlist union) ──
  // Default view = the going-forward set (`wmkf_triagestatus = Advancing`) plus
  // the normal reviewer-finding surface (`akoya_requeststatus = 'Phase II Pending'`).
  // `Set aside` is hidden unless includeSetAside. An UNTRIAGED row shows only via
  // the Phase II Pending status branch; untriaged NON-Phase-II rows — every
  // Concept-stage row the coarse meeting-date cycle filter also matches — are never
  // shown (not reviewer-finding targets). The OR groups are parenthesized so they
  // can't leak past the cycle/scope ANDs.
  //
  // Hide-Set-aside uses the null-inclusive pattern (`eq null or ne <Set aside>`,
  // mirroring reviewer-suggestion.js notExcludedFilter) so a Set-aside row is hidden
  // even when it also matches the Phase II Pending status clause (Set aside wins).
  const visibility = buildVisibilityFilter(includeSetAside);

  const filters = [`(${cycleFilter})`, visibility];
  if (scope === 'my') filters.push(`_wmkf_programdirector_value eq ${pd.systemuserid}`);

  const { records } = await grantRequestAdapter.queryAllRequests({
    select: PROPOSAL_SELECT,
    filter: filters.join(' and '),
    orderby: 'akoya_requestnum asc',
  });

  const requestIds = records.map((r) => r.akoya_requestid).filter(Boolean);
  const counts = await fetchReviewerRollup(requestIds);

  const proposals = records.map((row) => (
    projectProposal(row, counts[row.akoya_requestid], isSuperuser, callerSystemId)
  ));

  // Stable order: number ascending.
  proposals.sort((a, b) => String(a.requestNumber).localeCompare(String(b.requestNumber)));

  return {
    success: true,
    programDirector: { systemuserid: pd.systemuserid, fullName: pd.fullName },
    cycleCode: cycleCode.toUpperCase(),
    cycleLabel: cycleCodeToLabel(cycleCode),
    scope,
    includeSetAside: !!includeSetAside,
    rollup: summarize(proposals),
    proposals,
  };
}

function projectProposal(r, c, isSuperuser, callerSystemId) {
  const counts = c || emptyCounts();
  const cycleCode = r.wmkf_meetingdate ? meetingDateToCycleCode(r.wmkf_meetingdate) : null;
  const triageStatus = typeof r.wmkf_triagestatus === 'number' ? r.wmkf_triagestatus : null;
  const canManage = isSuperuser || (
    !!r._wmkf_programdirector_value
    && String(r._wmkf_programdirector_value).toLowerCase() === String(callerSystemId).toLowerCase()
  );
  return {
    requestId: r.akoya_requestid,
    requestNumber: r.akoya_requestnum,
    cycleCode,
    cycleLabel: cycleCode ? cycleCodeToLabel(cycleCode) : null,
    meetingDate: r.wmkf_meetingdate || null,
    requestStatus: r.akoya_requeststatus || null,
    phaseIIStatus: r.wmkf_phaseiistatus_formatted || null,
    institution: r.wmkf_organizationname || r._akoya_applicantid_value_formatted || null,
    applicant: r._akoya_applicantid_value_formatted || null,
    projectLeader: r._wmkf_projectleader_value_formatted || null,
    grantProgram: r._wmkf_grantprogram_value_formatted || null,
    programArea: r._wmkf_programareaserved_value_formatted || null,
    programDirector: r._wmkf_programdirector_value_formatted || null,
    // Server-computed visible gate for the per-row triage flip. Matches the
    // authoritative POST /api/workbench/triage lead-PD/superuser gate.
    canManage,
    // Triage state (S261, replaces `allowlisted`). `advancing` = the going-forward
    // pill; `setAside` rows only appear when includeSetAside.
    triageStatus,
    advancing: triageStatus === TRIAGE_STATUS.ADVANCING,
    setAside: triageStatus === TRIAGE_STATUS.SET_ASIDE,
    reviewers: {
      ...counts,
      needed: REVIEWERS_NEEDED,
    },
    // Coarse work-remaining cue for the dashboard row. Richer per-stage state
    // (overdue, recommended-but-unenriched) lands with the Manage/Find panels.
    workRemaining: deriveWorkRemaining(counts),
  };
}

function summarize(proposals) {
  const stages = { find: 0, invite: 0, awaiting: 0, review: 0, done: 0 };
  for (const p of proposals) stages[p.workRemaining] = (stages[p.workRemaining] || 0) + 1;
  return { total: proposals.length, stages };
}
