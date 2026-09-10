/**
 * PC Meeting Tracker slice 3 (docs/PC_MEETING_TRACKER_PLAN.md §5.4/§5.5) — the
 * single, React-free stage helper shared by the Staff Deliberations tab
 * (per-request rail) and the cycle view (one rail per row). Stage keys are
 * stable and code-owned (D6); display labels are admin-editable and read
 * separately via lib/services/deliberation-stage-labels.js.
 */

import {
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../config/requestDocument.js';

export const DELIBERATION_STAGE_KEYS = ['draft', 'shared', 'visit', 'final'];

export const DELIBERATION_STAGE_TEXT_KEYS = Object.freeze({
  draft: 'stage.deliberations.draft',
  shared: 'stage.deliberations.shared',
  visit: 'stage.deliberations.visit',
  final: 'stage.deliberations.final',
});

export const DELIBERATION_STAGE_DEFAULT_LABELS = Object.freeze({
  draft: 'AI draft ready',
  shared: 'Shared',
  visit: 'Visit',
  final: 'Final',
});

/**
 * Code-owned first-stop text for the draft substates that are *not* "ready".
 * The admin-editable `draft` label (D6) only describes a draft that exists;
 * before one does, the rail must not claim it (S503: a request with no draft
 * at all read "AI draft ready"). `ready` falls through to the label.
 */
export const DELIBERATION_DRAFT_SUBSTATE_TEXT = Object.freeze({
  none: 'No draft yet',
  generating: 'Generating draft',
  failed: 'Draft failed',
});

/**
 * The text the rail shows for the first stop given the current stage/substate:
 * the (admin-editable) draft label once a draft exists or the stage has moved
 * on, otherwise the code-owned substate text.
 */
export function draftStopText({ stage, substate, labels = {} }) {
  const label = labels.draft || DELIBERATION_STAGE_DEFAULT_LABELS.draft;
  if (stage !== 'draft') return label;
  return DELIBERATION_DRAFT_SUBSTATE_TEXT[substate] || label;
}

/**
 * D8: every advancing D26 request is visited, so stop 3 is never expected to
 * be absent this cycle. J27 changes this (a proposal may go out for review
 * and then not be visited) — this is the single predicate that register row
 * will flip; nothing else should branch on the D26 assumption directly.
 */
export function visitExpected() {
  return true;
}

function draftSubstate(currentArtifact) {
  if (!currentArtifact) return 'none';
  if (currentArtifact.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) return 'generating';
  if (currentArtifact.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED) return 'failed';
  if (currentArtifact.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && currentArtifact.file?.webUrl) return 'ready';
  return 'none';
}

function deriveVisit(siteVisitStartIso, now) {
  if (!siteVisitStartIso) return { status: 'not-scheduled', startIso: null };
  const startMs = Date.parse(siteVisitStartIso);
  if (!Number.isFinite(startMs)) return { status: 'not-scheduled', startIso: null };
  // D7: "visited" means the scheduled start is in the past — strict `<`, so a
  // visit scheduled for exactly `now` reads as still upcoming, not visited.
  return {
    status: startMs < now.getTime() ? 'visited' : 'scheduled',
    startIso: siteVisitStartIso,
  };
}

/**
 * @param {object} args
 * @param {object|null} args.currentArtifact - the current governed request-document row/status
 *   ({ lifecycleState, operationStatus, file } shape from getPreSiteVisitArtifactStatus).
 * @param {string|null} [args.siteVisitStartIso] - the wmkf_sitevisit Activity's scheduledstart.
 * @param {boolean} [args.everSent] - whether the shared document has ever been sent (substate only).
 * @param {Date} [args.now]
 * @returns {{ stage: 'draft'|'shared'|'visit'|'final'|'beyond', substate: string, visit: { status: string, startIso: string|null } }}
 */
export function deriveDeliberationStage({
  currentArtifact = null,
  siteVisitStartIso = null,
  everSent = false,
  now = new Date(),
}) {
  const lifecycleState = currentArtifact?.lifecycleState ?? null;
  const visit = deriveVisit(siteVisitStartIso, now);

  if (lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL) {
    return { stage: 'final', substate: 'moved', visit };
  }

  if (lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW) {
    if (visit.status === 'visited') {
      return { stage: 'visit', substate: 'awaiting-observations', visit };
    }
    return { stage: 'shared', substate: everSent ? 'sent' : 'not-sent', visit };
  }

  if (lifecycleState === null || lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT) {
    return { stage: 'draft', substate: draftSubstate(currentArtifact), visit };
  }

  // Board Ready / Superseded / any other numeric value not among the four
  // keyed stops. Never produced for the *current* artifact in practice (Board
  // Ready is only used on separate frozen distribution-snapshot rows), but
  // fails closed to an explicit out-of-band stage rather than silently
  // relabeling it "draft". Not in DELIBERATION_STAGE_KEYS — callers that
  // group/count by stage key must treat this as its own bucket.
  return { stage: 'beyond', substate: 'unknown-lifecycle', visit };
}

/**
 * Shape the server payloads carry for the request's latest deliberation slot
 * (tracker plan §5.4 reader, reduced to what the card shows). Null when the
 * tracker is not enabled or nothing is scheduled.
 */
export function projectDeliberationSession(schedule) {
  if (!schedule?.scheduledStartIso) return null;
  return {
    scheduledStartIso: schedule.scheduledStartIso,
    scheduledEndIso: schedule.scheduledEndIso || null,
    ianaTimeZone: schedule.ianaTimeZone || null,
    meetingLink: schedule.meetingLink || null,
    location: schedule.location || null,
  };
}

/**
 * "Deliberation session: not yet scheduled." names the PC as the actor (a
 * normal state, not a warning); with a slot it reads the date and time in the
 * session's own time zone.
 */
export function deliberationSessionLine(session) {
  const startMs = Date.parse(session?.scheduledStartIso || '');
  if (!Number.isFinite(startMs)) return 'Deliberation session: not yet scheduled.';
  let when;
  try {
    when = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...(session.ianaTimeZone ? { timeZone: session.ianaTimeZone } : {}),
    }).format(new Date(startMs));
  } catch {
    when = new Date(startMs).toLocaleString();
  }
  return `Deliberation session: ${when}.`;
}

export function deliberationVisitLine(visit) {
  if (!visit || visit.status === 'not-scheduled') return 'Visit not scheduled.';
  const date = new Date(visit.startIso).toLocaleDateString();
  return visit.status === 'visited' ? `Visited ${date}.` : `Visit ${date}.`;
}

/**
 * The one sentence under the rail (shape brief 2026-09-09, owner-approved
 * 2026-09-10): what to do next at this stage. Code-owned copy; the rail's
 * labels stay admin-editable.
 */
export function deliberationStageSentence({ stage, substate, sharedAtIso = null, visit = null }) {
  if (stage === 'final') return 'This proposal moved to Final Writeup.';
  if (stage === 'visit') {
    const visited = visit?.startIso ? `Visited ${new Date(visit.startIso).toLocaleDateString()}. ` : '';
    return `${visited}Add your site-visit edits to the working document in Word, then continue in Final Writeup to start group review.`;
  }
  if (stage === 'shared') {
    const sharedAt = Number.isFinite(Date.parse(sharedAtIso || ''))
      ? `Shared on ${new Date(sharedAtIso).toLocaleDateString()}.`
      : 'Shared.';
    return substate === 'sent'
      ? `${sharedAt} The deliberation email has gone out; keep editing the working document in Word.`
      : `${sharedAt} This exact version is locked as the working document. Send the deliberation email when you are ready.`;
  }
  if (substate === 'ready') {
    return 'Review and edit the AI draft in Word, then share it for the deliberation session. The draft leaves the recommendation, referee comments, and presentation for you to complete.';
  }
  if (substate === 'generating') return 'The draft is being generated. The Word link will be available when generation finishes.';
  if (substate === 'failed') return 'The latest Word-draft attempt failed. Generate the draft again when the cause is resolved.';
  return 'Generate the AI draft in Word to start staff deliberations for this proposal.';
}
