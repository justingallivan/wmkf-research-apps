/**
 * Ownership: view module: renders identity comparison; controller owns state and operation hooks own commands.
 */
import { IdentityDecision } from './SearchPrimitives';

const IDENTITY_COMPARISON_REASON = {
  spine_works_consensus: 'Both resolvers selected the same identity.',
  spine_retained_without_works_contradiction: 'Legacy identity retained; Works-first found no contradiction.',
  works_rescue: 'Works-first corroborated an identity that Legacy missed.',
  claimed_institution_unresolved: 'The claimed institution could not be resolved confidently.',
  no_institution_corroborated_byline: 'A publication byline was found, but its institution was not corroborated.',
  resolver_anchor_disagreement: 'The resolvers selected different identity anchors.',
  resolver_consensus: 'PubMed and Works-first reached the same identity decision.',
  works_found_identity: 'Works-first corroborated an identity that PubMed did not verify.',
  works_did_not_confirm: 'PubMed verified this reviewer, but Works-first did not independently confirm the identity.',
  resolver_disagreement: 'PubMed and Works-first reached different identity decisions.',
  comparison_failed: 'Works-first did not finish; the PubMed result was retained unchanged.',
};
export function IdentityComparisonPanel({ comparison }) {
  const rows = Array.isArray(comparison?.candidates) ? comparison.candidates : [];
  if (rows.length === 0) return null;
  const isPubMedDiagnostic = comparison.baselineKind === 'pubmed';
  const differences = rows.filter((row) => (isPubMedDiagnostic
    ? row.comparisonStatus === 'available' && row.baselineDecision !== row.worksDecision
    : row.legacyDecision !== row.worksDecision
      || row.legacyDecision !== row.combinedDecision
      || row.combinedReason === 'resolver_anchor_disagreement'));
  const failedComparisons = isPubMedDiagnostic
    ? rows.filter((row) => row.comparisonStatus !== 'available')
    : [];
  const displayedRows = isPubMedDiagnostic
    ? rows.filter((row) => row.comparisonStatus !== 'available' || row.baselineDecision !== row.worksDecision)
    : differences;
  const changedOutcomes = isPubMedDiagnostic
    ? 0
    : rows.filter((row) => row.legacyDecision !== row.combinedDecision).length;
  const mode = comparison.resolverMode || 'unknown';

  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 text-sm text-purple-950" data-testid="identity-comparison-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">Identity resolver comparison (admin)</p>
          <p className="mt-0.5 text-xs text-purple-800">
            {isPubMedDiagnostic
              ? 'This search used PubMed results; Works-first is shown as an admin diagnostic only.'
              : mode === 'shadow'
              ? 'This search still used Legacy results; Combined is shown for evaluation only.'
              : mode === 'combined'
                ? 'Combined supplied the live identity decisions for this search.'
                : `Resolver mode: ${mode}.`}
          </p>
        </div>
        <span className="text-xs text-purple-700">
          {differences.length} difference{differences.length === 1 ? '' : 's'} of {rows.length}
          {isPubMedDiagnostic && failedComparisons.length > 0
            ? <> · {failedComparisons.length} unavailable</>
            : null}
          {!isPubMedDiagnostic && <>{' '}· {changedOutcomes} combined outcome{changedOutcomes === 1 ? '' : 's'} changed</>}
        </span>
      </div>

      {displayedRows.length === 0 ? (
        <p className="mt-3 text-xs text-purple-800">
          {isPubMedDiagnostic
            ? 'PubMed and Works-first agreed for every reviewer.'
            : 'Legacy, Works-first, and Combined agreed for every reviewer.'}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-left text-xs">
            <thead>
              <tr className="text-purple-800">
                <th className="border-b border-purple-200 px-2 py-1.5 font-medium">Reviewer</th>
                <th className="border-b border-purple-200 px-2 py-1.5 font-medium">{isPubMedDiagnostic ? 'PubMed' : 'Legacy'}</th>
                <th className="border-b border-purple-200 px-2 py-1.5 font-medium">Works-first</th>
                {!isPubMedDiagnostic && <th className="border-b border-purple-200 px-2 py-1.5 font-medium">Combined</th>}
                <th className="border-b border-purple-200 px-2 py-1.5 font-medium">Why</th>
              </tr>
            </thead>
            <tbody>
              {displayedRows.map((row) => (
                <tr key={row.candidateKey || `${row.reviewerName}-${row.claimedInstitution}`} className="align-top">
                  <td className="border-b border-purple-100 px-2 py-2">
                    <span className="font-medium">{row.reviewerName || 'Unnamed reviewer'}</span>
                    {row.claimedInstitution && <span className="block text-purple-700">{row.claimedInstitution}</span>}
                  </td>
                  <td className="border-b border-purple-100 px-2 py-2"><IdentityDecision value={isPubMedDiagnostic ? row.baselineDecision : row.legacyDecision} /></td>
                  <td className="border-b border-purple-100 px-2 py-2"><IdentityDecision value={row.worksDecision} /></td>
                  {!isPubMedDiagnostic && <td className="border-b border-purple-100 px-2 py-2"><IdentityDecision value={row.combinedDecision} /></td>}
                  <td className="border-b border-purple-100 px-2 py-2 text-purple-800">
                    {IDENTITY_COMPARISON_REASON[isPubMedDiagnostic ? row.differenceReason : row.combinedReason]
                      || String((isPubMedDiagnostic ? row.differenceReason : row.combinedReason) || 'Unknown reason').replaceAll('_', ' ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-purple-700">
        {isPubMedDiagnostic
          ? 'This named diagnostic exists only in the current browser response and is not part of W2 shadow telemetry.'
          : 'This named comparison exists only in the current browser response; durable telemetry remains pseudonymous.'}
        {comparison.runId ? ` Run ${comparison.runId}.` : ''}
      </p>
    </div>
  );
}
