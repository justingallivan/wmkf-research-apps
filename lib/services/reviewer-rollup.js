/**
 * Shared per-request reviewer rollup — the LIGHTWEIGHT count path over
 * `wmkf_appreviewersuggestion` (selected + not applicant-excluded), with NO
 * person/researcher fan-out.
 *
 * Used by two surfaces:
 *   - the tier-2 dashboard (`fetchReviewerRollup` over a whole cycle's requests)
 *   - the per-request Overview tab, via `/api/workbench/reviewer-rollup` (one id)
 *
 * Extracted from `pages/api/workbench/dashboard.js` (S260, Codex review) so the
 * Overview tab — now the default landing tab — counts reviewer stages without
 * pulling the heavy `/api/review-manager/reviewers` payload (which fans out to
 * person/researcher lookups just to build full reviewer objects).
 */

import { DynamicsService } from './dynamics-service';
import { RESPONSE_TYPE_MAP, notExcludedFilter } from '../dataverse/adapters/reviewer-suggestion';

export const REVIEW_STATUS_COMPLETE = 100000004;
export const REVIEWERS_NEEDED = 3; // confirmed-reviewer invariant; 5 slots are over-invite buffer

export const emptyCounts = () => ({ candidates: 0, invited: 0, accepted: 0, declined: 0, held: 0, completed: 0 });

/**
 * Per-request reviewer counts keyed by request GUID. Chunked OR-chain at 25;
 * `queryAllRecords` paginates (`queryRecords` silently caps top at 100).
 * @param {string[]} requestIds - Dataverse request GUIDs (server-derived OR
 *   GUID-validated at the route edge before calling this).
 * @returns {Promise<Record<string, {candidates,invited,accepted,declined,held,completed}>>}
 */
export async function fetchReviewerRollup(requestIds) {
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
      const o = out[rid] || (out[rid] = emptyCounts());
      o.candidates += 1;
      if (s.wmkf_invited === true || s.wmkf_emailsentat) o.invited += 1;
      if (s.wmkf_accepted === true || s.wmkf_responsetype === RESPONSE_TYPE_MAP.accepted) o.accepted += 1;
      if (s.wmkf_declined === true || s.wmkf_responsetype === RESPONSE_TYPE_MAP.declined) o.declined += 1;
      // Held = agreed in principle (pre-finalize). Counted distinctly so staff can see a
      // committed slate before reviewers finalize; a held row is also counted in `invited`.
      if (s.wmkf_responsetype === RESPONSE_TYPE_MAP.held) o.held += 1;
      if (s.wmkf_reviewstatus === REVIEW_STATUS_COMPLETE) o.completed += 1;
    }
  }
  return out;
}

/**
 * Single-word stage cue, computed from the rollup counts:
 *   find    — fewer candidates than needed reviewers
 *   invite  — candidates exist but none/too-few invited
 *   awaiting — invited, still short of enough acceptances
 *   held    — enough reviewers agreed in principle (slate secured), not yet finalized
 *   review  — enough accepted, reviews not all in
 *   done    — enough completed
 */
export function deriveWorkRemaining(c) {
  if (c.completed >= REVIEWERS_NEEDED) return 'done';
  if (c.accepted >= REVIEWERS_NEEDED) return 'review';
  // A committed slate ranks above plain 'awaiting' so staff see it's secured before
  // reviewers finalize. Count accepted + held together: a proposal whose shortfall is
  // made up by holds (e.g. 2 accepted + 1 held when 3 are needed) is still committed
  // (Codex chunk-8 — the mixed case must not fall through to 'awaiting').
  if (c.accepted + c.held >= REVIEWERS_NEEDED) return 'held';
  if (c.invited > 0) return 'awaiting';
  if (c.candidates > 0) return 'invite';
  return 'find';
}

// Human "what next" label per workRemaining stage. CONSUMER of deriveWorkRemaining,
// parity-checked by check:status-enum-parity — every stage deriveWorkRemaining can
// return MUST have a label here (an unmapped stage would surface as an empty hint).
// The per-request endpoint returns the resolved string so the Overview tab needs no
// client-side stage enum.
export const WORK_REMAINING_LABEL = {
  find: 'No reviewer candidates yet — start finding reviewers.',
  invite: 'Candidates found — build the shortlist and send invitations.',
  awaiting: 'Invitations sent — awaiting reviewer responses.',
  held: 'Slate secured (reviewers agreed) — finalize them.',
  review: 'Enough reviewers accepted — reviews in progress.',
  done: 'Enough reviews complete.',
};
