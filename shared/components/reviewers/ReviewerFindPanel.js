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
 * The candidate search runs IN-PANEL via `ReviewerSearchSection` (S210): it
 * reuses the proposal loaded here + the applicant exclude list and chains the
 * reviewer-finder endpoints (analyze → discover → enrich → save), so saved
 * candidates land in this request's pool alongside the applicant recommendations.
 * (`summaryPages`/PDF-upload are not used — the proposal is auto-loaded.)
 *
 * Props:
 *   - requestId      : the akoya_request GUID (always present)
 *   - savedPoolNames : names already saved to this request's Dataverse pool
 *                      (from ReviewersTab's my-candidates fetch), unioned into the
 *                      search exclude set so a re-search doesn't re-surface them.
 *   (context / canManage are passed by ReviewersTab but not needed here — the
 *   panel is request-scoped by requestId and all ingestion APIs stay org-open.)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card } from '../Layout';
import ReviewerSearchSection from './ReviewerSearchSection';

function Spinner() {
  return <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />;
}

// Composite key the load-proposal endpoint uses to address a specific file.
function fileKeyOf(f) {
  return `${f.library}::${f.folder}::${f.name}`;
}

export default function ReviewerFindPanel({ requestId, savedPoolNames = [], onSaved, canManage = true }) {
  const requestIdRef = useRef(requestId);
  requestIdRef.current = requestId;
  const [ingest, setIngest] = useState({ loading: true, data: null, error: null });
  const [doc, setDoc] = useState({ loading: true, data: null, error: null });
  const [manual, setManual] = useState({
    name: '',
    email: '',
    affiliation: '',
    note: '',
    saving: false,
    error: null,
    added: null,
  });

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

  const updateManual = (field, value) => {
    setManual((prev) => ({ ...prev, [field]: value, error: null, added: null }));
  };

  const addManualReviewer = async (ev) => {
    ev.preventDefault();
    if (!requestId || manual.saving) return;
    const name = manual.name.trim();
    if (!name) {
      setManual((prev) => ({ ...prev, error: 'Name is required.' }));
      return;
    }
    setManual((prev) => ({ ...prev, saving: true, error: null, added: null }));
    const submittedRequestId = requestId;
    try {
      const res = await fetch('/api/workbench/manual-reviewer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          name,
          email: manual.email.trim() || undefined,
          affiliation: manual.affiliation.trim() || undefined,
          note: manual.note.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Could not add reviewer (${res.status})`);
      }
      if (requestIdRef.current !== submittedRequestId) return;
      setManual({
        name: '',
        email: '',
        affiliation: '',
        note: '',
        saving: false,
        error: null,
        added: data.candidate || { name },
      });
      if (onSaved) onSaved();
    } catch (e) {
      if (requestIdRef.current !== submittedRequestId) return;
      setManual((prev) => ({ ...prev, saving: false, error: e.message }));
    }
  };

  const data = ingest.data;
  const recommended = data?.recommended || [];
  const recommendedFailed = data?.recommendedFailed || [];
  // How many slots the applicant actually populated. `null` when the field is
  // absent (older response / fetch error). Lets us tell a genuine "applicant
  // listed none" from "ingestion failed so the list looks empty."
  const slotsPopulated = typeof data?.slotsPopulated === 'number' ? data.slotsPopulated : null;
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

  // Manual reviewer add — rendered (by ReviewerSearchSection) BELOW the search and
  // ABOVE the optional verify card. State lives here; the JSX is passed down as a
  // slot so it sits between those two without ReviewerSearchSection owning the form.
  const manualAddCard = (
    <Card hover={false}>
      <div className="flex items-center justify-between mb-2">
        <p className="font-medium text-gray-900">Manually Add New Reviewer</p>
        {manual.saving && <Spinner />}
      </div>
      <form onSubmit={addManualReviewer} className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block">
            <span className="block text-xs text-gray-500 mb-1">Name</span>
            <input
              type="text"
              value={manual.name}
              onChange={(ev) => updateManual('name', ev.target.value)}
              disabled={!canManage || manual.saving}
              maxLength={180}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white disabled:bg-gray-50"
              required
            />
          </label>
          <label className="block">
            <span className="block text-xs text-gray-500 mb-1">Email</span>
            <input
              type="email"
              value={manual.email}
              onChange={(ev) => updateManual('email', ev.target.value)}
              disabled={!canManage || manual.saving}
              maxLength={254}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white disabled:bg-gray-50"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-gray-500 mb-1">Affiliation</span>
            <input
              type="text"
              value={manual.affiliation}
              onChange={(ev) => updateManual('affiliation', ev.target.value)}
              disabled={!canManage || manual.saving}
              maxLength={500}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white disabled:bg-gray-50"
            />
          </label>
        </div>
        <label className="block">
          <span className="block text-xs text-gray-500 mb-1">Note</span>
          <textarea
            value={manual.note}
            onChange={(ev) => updateManual('note', ev.target.value)}
            disabled={!canManage || manual.saving}
            maxLength={1000}
            rows={2}
            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white disabled:bg-gray-50"
          />
        </label>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canManage || manual.saving || !manual.name.trim()}
            className="px-3 py-1.5 bg-gray-900 text-white rounded text-sm disabled:opacity-50"
          >
            {manual.saving ? 'Adding...' : 'Add reviewer'}
          </button>
          {manual.error && <span className="text-sm text-red-700">{manual.error}</span>}
          {manual.added && (
            <span className="text-sm text-green-700">
              Added {manual.added.name || 'reviewer'} to Candidates.
            </span>
          )}
        </div>
      </form>
    </Card>
  );

  return (
    <div className="space-y-4">
      {/* Applicant-recommended reviewers are now rendered (and verified) inside
          ReviewerSearchSection's bottom card — combined with the optional verify
          action and positioned below the search. The ingestion state is passed
          through as props. */}

      {/* Applicant-excluded reviewers are no longer a standalone card: the parsed
          names prefill the search's Exclude box, and the applicant's original
          exclusion text is shown as a disclosure under that box (ReviewerSearchSection).
          exclusionsUnavailable surfaces the parse-fail / load-fail case there. */}

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

      {/* In-panel candidate search — uses the proposal already loaded above and
          the applicant exclude list; saves into this request's candidate pool.
          exclusionsUnavailable flags when ingestion couldn't produce the list so
          the search shows a warning rather than treating it as "no exclusions".
          The manual-add card is passed as manualAddSlot so it renders BELOW the
          search and ABOVE the optional verify card. */}
      <ReviewerSearchSection
        requestId={requestId}
        blobUrl={doc.data?.blobUrl || null}
        cycleCode={data?.cycleCode || null}
        excludedNames={data?.excludedNames || []}
        exclusionsUnavailable={!!ingest.error || excludedParseFailed}
        excludedRaw={excludedRaw}
        recommended={recommended}
        recommendedFailed={recommendedFailed}
        slotsPopulated={slotsPopulated}
        ingestLoading={ingest.loading}
        ingestError={ingest.error}
        onRetryIngestion={runIngestion}
        savedPoolNames={savedPoolNames}
        onSaved={onSaved}
        manualAddSlot={manualAddCard}
      />
    </div>
  );
}
