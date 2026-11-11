import { useEffect, useState } from 'react';
import { SCORING_STATUS, isScoringEditable, CHAIRS_RECOMMENDATION_STATUS } from '../../config/j27Scoring';
import { requestEnvelope } from '../../utils/api-request';

const terminalClasses = new Set(['DECIDED_AWARD', 'DECIDED_NO_AWARD', 'WITHDRAWN']);
function memoPresent(record, field) {
  return typeof record[field] === 'string' ? Boolean(record[field].trim()) : null;
}

function nextAction(context, handoff, progress, chairsRecommendationEnabled) {
  if (terminalClasses.has(context.statusClass)) {
    return { heading: context.requestStatus || 'Request outcome recorded' };
  }
  if (context.phaseIStatus === SCORING_STATUS.no) {
    return { heading: 'Marked Not Scored',
      detail: 'The decision and staff rationale are in Initial Assessment.' };
  }
  if (context.phaseIStatus === CHAIRS_RECOMMENDATION_STATUS.no) {
    return { heading: 'Not recommended to Chairs',
      detail: 'The recommendation is in Initial Assessment.' };
  }
  if (handoff.visit) {
    return { heading: 'Presentation assessment saved',
      detail: 'Final Assessment shows the Draft Writeup status and whether group review can start.' };
  }
  if (handoff.presentation) {
    return { heading: 'Presentation record available',
      detail: 'Check the presentation, attendance, and staff assessment in Deliberations.' };
  }
  if (handoff.review) {
    return { heading: 'Staff review summary saved',
      detail: 'Use the reports and saved interpretation to decide what follows.', reports: true };
  }
  if (progress?.counts?.received > 0) {
    return { heading: 'Reviewer reports received',
      detail: 'Read the reports and record the staff interpretation.', reports: true };
  }
  if (context.phaseIStatus === CHAIRS_RECOMMENDATION_STATUS.yes) {
    return { heading: 'Recommended to Chairs',
      detail: 'Check Initial Assessment for the recommendation and integrity findings.' };
  }
  if (context.phaseIStatus !== SCORING_STATUS.yes) {
    if (handoff.rationale === false && isScoringEditable(context.phaseIStatus)) {
      return { heading: 'Initial assessment pending',
        detail: 'Read the proposal and record the staff rationale in Initial Assessment.' };
    }
    return { heading: 'Scoring decision to review',
      detail: 'Check the decision and supporting evidence in Initial Assessment.' };
  }
  return { heading: 'Marked Scored',
    detail: chairsRecommendationEnabled ? 'Record the recommendation to Chairs in Initial Assessment.'
      : 'Check the reviewer roster and progress in Peer Review.' };
}

function initialAssessmentDecision(context) {
  switch (context.phaseIStatus) {
    case SCORING_STATUS.yes: return 'Scored';
    case SCORING_STATUS.no: return 'Not Scored';
    case CHAIRS_RECOMMENDATION_STATUS.yes: return 'Recommended to Chairs';
    case CHAIRS_RECOMMENDATION_STATUS.no: return 'Not Recommended';
    default:
      if (isScoringEditable(context.phaseIStatus)) return 'No decision recorded';
      return context.phaseIStatusLabel ? `Status · ${context.phaseIStatusLabel}` : 'Couldn’t check the decision';
  }
}

function savedLabel(value) {
  if (value === undefined) return 'Unavailable in this setup';
  if (value === null) return 'Couldn’t check';
  return value ? 'Saved' : 'No saved text';
}

export default function J27Overview({ context, requestId, reviewerProgress,
  initialRationaleEnabled, chairsRecommendationEnabled, meetingRosterEnabled, onOpenReports, onJ27Facts = null }) {
  const [loaded, setLoaded] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    async function read(endpoint, project) {
      const { ok, data } = await requestEnvelope(
        `/api/workbench/${endpoint}?requestId=${encodeURIComponent(requestId)}`,
        { signal: controller.signal, tolerantBody: true },
      );
      if (!ok || !data || typeof data !== 'object') throw new Error('Handoff unavailable');
      return project(data);
    }
    const reads = [
      initialRationaleEnabled ? read('initial-assessment-rationale', r => memoPresent(r, 'rationale')) : undefined,
      read('staff-review-summary', r => memoPresent(r, 'summary')),
      read('staff-visit-assessment', r => memoPresent(r, 'assessment')),
      meetingRosterEnabled ? read('meeting-roster', r => (
        r.presentation === null ? { presentation: false, roster: false, stageFacts: r.stageFacts }
          : r.presentation?.id && typeof r.stale === 'boolean'
            ? { presentation: true, roster: Boolean(r.roster) && !r.stale, presentationId: r.presentation.id, rosterPresent: Boolean(r.roster), rosterStale: r.stale, stageFacts: r.stageFacts }
            : null
      )) : undefined,
    ];
    Promise.allSettled(reads).then(results => {
      if (controller.signal.aborted) return;
      const [rationale, review, visit, meeting] = results.map(r => r.status === 'fulfilled' ? r.value : null);
      setLoaded({ requestId, rationale, review, visit,
        presentation: meeting?.presentation ?? meeting, roster: meeting?.roster ?? meeting });
      // Step E: the page recomputes the J27 stage from the same reads (plan C7).
      onJ27Facts?.(requestId, { overview: { rationale, review, visit,
        meeting: meeting ? { presentation: meeting.presentation, presentationId: meeting.presentationId || null, roster: meeting.rosterPresent === true, rosterStale: meeting.rosterStale === true, stageFacts: meeting.stageFacts } : meeting } });
    });
    return () => controller.abort();
  }, [requestId, initialRationaleEnabled, meetingRosterEnabled]);

  const handoff = loaded?.requestId === requestId ? loaded : null;
  const terminal = terminalClasses.has(context.statusClass);
  const action = terminal || (handoff && reviewerProgress.status !== 'loading')
    ? nextAction(context, handoff, reviewerProgress.data, chairsRecommendationEnabled) : null;
  const received = reviewerProgress.data?.counts?.received;
  const showPeerReview = Boolean(handoff && (
    handoff.review || received > 0 || (!chairsRecommendationEnabled && context.phaseIStatus === SCORING_STATUS.yes)
  ));
  const showDeliberations = Boolean(handoff && (handoff.presentation || handoff.visit));

  return (
    <section aria-labelledby="j27-overview-heading" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
      <h2 id="j27-overview-heading" className="text-xl font-semibold text-gray-900">
        {action?.heading || 'Checking what’s saved…'}
      </h2>
      {action?.detail && <p className="mt-2 max-w-prose text-sm text-gray-700">{action.detail}</p>}
      {action?.reports && onOpenReports && (
        <button type="button" onClick={onOpenReports}
          className="mt-2 min-h-11 rounded-md text-sm font-semibold text-blue-800 underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-blue-600">
          Open Reports
        </button>
      )}
      {handoff && (
        <dl aria-label="Saved staff work"
          className={`mt-4 grid gap-4 border-t border-gray-200 pt-4 text-sm sm:grid-cols-2 ${showPeerReview && showDeliberations ? 'lg:grid-cols-3' : ''}`}>
          <div>
            <dt className="font-semibold">Initial Assessment</dt>
            <dd className="text-gray-600">{initialAssessmentDecision(context)}</dd>
            {initialRationaleEnabled && <dd className="text-gray-600">Staff rationale · {savedLabel(handoff.rationale)}</dd>}
          </div>
          {showPeerReview && (
            <div>
              <dt className="font-semibold">Peer Review</dt>
              <dd className="text-gray-600">{Number.isFinite(received)
                ? `${received} ${received === 1 ? 'report' : 'reports'} received`
                : 'Couldn’t check reports'}</dd>
              <dd className="text-gray-600">Staff review summary · {savedLabel(handoff.review)}</dd>
            </div>
          )}
          {showDeliberations && (
            <div>
              <dt className="font-semibold">Deliberations</dt>
              <dd className="text-gray-600">Presentation assessment · {savedLabel(handoff.visit)}</dd>
              {meetingRosterEnabled && <dd className="text-gray-600">Attendance · {handoff.roster === true ? 'Confirmed'
                : handoff.roster === false ? 'No current confirmation' : 'Couldn’t check'}</dd>}
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
