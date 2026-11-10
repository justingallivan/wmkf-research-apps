/**
 * The J27 Research cycle page's request list: one row shape on every request
 * tab (design brief docs/plans/J27_CYCLE_PAGE_DESIGN_BRIEF_2026-11-09.md).
 * Left: who the request is (number and institution / title / PI and PD).
 * Right: where it stands (chip) and what is next (one line).
 *
 * Read-only. The shell loads the rows once (useJ27CycleRows) and owns every
 * filter in the URL; this component filters and renders. Chip, line, filters
 * and counts are decided in shared/utils/j27CycleRows.js.
 */
import Link from 'next/link';
import { Card } from '../Layout';
import ScopeSegment from './ScopeSegment';
import TestRequestBadge from '../TestRequestBadge';
import { TOOLBAR_CONTROL_HEIGHT_CLASS, TOOLBAR_SELECT_CLASS } from '../ToolbarSelect';
import { useUrlMirroredInput } from './useUrlMirroredInput';
import ReviewerStatusIndicator from './ReviewerStatusIndicator';
import { J27_PHASE_LABEL, J27_STANDING_LABEL } from '../../config/j27Labels';
import {
  J27_SHOWING_KEYS, J27_SHOWING_LABEL, J27_STANDING_KEYS, isClosedRow, matchesPhaseFilters, matchesSearch, matchesShowing,
  rowChip, rowLine, rowNotes, rowsForTab, standingCounts,
} from '../../utils/j27CycleRows';

// Reviewer stage chips keep the colors the Request list uses today; every
// other chip is neutral, except Awarded (design brief, "Color").
const REVIEWER_STAGE_TONE = {
  find: 'bg-rose-100 text-rose-800',
  invite: 'bg-amber-100 text-amber-800',
  awaiting: 'bg-blue-100 text-blue-800',
  review: 'bg-indigo-100 text-indigo-800',
  done: 'bg-green-100 text-green-800',
};
const NEUTRAL_TONE = 'bg-gray-100 text-gray-700';

function chipTone(chip) {
  if (chip.kind === 'reviewer-stage') return REVIEWER_STAGE_TONE[chip.key] || NEUTRAL_TONE;
  if (chip.kind === 'closed' && chip.key === 'decided-award') return 'bg-green-100 text-green-800';
  return NEUTRAL_TONE;
}

const PHASES_WITH_A_PAGE_TAB = new Set(['initial-assessment', 'peer-review', 'deliberations', 'final-assessment']);

/** The request page, on the request's current phase. */
export function j27RequestHref(row) {
  const params = new URLSearchParams();
  if (PHASES_WITH_A_PAGE_TAB.has(row.j27?.phase)) params.set('tab', row.j27.phase);
  if (row.requestNumber) params.set('n', row.requestNumber);
  const query = params.toString();
  return `/workbench/${row.requestId}${query ? `?${query}` : ''}`;
}

// Peer Review rows add reviewer progress at the right, as on today's Request
// list; no other tab shows it (owner, 2026-11-09).
const ROW_GRID = 'lg:grid-cols-[minmax(0,1fr)_22rem]';
const ROW_GRID_WITH_REVIEWERS = 'lg:grid-cols-[minmax(0,1fr)_18rem_16rem]';

function RequestRow({ row, showReviewers }) {
  const chip = rowChip(row);
  const line = rowLine(row);
  const notes = rowNotes(row);
  const people = [
    row.projectLeader && `PI ${row.projectLeader}`,
    row.programDirector && `PD ${row.programDirector}`,
  ].filter(Boolean).join(' · ');
  return (
    <li className={`relative grid grid-cols-1 gap-x-8 gap-y-2 px-4 py-3 transition-colors hover:bg-gray-50 focus-within:bg-gray-50 lg:items-start ${showReviewers ? ROW_GRID_WITH_REVIEWERS : ROW_GRID}`}>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {/* Stretched link: the whole row opens the request, and it is a real
              link (new tab, copy address). */}
          <Link
            href={j27RequestHref(row)}
            className="shrink-0 font-semibold tabular-nums text-gray-900 after:absolute after:inset-0 after:content-[''] focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-gray-500"
          >
            #{row.requestNumber}
          </Link>
          <TestRequestBadge isTestRequest={row.isTestRequest} />
          {row.institution && <span className="min-w-0 truncate text-sm text-gray-900">{row.institution}</span>}
        </div>
        <div className="mt-0.5 truncate text-sm text-gray-700" title={row.title || undefined}>
          {row.title || 'Untitled request'}
        </div>
        {people && <div className="mt-0.5 truncate text-xs text-gray-500">{people}</div>}
      </div>
      <div className="min-w-0">
        {chip && (
          <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${chipTone(chip)}`}>
            {chip.label}
          </span>
        )}
        {line.kind === 'next' && <p className="mt-1 text-sm text-gray-900">Next: {line.text}</p>}
        {line.kind === 'wait' && <p className="mt-1 text-sm text-gray-600">{line.text}</p>}
        {line.kind === 'idle' && <p className="mt-1 text-sm text-gray-500">{line.text}</p>}
        {notes.map((note) => (
          <p key={note.kind} className={`mt-0.5 text-xs ${note.kind === 'outstanding' ? 'font-medium text-amber-800' : 'text-gray-500'}`}>{note.text}</p>
        ))}
      </div>
      {showReviewers && (
        <div className="lg:[&>div]:items-end">
          <ReviewerStatusIndicator reviewers={row.reviewers} />
        </div>
      )}
    </li>
  );
}

function PlaceholderRows() {
  return (
    <ul aria-hidden="true" className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {[0, 1, 2, 3, 4].map((index) => (
        <li key={index} className="grid grid-cols-1 gap-x-8 gap-y-2 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-2">
            <div className="h-4 w-2/5 rounded bg-gray-100" />
            <div className="h-4 w-4/5 rounded bg-gray-100" />
            <div className="h-3 w-1/3 rounded bg-gray-100" />
          </div>
          <div className="space-y-2">
            <div className="h-6 w-28 rounded-full bg-gray-100" />
            <div className="h-4 w-3/5 rounded bg-gray-100" />
          </div>
        </li>
      ))}
    </ul>
  );
}

const EMPTY_PHASE = {
  'initial-assessment': 'No requests are in Initial Assessment. A request arrives here when it is marked ready for review.',
  'peer-review': 'No requests are in Peer Review yet. A request arrives here once the Chairs’ outcome is recorded as Invited.',
};

/**
 * @param {object} props
 * @param {'requests'|'initial-assessment'|'peer-review'} props.tab
 * @param {{rows: Array, hasSnapshot: boolean, loading: boolean, error: string|null, reload: Function}} props.rowsState
 * @param {boolean} props.loadingCycles   the shell is still resolving the cycle
 * @param {'my'|'all'} props.scope        the scope in effect
 * @param {number} [props.myCount]
 * @param {Function} props.onScopeChange
 * @param {string} props.search           All requests only
 * @param {Function} props.onSearchChange
 * @param {string} props.showing          All requests only
 * @param {Function} props.onShowingChange
 * @param {boolean} props.showClosed      phase tabs only
 * @param {Function} props.onShowClosedChange
 * @param {string} props.standing         Initial Assessment only; '' = all
 * @param {Function} props.onStandingChange
 * @param {React.ReactNode} [props.leading] section switch, first in the control row
 */
export default function J27RequestList({
  tab,
  rowsState,
  loadingCycles = false,
  scope,
  myCount,
  onScopeChange,
  search = '',
  onSearchChange = () => {},
  showing = 'open',
  onShowingChange = () => {},
  showClosed = false,
  onShowClosedChange = () => {},
  standing = '',
  onStandingChange = () => {},
  leading = null,
}) {
  const allRequests = tab === 'requests';
  const [searchInput, setSearchInput] = useUrlMirroredInput(search, onSearchChange);
  const { rows, hasSnapshot, loading, error, reload } = rowsState;

  const tabRows = rowsForTab(rows, tab);
  const closedCount = tabRows.filter(isClosedRow).length;
  const query = allRequests ? searchInput : '';
  const standingFilter = tab === 'initial-assessment' ? standing : '';
  const byStanding = tab === 'initial-assessment' ? standingCounts(tabRows) : null;
  const visible = tabRows.filter((row) => (allRequests
    ? matchesShowing(row, showing) && matchesSearch(row, query)
    : matchesPhaseFilters(row, { showClosed, standing: standingFilter })));
  const hiddenClosed = (allRequests ? showing === 'open' : !showClosed && !standingFilter) ? closedCount : 0;
  const searching = query.trim().length > 0;
  const showLoading = loadingCycles || (!hasSnapshot && !error);
  const revealClosed = () => (allRequests ? onShowingChange('everything') : onShowClosedChange(true));
  const hiddenLink = hiddenClosed > 0 && (
    <button type="button" className="underline hover:text-gray-900" onClick={revealClosed}>
      {hiddenClosed} closed request{hiddenClosed === 1 ? '' : 's'} hidden
    </button>
  );

  return (
    <section aria-label={allRequests ? 'All requests' : J27_PHASE_LABEL[tab]}>
      <div className="mb-2 flex flex-wrap items-end gap-4">
        {leading}
        <ScopeSegment scope={scope} onChange={onScopeChange} myCount={myCount} />
        {allRequests ? (
          <>
            <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium text-gray-700">
              Search
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="PI, institution, title or number"
                className={`${TOOLBAR_CONTROL_HEIGHT_CLASS} w-full max-w-md rounded-xl border border-gray-300 bg-white px-4 text-base font-normal text-gray-900 shadow-sm placeholder:text-gray-500 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400/30`}
              />
            </label>
            <label className="flex w-56 flex-col gap-1.5 text-sm font-medium text-gray-700">
              Showing
              <select
                value={showing}
                onChange={(event) => onShowingChange(event.target.value)}
                className={`${TOOLBAR_SELECT_CLASS} font-normal`}
              >
                {J27_SHOWING_KEYS.map((key) => <option key={key} value={key}>{J27_SHOWING_LABEL[key]}</option>)}
              </select>
            </label>
          </>
        ) : (
          <>
          {byStanding && (
            <div role="group" aria-label="Standing" className={`flex ${TOOLBAR_CONTROL_HEIGHT_CLASS} flex-wrap items-center gap-2`}>
              {['', ...J27_STANDING_KEYS].map((key) => {
                const count = key ? byStanding[key] : null;
                const selected = standingFilter === key;
                return (
                  <button
                    key={key || 'all'}
                    type="button"
                    disabled={Boolean(key) && count === 0}
                    aria-pressed={selected}
                    onClick={() => onStandingChange(key)}
                    className={`rounded-full border px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                      selected ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {key ? `${J27_STANDING_LABEL[key]} (${count})` : 'All'}
                  </button>
                );
              })}
            </div>
          )}
          <label className={`flex ${TOOLBAR_CONTROL_HEIGHT_CLASS} items-center gap-2 text-sm font-medium text-gray-700`}>
            <input
              type="checkbox"
              className="rounded border-gray-300"
              checked={showClosed}
              onChange={(event) => onShowClosedChange(event.target.checked)}
            />
            Show closed
          </label>
          </>
        )}
      </div>

      {hasSnapshot && !showLoading && (
        <p className="mb-4 text-sm text-gray-600" aria-live="polite">
          <span className="font-semibold text-gray-900">{visible.length}</span> request{visible.length === 1 ? '' : 's'}
          {hiddenLink && <> · {hiddenLink}</>}
        </p>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          <span>{error}</span>{' '}
          <button type="button" className="font-medium underline" onClick={reload}>Retry</button>
        </div>
      )}

      {loading && hasSnapshot && <p className="mb-3 text-xs text-gray-500" role="status">Updating…</p>}

      {error && !hasSnapshot ? null : showLoading ? (
        <div role="status" aria-label="Loading requests"><PlaceholderRows /></div>
      ) : visible.length === 0 ? (
        <Card hover={false}>
          {searching ? (
            <p className="text-gray-700">
              No requests match “{query.trim()}”.{' '}
              <button type="button" className="font-medium underline" onClick={() => setSearchInput('')}>Clear search</button>
            </p>
          ) : (
            <p className="text-gray-700">
              {allRequests
                ? (showing === 'open' || showing === 'everything'
                  ? 'No requests to show for this program, cycle and scope.'
                  : `No requests ended as ${J27_SHOWING_LABEL[showing]}.`)
                : EMPTY_PHASE[tab]}
            </p>
          )}
        </Card>
      ) : (
        <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {visible.map((row) => <RequestRow key={row.requestId} row={row} showReviewers={tab === 'peer-review'} />)}
        </ul>
      )}
    </section>
  );
}
