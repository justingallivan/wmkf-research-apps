/**
 * Ownership: view module: renders handled reviewers; controller owns state and operation hooks own commands.
 */
import { Card } from '../../Layout';
import { Pill } from './SearchPrimitives';
import { REDISCOVERED_STAGE_LABELS } from '../../../utils/reviewer-rediscovery';

export default function HandledReviewers({ handledReviewers, onNavigate }) {
  if (handledReviewers.length === 0) return null;
  return (
    <Card hover={false}>
      <div className="flex items-center justify-between mb-2">
        <p className="font-medium text-gray-900">Already handled</p>
        <span className="text-xs text-gray-500">Not actionable in Find</span>
      </div>
      <ul className="space-y-2">
        {handledReviewers.map((reviewer) => (
          <li key={reviewer.candidateKey || reviewer.suggestionId || reviewer.name} className="flex items-center justify-between gap-3 text-sm border border-gray-200 rounded p-2">
            <span className="min-w-0">
              <span className="font-medium text-gray-900">{reviewer.name}</span>
              {reviewer.rediscovered && <Pill tone="blue">Re-found by search</Pill>}
              <span className="ml-2 text-gray-500">
                {reviewer.rediscovered
                  ? (REDISCOVERED_STAGE_LABELS[reviewer.stage] || String(reviewer.stage || 'handled').replaceAll('_', ' '))
                  : String(reviewer.stage || 'handled').replaceAll('_', ' ')}
              </span>
              {reviewer.rediscovered && reviewer.affiliation && (
                <span className="block text-xs text-gray-400 truncate">{reviewer.affiliation}</span>
              )}
            </span>
            <button
              type="button"
              onClick={() => onNavigate?.(['selected', 'declined', 'invited'].includes(reviewer.stage) ? 'candidates' : 'track')}
              disabled={!onNavigate}
              className="text-xs text-amber-900 underline whitespace-nowrap"
            >
              {['selected', 'invited'].includes(reviewer.stage)
                ? 'Open Invite'
                : reviewer.stage === 'declined'
                  ? 'Open Removed'
                  : 'Open Track'}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
