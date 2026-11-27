/**
 * Ownership: view module: renders search controls; controller owns state and operation hooks own commands.
 */
import ReviewerPromptOverridePanel from '../ReviewerPromptOverridePanel';
import { Spinner } from './SearchPrimitives';

// The search-card controls are a markup-only view. Workflow state and commands
// remain owned by useReviewerSearchController and the operation hooks.
const SEARCH_SOURCES = [
  { key: 'pubmed', label: 'PubMed', icon: '📚', desc: 'Biomedical' },
  { key: 'arxiv', label: 'ArXiv', icon: '📄', desc: 'Physics, math, CS' },
  { key: 'biorxiv', label: 'BioRxiv', icon: '🧬', desc: 'Life sciences' },
  { key: 'chemrxiv', label: 'ChemRxiv', icon: '🧪', desc: 'Chemistry' },
];

export default function SearchControls({
  busy,
  showPromptEditor,
  onTogglePromptEditor,
  onClosePromptEditor,
  blobUrl,
  phase,
  searchSources,
  noSourcesSelected,
  onToggleSource,
  reviewerCount,
  onReviewerCountChange,
  additionalNotes,
  onAdditionalNotesChange,
  referredSeedsText,
  onReferredSeedsChange,
  referredBy,
  onReferredByChange,
  excludeText,
  onExcludeChange,
  exclusionsUnavailable,
  excludedRaw,
  error,
  errorMeta,
  finishStaffDiscovery,
  savedPool,
  previousSearchKeys,
  promotionNotice,
  progress,
  rosterLoadFailed,
  retryRosterLoad,
  runSearch,
  rosterLoaded,
  removingPrevious,
}) {
  const refused = errorMeta?.status === 'analysis_refused';
  const handoff = errorMeta?.status === 'discovery_handoff';
  const expertiseRetry = refused || errorMeta?.mode === 'expertise';
  const { model, primaryModel, fallbackModel } = errorMeta?.models || {};
  const switchToPrimary = refused && model === fallbackModel && primaryModel && primaryModel !== model;
  const alternate = switchToPrimary ? primaryModel : fallbackModel;
  const refusalChoice = refused && model && alternate && alternate !== model;
  const canSwitch = refusalChoice || (errorMeta?.analyzing && !handoff && !expertiseRetry && errorMeta.mode !== 'staff'
    && errorMeta.mode !== 'fallback' && (!errorMeta.models?.model || (alternate && alternate !== errorMeta.models.model)));
  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <p className="font-medium text-gray-900">Search for reviewers</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onTogglePromptEditor}
            className="text-xs text-gray-500 hover:text-gray-800"
            title="Edit your personal copy of the analysis / scoring prompts"
          >
            ✎ {showPromptEditor ? 'Hide prompt editor' : 'Edit prompts'}
          </button>
          {busy && <Spinner />}
        </div>
      </div>

      {showPromptEditor && (
        <div className="mb-3">
          <ReviewerPromptOverridePanel onClose={onClosePromptEditor} />
        </div>
      )}

      {!blobUrl && (
        <p className="text-sm text-gray-600">Load a proposal document above to search for new reviewers. Candidates already found for this request appear below.</p>
      )}

      {blobUrl && (phase === 'idle' || phase === 'error') && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Searches the selected literature sources using the loaded proposal, verifies expertise, and flags conflicts.
          </p>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Search sources:</label>
            <div className="flex gap-2 flex-wrap">
              {SEARCH_SOURCES.map(({ key, label, icon, desc }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onToggleSource(key)}
                  aria-pressed={searchSources[key]}
                  className={`px-3 py-1.5 rounded-lg border text-xs transition-colors flex flex-col items-center min-w-[80px] ${
                    searchSources[key]
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-gray-50 border-gray-200 text-gray-400'
                  }`}
                >
                  <span className="text-base leading-none">{icon}</span>
                  <span className="font-medium">{label}</span>
                  <span className="opacity-75">{desc}</span>
                </button>
              ))}
            </div>
            {noSourcesSelected && (
              <p className="text-xs text-amber-700 mt-1">Select at least one source to search.</p>
            )}
          </div>
          <div>
            <label htmlFor="reviewer-count" className="block text-xs text-gray-500 mb-1">
              Number of candidates to find: <span className="font-medium text-gray-700">{reviewerCount}</span>
            </label>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 w-4">1</span>
              <input
                id="reviewer-count"
                type="range"
                min="1"
                max="25"
                step="1"
                value={reviewerCount}
                onChange={(e) => onReviewerCountChange(parseInt(e.target.value, 10))}
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <span className="text-xs text-gray-400 w-6 text-right">25</span>
            </div>
          </div>
          <div>
            <label htmlFor="additional-notes" className="block text-xs text-gray-500 mb-1">
              Additional context for Claude (optional):
            </label>
            <textarea
              id="additional-notes"
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white"
              rows={2}
              value={additionalNotes}
              onChange={(e) => onAdditionalNotesChange(e.target.value)}
              placeholder="e.g. prioritize clinical trialists; avoid industry-affiliated reviewers"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_220px]">
            <div>
              <label htmlFor="referred-seeds" className="block text-xs text-gray-500 mb-1">
                Externally-referred reviewers (optional):
              </label>
              <textarea
                id="referred-seeds"
                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white"
                rows={2}
                value={referredSeedsText}
                onChange={(e) => onReferredSeedsChange(e.target.value)}
                placeholder="e.g. Jane Smith, jane@uni.edu, University of Example"
              />
            </div>
            <div>
              <label htmlFor="referred-by" className="block text-xs text-gray-500 mb-1">
                Referred by (optional):
              </label>
              <input
                id="referred-by"
                type="text"
                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white"
                value={referredBy}
                onChange={(e) => onReferredByChange(e.target.value)}
                placeholder="Reviewer name"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Exclude these reviewers (one per line or comma-separated){exclusionsUnavailable ? ' — applicant list unavailable, add any by hand' : ''}:
            </label>
            <textarea
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white"
              rows={2}
              value={excludeText}
              onChange={onExcludeChange}
              placeholder="e.g. Thomas K. Wood, Jens Hör"
            />
            {exclusionsUnavailable && (
              <p className="text-xs text-amber-700 mt-1">The applicant exclusion list couldn't be loaded — add exclusions manually above.</p>
            )}
            {excludedRaw && (
              <details className="mt-2">
                <summary className="text-xs text-gray-500 cursor-pointer">Applicant's original text</summary>
                <pre className="text-xs bg-gray-50 text-gray-700 rounded p-2 mt-1 whitespace-pre-wrap">{excludedRaw}</pre>
              </details>
            )}
          </div>
          {error && !promotionNotice && (
            <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
              {errorMeta?.status === 'analysis_invalid' ? (
                <>
                  The proposal analysis response was incomplete or unreliable. Please retry the analysis.
                  {errorMeta.retryable && <span className="block text-xs mt-1">Use Try again to rerun the analysis.</span>}
                </>
              ) : errorMeta?.status === 'analysis_refused' ? (
                <>
                  {model ? `${model} declined this reviewer search.` : 'The analysis model declined this request.'}
                  <span className="block text-xs mt-1">{refusalChoice
                    ? 'You can retry the original search with the other model using your current settings.'
                    : 'No other configured model is available for this retry.'}</span>
                  <span className="block text-xs mt-1">Find can read the proposal for panel expertise, then use those specialties to find reviewers.</span>
                </>
              ) : (
                <>
                  {error}
                  {previousSearchKeys.size > 0 && (
                    <span className="block text-xs mt-1">
                      The previously found candidates below are unchanged; this attempt did not replace them.
                    </span>
                  )}
                </>
              )}
            </div>
          )}
          {error && errorMeta?.models?.model && <p className="mb-2 text-xs text-gray-600">Analysis model: {errorMeta.models.model}</p>}
          {expertiseRetry && errorMeta?.mode === 'expertise' && !handoff && <button type="button"
            disabled={!rosterLoaded || removingPrevious} onClick={() => runSearch('staff')}
            className="mr-3 px-3 py-2 border rounded-lg text-sm">Assign staff search to me</button>}
          {handoff && <div className="my-2 text-sm">
            <p>Use the manual reviewer form below to save a reviewer to Candidates. The case owner can then complete discovery.</p>
            {(savedPool || []).filter(row => row.suggestionId).map(row => (
              <button key={row.suggestionId} type="button" onClick={() => finishStaffDiscovery(row.suggestionId)}
                className="my-2 mr-2 px-3 py-2 border rounded-lg">Complete discovery with {row.name}</button>
            ))}
          </div>}
          {phase === 'idle' && !rosterLoadFailed && <button type="button"
            disabled={noSourcesSelected || !rosterLoaded || removingPrevious} onClick={() => runSearch('expertise')}
            className="mr-3 px-3 py-2 border rounded-lg text-sm">Find reviewers by proposal expertise</button>}
          {canSwitch && <button type="button" disabled={noSourcesSelected || !rosterLoaded || removingPrevious}
            onClick={() => runSearch(switchToPrimary ? 'standard' : 'fallback')} className="mr-3 px-3 py-2 border rounded-lg text-sm">
            Retry with {alternate || 'the configured alternate model'}
          </button>}
          <button
            type="button"
            onClick={rosterLoadFailed ? retryRosterLoad : () => runSearch(expertiseRetry ? 'expertise' : 'standard')}
            disabled={!rosterLoadFailed && (noSourcesSelected || !rosterLoaded || removingPrevious || handoff)}
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {rosterLoadFailed
              ? 'Retry reviewer state'
              : !rosterLoaded
              ? 'Loading existing candidates…'
              : handoff ? 'Staff discovery open' : expertiseRetry
                ? 'Find reviewers by proposal expertise'
                : phase === 'error' ? 'Try again' : 'Run reviewer search'}
          </button>
        </div>
      )}

      {phase === 'running' && (
        <div className="space-y-2">
          <p className="text-sm text-gray-600">Searching… this can take several minutes — please keep this tab open.</p>
          <ul className="text-xs text-gray-500 space-y-0.5">
            {progress.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      )}
    </>
  );
}
