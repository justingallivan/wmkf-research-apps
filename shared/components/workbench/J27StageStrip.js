/**
 * Minimal read-only strip for J27 Research requests (step E): the derived
 * phase, the primary task, and the blockers that touch a task of the model.
 * It renders only what the resolve DTO and the page's existing reads provide;
 * it fetches nothing and gates nothing. Label maps are pinned to the read
 * model's vocabularies in tests/unit/j27-page-stage.test.js.
 */
import { J27_BLOCKERS, J27_PHASES, J27_TASKS } from '../../../lib/services/workbench/j27-read-model';

export const J27_PHASE_LABEL = {
  'initial-assessment': 'Initial Assessment',
  'peer-review': 'Peer Review',
  deliberations: 'Deliberations',
  'final-assessment': 'Final Assessment',
  decided: 'Decided',
  unclassified: 'Not classified',
};

export const J27_TASK_LABEL = {
  'record-rationale': 'Record the staff rationale',
  'record-first-cut': 'Record the First Cut decision',
  'record-semi-finalist': 'Record the semi-finalist recommendation',
  'review-integrity': 'Review the integrity findings',
  'identify-reviewers': 'Identify reviewers',
  'send-invitations': 'Send reviewer invitations',
  'read-reports': 'Read the reviewer reports',
  'record-offramp': 'Record an offramp decision if one is needed',
  'confirm-roster': 'Confirm presentation attendance',
  'write-visit-assessment': 'Write the staff visit assessment',
  'write-board-draft': 'Write the Board draft',
  'start-group-review': 'Start group review',
};

export const J27_BLOCKER_LABEL = {
  'chairs-outcome-pending': 'Reviewer invitations wait for the Chairs’ outcome',
  'phase-two-status-pending': 'Reviewer invitations open once the Phase II status is Pending Committee Review',
  'integrity-unreviewed': 'Integrity findings need a Program Director’s review before invitations or scheduling',
  'continue-decision-missing': 'Presentation steps wait for the continue decision',
  'presentation-not-ended': 'Group review starts after the presentation ends',
  'presentation-end-unverified': 'The presentation’s end has not been verified yet',
  'presentation-schedule-unavailable': 'The presentation schedule could not be read',
  'evidence-stale': 'Reviewer reports changed after the staff summary was saved',
  'roster-stale': 'The confirmed attendance no longer matches the presentation',
};

const BASIS_NOTE = {
  partial: 'Some facts load as you open tabs.',
  degraded: 'Some facts could not be read.',
};

/**
 * Blockers that touch a task of the current phase or an earlier one. A blocker on a
 * later phase's task is not yet news; presentation-only blockers wait for step I.
 */
export function visibleBlockerKeys(blockerKeys, phase = null) {
  const phaseIndex = J27_PHASES.indexOf(phase);
  const reachable = new Set(J27_TASKS
    .filter((task) => phaseIndex < 0 || J27_PHASES.indexOf(task.phase) <= phaseIndex)
    .map((task) => task.key));
  return (blockerKeys || []).filter((key) => (J27_BLOCKERS[key] || []).some((op) => reachable.has(op)));
}

export default function J27StageStrip({ stage }) {
  if (!stage || stage.phase === 'unclassified') return null;
  const blockers = visibleBlockerKeys(stage.blockerKeys, stage.phase);
  const note = BASIS_NOTE[stage.basis];
  return (
    <section aria-label="Where this request stands" className="mb-6 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold text-gray-900">{J27_PHASE_LABEL[stage.phase] || stage.phase}</span>
        {stage.primaryTask ? (
          <span>Next: {J27_TASK_LABEL[stage.primaryTask] || stage.primaryTask}</span>
        ) : stage.phase === 'decided' ? null : (
          <span className="text-gray-600">Nothing is waiting on staff right now.</span>
        )}
        {note && <span className="text-gray-500">{note}</span>}
      </div>
      {blockers.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-gray-700">
          {blockers.map((key) => <li key={key}>{J27_BLOCKER_LABEL[key] || key}</li>)}
        </ul>
      )}
    </section>
  );
}
