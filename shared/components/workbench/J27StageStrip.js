/**
 * Minimal read-only strip for J27 Research requests (step E): the derived
 * phase, the primary task, and the blockers that touch a task of the model.
 * It renders only what the resolve DTO and the page's existing reads provide;
 * it fetches nothing and gates nothing. Label maps are pinned to the read
 * model's vocabularies in tests/unit/j27-page-stage.test.js.
 */
import { J27_BLOCKERS, J27_OUTCOMES, J27_PHASES, J27_TASKS } from '../../../lib/services/workbench/j27-read-model';

import { J27_BLOCKER_LABEL, J27_IDLE_LABEL, J27_OUTCOME_LABEL, J27_PHASE_LABEL, J27_TASK_LABEL } from '../../config/j27Labels';

// Labels live in shared/config/j27Labels.js; re-exported under their original names.
export { J27_PHASE_LABEL, J27_TASK_LABEL, J27_BLOCKER_LABEL, J27_OUTCOME_LABEL };
export { J27_OUTCOMES };

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
        {stage.outcome && stage.outcome !== 'none' && J27_OUTCOME_LABEL[stage.outcome] && (
          <span className="rounded-md bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-800">{J27_OUTCOME_LABEL[stage.outcome]}</span>
        )}
        {stage.primaryTask ? (
          <span>Next: {J27_TASK_LABEL[stage.primaryTask] || stage.primaryTask}</span>
        ) : (stage.phase === 'decided' || (stage.outcome && stage.outcome !== 'none')) ? null : (
          <span className="text-gray-600">{J27_IDLE_LABEL}</span>
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
