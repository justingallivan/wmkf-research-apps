/**
 * ReviewerSearchSection — the in-panel reviewer candidate search for the
 * Workbench Find tab (Phase 3). Replaces the old "go to the standalone Reviewer
 * Finder" handoff: it reuses the proposal already loaded by ReviewerFindPanel
 * (a Vercel Blob URL) and the applicant exclude list, then runs the same
 * endpoints the standalone app uses —
 *   analyze (Claude) → discover (PubMed/preprint verify + rank) → enrich-contacts
 *   (free tiers) → save-candidates(requestId)
 * — so saved candidates land in the SAME per-request pool the Invite tab reads,
 * on equal footing with the applicant-recommended rows.
 *
 * Props:
 *   - requestId             : akoya_request GUID (save target)
 *   - blobUrl               : proposal blob URL from load-proposal (required to search)
 *   - cycleCode             : grant cycle code (persisted with saved candidates)
 *   - excludedNames         : string[] of applicant-excluded names (prefills the editable box)
 *   - exclusionsUnavailable : true when ingestion failed to produce the exclude list
 *   - onSaved               : optional callback after a successful save
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Card } from '../Layout';
import { readSseStream } from './sse';
import {
  mergeEnrichment,
  asPercent,
  parseExcludeList,
  filterExcluded,
} from './reviewer-search-logic';

function Spinner() {
  return <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />;
}

function Pill({ children, tone = 'gray' }) {
  const tones = {
    gray: 'bg-gray-100 text-gray-700',
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-800',
    blue: 'bg-blue-100 text-blue-700',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${tones[tone] || tones.gray}`}>{children}</span>;
}

function CandidateRow({ candidate, checked, onToggle }) {
  const score = asPercent(candidate.relevanceScore);
  const conf = asPercent(candidate.verificationConfidence);
  const expertise = Array.isArray(candidate.expertiseAreas) ? candidate.expertiseAreas.slice(0, 3) : [];
  const reason = candidate.reasoning || candidate.generatedReasoning || null;
  const email = candidate.email || candidate.contactEnrichment?.email || null;
  const hasCoi = candidate.hasInstitutionCOI || candidate.hasCoauthorCOI;

  return (
    <li className="py-3 flex items-start gap-3">
      <input type="checkbox" className="mt-1" checked={checked} onChange={onToggle} aria-label={`Select ${candidate.name}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-gray-900 truncate">{candidate.name}</span>
          <span className="flex items-center gap-1 shrink-0">
            {typeof score === 'number' && <Pill tone="blue">{score}% match</Pill>}
            {candidate.hasInstitutionCOI && <Pill tone="red">Institution COI</Pill>}
            {candidate.hasCoauthorCOI && <Pill tone="red">Coauthor COI</Pill>}
            {!hasCoi && typeof conf === 'number' && conf < 35 && <Pill tone="amber">low confidence</Pill>}
          </span>
        </div>
        {candidate.affiliation && <p className="text-xs text-gray-500 mt-0.5 truncate">{candidate.affiliation}</p>}
        {expertise.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {expertise.map((e, i) => <Pill key={i}>{e}</Pill>)}
          </div>
        )}
        {reason && <p className="text-xs text-gray-600 mt-1 line-clamp-2">{reason}</p>}
        {email && <p className="text-xs text-gray-500 mt-1">{email}</p>}
      </div>
    </li>
  );
}

export default function ReviewerSearchSection({
  requestId,
  blobUrl,
  cycleCode,
  excludedNames = [],
  exclusionsUnavailable = false,
  onSaved,
}) {
  const [phase, setPhase] = useState('idle'); // idle | running | results | saving | done | error
  const [progress, setProgress] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [error, setError] = useState(null);
  const [savedMsg, setSavedMsg] = useState(null);
  const [enrichNote, setEnrichNote] = useState(null);
  const [excludeText, setExcludeText] = useState((excludedNames || []).join(', '));
  const [excludedRemoved, setExcludedRemoved] = useState(0);

  // Imperative guards: prevent double-submit (Finding 8) and let a context change
  // invalidate an in-flight run so a stale stream can't overwrite newer state
  // (Finding 7).
  const runningRef = useRef(false);
  const savingRef = useRef(false);
  const genRef = useRef(0);
  const excludeEditedRef = useRef(false);

  // Reset everything when the request or the loaded proposal changes — stale
  // candidates must never be savable under a different proposal (Finding 6).
  useEffect(() => {
    genRef.current += 1; // invalidate any in-flight run
    setPhase('idle'); setProgress([]); setCandidates([]); setAnalysis(null);
    setSelected(new Set()); setError(null); setSavedMsg(null); setEnrichNote(null);
    setExcludedRemoved(0);
    excludeEditedRef.current = false;
    setExcludeText((excludedNames || []).join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, blobUrl]);

  // When the applicant exclude list finishes loading (it can arrive after the
  // proposal), prefill the box — unless the user has already edited it.
  useEffect(() => {
    if (!excludeEditedRef.current) setExcludeText((excludedNames || []).join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excludedNames]);

  const pushProgress = useCallback((m) => {
    if (m) setProgress((p) => [...p.slice(-6), m]);
  }, []);

  const runSearch = useCallback(async () => {
    if (!blobUrl || runningRef.current) return;
    runningRef.current = true;
    const myGen = genRef.current;
    const effectiveExcluded = parseExcludeList(excludeText);
    setPhase('running');
    setError(null); setProgress([]); setCandidates([]); setSelected(new Set());
    setSavedMsg(null); setEnrichNote(null); setAnalysis(null); setExcludedRemoved(0);
    try {
      // 1. Analyze the proposal (Claude). excludedNames soft-blocks Claude's own
      //    suggestions; we still hard-filter discovery results below.
      const aRes = await fetch('/api/reviewer-finder/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blobUrl, excludedNames: effectiveExcluded, temperature: 0.3, reviewerCount: 12 }),
      });
      let analysisResult = null;
      let streamError = null;
      await readSseStream(aRes, ({ event, data }) => {
        if (event === 'error') { streamError = data?.message || 'Analysis failed'; return; }
        if (data?.error) { streamError = data.error; return; }
        if (data?.message) pushProgress(data.message);
        if (data?.proposalInfo) analysisResult = data;
      });
      if (streamError) throw new Error(streamError);
      if (!analysisResult) throw new Error('Analysis returned no result.');
      if (genRef.current !== myGen) return; // context changed — abort
      setAnalysis(analysisResult);

      // 2. Discover + verify + rank across databases.
      pushProgress('Searching databases for candidates…');
      const dRes = await fetch('/api/reviewer-finder/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisResult,
          options: { searchPubmed: true, searchArxiv: true, searchBiorxiv: true, searchChemrxiv: true, generateReasoning: true },
        }),
      });
      let ranked = null;
      streamError = null;
      await readSseStream(dRes, ({ event, data }) => {
        if (event === 'error') { streamError = data?.message || 'Discovery failed'; return; }
        if (data?.error) { streamError = data.error; return; }
        if (data?.message) pushProgress(data.message);
        if (data?.ranked) ranked = data.ranked;
      });
      if (streamError) throw new Error(streamError);
      if (!ranked) throw new Error('Discovery returned no candidates.');
      if (genRef.current !== myGen) return; // context changed — abort

      // 3. Hard-filter excluded names from the database results — /discover does
      //    NOT honor the soft-block, so without this the panel's "excluded names
      //    are blocked" claim would be false (Codex S210, Finding 3).
      const { kept, removed } = filterExcluded(ranked, effectiveExcluded);
      setCandidates(kept);
      setExcludedRemoved(removed.length);
      setPhase('results');
    } catch (e) {
      if (genRef.current === myGen) { setError(e.message); setPhase('error'); }
    } finally {
      runningRef.current = false;
    }
  }, [blobUrl, excludeText, pushProgress]);

  const toggle = (i) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };
  const allSelected = candidates.length > 0 && selected.size === candidates.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(candidates.map((_, i) => i)));

  const saveSelected = useCallback(async () => {
    if (savingRef.current) return;
    const chosen = candidates.filter((_, i) => selected.has(i));
    if (chosen.length === 0) return;
    savingRef.current = true;
    setPhase('saving');
    setError(null); setProgress([]); setSavedMsg(null); setEnrichNote(null);
    try {
      // 4. Enrich contacts (free tiers: PubMed + ORCID). Best-effort — a failure
      //    still saves the candidates, with a note (Finding 10).
      let enrichmentResults = null;
      let enrichError = null;
      try {
        pushProgress(`Finding contact info for ${chosen.length} reviewer(s)…`);
        const eRes = await fetch('/api/reviewer-finder/enrich-contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ candidates: chosen, options: { usePubmed: true, useOrcid: true } }),
        });
        await readSseStream(eRes, ({ event, data }) => {
          if (event === 'error' || data?.type === 'error') { enrichError = data?.message || 'enrichment failed'; return; }
          if (data?.type === 'progress' && data.overall) pushProgress(`Enriching ${data.overall.current}/${data.overall.total}…`);
          if (data?.type === 'complete') enrichmentResults = data.results;
        });
      } catch (e) {
        enrichError = e.message;
      }
      if (enrichError || !enrichmentResults) {
        setEnrichNote('Contact lookup was incomplete — saved candidates may be missing emails.');
      }

      const toSave = mergeEnrichment(chosen, enrichmentResults);
      pushProgress(`Saving ${toSave.length} candidate(s)…`);
      const sRes = await fetch('/api/reviewer-finder/save-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          proposalTitle: analysis?.proposalInfo?.title || null,
          programArea: analysis?.proposalInfo?.programArea || null,
          grantCycleCode: cycleCode || null,
          candidates: toSave,
        }),
      });
      const sData = await sRes.json().catch(() => ({}));
      if (!sRes.ok || !sData.success) throw new Error(sData.error || `Save failed (${sRes.status})`);
      // save-candidates returns success:true even when every row failed — treat
      // savedCount === 0 as a hard failure and surface the first error (Finding 9).
      const saved = sData.savedCount || 0;
      if (saved === 0) {
        const detail = sData.errors?.[0]?.error;
        throw new Error(detail ? `No candidates were saved: ${detail}` : 'No candidates were saved.');
      }
      const failed = toSave.length - saved;
      setSavedMsg(`Saved ${saved} of ${toSave.length} to this request’s candidate pool.${failed > 0 ? ` ${failed} could not be saved.` : ''}`);
      setPhase('done');
      if (onSaved) onSaved();
    } catch (e) {
      setError(e.message);
      setPhase('error');
    } finally {
      savingRef.current = false;
    }
  }, [candidates, selected, requestId, analysis, cycleCode, onSaved, pushProgress]);

  const busy = phase === 'running' || phase === 'saving';
  const onExcludeChange = (ev) => { excludeEditedRef.current = true; setExcludeText(ev.target.value); };

  return (
    <Card hover={false}>
      <div className="flex items-center justify-between mb-2">
        <p className="font-medium text-gray-900">Search for reviewers</p>
        {busy && <Spinner />}
      </div>

      {!blobUrl ? (
        <p className="text-sm text-gray-600">Load a proposal document above to search for reviewers.</p>
      ) : (
        <>
          {(phase === 'idle' || phase === 'error') && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Searches PubMed and preprint servers using the loaded proposal, verifies expertise, and flags conflicts.
              </p>
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
                  <p className="text-xs text-amber-700 mt-1">The applicant exclusion list couldn’t be loaded — add exclusions manually above.</p>
                )}
              </div>
              {error && <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">{error}</div>}
              <button type="button" onClick={runSearch} className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800">
                {phase === 'error' ? 'Try again' : 'Run reviewer search'}
              </button>
            </div>
          )}

          {busy && (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">{phase === 'saving' ? 'Saving candidates…' : 'Searching… this can take a minute.'}</p>
              <ul className="text-xs text-gray-500 space-y-0.5">
                {progress.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}

          {(phase === 'results' || phase === 'done') && (
            <div className="space-y-3">
              {savedMsg && <div className="p-3 bg-green-50 text-green-700 rounded-lg text-sm">{savedMsg}</div>}
              {enrichNote && <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">{enrichNote}</div>}
              {excludedRemoved > 0 && (
                <p className="text-xs text-gray-500">
                  {excludedRemoved} excluded {excludedRemoved === 1 ? 'reviewer was' : 'reviewers were'} filtered out of the results.
                </p>
              )}
              {candidates.length === 0 ? (
                <p className="text-sm text-gray-600">No candidates were found for this proposal.</p>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-600">
                      {candidates.length} candidate{candidates.length === 1 ? '' : 's'} found
                      {selected.size > 0 && <> · {selected.size} selected</>}
                    </p>
                    <button type="button" onClick={toggleAll} className="text-xs text-blue-600 underline">
                      {allSelected ? 'Clear all' : 'Select all'}
                    </button>
                  </div>
                  <ul className="divide-y divide-gray-100 max-h-[28rem] overflow-y-auto">
                    {candidates.map((c, i) => (
                      <CandidateRow key={`${c.name}-${i}`} candidate={c} checked={selected.has(i)} onToggle={() => toggle(i)} />
                    ))}
                  </ul>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={saveSelected}
                      disabled={selected.size === 0}
                      className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Save {selected.size > 0 ? selected.size : ''} selected as candidates
                    </button>
                    <button type="button" onClick={runSearch} className="text-sm text-gray-500 underline">Re-run search</button>
                  </div>
                  <p className="text-xs text-gray-400">
                    Saved candidates join this request’s pool and appear in the Invite tab once you invite and they accept.
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
