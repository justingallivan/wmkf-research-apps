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

import { RESPONSE_TYPE_MAP, findForRollup } from '../dataverse/adapters/reviewer-suggestion';
import { chunk as chunked } from '../utils/chunk.js';

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
  for (const chunk of chunked(requestIds, CHUNK)) {
    const orChain = chunk.map((id) => `_wmkf_request_value eq ${id}`).join(' or ');
    const records = await findForRollup(orChain);
    for (const s of records) {
      const rid = s._wmkf_request_value;
      if (!rid) continue;
      const o = out[rid] || (out[rid] = emptyCounts());
      o.candidates += 1;
      if (s.wmkf_invited === true || s.wmkf_emailsentat) o.invited += 1;
      if (s.wmkf_accepted === true || s.wmkf_responsetype === RESPONSE_TYPE_MAP.accepted) o.accepted += 1;
      if (s.wmkf_declined === true || s.wmkf_responsetype === RESPONSE_TYPE_MAP.declined) o.declined += 1;
      // `held` is a RETIRED response type — the hold/finalize step was removed (S279);
      // the enum is kept only for read-safety. A historical held row is also counted in
      // `invited`, so it surfaces as 'awaiting' (it routes to the accept form). The
      // distinct count is retained just to read such rows without breaking.
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
 *   review  — enough accepted, reviews not all in
 *   done    — enough completed
 */
export function deriveWorkRemaining(c) {
  if (c.completed >= REVIEWERS_NEEDED) return 'done';
  if (c.accepted >= REVIEWERS_NEEDED) return 'review';
  // `held` is retired (S279): a historical held row is also counted in `invited`, so it
  // falls through to 'awaiting' here — it still needs the reviewer to accept.
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
  review: 'Enough reviewers accepted — reviews in progress.',
  done: 'Enough reviews complete.',
};
