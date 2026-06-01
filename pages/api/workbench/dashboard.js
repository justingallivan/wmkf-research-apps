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
 *   ?cycleCode=Dxx|Jxx   the cycle to list (omit → cycle list mode)
 *   ?scope=my|all        my (default) = requests where the caller is lead PD;
 *                        all = every request in the cycle.
 *
 * THE ADDITIVE UNION (the reason this endpoint exists rather than reusing
 * my-proposals): the normal reviewer-finding surface is gated to
 * `akoya_requeststatus = 'Phase II Pending'`. The D26 going-forward set is
 * still `Phase I Pending` (advancing it early fires a live PA trigger), so it
 * never appears there. For the D26 cycle we ALSO fetch a committed allowlist of
 * request NUMBERS (shared/config/d26Allowlist.js) regardless of status and union
 * them in. The status-gated branch is unchanged; my-proposals.js is untouched.
 * Once D26 flips to Phase II for real, the allowlist branch becomes a harmless
 * duplicate of the status-gated branch (deduped here) and the config can go.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { resolveByEmail } from '../../../lib/services/program-director-resolver';
import { meetingDateToCycleCode, cycleCodeToOdataFilter, cycleCodeToLabel } from '../../../lib/utils/cycle-code';
import { RESPONSE_TYPE_MAP, notExcludedFilter } from '../../../lib/dataverse/adapters/reviewer-suggestion';
import { D26_ALLOWLIST_CYCLE_CODE, D26_ALLOWLIST_REQUEST_NUMS } from '../../../shared/config/d26Allowlist';

const REVIEW_STATUS_COMPLETE = 100000004;
const REVIEWERS_NEEDED = 3; // confirmed-reviewer invariant; 5 slots are over-invite buffer

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

      const { cycleCode } = req.query;
      if (!cycleCode) {
        return await listCycles(res, pd);
      }
      return await listProposals(res, pd, String(cycleCode), scope);
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

  // Always offer the allowlist cycle even if the PD has no Phase-II-dated rows
  // there yet (the going-forward set is Phase I Pending).
  if (!seen.has(D26_ALLOWLIST_CYCLE_CODE)) {
    const parsedYear = 2000 + Number(D26_ALLOWLIST_CYCLE_CODE.slice(1));
    seen.set(D26_ALLOWLIST_CYCLE_CODE, {
      code: D26_ALLOWLIST_CYCLE_CODE,
      label: cycleCodeToLabel(D26_ALLOWLIST_CYCLE_CODE),
      year: parsedYear,
      month: 12,
      count: 0,
    });
  }

  const cycles = Array.from(seen.values()).sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
  });

  return res.status(200).json({
    success: true,
    programDirector: { systemuserid: pd.systemuserid, fullName: pd.fullName },
    cycles,
    // Default to the allowlist cycle — the pilot's open cycle — when present.
    defaultCycleCode: cycles.some((c) => c.code === D26_ALLOWLIST_CYCLE_CODE)
      ? D26_ALLOWLIST_CYCLE_CODE
      : (cycles[0]?.code || null),
  });
}

async function listProposals(res, pd, cycleCode, scope) {
  const cycleFilter = cycleCodeToOdataFilter(cycleCode);
  if (!cycleFilter) {
    return res.status(400).json({ error: `Invalid cycleCode: ${cycleCode}` });
  }

  // ── Branch 1: status-gated query (the normal reviewer-finding surface) ──
  // Unchanged predicate: Phase II Pending in the cycle; scope=my adds the lead-PD
  // filter. For the D26 cycle this currently returns nothing (all Phase I Pending).
  const statusFilters = [cycleFilter, `akoya_requeststatus eq 'Phase II Pending'`];
  if (scope === 'my') statusFilters.unshift(`_wmkf_programdirector_value eq ${pd.systemuserid}`);
  const { records: statusGated } = await DynamicsService.queryAllRecords('akoya_requests', {
    select: PROPOSAL_SELECT,
    filter: statusFilters.join(' and '),
    orderby: 'akoya_requestnum asc',
  });

  // ── Branch 2: allowlist-by-number (only for the D26 allowlist cycle) ──
  const byId = new Map();
  for (const r of statusGated) byId.set(r.akoya_requestid, { row: r, allowlisted: false });

  if (cycleCode.toUpperCase() === D26_ALLOWLIST_CYCLE_CODE) {
    const allowRows = await fetchAllowlisted(pd, scope, cycleFilter);
    for (const r of allowRows) {
      if (!byId.has(r.akoya_requestid)) {
        byId.set(r.akoya_requestid, { row: r, allowlisted: true });
      }
    }
  }

  const entries = Array.from(byId.values());
  const requestIds = entries.map((e) => e.row.akoya_requestid).filter(Boolean);
  const counts = await fetchReviewerRollup(requestIds);

  const proposals = entries.map(({ row, allowlisted }) =>
    projectProposal(row, counts[row.akoya_requestid], allowlisted));

  // Stable order: number ascending.
  proposals.sort((a, b) => String(a.requestNumber).localeCompare(String(b.requestNumber)));

  return res.status(200).json({
    success: true,
    programDirector: { systemuserid: pd.systemuserid, fullName: pd.fullName },
    cycleCode: cycleCode.toUpperCase(),
    cycleLabel: cycleCodeToLabel(cycleCode),
    scope,
    rollup: summarize(proposals),
    proposals,
  });
}

/**
 * Fetch the committed allowlist requests by NUMBER (akoya_requestnum is a STRING
 * field → each value is single-quoted). A defensive meeting-date cycle filter is
 * AND-ed in: all 35 carry Dec-2026 dates (verified), so it never drops a real
 * member but guards against a mistyped number from another cycle. scope=my also
 * AND-s the lead-PD filter so "My" never dumps the whole set on one PD.
 */
async function fetchAllowlisted(pd, scope, cycleFilter) {
  const out = [];
  const CHUNK = 20;
  for (let i = 0; i < D26_ALLOWLIST_REQUEST_NUMS.length; i += CHUNK) {
    const chunk = D26_ALLOWLIST_REQUEST_NUMS.slice(i, i + CHUNK);
    const orChain = chunk
      .map((n) => `akoya_requestnum eq '${String(n).replace(/'/g, "''")}'`)
      .join(' or ');
    const filters = [`(${orChain})`, cycleFilter];
    if (scope === 'my') filters.push(`_wmkf_programdirector_value eq ${pd.systemuserid}`);
    const { records } = await DynamicsService.queryAllRecords('akoya_requests', {
      select: PROPOSAL_SELECT,
      filter: filters.join(' and '),
    });
    out.push(...records);
  }
  return out;
}

/**
 * Per-request reviewer rollup from wmkf_appreviewersuggestion (selected + not
 * applicant-excluded). Dashboard-local — does not reuse my-proposals'
 * fetchReviewerCounts so my-proposals stays untouched. Chunked OR-chain at 25;
 * queryAllRecords paginates (queryRecords silently caps top at 100).
 */
async function fetchReviewerRollup(requestIds) {
  if (!requestIds || requestIds.length === 0) return {};
  const out = {};
  const CHUNK = 25;
  for (let i = 0; i < requestIds.length; i += CHUNK) {
    const chunk = requestIds.slice(i, i + CHUNK);
    const orChain = chunk.map((id) => `_wmkf_request_value eq ${id}`).join(' or ');
    const { records } = await DynamicsService.queryAllRecords('wmkf_appreviewersuggestions', {
      select: '_wmkf_request_value,wmkf_invited,wmkf_accepted,wmkf_declined,wmkf_emailsentat,wmkf_responsetype,wmkf_reviewstatus',
      filter: `(${orChain}) and wmkf_selected eq true and ${notExcludedFilter()}`,
    });
    for (const s of records) {
      const rid = s._wmkf_request_value;
      if (!rid) continue;
      const o = out[rid] || (out[rid] = { candidates: 0, invited: 0, accepted: 0, declined: 0, completed: 0 });
      o.candidates += 1;
      if (s.wmkf_invited === true || s.wmkf_emailsentat) o.invited += 1;
      if (s.wmkf_accepted === true || s.wmkf_responsetype === RESPONSE_TYPE_MAP.accepted) o.accepted += 1;
      if (s.wmkf_declined === true || s.wmkf_responsetype === RESPONSE_TYPE_MAP.declined) o.declined += 1;
      if (s.wmkf_reviewstatus === REVIEW_STATUS_COMPLETE) o.completed += 1;
    }
  }
  return out;
}

function projectProposal(r, c, allowlisted) {
  const counts = c || { candidates: 0, invited: 0, accepted: 0, declined: 0, completed: 0 };
  const cycleCode = r.wmkf_meetingdate ? meetingDateToCycleCode(r.wmkf_meetingdate) : null;
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
    allowlisted: !!allowlisted,
    reviewers: {
      ...counts,
      needed: REVIEWERS_NEEDED,
    },
    // Coarse work-remaining cue for the dashboard row. Richer per-stage state
    // (overdue, recommended-but-unenriched) lands with the Manage/Find panels.
    workRemaining: deriveWorkRemaining(counts),
  };
}

/**
 * Single-word stage cue, computed from the rollup counts:
 *   find    — fewer candidates than needed reviewers
 *   invite  — candidates exist but none/too-few invited
 *   awaiting — invited, still short of enough acceptances
 *   review  — enough accepted, reviews not all in
 *   done    — enough completed
 */
function deriveWorkRemaining(c) {
  if (c.completed >= REVIEWERS_NEEDED) return 'done';
  if (c.accepted >= REVIEWERS_NEEDED) return 'review';
  if (c.invited > 0) return 'awaiting';
  if (c.candidates > 0) return 'invite';
  return 'find';
}

function summarize(proposals) {
  const stages = { find: 0, invite: 0, awaiting: 0, review: 0, done: 0 };
  for (const p of proposals) stages[p.workRemaining] = (stages[p.workRemaining] || 0) + 1;
  return { total: proposals.length, stages };
}
