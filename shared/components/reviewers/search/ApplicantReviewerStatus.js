import { Card } from '../../Layout';
import { Spinner } from './SearchPrimitives';

export default function ApplicantReviewerStatus({
  ingestLoading,
  recPhase,
  ingestError,
  onRetryIngestion,
  recommended,
  recommendedFailed,
  slotsPopulated,
  knownLookupFailed,
  blobUrl,
  recCount,
  recProgress,
  recVerifiedCount,
  recIdentityReviewCount,
  enrichRecommended,
  proposalKey,
  recError,
}) {
  return (
    <Card hover={false}>
      <div className="flex items-center justify-between mb-2">
        <p className="font-medium text-gray-900">Applicant-referred reviewers</p>
        {(ingestLoading || recPhase === 'running') && <Spinner />}
      </div>

      {ingestError ? (
        <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
          Couldn't ingest applicant reviewers: {ingestError}{' '}
          <button type="button" onClick={onRetryIngestion} className="underline font-medium">Retry</button>
        </div>
      ) : ingestLoading ? (
        <p className="text-sm text-gray-500">Materializing the applicant's recommended reviewers…</p>
      ) : (recommended.length === 0 && recommendedFailed.length === 0 && slotsPopulated === 0) ? (
        <p className="text-sm text-gray-600">The applicant did not list any recommended reviewers for this request.</p>
      ) : (recommended.length === 0 && recommendedFailed.length === 0 && slotsPopulated === null) ? (
        <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
          Couldn't confirm the applicant's recommended reviewers.{' '}
          <button type="button" onClick={onRetryIngestion} className="underline font-medium">Retry</button>
        </div>
      ) : (
        <div className="space-y-3">
          {recommendedFailed.length > 0 && (
            <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
              {recommendedFailed.length} of {slotsPopulated ?? (recommended.length + recommendedFailed.length)}{' '}
              applicant-recommended reviewer{recommendedFailed.length === 1 ? '' : 's'} failed to ingest
              {recommendedFailed.some((f) => f.name) && (
                <> ({recommendedFailed.map((f) => f.name).filter(Boolean).join(', ')})</>
              )}
              . They are <span className="font-medium">not</span> saved as candidates.{' '}
              <button type="button" onClick={onRetryIngestion} className="underline font-medium">Retry</button>
            </div>
          )}
          {knownLookupFailed.length > 0 && (
            <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
              {knownLookupFailed.length} materialized reviewer record{knownLookupFailed.length === 1 ? '' : 's'} could not be safely hydrated from Dataverse.{' '}
              <button type="button" onClick={onRetryIngestion} className="underline font-medium">Retry</button>
            </div>
          )}
          {recommended.length > 0 && (
            <ul className="space-y-2">
              {recommended.map((row) => {
                const known = row.applicantKnownReviewer;
                return (
                  <li key={row.suggestionId || row.potentialReviewerId} className="p-2 border border-gray-200 rounded text-xs text-gray-700">
                    <div className="font-medium">{known?.name || row.name || 'Applicant-recommended reviewer'}</div>
                    {known?.status === 'known' ? (
                      <>
                        <div className="text-emerald-700">✓ Existing linked reviewer record</div>
                        {known.affiliation && <div>{known.affiliation}</div>}
                        {known.orcid && <div>ORCID {known.orcid}</div>}
                        <div>
                          {known.email || 'No stored email'}
                          {known.emailReadiness?.action ? ` · ${known.emailReadiness.action}` : ''}
                        </div>
                      </>
                    ) : (
                      <div className="text-amber-700">
                        Existing linked record needs repair ({known?.code || 'person_unavailable'}).
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {recPhase === 'idle' && !blobUrl && recCount > 0 && (
            <p className="text-sm text-gray-500">
              {recCount} applicant-referred reviewer{recCount === 1 ? '' : 's'} ingested — waiting for the proposal to load before verifying.
            </p>
          )}
          {recPhase === 'running' && (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">Verifying applicant-referred reviewers — this can take a minute or two, please keep this tab open.</p>
              <ul className="text-xs text-gray-500 space-y-0.5">
                {recProgress.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}
          {recPhase === 'done' && (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">
                {recVerifiedCount === 0 && recIdentityReviewCount === 0
                  ? 'No applicant-referred reviewers could be verified.'
                  : <>
                      {recVerifiedCount > 0
                        ? `${recVerifiedCount} applicant-referred reviewer${recVerifiedCount === 1 ? '' : 's'} verified — see the Applicant-referred section above`
                        : 'No reviewers added to the Applicant-referred section'}
                      {recIdentityReviewCount > 0 && <>; {recIdentityReviewCount} could not be confirmed — see the Identity review section</>}.
                    </>}
              </p>
              {recCount > 0 && (
                <button
                  type="button"
                  onClick={() => enrichRecommended()}
                  disabled={!blobUrl || !proposalKey}
                  className="px-3 py-1.5 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Update applicant suggestions
                </button>
              )}
            </div>
          )}
          {recPhase === 'error' && (
            <div className="space-y-2">
              <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">{recError}</div>
              <button
                type="button"
                onClick={() => enrichRecommended()}
                disabled={!blobUrl || !proposalKey}
                className="px-3 py-1.5 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
