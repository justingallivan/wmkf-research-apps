/**
 * Shared four-stop Staff Deliberations rail (PC Meeting Tracker slice 3,
 * docs/PC_MEETING_TRACKER_PLAN.md D6). Stage keys are code-owned
 * (shared/utils/deliberation-stage.js); labels are admin-editable and passed
 * in from the caller (falls back to DELIBERATION_STAGE_DEFAULT_LABELS).
 * Used by both StaffDeliberationsTab.js (per-request) and
 * StaffDeliberationsPanel.js (one compact rail per cycle-view row).
 *
 * At the draft stage the first stop reads the substate (No draft yet /
 * Generating draft / Draft failed) in neutral gray; the green admin label is
 * reserved for a draft that actually exists (`ready`).
 */

import {
  DELIBERATION_STAGE_KEYS,
  DELIBERATION_STAGE_DEFAULT_LABELS,
  draftStopText,
} from '../../utils/deliberation-stage';

export default function DeliberationStageRail({ stage, substate = null, labels = {}, reopened = false }) {
  const currentIndex = DELIBERATION_STAGE_KEYS.indexOf(stage);
  const noDraftYet = stage === 'draft' && substate !== 'ready';
  return (
    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold" data-testid="stage-rail">
      {DELIBERATION_STAGE_KEYS.map((key, index) => (
        <span key={key} className="flex items-center gap-2">
          {index > 0 && <span className="text-gray-300">──</span>}
          <span className={index < currentIndex
            ? 'text-gray-500'
            : index === currentIndex
              ? (noDraftYet ? 'text-gray-700' : 'text-green-800')
              : 'text-gray-300'}
          >
            {index < currentIndex ? '✓' : index === currentIndex ? '●' : '○'}{' '}
            {key === 'draft'
              ? draftStopText({ stage, substate, labels })
              : (labels[key] || DELIBERATION_STAGE_DEFAULT_LABELS[key])}
          </span>
        </span>
      ))}
      {reopened && (
        <span className="inline-flex min-h-6 items-center rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
          reopened
        </span>
      )}
    </p>
  );
}
