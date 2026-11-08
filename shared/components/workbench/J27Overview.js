import { useEffect, useState } from 'react';
import { FIRST_CUT_STATUS, isFirstCutEditable } from '../../config/j27FirstCut';
import { requestEnvelope } from '../../utils/api-request';
import { Card } from '../Layout';

const terminalClasses = new Set(['DECIDED_AWARD', 'DECIDED_NO_AWARD', 'WITHDRAWN']);
const reportTask = {
  label: 'Open Reports', tab: 'reviews',
};
const deliberationTask = {
  label: 'Open Deliberations', tab: 'staff-deliberations',
};

function memoPresent(record, field) {
  return typeof record[field] === 'string' ? Boolean(record[field].trim()) : null;
}

function nextAction(context, handoff, progress) {
  if (terminalClasses.has(context.statusClass)) {
    return { heading: 'Request outcome recorded' };
  }
  if (context.phaseIStatus === FIRST_CUT_STATUS.no) {
    return { heading: 'First Cut marked Not Scored',
      detail: 'Review the recorded decision and staff rationale.',
      label: 'Open Initial Assessment', tab: 'initial-assessment' };
  }
  if (handoff.visit) {
    return { heading: 'Visit assessment saved',
      detail: 'Review the saved handoff and check the status of the Word recommendation.',
      label: 'Open Final Assessment', tab: 'final-assessment' };
  }
  if (handoff.presentation) {
    return { ...deliberationTask, heading: 'Presentation record available',
      detail: 'Check the presentation, attendance and staff assessment.' };
  }
  if (handoff.review) {
    return { ...reportTask, heading: 'Staff review summary saved',
      detail: 'Review the saved summary and reports to decide what follows.' };
  }
  if (progress?.counts?.received > 0) {
    return { ...reportTask, heading: 'Reviewer reports received',
      detail: 'Read the reports and record the staff interpretation.' };
  }
  if (context.phaseIStatus !== FIRST_CUT_STATUS.yes) {
    const canStartRationale = handoff.rationale === false && isFirstCutEditable(context.phaseIStatus);
    return { heading: canStartRationale ? 'Staff rationale to record' : 'First Cut decision to review',
      detail: canStartRationale ? 'Read the proposal and record the staff rationale.' : 'Check the current decision and assessment evidence.',
      label: 'Open Initial Assessment', tab: 'initial-assessment' };
  }
  return { heading: 'First Cut marked Scored',
    detail: progress?.hint || 'Check the reviewer roster and progress.',
    label: 'Open Panel', tab: 'reviewers' };
}

function savedLabel(value) {
  if (value === undefined) return 'Unavailable in this setup';
  if (value === null) return 'Couldn’t check';
  return value ? 'Saved' : 'No saved text';
}

export default function J27Overview({ context, requestId, reviewerProgress, onSelectTab,
  initialRationaleEnabled, meetingRosterEnabled }) {
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
        r.presentation === null ? { presentation: false, roster: false }
          : r.presentation?.id && typeof r.stale === 'boolean'
            ? { presentation: true, roster: Boolean(r.roster) && !r.stale }
            : null
      )) : undefined,
    ];
    Promise.allSettled(reads).then(results => {
      if (controller.signal.aborted) return;
      const [rationale, review, visit, meeting] = results.map(r => r.status === 'fulfilled' ? r.value : null);
      setLoaded({ requestId, rationale, review, visit,
        presentation: meeting?.presentation ?? meeting, roster: meeting?.roster ?? meeting });
    });
    return () => controller.abort();
  }, [requestId, initialRationaleEnabled, meetingRosterEnabled]);

  const handoff = loaded?.requestId === requestId ? loaded : null;
  const terminal = terminalClasses.has(context.statusClass);
  const action = terminal || (handoff && reviewerProgress.status !== 'loading')
    ? nextAction(context, handoff, reviewerProgress.data) : null;
  const firstCut = context.phaseIStatusLabel || (context.phaseIStatus == null ? 'Not set'
    : context.phaseIStatus === FIRST_CUT_STATUS.yes ? 'Scored'
      : context.phaseIStatus === FIRST_CUT_STATUS.no ? 'Not Scored' : 'Status recorded');
  const received = reviewerProgress.data?.counts?.received;
  const reports = reviewerProgress.status === 'loading' ? 'Checking reports…'
    : Number.isFinite(received) ? `${received} ${received === 1 ? 'report' : 'reports'} received`
      : 'Couldn’t check reports';

  return (
    <Card hover={false}>
      <section aria-labelledby="j27-overview-heading">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Where this request stands</p>
        <h2 id="j27-overview-heading" className="mt-1 text-xl font-semibold text-gray-900">
          {action?.heading || 'Checking the saved handoffs…'}
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Request status <span className="font-medium text-gray-900">{context.requestStatus || 'Not set'}</span>
        </p>
        {action?.detail && <p className="mt-2 text-sm text-gray-700">{action.detail}</p>}
        {action?.tab && onSelectTab && (
          <button type="button" onClick={() => onSelectTab(action.tab)}
            className="mt-3 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700">
            {action.label}
          </button>
        )}
        {handoff && (
          <dl className="mt-5 grid gap-3 border-t border-gray-200 pt-4 text-sm sm:grid-cols-3">
            <div><dt className="font-semibold">Initial Assessment</dt>
              <dd className="text-gray-600">First Cut · {firstCut}</dd>
              {initialRationaleEnabled && <dd className="text-gray-600">Staff rationale · {savedLabel(handoff.rationale)}</dd>}
            </div>
            <div><dt className="font-semibold">Peer Review</dt>
              <dd className="text-gray-600">{reports}</dd>
              <dd className="text-gray-600">Staff review summary · {savedLabel(handoff.review)}</dd>
            </div>
            <div><dt className="font-semibold">Deliberations</dt>
              <dd className="text-gray-600">Visit assessment · {savedLabel(handoff.visit)}</dd>
              {meetingRosterEnabled && <dd className="text-gray-600">Attendance · {handoff.roster === true ? 'Confirmed'
                : handoff.roster === false ? 'No current confirmation' : 'Couldn’t check'}</dd>}
            </div>
          </dl>
        )}
      </section>
    </Card>
  );
}
