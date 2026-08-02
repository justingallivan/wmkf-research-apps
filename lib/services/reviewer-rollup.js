// @ts-check
/**
 * Shared per-request reviewer rollup — the LIGHTWEIGHT count path over
 * `wmkf_appreviewersuggestion` (active or declined + not applicant-excluded),
 * with NO person/researcher fan-out. Active lifecycle counts retain their
 * selected-only semantics; the nested `progress` object adds mutually exclusive
 * dashboard buckets and includes archived declines.
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

/**
 * Per-request reviewer stage counts.
 * @typedef {{total:number, accepted:number, pending:number, declined:number, uninvited:number}} ReviewerProgress
 * @typedef {{candidates:number, invited:number, accepted:number, declined:number, held:number, completed:number, progress:ReviewerProgress}} Counts
 */

/**
 * The stage cue `deriveWorkRemaining` can return. This union is the #15
 * exhaustiveness anchor (docs/TYPESCRIPT_OPTION_ASSESSMENT.md §5): every arm of
 * `deriveWorkRemaining` must return a member of it, and `WORK_REMAINING_LABEL`
 * is typed `Record<WorkRemaining, string>` so a stage added to one without the
 * other fails `tsc` — the compile-time form of the check:status-enum-parity
 * producer↔consumer guard. NOTE: `held` is deliberately absent (retired S279).
 * @typedef {'find'|'invite'|'awaiting'|'review'|'done'} WorkRemaining
 */

export const REVIEW_STATUS_COMPLETE = 100000004;
export const REVIEWERS_NEEDED = 3; // confirmed-reviewer invariant; 5 slots are over-invite buffer

/** @returns {Counts} */
export const emptyCounts = () => ({
  candidates: 0,
  invited: 0,
  accepted: 0,
  declined: 0,
  held: 0,
  completed: 0,
  progress: { total: 0, accepted: 0, pending: 0, declined: 0, uninvited: 0 },
});

/**
 * Per-request reviewer counts keyed by request GUID. Chunked OR-chain at 25;
 * `queryAllRecords` paginates (`queryRecords` silently caps top at 100).
 * @param {string[]} requestIds - Dataverse request GUIDs (server-derived OR
 *   GUID-validated at the route edge before calling this).
 * @returns {Promise<Record<string, Counts>>}
 */
export async function fetchReviewerRollup(requestIds) {
  if (!requestIds || requestIds.length === 0) return {};
  /** @type {Record<string, Counts>} */
  const out = {};
  const CHUNK = 25;
  for (const chunk of chunked(requestIds, CHUNK)) {
    const orChain = chunk.map((id) => `_wmkf_request_value eq ${id}`).join(' or ');
    const records = await findForRollup(orChain);
    for (const s of records) {
      const rid = s._wmkf_request_value;
      if (!rid) continue;
      const o = out[rid] || (out[rid] = emptyCounts());
      const selected = s.wmkf_selected === true;
      const invited = s.wmkf_invited === true || !!s.wmkf_emailsentat;
      const declined = s.wmkf_declined === true || s.wmkf_responsetype === RESPONSE_TYPE_MAP.declined;
      const accepted = !declined
        && (s.wmkf_accepted === true || s.wmkf_responsetype === RESPONSE_TYPE_MAP.accepted);

      // Existing stage counts remain active-pool-only so archived declines cannot
      // change the dashboard's workRemaining/needs-reviewers behavior.
      if (selected) {
        o.candidates += 1;
        if (invited) o.invited += 1;
        if (accepted) o.accepted += 1;
      }
      if (declined) o.declined += 1;

      // Progress buckets are exclusive, with decline taking precedence over an
      // inconsistent accepted+declined legacy row. Every queried row lands once.
      o.progress.total += 1;
      if (declined) o.progress.declined += 1;
      else if (accepted) o.progress.accepted += 1;
      else if (invited) o.progress.pending += 1;
      else o.progress.uninvited += 1;
      // `held` is a RETIRED response type — the hold/finalize step was removed (S279);
      // the enum is kept only for read-safety. A historical held row is also counted in
      // `invited`, so it surfaces as 'awaiting' (it routes to the accept form). The
      // distinct count is retained just to read such rows without breaking.
      if (selected && s.wmkf_responsetype === RESPONSE_TYPE_MAP.held) o.held += 1;
      if (selected && s.wmkf_reviewstatus === REVIEW_STATUS_COMPLETE) o.completed += 1;
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
 * @param {Counts} c
 * @returns {WorkRemaining}
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
// client-side stage enum. Typed Record<WorkRemaining,string>: a missing key (a new
// stage without a label) OR an extra key (a label whose stage was removed) fails tsc.
/** @type {Record<WorkRemaining, string>} */
export const WORK_REMAINING_LABEL = {
  find: 'No reviewer candidates yet — start finding reviewers.',
  invite: 'Candidates found — build the shortlist and send invitations.',
  awaiting: 'Invitations sent — awaiting reviewer responses.',
  review: 'Enough reviewers accepted — reviews in progress.',
  done: 'Enough reviews complete.',
};
