/**
 * Step E (plan C7, request-page paragraph): the request page recomputes the
 * J27 stage with the same pure function as each existing read lands. Nothing
 * here fetches. The server's tier 1 `input` arrives on the resolve DTO; the
 * page merges the facts its tabs already load and derives again.
 *
 *   reviewer rollup (OverviewTab)     → reviewers.counts
 *   Overview handoffs (J27Overview)   → rationale, reviewSummary, visitAssessment, presentation, roster
 *   Final Writeup state (that tab)    → boardDraft, transition, presentation.ended / legacyException
 *
 * `not_checked`, `unverified` and `missing` never become ended or absent on
 * their own: ended stays `null` (unknown) until the schedule check says so.
 */
import { deriveJ27Stage } from '../../lib/services/workbench/j27-read-model';

const DRAFT_NEEDED_CODES = new Set(['final_writeup_source_missing', 'final_writeup_source_ineligible']);
const LEGACY_REASONS = new Set(['legacy_complete_review_without_schedule', 'legacy_review_schedule_unverified']);
const TRANSITION_PHASES = new Set(['group-review', 'leadership-review']);
const n = (v) => (Number.isFinite(v) ? v : 0);

/** Reviewer counts from the Overview's rollup state (`useReviewerProgress`). */
export function j27CountsInput(progress) {
  if (!progress || progress.status === 'loading') return null;
  if (progress.status !== 'ready' || !progress.data?.counts) return { status: 'unavailable' };
  const c = progress.data.counts;
  return { status: 'present', candidates: n(c.candidates), invited: n(c.invited), accepted: n(c.accepted), received: n(c.received), completed: n(c.completed) };
}

const KEY_STATUSES = new Set(['present', 'absent', 'unavailable', 'stale', 'not-provisioned']);
/** A stage-model key as the server reports it: an object with a known status. */
const isWholeKey = (key) => Boolean(key) && typeof key === 'object' && KEY_STATUSES.has(key.status);

const memo = (value) => (value === undefined ? null : value === null ? { status: 'unavailable' } : { status: value ? 'present' : 'absent' });

/**
 * Memo presence and the meeting record from the Overview's handoff reads.
 * With `serverLoaded`, only whole keys from the attendance read replace the
 * server's presentation and attendance; a failed read or an older response
 * shape leaves them alone.
 */
export function j27OverviewInputs(loaded, serverLoaded = false) {
  if (!loaded) return {};
  const out = {};
  const rationale = memo(loaded.rationale); if (rationale) out.rationale = rationale;
  const review = memo(loaded.review); if (review) out.reviewSummary = review;
  const visit = memo(loaded.visit); if (visit) out.visitAssessment = visit;
  const meeting = loaded.meeting;
  // The attendance read reports whole keys by the shared server rule
  // (j27-later-facts.js); they replace the keys outright.
  if (isWholeKey(meeting?.stageFacts?.presentation) && isWholeKey(meeting.stageFacts.roster)) {
    out.presentation = meeting.stageFacts.presentation;
    out.roster = meeting.stageFacts.roster;
    return out;
  }
  if (serverLoaded) return out;
  if (meeting === null) { out.presentation = { status: 'unavailable' }; out.roster = { status: 'unavailable' }; }
  else if (meeting && meeting.presentation === false) {
    out.presentation = { status: 'present', exists: false, id: null, ended: null, legacyException: false };
    out.roster = { status: 'absent' };
  } else if (meeting && meeting.presentation === true) {
    out.presentation = { status: 'present', exists: true, id: meeting.presentationId || null, ended: null, legacyException: false };
    out.roster = { status: meeting.roster ? 'present' : 'absent', stale: meeting.rosterStale === true };
  }
  return out;
}

/**
 * Board draft, transition, and the presentation's end from the Final Writeup state.
 * `serverLoaded` says the server already supplied these keys for this request
 * (resolve-request); a status read that carries no whole keys then never
 * replaces a known presentation with an unknown one.
 */
export function j27FinalWriteupInputs(status, presentation, serverLoaded = false) {
  if (!status) return {};
  const whole = status.stageFacts;
  if (isWholeKey(whole?.boardDraft) && isWholeKey(whole.transition) && isWholeKey(whole.presentation)) {
    return { boardDraft: whole.boardDraft, transition: whole.transition, presentation: whole.presentation };
  }
  // "No Board draft yet", and a draft not yet shared for review (for example one
  // just reopened), are known states, not failures, and they replace what the
  // server said earlier: the tab offers the draft editor there. Same mapping as
  // documentFacts in j27-later-facts.js.
  if (status.error && DRAFT_NEEDED_CODES.has(status.code)) {
    return { boardDraft: { status: 'present', exists: false }, transition: { status: 'present', phase: null } };
  }
  // Any other failed status read says nothing new about facts the server already supplied.
  if (serverLoaded && (status.error || status.available !== true)) return {};
  if (status.error || status.available !== true) {
    return { boardDraft: { status: 'unavailable' }, transition: { status: 'unavailable' } };
  }
  const out = {
    boardDraft: { status: 'present', exists: Boolean(status.sourceArtifactId) },
    transition: { status: 'present', phase: TRANSITION_PHASES.has(status.phase) ? status.phase : null },
  };
  if (serverLoaded) return out;
  const schedule = status.presentationSchedule;
  const legacyException = LEGACY_REASONS.has(status.startCompatibilityReason);
  // Without an Overview meeting read, the schedule check still says something about
  // the presentation; its timing stays unknown (`ended: null`) unless it says otherwise.
  const base = presentation?.status === 'present' ? presentation : { status: 'present', exists: null, id: null, ended: null, legacyException: false };
  if (schedule === 'ended') out.presentation = { ...base, exists: true, ended: true, legacyException };
  else if (schedule === 'upcoming') out.presentation = { ...base, exists: true, ended: false, legacyException };
  else if (schedule === 'missing') out.presentation = { ...base, exists: base.exists === true, ended: null, legacyException };
  else if (schedule === 'unverified' || schedule === 'not_checked') out.presentation = { ...base, ended: null, legacyException };
  return out;
}

/** The server's tier 1 input plus whatever the page has loaded so far. */
export function composeJ27PageInput(serverInput, facts = {}) {
  if (!serverInput || typeof serverInput !== 'object') return null;
  const serverLoaded = Boolean(serverInput.boardDraft && serverInput.boardDraft.status !== 'not-loaded');
  const overview = j27OverviewInputs(facts.overview, serverLoaded);
  const counts = j27CountsInput(facts.progress);
  const merged = { ...serverInput, ...overview };
  if (counts) merged.reviewers = { ...(serverInput.reviewers || { status: 'unavailable' }), counts };
  // Summary freshness arrives from the read-only summary panel once both evidence hashes are known.
  if (typeof facts.summaryStale === 'boolean' && merged.reviewSummary?.status === 'present') {
    merged.reviewSummary = { ...merged.reviewSummary, stale: facts.summaryStale };
  }
  const presentation = merged.presentation?.status === 'not-loaded' ? null : merged.presentation;
  const finalWriteup = j27FinalWriteupInputs(facts.finalWriteup, presentation, serverLoaded);
  // Both reporters can carry the presentation. The one that reported last wins
  // (`facts.order`, stamped by the page as each report lands), so a newer
  // Overview read is not overwritten by an older Final Writeup read.
  const overviewIsNewer = Number(facts.order?.overview) > Number(facts.order?.finalWriteup);
  const result = { ...merged, ...finalWriteup };
  if (overviewIsNewer && overview.presentation) result.presentation = overview.presentation;
  return result;
}

export function deriveJ27PageStage(serverInput, facts) {
  const input = composeJ27PageInput(serverInput, facts);
  return input ? deriveJ27Stage(input) : null;
}
