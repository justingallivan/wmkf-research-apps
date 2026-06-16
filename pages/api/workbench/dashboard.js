/**
 * API: /api/workbench/dashboard
 *
 * Tier-2 Request Workbench dashboard feed. Surfaces the requests a Program
 * Director needs to find reviewers for, in a chosen grant cycle, with a
 * per-request reviewer work-remaining rollup.
 *
 * Two modes (mirrors my-proposals.js):
 *   GET (no cycleCode)        → { cycles, defaultCycleCode } the user can pick.
 *   GET ?cycleCode=Dxx        → { proposals, rollup } for that cycle.
 *
 * Query params:
 *   ?cycleCode=Dxx|Jxx     the cycle to list (omit → cycle list mode)
 *   ?scope=my|all          my (default) = requests where the caller is lead PD;
 *                          all = every request in the cycle.
 *   ?includeSetAside=1     also show `Set aside` rows (default hides them).
 *
 * TRIAGE-DRIVEN VISIBILITY (S261 — replaced the d26Allowlist union): the default
 * view shows the going-forward set (`wmkf_triagestatus = Advancing`) plus the
 * normal reviewer-finding surface (`akoya_requeststatus = 'Phase II Pending'`).
 * `Set aside` is hidden unless ?includeSetAside=1. An UNTRIAGED row shows ONLY if
 * it is `Phase II Pending` (the normal reviewer-finding surface); untriaged
 * NON-Phase-II rows — notably every Concept-stage row the coarse meeting-date
 * cycle filter also matches — are never shown (not reviewer-finding targets). The going-
 * forward set used to be a committed allowlist of request numbers
 * (shared/config/d26Allowlist.js); the D26 backfill moved that set onto the
 * `wmkf_triagestatus` field (35 Advancing / 170 Set aside). The cycle picker now
 * derives cycles from the PD's meeting-dated proposals (default = latest), with no
 * allowlist anchor — d26Allowlist.js is retired from live use (§5, S261).
 * my-proposals.js is untouched.
 */

import { getUserRole, requireAppAccess } from '../../../lib/utils/auth';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { resolveByEmail } from '../../../lib/services/program-director-resolver';
import { meetingDateToCycleCode, cycleCodeToOdataFilter, cycleCodeToLabel } from '../../../lib/utils/cycle-code';
import { TRIAGE_STATUS } from '../../../shared/config/triageStatus';
// Reviewer rollup + work-remaining derivation are shared with the per-request
// Overview tab (via /api/workbench/reviewer-rollup); single source of truth.
import { fetchReviewerRollup, deriveWorkRemaining, REVIEWERS_NEEDED } from '../../../lib/services/reviewer-rollup';

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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const azureEmail = access.session?.user?.azureEmail;
  if (!azureEmail) {
    return res.status(400).json({ error: 'Could not determine your email from the session. Sign out and back in.' });
  }

  const scope = req.query.scope === 'all' ? 'all' : 'my';

  return bypassDynamicsRestrictions('workbench-dashboard', async () => {
    try {
      const pd = await resolveByEmail(azureEmail);
      if (!pd?.systemuserid) {
        return res.status(404).json({ error: `No active Dynamics systemuser found for ${azureEmail}.` });
      }
      const isSuperuser = (await getUserRole(access.profileId)) === 'superuser';

      const { cycleCode } = req.query;
      if (!cycleCode) {
        return await listCycles(res, pd);
      }
      const includeSetAside = req.query.includeSetAside === '1';
      return await listProposals(res, pd, String(cycleCode), scope, includeSetAside, isSuperuser);
    } catch (err) {
      console.error('workbench dashboard error:', err);
      return res.status(500).json({
        error: 'Failed to load dashboard',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  });
}

/**
 * Cycle-picker source: the cycles the PD has meeting-dated proposals in, plus
 * the D26 allowlist cycle always (so it's selectable before any D26 request is
 * Phase II Pending). Scope does not narrow the picker — it narrows the proposal
 * list — which keeps this query cheap (PD-scoped, not a full-table scan).
 */
async function listCycles(res, pd) {
  const filter = `_wmkf_programdirector_value eq ${pd.systemuserid} and wmkf_meetingdate ne null`;
  const { records } = await DynamicsService.queryAllRecords('akoya_requests', {
    select: 'akoya_requestid,wmkf_meetingdate',
    filter,
    orderby: 'wmkf_meetingdate desc',
  });

  const seen = new Map(); // code → { code, label, year, month, count }
  for (const r of records) {
    const code = meetingDateToCycleCode(r.wmkf_meetingdate);
    if (!code) continue;
    const existing = seen.get(code);
    if (existing) {
      existing.count += 1;
    } else {
      const d = new Date(r.wmkf_meetingdate);
      seen.set(code, {
        code,
        label: cycleCodeToLabel(code),
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        count: 1,
      });
    }
  }

  const cycles = Array.from(seen.values()).sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
  });

  return res.status(200).json({
    success: true,
    programDirector: { systemuserid: pd.systemuserid, fullName: pd.fullName },
    cycles,
    // Default to the PD's latest-meeting-date cycle (cycles are sorted desc) — the
    // current/upcoming cycle in practice (D26 today). S261: replaced the hardcoded
    // d26Allowlist anchor. A more principled default — nearest upcoming reviewDeadline
    // among isActive `wmkf_appgrantcycle` rows — is a future refinement.
    defaultCycleCode: cycles[0]?.code || null,
  });
}

async function listProposals(res, pd, cycleCode, scope, includeSetAside, isSuperuser) {
  const cycleFilter = cycleCodeToOdataFilter(cycleCode);
  if (!cycleFilter) {
    return res.status(400).json({ error: `Invalid cycleCode: ${cycleCode}` });
  }

  // ── Triage-driven visibility (S261 — replaces the d26Allowlist union) ──
  // Default view = the going-forward set (`wmkf_triagestatus = Advancing`) plus
  // the normal reviewer-finding surface (`akoya_requeststatus = 'Phase II Pending'`).
  // `Set aside` is hidden unless ?includeSetAside=1. An UNTRIAGED row shows only via
  // the Phase II Pending status branch; untriaged NON-Phase-II rows — every
  // Concept-stage row the coarse meeting-date cycle filter also matches — are never
  // shown (not reviewer-finding targets). The OR groups are parenthesized so they
  // can't leak past the cycle/scope ANDs.
  //
  // Hide-Set-aside uses the null-inclusive pattern (`eq null or ne <Set aside>`,
  // mirroring reviewer-suggestion.js notExcludedFilter) so a Set-aside row is hidden
  // even when it also matches the Phase II Pending status clause (Set aside wins).
  const base = `akoya_requeststatus eq 'Phase II Pending' or wmkf_triagestatus eq ${TRIAGE_STATUS.ADVANCING}`;
  const visibility = includeSetAside
    ? `(${base} or wmkf_triagestatus eq ${TRIAGE_STATUS.SET_ASIDE})`
    : `(${base}) and (wmkf_triagestatus eq null or wmkf_triagestatus ne ${TRIAGE_STATUS.SET_ASIDE})`;

  const filters = [`(${cycleFilter})`, visibility];
  if (scope === 'my') filters.push(`_wmkf_programdirector_value eq ${pd.systemuserid}`);

  const { records } = await DynamicsService.queryAllRecords('akoya_requests', {
    select: PROPOSAL_SELECT,
    filter: filters.join(' and '),
    orderby: 'akoya_requestnum asc',
  });

  const requestIds = records.map((r) => r.akoya_requestid).filter(Boolean);
  const counts = await fetchReviewerRollup(requestIds);

  const proposals = records.map((row) => (
    projectProposal(row, counts[row.akoya_requestid], isSuperuser, pd.systemuserid)
  ));

  // Stable order: number ascending.
  proposals.sort((a, b) => String(a.requestNumber).localeCompare(String(b.requestNumber)));

  return res.status(200).json({
    success: true,
    programDirector: { systemuserid: pd.systemuserid, fullName: pd.fullName },
    cycleCode: cycleCode.toUpperCase(),
    cycleLabel: cycleCodeToLabel(cycleCode),
    scope,
    includeSetAside: !!includeSetAside,
    rollup: summarize(proposals),
    proposals,
  });
}

function projectProposal(r, c, isSuperuser, callerSystemId) {
  const counts = c || { candidates: 0, invited: 0, accepted: 0, declined: 0, held: 0, completed: 0 };
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
    // pill; `setAside` rows only appear when ?includeSetAside=1.
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
