/**
 * Scope segment — the "Assigned to me / All in program" request-scope control
 * shared by Request list, Reviewer follow-up, and Awardees (Slice B of the
 * Workbench top-matter reconciliation, 2026-09-08). One small component so the
 * three `scope` consumers present the same label, options, and visual style.
 */

import { TOOLBAR_CONTROL_HEIGHT_CLASS } from '../ToolbarSelect';

/**
 * @param {object} props
 * @param {'my'|'all'} props.scope
 * @param {Function} props.onChange   (scope) => void
 * @param {number} [props.myCount]    optional count appended to "Assigned to me"
 * @param {string} [props.allLabel]   label for the "all" option (default "All in program")
 */
export default function ScopeSegment({ scope, onChange, myCount, allLabel = 'All in program' }) {
  // A div + span label rather than fieldset + legend: a legend does not take
  // part in the flex column's gap, so "Scope" rendered lower than the sibling
  // ToolbarSelect labels (owner, 2026-09-10).
  return (
    <div role="group" aria-labelledby="scope-segment-label" className="flex flex-col gap-1.5">
      <span id="scope-segment-label" className="text-sm font-medium text-gray-700">Scope</span>
      <div className={`inline-flex ${TOOLBAR_CONTROL_HEIGHT_CLASS} overflow-hidden rounded-xl border border-gray-300 bg-white`}>
        <button
          type="button"
          onClick={() => onChange('my')}
          aria-pressed={scope === 'my'}
          className={`px-4 py-2 text-sm font-semibold ${scope === 'my' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
        >
          {Number.isFinite(myCount) ? `Assigned to me (${myCount})` : 'Assigned to me'}
        </button>
        <button
          type="button"
          onClick={() => onChange('all')}
          aria-pressed={scope === 'all'}
          className={`border-l border-gray-300 px-4 py-2 text-sm font-semibold ${scope === 'all' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
        >
          {allLabel}
        </button>
      </div>
    </div>
  );
}
