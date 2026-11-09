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

const memo = (value) => (value === undefined ? null : value === null ? { status: 'unavailable' } : { status: value ? 'present' : 'absent' });

/** Memo presence and the meeting record from the Overview's handoff reads. */
export function j27OverviewInputs(loaded) {
  if (!loaded) return {};
  const out = {};
  const rationale = memo(loaded.rationale); if (rationale) out.rationale = rationale;
  const review = memo(loaded.review); if (review) out.reviewSummary = review;
  const visit = memo(loaded.visit); if (visit) out.visitAssessment = visit;
  const meeting = loaded.meeting;
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

/** Board draft, transition, and the presentation's end from the Final Writeup state. */
export function j27FinalWriteupInputs(status, presentation) {
  if (!status) return {};
  if (status.error || status.available !== true) {
    return { boardDraft: { status: 'unavailable' }, transition: { status: 'unavailable' } };
  }
  const out = {
    boardDraft: { status: 'present', exists: Boolean(status.sourceArtifactId) },
    transition: { status: 'present', phase: TRANSITION_PHASES.has(status.phase) ? status.phase : null },
  };
  const schedule = status.presentationSchedule;
  const legacyException = LEGACY_REASONS.has(status.startCompatibilityReason);
  const base = presentation?.status === 'present' ? presentation : { status: 'present', exists: null, id: null, ended: null, legacyException: false };
  if (schedule === 'ended') out.presentation = { ...base, exists: true, ended: true, legacyException };
  else if (schedule === 'upcoming') out.presentation = { ...base, exists: true, ended: false, legacyException };
  else if (schedule === 'missing') out.presentation = { ...base, exists: base.exists === true, ended: null, legacyException };
  else if (presentation?.status === 'present' && legacyException) out.presentation = { ...base, legacyException: true };
  return out;
}

/** The server's tier 1 input plus whatever the page has loaded so far. */
export function composeJ27PageInput(serverInput, facts = {}) {
  if (!serverInput || typeof serverInput !== 'object') return null;
  const overview = j27OverviewInputs(facts.overview);
  const counts = j27CountsInput(facts.progress);
  const merged = { ...serverInput, ...overview };
  if (counts) merged.reviewers = { ...(serverInput.reviewers || { status: 'unavailable' }), counts };
  const presentation = merged.presentation?.status === 'not-loaded' ? null : merged.presentation;
  return { ...merged, ...j27FinalWriteupInputs(facts.finalWriteup, presentation) };
}

export function deriveJ27PageStage(serverInput, facts) {
  const input = composeJ27PageInput(serverInput, facts);
  return input ? deriveJ27Stage(input) : null;
}
