/**
 * ReviewerFindPanel — the Find sub-tab inside the Request Workbench Reviewers tab
 * (tier-3), Phase 3.
 *
 * This is the applicant-reviewer ingestion surface. On open it:
 *   1. Runs `/api/workbench/applicant-reviewers` (idempotent) to materialize the
 *      request's legacy `wmkf_potentialreviewer1..5` slots into
 *      `disposition=recommended` candidate rows and to parse the free-text
 *      `wmkf_excludedreviewers` into clean names.
 *   2. Auto-loads the request's proposal document via `/api/reviewer-finder/
 *      load-proposal` (the "Find defaults to the request's documents"
 *      modernization — no PDF-upload entry in the Workbench).
 *   3. Surfaces the applicant RECOMMENDED set (badged, now candidates), the
 *      applicant EXCLUDED set (per-request soft-block, badged), and the loaded
 *      proposal — and pre-computes the exclude list staff carry into a search.
 *
 * Per the S210 option-B decision, exclusions are soft-block-only: no structured
 * `disposition=excluded` rows are written, and nothing global is touched, so an
 * exclusion here never affects the person's eligibility on any other request
 * (`[[project-excluded-reviewers-often-in-pool]]`).
 *
 * The full in-panel candidate search (relocating the standalone Reviewer
 * Finder's ~1,400-line search flow, dropping `summaryPages`) is the remaining
 * Phase 3 deep refactor — staff run that search from the standalone Reviewer
 * Finder for now, with the exclude list surfaced here to carry over.
 *
 * Props:
 *   - requestId : the akoya_request GUID (always present)
 *   - context   : light request context from resolve-request (requestNumber, …)
 *   - canManage : soft UI gate (cosmetic; ingestion APIs stay org-open)
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card } from '../Layout';

function Spinner() {
  return <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />;
}

// Composite key the load-proposal endpoint uses to address a specific file.
function fileKeyOf(f) {
  return `${f.library}::${f.folder}::${f.name}`;
}

function Badge({ children, tone = 'gray' }) {
  const tones = {
    gray: 'bg-gray-100 text-gray-700',
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${tones[tone] || tones.gray}`}>
      {children}
    </span>
  );
}

export default function ReviewerFindPanel({ requestId, context }) {
  const [ingest, setIngest] = useState({ loading: true, data: null, error: null });
  const [doc, setDoc] = useState({ loading: true, data: null, error: null });

  const runIngestion = useCallback(async () => {
    if (!requestId) return;
    setIngest({ loading: true, data: null, error: null });
    try {
      const res = await fetch(`/api/workbench/applicant-reviewers?requestId=${encodeURIComponent(requestId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Ingestion failed (${res.status})`);
      }
      setIngest({ loading: false, data, error: null });
    } catch (e) {
      setIngest({ loading: false, data: null, error: e.message });
    }
  }, [requestId]);

  // fileKey is an optional "library::folder::filename" override; when omitted the
  // endpoint auto-picks the proposal best-guess. The manual picker below passes
  // a fileKey so staff can correct a wrong auto-pick (unconventional filenames).
  const loadProposal = useCallback(async (fileKey) => {
    if (!requestId) return;
    setDoc({ loading: true, data: null, error: null });
    try {
      const res = await fetch('/api/reviewer-finder/load-proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fileKey ? { requestId, fileKey } : { requestId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        // Carry allFiles through on a 404 so the picker can still offer a manual
        // choice when the auto-pick found no proposal-classified file.
        const err = new Error(data.error || `Could not load the proposal document (${res.status})`);
        err.allFiles = data.allFiles || null;
        throw err;
      }
      setDoc({ loading: false, data, error: null });
    } catch (e) {
      setDoc({ loading: false, data: null, error: e.message, allFiles: e.allFiles || null });
    }
  }, [requestId]);

  useEffect(() => { runIngestion(); }, [runIngestion]);
  useEffect(() => { loadProposal(); }, [loadProposal]);

  const data = ingest.data;
  const recommended = data?.recommended || [];
  const recommendedFailed = data?.recommendedFailed || [];
  // How many slots the applicant actually populated. `null` when the field is
  // absent (older response / fetch error). Lets us tell a genuine "applicant
  // listed none" from "ingestion failed so the list looks empty."
  const slotsPopulated = typeof data?.slotsPopulated === 'number' ? data.slotsPopulated : null;
  const excluded = data?.excluded || [];
  const excludedRaw = data?.excludedRaw || null;
  const excludedParseFailed = data?.excludedParseFailed || false;

  // File list for the manual override picker — present on a successful load and,
  // via the carried error, on a no-proposal-found 404. Proposal-classified files
  // sort first so the likely choice is at the top.
  const rawFiles = doc.data?.allFiles || doc.allFiles || [];
  const availableFiles = [...rawFiles].sort((a, b) => {
    const ap = a.classification === 'proposal' ? 0 : 1;
    const bp = b.classification === 'proposal' ? 0 : 1;
    return ap - bp || String(a.name).localeCompare(String(b.name));
  });
  const pickedKey = doc.data?.picked || null;

  return (
    <div className="space-y-4">
      {/* Applicant-recommended reviewers */}
      <Card hover={false}>
        <div className="flex items-center justify-between mb-2">
          <p className="font-medium text-gray-900">Applicant-recommended reviewers</p>
          {ingest.loading && <Spinner />}
        </div>

        {ingest.error ? (
          <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
            Couldn’t ingest applicant reviewers: {ingest.error}{' '}
            <button type="button" onClick={runIngestion} className="underline font-medium">Retry</button>
          </div>
        ) : ingest.loading ? (
          <p className="text-sm text-gray-500">Materializing the applicant’s recommended reviewers…</p>
        ) : (recommended.length === 0 && recommendedFailed.length === 0 && slotsPopulated === 0) ? (
          <p className="text-sm text-gray-600">The applicant did not list any recommended reviewers for this request.</p>
        ) : (recommended.length === 0 && recommendedFailed.length === 0 && slotsPopulated === null) ? (
          // No usable signal (older/garbled response). Don't claim "listed none".
          <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
            Couldn’t confirm the applicant’s recommended reviewers.{' '}
            <button type="button" onClick={runIngestion} className="underline font-medium">Retry</button>
          </div>
        ) : (
          <>
            {recommendedFailed.length > 0 && (
              <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm mb-3">
                {recommendedFailed.length} of {slotsPopulated ?? (recommended.length + recommendedFailed.length)}{' '}
                applicant-recommended reviewer{recommendedFailed.length === 1 ? '' : 's'} failed to ingest
                {recommendedFailed.some((f) => f.name) && (
                  <> ({recommendedFailed.map((f) => f.name).filter(Boolean).join(', ')})</>
                )}
                . They are <span className="font-medium">not</span> saved as candidates yet.{' '}
                <button type="button" onClick={runIngestion} className="underline font-medium">Retry</button>
              </div>
            )}
            {recommended.length > 0 ? (
              <>
                <p className="text-sm text-gray-600 mb-3">
                  These were recommended by the applicant and are now saved as candidates for this request.
                  Enrich them on a search run, then dispatch from the <span className="font-medium">Invite</span> tab.
                </p>
                <ul className="divide-y divide-gray-100">
                  {recommended.map((r) => (
                    <li key={r.suggestionId || r.potentialReviewerId} className="py-2 flex items-center justify-between gap-3">
                      <span className="text-sm text-gray-900">{r.name || '(unnamed reviewer)'}</span>
                      <span className="flex items-center gap-2">
                        <Badge tone="green">Applicant</Badge>
                        {r.selected === false && <Badge tone="red">Removed by staff</Badge>}
                        {r.skippedExcluded && <Badge tone="red">Excluded — kept</Badge>}
                        {r.created && <Badge tone="gray">new</Badge>}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-gray-600">
                None of the applicant’s recommended reviewers could be ingested — retry above.
              </p>
            )}
          </>
        )}
      </Card>

      {/* Applicant-excluded reviewers (per-request soft-block) */}
      <Card hover={false}>
        <p className="font-medium text-gray-900 mb-2">Applicant-excluded reviewers</p>
        {ingest.loading ? (
          <p className="text-sm text-gray-500">Reading the applicant’s exclusion list…</p>
        ) : excludedParseFailed ? (
          <div className="space-y-2">
            <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
              Couldn’t automatically parse the exclusion text — please read it manually and exclude by hand in the search.
            </div>
            {excludedRaw && (
              <pre className="text-xs bg-gray-50 text-gray-700 rounded p-2 whitespace-pre-wrap">{excludedRaw}</pre>
            )}
          </div>
        ) : excluded.length === 0 ? (
          <p className="text-sm text-gray-600">No reviewers were excluded by the applicant for this request.</p>
        ) : (
          <>
            <p className="text-sm text-gray-600 mb-3">
              Excluded by the applicant <span className="font-medium">for this request only</span> — they stay
              eligible on every other request. Carry these into your search’s exclude list so they aren’t suggested.
            </p>
            <ul className="divide-y divide-gray-100">
              {excluded.map((e, i) => (
                <li key={`${e.name}-${i}`} className="py-2 flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-900">
                    {e.name}
                    {e.affiliation && <span className="text-gray-500"> · {e.affiliation}</span>}
                  </span>
                  <Badge tone="amber">Excluded by applicant</Badge>
                </li>
              ))}
            </ul>
            {excludedRaw && (
              <details className="mt-3">
                <summary className="text-xs text-gray-500 cursor-pointer">Applicant’s original text</summary>
                <pre className="text-xs bg-gray-50 text-gray-700 rounded p-2 mt-1 whitespace-pre-wrap">{excludedRaw}</pre>
              </details>
            )}
          </>
        )}
      </Card>

      {/* Proposal document (auto-loaded, with manual override) */}
      <Card hover={false}>
        <div className="flex items-center justify-between mb-2">
          <p className="font-medium text-gray-900">Proposal document</p>
          {doc.loading && <Spinner />}
        </div>
        {doc.error ? (
          <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
            {doc.error}{' '}
            <button type="button" onClick={() => loadProposal()} className="underline font-medium">Retry</button>
          </div>
        ) : doc.loading ? (
          <p className="text-sm text-gray-500">Loading the request’s proposal from SharePoint…</p>
        ) : doc.data ? (
          <p className="text-sm text-gray-700">
            Auto-loaded <span className="font-medium">{doc.data.filename}</span> from the request’s documents.
          </p>
        ) : (
          <p className="text-sm text-gray-600">No proposal document found for this request.</p>
        )}

        {/* Manual override: the auto-pick uses filename heuristics and can miss
            unconventional names — let staff choose the right file. allFiles is
            present on success and (via the carried error) on a no-match 404. */}
        {availableFiles.length > 0 && (
          <div className="mt-3">
            <label className="block text-xs text-gray-500 mb-1">
              Wrong document? Choose the proposal manually:
            </label>
            <select
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white"
              value={pickedKey || ''}
              disabled={doc.loading}
              onChange={(ev) => { if (ev.target.value) loadProposal(ev.target.value); }}
            >
              {!pickedKey && <option value="">Select a file…</option>}
              {availableFiles.map((f) => {
                const k = fileKeyOf(f);
                return (
                  <option key={k} value={k}>
                    {f.name}{f.classification === 'proposal' ? '  ·  proposal' : ''}
                  </option>
                );
              })}
            </select>
          </div>
        )}
      </Card>

      {/* Search entry. The full in-panel candidate search is the remaining Phase 3
          work; until then this is an HONEST handoff — the standalone app does NOT
          yet receive the proposal or exclude list (no requestId param), so don't
          claim it does. */}
      <Card hover={false}>
        <p className="font-medium text-gray-900 mb-1">Search for reviewers</p>
        <p className="text-sm text-gray-600">
          Candidate search isn’t in the Workbench yet. For now, run it in the{' '}
          <Link href="/reviewer-finder" className="text-blue-600 underline">standalone Reviewer Finder</Link>
          {context?.requestNumber ? <> (you’ll re-select request <span className="font-medium">{context.requestNumber}</span> there)</> : null}.
          The applicant’s recommended reviewers above are already saved as candidates for this request, so anyone you
          invite and who accepts will appear in the <span className="font-medium">Invite</span> tab here.
        </p>
      </Card>
    </div>
  );
}
