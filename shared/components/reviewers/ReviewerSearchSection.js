/**
 * ReviewerSearchSection — the in-panel reviewer candidate search for the
 * Workbench Find tab. Replaces the old "go to the standalone Reviewer Finder"
 * handoff: it reuses the proposal already loaded by ReviewerFindPanel (a Vercel
 * Blob URL) and the applicant exclude list, then runs the same endpoints the
 * standalone app uses —
 *   analyze (Claude) → discover (PubMed/preprint verify + rank)
 *     → enrich-contacts (ALL tiers — PubMed/ORCID/SerpAPI Google+Scholar/Claude
 *       web search; SerpAPI is ~free so there is no cost dialog) → save-candidates
 * — so saved candidates land in the SAME per-request pool the Invite tab reads,
 * on equal footing with the applicant-recommended rows.
 *
 * S211 parity build (matches the proven standalone workflow): per-source toggles,
 * candidate-count + reviewer-diversity (temperature) + additional-context inputs;
 * enrichment runs ON RESULTS (not at save) so cards show email + ORCID/Scholar +
 * REAL h-index/citations (fetched via the google_scholar_author engine) BEFORE the
 * user selects; rich candidate cards with COI / mismatch / confidence warnings;
 * results split into Claude-suggestions / Database-discoveries / Unverified (the
 * last is read-only). The displayed "expertise match %" is verificationConfidence;
 * the composite relevanceScore drives ordering only — and because /discover ranks
 * BEFORE enrichment, the enriched list is RE-RANKED here (shared scorer in
 * lib/utils/relevance-score.js) so the fetched h-index/citations affect order.
 *
 * Props:
 *   - requestId             : akoya_request GUID (save target)
 *   - blobUrl               : proposal blob URL from load-proposal (required to search)
 *   - cycleCode             : grant cycle code (persisted with saved candidates)
 *   - excludedNames         : string[] of applicant-excluded names (prefills the editable box)
 *   - exclusionsUnavailable : true when ingestion failed to produce the exclude list
 *   - recommended           : applicant-recommended candidate rows (rendered + verifiable in the bottom card)
 *   - recommendedFailed      : applicant-recommended rows that failed to ingest (warning in the bottom card)
 *   - slotsPopulated        : how many wmkf_potentialreviewer slots the applicant filled (null = unknown)
 *   - ingestLoading / ingestError / onRetryIngestion : applicant-reviewer ingestion state + retry (from ReviewerFindPanel)
 *   - onSaved               : optional callback after a successful save
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Card } from '../Layout';
import { readSseStream } from './sse';
import ReviewerPromptOverridePanel from './ReviewerPromptOverridePanel';
import {
  mergeEnrichment,
  parseExcludeList,
  filterExcluded,
  normalizeReviewerName,
  pruneCandidateForRoster,
} from './reviewer-search-logic';
import { rankByRelevance } from '../../../lib/utils/relevance-score';
import { buildScholarSearchUrl } from '../../../lib/utils/scholar-url';

// The four literature sources the discover endpoint understands. The user picks
// which to query (parity with the standalone Reviewer Finder); at least one must
// stay selected or there's nothing to search.
const SEARCH_SOURCES = [
  { key: 'pubmed', label: 'PubMed', icon: '📚', desc: 'Biomedical' },
  { key: 'arxiv', label: 'ArXiv', icon: '📄', desc: 'Physics, math, CS' },
  { key: 'biorxiv', label: 'BioRxiv', icon: '🧬', desc: 'Life sciences' },
  { key: 'chemrxiv', label: 'ChemRxiv', icon: '🧪', desc: 'Chemistry' },
];

function Spinner() {
  return <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />;
}

function Pill({ children, tone = 'gray' }) {
  const tones = {
    gray: 'bg-gray-100 text-gray-700',
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-800',
    blue: 'bg-blue-100 text-blue-700',
    purple: 'bg-purple-100 text-purple-700',
    green: 'bg-green-100 text-green-700',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${tones[tone] || tones.gray}`}>{children}</span>;
}

// A candidate is a Claude suggestion (vs a database discovery) when tagged by
// rankAllCandidates (`isClaudeSuggestion`) or carrying the verified-suggestion
// source string.
function isClaudeSuggestion(c) {
  return !!(c?.isClaudeSuggestion || c?.source === 'claude_suggestion');
}

// Stable id for a candidate across roster splices + selection (S224): the
// normalized name — same key the dedup/exclude use, so selection survives a
// list reorder/splice (the old flat-index selection would corrupt).
function candKey(c) {
  return normalizeReviewerName(c && c.name);
}

// Dedupe a candidate list by normalized name; first occurrence wins (so a
// freshly-enriched run candidate beats its pruned roster copy).
function dedupeByName(list) {
  const seen = new Set();
  const out = [];
  for (const c of (Array.isArray(list) ? list : [])) {
    const k = candKey(c);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

// Affiliation-pin provenance (S224 #16). enrichment may replace the discovery
// (PubMed-recency) affiliation with an identity-trusted CURRENT one from ORCID
// or Scholar. Return a short source label for the "current (per X)" badge, or
// null for the default pubmed_recency / unset case (no badge — it's the norm).
function affiliationProvenance(source) {
  if (source === 'orcid_current') return 'ORCID';
  if (source === 'scholar_current') return 'Scholar';
  return null;
}
function affiliationSourceLabel(source) {
  return affiliationProvenance(source) || 'recent publications';
}

// Ported from the standalone Reviewer Finder: build a Google Scholar author-search
// URL as a fallback when we don't have the candidate's real profile URL. Strips
// honorifics and extracts the institution from a messy affiliation string.
// Rich candidate card — ports the standalone Reviewer Finder's CandidateCard into
// the in-panel Workbench: seniority, COI + mismatch + confidence warnings, the
// metrics line (expertise match % + real h-index/citations), enriched contact
// links, a Scholar link, and a publications expander. `readOnly` renders the card
// without a checkbox for the non-selectable Unverified section. `onExclude` adds
// a set-aside action (active cards); `onPromote` adds a restore action (the
// collapsed Excluded section).
function CandidateCard({ candidate, checked, onToggle, readOnly = false, onExclude, onPromote }) {
  const [expanded, setExpanded] = useState(false);
  const c = candidate;
  const confidence = typeof c.verificationConfidence === 'number' ? c.verificationConfidence : undefined;
  const isLowConfidence = confidence !== undefined && confidence < 0.35;
  const isWeakMatch = confidence !== undefined && confidence >= 0.35 && confidence < 0.65;
  const hasInstitutionMismatch = !!c.institutionMismatch;
  const hasExpertiseMismatch = !!c.expertiseMismatch;
  const hasAnyMismatch = hasInstitutionMismatch || hasExpertiseMismatch;
  const hasInstitutionCOI = !!c.hasInstitutionCOI;
  const hasCoauthorCOI = !!c.hasCoauthorCOI;
  const hasAnyCOI = hasInstitutionCOI || hasCoauthorCOI;
  // Model-flagged concern (POTENTIAL_CONCERNS). The parser normalizes "None
  // identified" and its variants to null (isNoConcernText), so any non-empty
  // value here is a real warning.
  const potentialConcerns = typeof c.potentialConcerns === 'string' ? c.potentialConcerns.trim() : '';
  const hasPotentialConcern = !!potentialConcerns;
  const reason = c.reasoning || c.generatedReasoning || null;
  const claude = isClaudeSuggestion(c);
  const pubs = Array.isArray(c.publications) ? c.publications : [];
  const pubCount = c.publicationCount5yr || pubs.length || 0;
  const enr = c.contactEnrichment || {};
  const email = c.email || enr.email || null;
  const website = c.website || enr.website || null;
  const orcidUrl = c.orcidUrl || enr.orcidUrl || null;
  const scholarUrl = c.googleScholarUrl || enr.googleScholarUrl || buildScholarSearchUrl(c.name, c.affiliation);
  const hasRealScholar = !!(c.googleScholarUrl || enr.googleScholarUrl);
  const hIndex = c.hIndex ?? enr.hIndex ?? null;
  const citations = c.totalCitations ?? enr.totalCitations ?? null;
  const coauthorships = Array.isArray(c.coauthorships) ? c.coauthorships : [];

  const border = checked ? 'border-blue-500 bg-blue-50'
    : hasAnyCOI ? 'border-red-300 bg-red-50'
    : hasPotentialConcern ? 'border-amber-300 bg-amber-50'
    : hasAnyMismatch ? 'border-orange-300 bg-orange-50'
    : isLowConfidence ? 'border-amber-300 bg-amber-50'
    : isWeakMatch ? 'border-yellow-200 bg-yellow-50'
    : 'border-gray-200';

  return (
    <div className={`border rounded-lg p-3 transition-colors ${border}`}>
      <div className="flex items-start gap-3">
        {!readOnly && (
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            aria-label={`Select ${c.name}`}
            className="mt-1 h-4 w-4 text-blue-600 rounded border-gray-300"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-900 truncate">{c.name}</span>
            {c.seniorityEstimate && (
              <Pill tone={c.seniorityEstimate === 'Senior' ? 'purple' : c.seniorityEstimate === 'Mid-career' ? 'blue' : 'green'}>
                {c.seniorityEstimate}
              </Pill>
            )}
          </div>
          {c.affiliation && (
            <p className="text-xs text-gray-500 mt-0.5 truncate" title={enr.priorAffiliation ? `Current affiliation (per ${affiliationSourceLabel(c.affiliationSource || enr.affiliationSource)}); previously: ${enr.priorAffiliation}` : undefined}>
              {c.affiliation}
              {affiliationProvenance(c.affiliationSource || enr.affiliationSource) && (
                <span className="ml-1 text-gray-400">· current (per {affiliationProvenance(c.affiliationSource || enr.affiliationSource)})</span>
              )}
            </p>
          )}

          {hasInstitutionCOI && (
            <div className="mt-2 p-2 bg-red-50 border border-red-300 rounded text-xs text-red-800">
              <span className="font-medium">🏛️ Institution COI:</span> {c.institutionCOIDetails?.historical ? 'Former shared institution with proposal PI' : 'Same institution as proposal PI'}
              {c.institutionCOIDetails?.reviewerInstitution && <span className="ml-1">({c.institutionCOIDetails.reviewerInstitution})</span>}
            </div>
          )}
          {hasCoauthorCOI && coauthorships.length > 0 && (
            <div className="mt-2 p-2 bg-red-50 border border-red-300 rounded text-xs text-red-800">
              <span className="font-medium">🚨 Coauthor COI:</span> Co-authored {coauthorships.reduce((s, co) => s + (co.paperCount || 0), 0)} paper(s) with proposal author(s):
              <ul className="mt-1 ml-4 list-disc">
                {coauthorships.map((co, idx) => (
                  <li key={idx}>
                    <strong>{co.proposalAuthor}</strong> ({co.paperCount} paper{co.paperCount > 1 ? 's' : ''})
                    {co.recentPapers?.[0]?.title && (
                      <span className="text-red-600"> — e.g., “{co.recentPapers[0].title.substring(0, 60)}…”</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hasPotentialConcern && (
            <div className="mt-2 p-2 bg-amber-100 border border-amber-300 rounded text-xs text-amber-800">
              <span className="font-medium">⚠️ Potential concern (AI-flagged):</span> {potentialConcerns}
            </div>
          )}
          {isLowConfidence && (
            <div className="mt-2 p-2 bg-amber-100 border border-amber-300 rounded text-xs text-amber-800">
              <span className="font-medium">⚠️ Low match ({Math.round(confidence * 100)}%):</span> Publications don’t match Claude’s description — could be a different person with the same name.
            </div>
          )}
          {isWeakMatch && !hasAnyMismatch && (
            <div className="mt-2 p-2 bg-yellow-50 border border-yellow-300 rounded text-xs text-yellow-800">
              <span className="font-medium">⚡ Weak match ({Math.round(confidence * 100)}%):</span> Some publications match, but relevance is uncertain — verify expertise manually.
            </div>
          )}
          {hasInstitutionMismatch && c.suggestedInstitution && (
            <div className="mt-2 p-2 bg-orange-100 border border-orange-300 rounded text-xs text-orange-800">
              <span className="font-medium">⚠️ Institution mismatch:</span> Claude suggested <strong>{c.suggestedInstitution}</strong>, but PubMed shows <strong>{c.affiliation?.split(',')[0] || 'a different institution'}</strong>.
            </div>
          )}
          {hasExpertiseMismatch && Array.isArray(c.expertiseAreas) && c.expertiseAreas.length > 0 && (
            <div className="mt-2 p-2 bg-orange-100 border border-orange-300 rounded text-xs text-orange-800">
              <span className="font-medium">⚠️ Expertise mismatch:</span> Claude claimed “{c.expertiseAreas.slice(0, 2).join(', ')}” but no publications matched these terms.
            </div>
          )}

          {reason && <p className="text-xs text-gray-700 mt-2"><span className="font-medium">Why: </span>{reason}</p>}

          <div className="mt-2 flex items-center flex-wrap gap-x-2 gap-y-1 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <span className={hasAnyMismatch ? 'text-orange-500' : isLowConfidence ? 'text-amber-500' : isWeakMatch ? 'text-yellow-600' : 'text-green-500'}>
                {hasAnyMismatch || isLowConfidence ? '⚠' : isWeakMatch ? '⚡' : '✓'}
              </span>
              {pubCount} publications
              {confidence !== undefined && <span className="text-gray-400">({Math.round(confidence * 100)}% expertise match)</span>}
            </span>
            {hIndex != null && <span>· h-index {hIndex}</span>}
            {citations != null && <span>· {citations.toLocaleString()} citations</span>}
            {c.isApplicantRecommended
              ? <Pill tone="green">Applicant recommended</Pill>
              : <Pill tone={claude ? 'amber' : 'gray'}>{claude ? 'Claude suggestion' : (c.source || 'Database')}</Pill>}
          </div>

          {(email || website || orcidUrl) && (
            <div className="mt-2 flex items-center flex-wrap gap-2 text-xs">
              {email && (
                <a
                  href={`mailto:${email}`}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                  title={`Email (from ${enr.emailSource || 'enrichment'}${enr.emailYear ? `, ${enr.emailYear}` : ''})`}
                >
                  📧 {email}
                </a>
              )}
              {website && (
                <a href={website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 rounded hover:bg-green-100" title="Faculty / personal website">
                  🔗 Website
                </a>
              )}
              {orcidUrl && (
                <a href={orcidUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100" title="ORCID profile">
                  ORCID
                </a>
              )}
            </div>
          )}

          <div className="mt-2 flex items-center gap-3">
            {pubs.length > 0 && (
              <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs text-blue-600 hover:text-blue-800" aria-expanded={expanded}>
                {expanded ? 'Show less' : `View ${pubs.length} recent paper${pubs.length === 1 ? '' : 's'}`}
              </button>
            )}
            <a href={scholarUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1" title={hasRealScholar ? 'Open this researcher’s Google Scholar profile' : 'Search Google Scholar for this researcher'}>
              🎓 {hasRealScholar ? 'Scholar Profile' : 'Scholar Search'}
            </a>
            {onExclude && (
              <button
                type="button"
                onClick={() => onExclude(c)}
                className="text-xs text-gray-400 hover:text-red-600 ml-auto"
                title="Set aside — moves to the Excluded list and won’t be surfaced again by a search for this request (recoverable)"
              >
                ✕ Exclude
              </button>
            )}
            {onPromote && (
              <button
                type="button"
                onClick={() => onPromote(c)}
                className="text-xs text-blue-600 hover:text-blue-800 ml-auto"
                title="Promote back to the active candidate list"
              >
                ↩ Promote back
              </button>
            )}
          </div>

          {expanded && pubs.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {pubs.map((pub, i) => (
                <li key={i} className="text-xs text-gray-600">
                  • {pub.title}{pub.year ? ` (${pub.year})` : ''}
                  {pub.url && (
                    <a href={pub.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-blue-500 hover:text-blue-700">[link]</a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ReviewerSearchSection({
  requestId,
  blobUrl,
  cycleCode,
  excludedNames = [],
  exclusionsUnavailable = false,
  recommended = [],
  recommendedFailed = [],
  slotsPopulated = null,
  ingestLoading = false,
  ingestError = null,
  onRetryIngestion,
  savedPoolNames = [],
  onSaved,
}) {
  const [phase, setPhase] = useState('idle'); // idle | running | results | saving | done | error
  const [progress, setProgress] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [unverified, setUnverified] = useState([]); // Claude suggestions PubMed couldn't verify (read-only)
  const [analysis, setAnalysis] = useState(null);
  // `selected` is keyed by normalizeReviewerName(name) — a STABLE id — not by
  // flat array index (S224): the durable roster + exclude/promote splice the
  // candidate list, which would corrupt an index-keyed Set.
  const [selected, setSelected] = useState(() => new Set());
  // Durable per-request roster (reviewer_find_roster via /api/workbench/reviewer-roster):
  // active candidates (selectable, persist across reload), the collapsed Excluded
  // set, and the full surfaced-name list fed into the cross-run dedup.
  const [rosterActive, setRosterActive] = useState([]);
  const [rosterExcluded, setRosterExcluded] = useState([]);
  const [rosterNames, setRosterNames] = useState([]);
  // Gates the search button until the roster GET resolves, so a run can't skip
  // the cross-run dedup by firing before rosterNames is loaded (Codex post-impl).
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [rosterNote, setRosterNote] = useState(null); // surfaced if a durable write fails
  const [excludedOpen, setExcludedOpen] = useState(false);
  const [error, setError] = useState(null);
  const [savedMsg, setSavedMsg] = useState(null);
  const [enrichNote, setEnrichNote] = useState(null);
  const [excludeText, setExcludeText] = useState((excludedNames || []).join(', '));
  const [excludedRemoved, setExcludedRemoved] = useState(0);
  const [searchSources, setSearchSources] = useState({ pubmed: true, arxiv: true, biorxiv: true, chemrxiv: true });
  const noSourcesSelected = !Object.values(searchSources).some(Boolean);
  const [reviewerCount, setReviewerCount] = useState(12); // how many candidates Claude is asked to suggest
  const [temperature, setTemperature] = useState(0.3); // "reviewer diversity": 0.3 conservative → 1.0 creative
  const [additionalNotes, setAdditionalNotes] = useState(''); // optional extra instructions for Claude

  // Track C v1 — READ-ONLY web suggestions (Perplexity). A separate, display-only
  // panel that counters Claude's training-cutoff + fame bias; it NEVER enters the
  // candidate list, ranking, COI, roster, or save. The toggle defaults on but is
  // hidden when no Perplexity key (capability from /api/api-capabilities). The web
  // call runs independently of /discover (its own fetch + try/catch), so a web
  // outage degrades to an empty panel and never touches the search's error path.
  const [searchWeb, setSearchWeb] = useState(true);
  const [webSearchAvailable, setWebSearchAvailable] = useState(false);
  const [webPhase, setWebPhase] = useState('idle'); // idle | running | done
  const [webSuggestions, setWebSuggestions] = useState([]);
  const [webNote, setWebNote] = useState(null);

  // Applicant-recommended enrichment (separate flow from the search).
  const [recPhase, setRecPhase] = useState('idle'); // idle | running | done | error
  const [recCandidates, setRecCandidates] = useState([]);
  const [recProgress, setRecProgress] = useState([]);
  const [recError, setRecError] = useState(null);
  const recRunningRef = useRef(false);

  // Per-user prompt-override editor toggle (S222).
  const [showPromptEditor, setShowPromptEditor] = useState(false);

  // Imperative guards: prevent double-submit (Finding 8) and let a context change
  // invalidate an in-flight run so a stale stream can't overwrite newer state
  // (Finding 7).
  const runningRef = useRef(false);
  const savingRef = useRef(false);
  const genRef = useRef(0);
  const excludeEditedRef = useRef(false);

  // Reset everything when the request or the loaded proposal changes — stale
  // candidates must never be savable under a different proposal (Finding 6).
  // Also (re)loads the durable per-request roster (genRef-guarded) so the
  // active + excluded sets show even before any fresh search this session.
  useEffect(() => {
    genRef.current += 1; // invalidate any in-flight run
    const myGen = genRef.current;
    setPhase('idle'); setProgress([]); setCandidates([]); setUnverified([]); setAnalysis(null);
    setSelected(new Set()); setError(null); setSavedMsg(null); setEnrichNote(null);
    setExcludedRemoved(0); setRosterNote(null);
    setRosterActive([]); setRosterExcluded([]); setRosterNames([]); setExcludedOpen(false); setRosterLoaded(false);
    setSearchSources({ pubmed: true, arxiv: true, biorxiv: true, chemrxiv: true });
    setReviewerCount(12);
    setTemperature(0.3);
    setAdditionalNotes('');
    setWebPhase('idle'); setWebSuggestions([]); setWebNote(null);
    setRecPhase('idle'); setRecCandidates([]); setRecProgress([]); setRecError(null);
    excludeEditedRef.current = false;
    setExcludeText((excludedNames || []).join(', '));

    // Load the durable roster for this request. genRef-guarded so a slower fetch
    // can't clobber state after the request/proposal changed again. Never sets
    // `phase` — the roster renders independent of the search phase.
    if (requestId) {
      (async () => {
        try {
          const res = await fetch(`/api/workbench/reviewer-roster?requestId=${encodeURIComponent(requestId)}`);
          const data = await res.json().catch(() => ({}));
          if (genRef.current !== myGen) return; // context changed — discard
          if (res.ok && data.success) {
            setRosterActive(Array.isArray(data.active) ? data.active : []);
            setRosterExcluded(Array.isArray(data.excluded) ? data.excluded : []);
            setRosterNames(Array.isArray(data.allNames) ? data.allNames : []);
          }
        } catch { /* best-effort — a missing roster just means no dedup/restore this load */ }
        finally { if (genRef.current === myGen) setRosterLoaded(true); }
      })();
    } else {
      setRosterLoaded(true); // no request → nothing to load; don't block the form
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, blobUrl]);

  // When the applicant exclude list finishes loading (it can arrive after the
  // proposal), prefill the box — unless the user has already edited it.
  useEffect(() => {
    if (!excludeEditedRef.current) setExcludeText((excludedNames || []).join(', '));
  }, [excludedNames]);

  // Web-suggestions capability (Track C): is the Perplexity key configured? Drives
  // whether the `searchWeb` toggle shows at all. Self-fetched so this shared
  // component works on every surface that renders it without prop-drilling the
  // capability through ReviewersTab / ReviewerFindPanel.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/api-capabilities')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled && data) setWebSearchAvailable(!!data.reviewerWebSearch); })
      .catch(() => { /* capability stays false → toggle hidden, search unaffected */ });
    return () => { cancelled = true; };
  }, []);

  const pushProgress = useCallback((m) => {
    if (m) setProgress((p) => [...p.slice(-6), m]);
  }, []);

  const runSearch = useCallback(async () => {
    if (!blobUrl || runningRef.current || noSourcesSelected || !rosterLoaded) return;
    runningRef.current = true;
    const myGen = genRef.current;
    // Exclude set = the manual/applicant box + everything already surfaced for
    // this request (roster, every status) + names already in the saved pool. The
    // union is what makes a re-run find NEW people instead of re-surfacing the
    // same set (S224).
    const effectiveExcluded = Array.from(new Set([
      ...parseExcludeList(excludeText),
      ...rosterNames,
      ...(savedPoolNames || []),
    ]));
    setPhase('running');
    setError(null); setProgress([]); setCandidates([]); setUnverified([]); setSelected(new Set());
    setSavedMsg(null); setEnrichNote(null); setAnalysis(null); setExcludedRemoved(0);
    setWebPhase('idle'); setWebSuggestions([]); setWebNote(null);
    try {
      // 1. Analyze the proposal (Claude). excludedNames soft-blocks Claude's own
      //    suggestions; we still hard-filter discovery results below.
      const aRes = await fetch('/api/reviewer-finder/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blobUrl, excludedNames: effectiveExcluded, temperature, reviewerCount, additionalNotes: additionalNotes.trim() || undefined }),
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
      // Stream ended cleanly but no result frame arrived — almost always a
      // timed-out or dropped connection during the long Claude analysis, not a
      // content problem. Name the likely cause so the user knows to just retry.
      if (!analysisResult) throw new Error('The proposal analysis didn’t finish — the connection timed out or dropped before results came back. Please run the search again.');
      if (genRef.current !== myGen) return; // context changed — abort
      setAnalysis(analysisResult);

      // 1b. Track C (READ-ONLY): fire web discovery INDEPENDENTLY of /discover —
      //     its own fetch + try/catch, fire-and-forget so it runs concurrently and
      //     never delays or fails the candidate flow. A web outage → empty panel.
      //     genRef-guarded so a stale run can't write into newer state.
      if (searchWeb && webSearchAvailable) {
        setWebPhase('running');
        (async () => {
          try {
            const wRes = await fetch('/api/reviewer-finder/web-suggestions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ analysisResult }),
            });
            const wData = await wRes.json().catch(() => ({}));
            if (genRef.current !== myGen) return; // context changed — discard
            setWebSuggestions(Array.isArray(wData?.webLeads) ? wData.webLeads : []);
            setWebNote(wData?.error ? 'Web search was unavailable for this run — showing none.' : null);
          } catch {
            if (genRef.current !== myGen) return;
            setWebSuggestions([]);
            setWebNote('Web search was unavailable for this run — showing none.');
          } finally {
            if (genRef.current === myGen) setWebPhase('done');
          }
        })();
      }

      // 2. Discover + verify + rank across databases.
      pushProgress('Searching databases for candidates…');
      const dRes = await fetch('/api/reviewer-finder/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisResult,
          // Server-side dedup: filter already-surfaced/excluded/saved names out of
          // the database results BEFORE the per-candidate Claude reasoning call, so
          // a re-run doesn't re-spend reasoning tokens (S224). Client filterExcluded
          // below stays as defense-in-depth.
          excludedNames: effectiveExcluded,
          options: {
            searchPubmed: searchSources.pubmed,
            searchArxiv: searchSources.arxiv,
            searchBiorxiv: searchSources.biorxiv,
            searchChemrxiv: searchSources.chemrxiv,
            generateReasoning: true,
          },
        }),
      });
      let ranked = null;
      let unverifiedRaw = null;
      streamError = null;
      await readSseStream(dRes, ({ event, data }) => {
        if (event === 'error') { streamError = data?.message || 'Discovery failed'; return; }
        if (data?.error) { streamError = data.error; return; }
        if (data?.message) pushProgress(data.message);
        if (data?.ranked) ranked = data.ranked;
        if (data?.unverified) unverifiedRaw = data.unverified;
      });
      if (streamError) throw new Error(streamError);
      if (!ranked) throw new Error('Discovery returned no candidates.');
      if (genRef.current !== myGen) return; // context changed — abort

      // 3. Hard-filter excluded names from the database results — /discover does
      //    NOT honor the soft-block, so without this the panel's "excluded names
      //    are blocked" claim would be false (Codex S210, Finding 3). The same
      //    filter applies to the unverified list so excluded names leak nowhere.
      const { kept, removed } = filterExcluded(ranked, effectiveExcluded);
      setExcludedRemoved(removed.length);
      const unverifiedKept = filterExcluded(Array.isArray(unverifiedRaw) ? unverifiedRaw : [], effectiveExcluded).kept;

      // 4. Enrich ALL kept candidates now, with every tier (SerpAPI is ~free), so
      //    email + bibliometrics + ORCID/Scholar show on the cards BEFORE the user
      //    selects. Best-effort: a failure leaves un-enriched cards + a note and
      //    still reaches results — it must never fail the search (Finding 10).
      let enriched = kept;
      let enrichFailed = false;
      if (kept.length > 0) {
        try {
          pushProgress(`Finding contact info & citation metrics for ${kept.length} reviewer(s)…`);
          const eRes = await fetch('/api/reviewer-finder/enrich-contacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              candidates: kept,
              options: { usePubmed: true, useOrcid: true, useSerpSearch: true, useClaudeSearch: true },
              // Lets the route re-evaluate institution COI on the post-enrichment
              // affiliation so the badge stays accurate after a current-affiliation
              // promotion (Codex P2#1).
              authorInstitution: analysisResult?.proposalInfo?.authorInstitution || null,
            }),
          });
          let enrichmentResults = null;
          let enrichStreamError = null;
          await readSseStream(eRes, ({ event, data }) => {
            if (event === 'error' || data?.type === 'error') { enrichStreamError = data?.message || 'enrichment failed'; return; }
            if (data?.type === 'progress' && data.overall) pushProgress(`Enriching ${data.overall.current}/${data.overall.total}…`);
            if (data?.type === 'complete') enrichmentResults = data.results;
          });
          if (enrichStreamError || !enrichmentResults) enrichFailed = true;
          else enriched = mergeEnrichment(kept, enrichmentResults);
        } catch {
          enrichFailed = true;
        }
      }
      if (genRef.current !== myGen) return; // context changed mid-enrich — abort

      // Re-rank with the SAME shared scorer /discover used, now that enrichment
      // has populated real h-index/citations — /discover ranks BEFORE enrichment,
      // so without this re-rank the bibliometrics would never affect ordering
      // (Codex S211 catch). Mirrors discover.js's keyword derivation.
      const proposalKeywords = (analysisResult.proposalInfo?.keywords || '')
        .split(',').map((k) => k.trim()).filter(Boolean);
      enriched = rankByRelevance(enriched, proposalKeywords);

      setCandidates(enriched);
      setUnverified(unverifiedKept);
      if (enrichFailed) {
        setEnrichNote('Contact lookup was incomplete — some cards may be missing emails or citation metrics.');
      }
      setPhase('results');

      // Durably record the surfaced candidates so they persist + dedup future
      // runs. AWAIT it (don't fire-and-forget) and re-check genRef before trusting
      // it as deduped — a slow POST must not clobber a newer search's roster
      // (S224). Verified (Claude) + database discoveries only; unverified stay
      // ephemeral. A failure degrades to "no dedup this run", never a broken panel.
      if (enriched.length > 0 && requestId) {
        try {
          const pruned = enriched.map(pruneCandidateForRoster);
          const rRes = await fetch('/api/workbench/reviewer-roster', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId, candidates: pruned }),
          });
          if (genRef.current !== myGen) return; // newer search started — don't touch roster state
          if (rRes.ok) {
            // Merge into the existing active roster (prior runs persist), pruned
            // DTOs deduped by normalized name.
            setRosterActive((prev) => dedupeByName([...pruned, ...prev]));
            setRosterNames((prev) => Array.from(new Set([...prev, ...enriched.map((c) => c.name)])));
            setRosterNote(null);
          } else {
            setRosterNote('Couldn’t save this search to the request — these candidates may re-appear on a future search.');
          }
        } catch {
          if (genRef.current === myGen) setRosterNote('Couldn’t save this search to the request — these candidates may re-appear on a future search.');
        }
      }
    } catch (e) {
      if (genRef.current === myGen) { setError(e.message); setPhase('error'); }
    } finally {
      runningRef.current = false;
    }
  }, [blobUrl, requestId, excludeText, rosterNames, savedPoolNames, rosterLoaded, searchSources, noSourcesSelected, reviewerCount, temperature, additionalNotes, searchWeb, webSearchAvailable, pushProgress]);

  // Run the applicant-recommended reviewers through the full verify→COI→enrich
  // pipeline (server-side) and write the enrichment back to their existing rows.
  // Independent of the search; reuses the search's `analysis` when present so the
  // server can skip a second analyze call.
  const enrichRecommended = useCallback(async () => {
    if (!blobUrl || recRunningRef.current) return;
    recRunningRef.current = true;
    const myGen = genRef.current;
    setRecPhase('running'); setRecError(null); setRecProgress([]); setRecCandidates([]);
    try {
      const res = await fetch('/api/workbench/enrich-recommended', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, blobUrl, analysisResult: analysis || undefined }),
      });
      let result = null;
      let streamError = null;
      await readSseStream(res, ({ event, data }) => {
        if (event === 'error') { streamError = data?.message || 'Enrichment failed'; return; }
        if (data?.error) { streamError = data.error; return; }
        if (data?.message) setRecProgress((p) => [...p.slice(-6), data.message]);
        if (data?.recommended) result = data.recommended;
      });
      if (streamError) throw new Error(streamError);
      if (genRef.current !== myGen) return; // context changed — abort
      setRecCandidates(Array.isArray(result) ? result : []);
      setRecPhase('done');
    } catch (e) {
      if (genRef.current === myGen) { setRecError(e.message); setRecPhase('error'); }
    } finally {
      recRunningRef.current = false;
    }
  }, [blobUrl, requestId, analysis]);

  // The selectable list = the durable active roster ∪ this run's results, deduped
  // by normalized name (run results win — freshest enrichment). Renders + ranks
  // independent of `phase` so the roster shows on reload without a fresh search.
  const displayCandidates = dedupeByName([...candidates, ...rosterActive]);

  const toggle = (key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const allSelected = displayCandidates.length > 0 && displayCandidates.every((c) => selected.has(candKey(c)));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(displayCandidates.map(candKey)));

  // Move a surfaced candidate into the durable Excluded set (not deleted). Optimistic:
  // splice it out of the active view immediately, persist in the background, restore on
  // failure. The candidate stays in rosterNames so a re-run still won't re-surface it.
  const excludeCandidate = useCallback(async (cand) => {
    const key = candKey(cand);
    if (!key || !requestId) return;
    const pruned = pruneCandidateForRoster(cand);
    setCandidates((prev) => prev.filter((c) => candKey(c) !== key));
    setRosterActive((prev) => prev.filter((c) => candKey(c) !== key));
    setRosterExcluded((prev) => dedupeByName([pruned, ...prev]));
    setRosterNames((prev) => Array.from(new Set([...prev, cand.name])));
    setSelected((prev) => { const next = new Set(prev); next.delete(key); return next; });
    try {
      const res = await fetch('/api/workbench/reviewer-roster', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, action: 'exclude', candidate: pruned }),
      });
      if (!res.ok) throw new Error('exclude failed');
    } catch {
      // Roll back the optimistic move so the card isn't silently lost.
      setRosterExcluded((prev) => prev.filter((c) => candKey(c) !== key));
      setRosterActive((prev) => dedupeByName([pruned, ...prev]));
      setRosterNote('Couldn’t exclude that reviewer — please try again.');
    }
  }, [requestId]);

  // Promote an excluded candidate back to the active, selectable list.
  const promoteCandidate = useCallback(async (cand) => {
    const key = candKey(cand);
    if (!key || !requestId) return;
    setRosterExcluded((prev) => prev.filter((c) => candKey(c) !== key));
    setRosterActive((prev) => dedupeByName([cand, ...prev]));
    try {
      const res = await fetch('/api/workbench/reviewer-roster', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, action: 'promote', name: cand.name }),
      });
      if (!res.ok) throw new Error('promote failed');
    } catch {
      setRosterActive((prev) => prev.filter((c) => candKey(c) !== key));
      setRosterExcluded((prev) => dedupeByName([cand, ...prev]));
      setRosterNote('Couldn’t promote that reviewer — please try again.');
    }
  }, [requestId]);

  const saveSelected = useCallback(async () => {
    if (savingRef.current) return;
    const chosen = displayCandidates.filter((c) => selected.has(candKey(c)));
    if (chosen.length === 0) return;
    savingRef.current = true;
    setPhase('saving');
    setError(null); setProgress([]); setSavedMsg(null);
    try {
      // Candidates were already enriched at results time (stage 4 of runSearch),
      // so the chosen rows carry contact info + bibliometrics — save them directly.
      const toSave = chosen;
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

      // Graduate ONLY the successfully-saved names: flip them to status='saved'
      // in the roster (so they leave the active Find list → Candidates tab, but
      // stay deduped) and splice them out of the active view. Failed rows remain
      // active/selectable. Best-effort — a roster failure doesn't fail the save.
      const savedNames = Array.isArray(sData.savedNames) ? sData.savedNames : [];
      if (savedNames.length > 0) {
        const savedKeys = new Set(savedNames.map((n) => normalizeReviewerName(n)));
        setCandidates((prev) => prev.filter((c) => !savedKeys.has(candKey(c))));
        setRosterActive((prev) => prev.filter((c) => !savedKeys.has(candKey(c))));
        setSelected((prev) => { const next = new Set(prev); savedKeys.forEach((k) => next.delete(k)); return next; });
        if (requestId) {
          try {
            await fetch('/api/workbench/reviewer-roster', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ requestId, action: 'saved', names: savedNames }),
            });
          } catch { /* best-effort — savedPoolNames dedup covers re-surfacing */ }
        }
      }
      if (onSaved) onSaved();
    } catch (e) {
      setError(e.message);
      setPhase('error');
    } finally {
      savingRef.current = false;
    }
  }, [displayCandidates, selected, requestId, analysis, cycleCode, onSaved, pushProgress]);

  const busy = phase === 'running' || phase === 'saving';
  const onExcludeChange = (ev) => { excludeEditedRef.current = true; setExcludeText(ev.target.value); };

  // The two selectable sections are VIEWS over displayCandidates; selection is
  // keyed by candKey(c) (stable normalized name), so a roster splice can't
  // corrupt it (S224 — replaces the former flat-index invariant).
  const claudeItems = displayCandidates.filter((c) => isClaudeSuggestion(c));
  const dbItems = displayCandidates.filter((c) => !isClaudeSuggestion(c));

  // Staff-removed recommendations (selected===false) are NOT enriched by the
  // endpoint (it loads selectedOnly:true), so count only the enrichable ones —
  // otherwise the button promises N but enriches fewer (Codex post-impl).
  const recCount = recommended.filter((r) => r.selected !== false).length;

  return (
    <>
    <Card hover={false}>
      <div className="flex items-center justify-between mb-2">
        <p className="font-medium text-gray-900">Search for reviewers</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowPromptEditor((s) => !s)}
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
          <ReviewerPromptOverridePanel onClose={() => setShowPromptEditor(false)} />
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
                      onClick={() => setSearchSources((prev) => ({ ...prev, [key]: !prev[key] }))}
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
              {webSearchAvailable && (
                <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={searchWeb}
                    onChange={(e) => setSearchWeb(e.target.checked)}
                    className="mt-0.5 accent-blue-600"
                  />
                  <span>
                    Also search the web for current researchers
                    <span className="block text-xs text-gray-500">
                      Surfaces active, mid-career names from the live web in a separate panel to counter training-cutoff &amp; fame bias. Read-only leads — they don’t enter the candidate list.
                    </span>
                  </span>
                </label>
              )}
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
                    onChange={(e) => setReviewerCount(parseInt(e.target.value, 10))}
                    className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <span className="text-xs text-gray-400 w-6 text-right">25</span>
                </div>
              </div>
              <div>
                <label htmlFor="reviewer-diversity" className="block text-xs text-gray-500 mb-1">
                  Reviewer diversity: <span className="font-medium text-gray-700">{temperature.toFixed(1)}</span>
                  <span className="text-gray-400"> — higher = more varied / exploratory suggestions</span>
                </label>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-16">Conservative</span>
                  <input
                    id="reviewer-diversity"
                    type="range"
                    min="0.3"
                    max="1.0"
                    step="0.1"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <span className="text-xs text-gray-400 w-12 text-right">Creative</span>
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
                  onChange={(e) => setAdditionalNotes(e.target.value)}
                  placeholder="e.g. prioritize clinical trialists; avoid industry-affiliated reviewers"
                />
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
                  <p className="text-xs text-amber-700 mt-1">The applicant exclusion list couldn’t be loaded — add exclusions manually above.</p>
                )}
              </div>
              {error && <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">{error}</div>}
              <button
                type="button"
                onClick={runSearch}
                disabled={noSourcesSelected || !rosterLoaded}
                className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {!rosterLoaded ? 'Loading existing candidates…' : phase === 'error' ? 'Try again' : 'Run reviewer search'}
              </button>
            </div>
          )}

          {busy && (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">{phase === 'saving' ? 'Saving candidates…' : 'Searching… this can take several minutes — please keep this tab open.'}</p>
              <ul className="text-xs text-gray-500 space-y-0.5">
                {progress.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}

          {/* Durable roster + this-run results — rendered INDEPENDENT of `phase`
              so the per-request candidate list (active + the collapsed Excluded
              set) shows on reload and even when no proposal is loaded. */}
          {(displayCandidates.length > 0 || rosterExcluded.length > 0 || phase === 'results' || phase === 'done') && (
            <div className="space-y-3 mt-3">
              {savedMsg && <div className="p-3 bg-green-50 text-green-700 rounded-lg text-sm">{savedMsg}</div>}
              {enrichNote && <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">{enrichNote}</div>}
              {rosterNote && <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">{rosterNote}</div>}
              {excludedRemoved > 0 && (
                <p className="text-xs text-gray-500">
                  {excludedRemoved} already-surfaced or excluded {excludedRemoved === 1 ? 'reviewer was' : 'reviewers were'} filtered out of the results.
                </p>
              )}
              {displayCandidates.length === 0 && rosterExcluded.length === 0 && unverified.length === 0 ? (
                <p className="text-sm text-gray-600">No candidates were found for this proposal.</p>
              ) : (
                <>
                  {displayCandidates.length > 0 && (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-gray-600">
                          {displayCandidates.length} candidate{displayCandidates.length === 1 ? '' : 's'} for this request
                          {selected.size > 0 && <> · {selected.size} selected</>}
                        </p>
                        <button type="button" onClick={toggleAll} className="text-xs text-blue-600 underline">
                          {allSelected ? 'Clear all' : 'Select all'}
                        </button>
                      </div>
                      <div className="max-h-[32rem] overflow-y-auto space-y-4 pr-1">
                        {claudeItems.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                              Claude suggestions ({claudeItems.length} verified)
                            </p>
                            <div className="space-y-2">
                              {claudeItems.map((c) => (
                                <CandidateCard key={candKey(c)} candidate={c} checked={selected.has(candKey(c))} onToggle={() => toggle(candKey(c))} onExclude={excludeCandidate} />
                              ))}
                            </div>
                          </div>
                        )}
                        {dbItems.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                              Database discoveries ({dbItems.length})
                            </p>
                            <div className="space-y-2">
                              {dbItems.map((c) => (
                                <CandidateCard key={candKey(c)} candidate={c} checked={selected.has(candKey(c))} onToggle={() => toggle(candKey(c))} onExclude={excludeCandidate} />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={saveSelected}
                          disabled={selected.size === 0}
                          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Save {selected.size > 0 ? selected.size : ''} selected as candidates
                        </button>
                        <button type="button" onClick={runSearch} disabled={!blobUrl || busy || !rosterLoaded} className="text-sm text-gray-500 underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed">Run another search</button>
                      </div>
                      <p className="text-xs text-gray-400">
                        Saved candidates join this request’s pool and appear in the Invite tab once you invite and they accept. Excluded and already-surfaced candidates are skipped by the next search.
                      </p>
                    </>
                  )}

                  {/* Collapsed, recoverable Excluded set (durable per request). */}
                  {rosterExcluded.length > 0 && (
                    <details open={excludedOpen} onToggle={(e) => setExcludedOpen(e.currentTarget.open)} className="border border-gray-200 rounded-lg p-2">
                      <summary className="text-xs font-medium text-gray-500 cursor-pointer">
                        Excluded ({rosterExcluded.length}) — set aside for this request; not re-surfaced by a search. Promote one back to reconsider it.
                      </summary>
                      <div className="space-y-2 mt-2">
                        {rosterExcluded.map((c) => (
                          <CandidateCard key={`exc-${candKey(c)}`} candidate={c} readOnly onPromote={promoteCandidate} />
                        ))}
                      </div>
                    </details>
                  )}

                  {unverified.length > 0 && (
                    <details className="border border-gray-200 rounded-lg p-2">
                      <summary className="text-xs font-medium text-gray-500 cursor-pointer">
                        Unverified suggestions ({unverified.length}) — PubMed couldn’t confirm these; not selectable
                      </summary>
                      <div className="space-y-2 mt-2">
                        {unverified.map((c, i) => (
                          <CandidateCard key={`unv-${c.name}-${i}`} candidate={c} readOnly />
                        ))}
                      </div>
                    </details>
                  )}
                </>
              )}
            </div>
          )}
    </Card>

    {/* Web suggestions (Track C v1, READ-ONLY). A visually SEPARATE panel — these
        are leads from the live web, NOT candidates: not selectable, not ranked,
        not saved. Renders only once a run has started the web search this session. */}
    {webSearchAvailable && webPhase !== 'idle' && (
      <Card hover={false}>
        <p className="font-medium text-gray-900 mb-1">Web suggestions</p>
        <p className="text-sm text-gray-600 mb-3">
          Currently-active researchers surfaced from the live web to counter training-cutoff and fame bias.
          These are <span className="font-medium">leads only</span> — check the source, then add anyone promising through your normal search. They are not candidates and are not saved.
        </p>
        {webNote && <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm mb-3">{webNote}</div>}
        {webPhase === 'running' ? (
          <p className="text-sm text-gray-500">Searching the web for current researchers…</p>
        ) : webSuggestions.length === 0 ? (
          !webNote && <p className="text-sm text-gray-600">No web suggestions for this proposal.</p>
        ) : (
          <ul className="divide-y divide-gray-100 max-h-[32rem] overflow-y-auto pr-1">
            {webSuggestions.map((w, i) => (
              <li key={`web-${w.name}-${i}`} className="py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-gray-900">{w.name}</span>
                  {w.date && <span className="text-xs text-gray-400 whitespace-nowrap">{w.date}</span>}
                </div>
                {w.snippet && <p className="text-xs text-gray-600 mt-0.5">{w.snippet}</p>}
                {w.provenanceUrl && (
                  <a
                    href={w.provenanceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:text-blue-700 break-all"
                  >
                    {w.provenanceUrl}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    )}

    {/* Applicant-recommended reviewers + the OPTIONAL verify action, combined into
        one card below the primary search so it can't be mistaken for the search
        (S220: a PD ran the verify thinking it was the reviewer search). The card
        always renders so it still reports "applicant listed none" / ingestion
        errors; the verify controls appear only when there are selectable
        recommendations. Verify checks only the applicant's own listed names — it
        does not find new reviewers. */}
    <Card hover={false}>
      <div className="flex items-center justify-between mb-2">
        <p className="font-medium text-gray-900">Optional: verify the applicant’s suggested reviewers</p>
        {(ingestLoading || recPhase === 'running') && <Spinner />}
      </div>

      {/* Applicant-recommended list (materialized candidates) */}
      {ingestError ? (
        <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
          Couldn’t ingest applicant reviewers: {ingestError}{' '}
          <button type="button" onClick={onRetryIngestion} className="underline font-medium">Retry</button>
        </div>
      ) : ingestLoading ? (
        <p className="text-sm text-gray-500">Materializing the applicant’s recommended reviewers…</p>
      ) : (recommended.length === 0 && recommendedFailed.length === 0 && slotsPopulated === 0) ? (
        <p className="text-sm text-gray-600">The applicant did not list any recommended reviewers for this request.</p>
      ) : (recommended.length === 0 && recommendedFailed.length === 0 && slotsPopulated === null) ? (
        // No usable signal (older/garbled response). Don't claim "listed none".
        <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
          Couldn’t confirm the applicant’s recommended reviewers.{' '}
          <button type="button" onClick={onRetryIngestion} className="underline font-medium">Retry</button>
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
              <button type="button" onClick={onRetryIngestion} className="underline font-medium">Retry</button>
            </div>
          )}
          {recommended.length > 0 ? (
            <>
              <p className="text-sm text-gray-600 mb-3">
                These were recommended by the applicant and are now saved as candidates for this request.
                Verify them below to enrich their records, then dispatch from the <span className="font-medium">Invite</span> tab.
              </p>
              <ul className="divide-y divide-gray-100">
                {recommended.map((r) => (
                  <li key={r.suggestionId || r.potentialReviewerId} className="py-2 flex items-center justify-between gap-3">
                    <span className="text-sm text-gray-900">{r.name || '(unnamed reviewer)'}</span>
                    <span className="flex items-center gap-2">
                      <Pill tone="green">Applicant-suggested</Pill>
                      {r.selected === false && <Pill tone="red">Removed by staff</Pill>}
                      {r.skippedExcluded && <Pill tone="red">Excluded — kept</Pill>}
                      {r.created && <Pill tone="gray">new</Pill>}
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

      {/* Verify action — only when there are selectable recommendations */}
      {recCount > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          {(recPhase === 'idle' || recPhase === 'error') && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                This only checks the {recCount} name{recCount === 1 ? '' : 's'} the applicant listed — it does
                <span className="font-medium"> not</span> find new reviewers. It runs them through the same
                verification, conflict-of-interest, and contact/citation enrichment and saves the results to their rows.
              </p>
              {!blobUrl && <p className="text-xs text-amber-700">Load a proposal document above first (needed for conflict-of-interest checks).</p>}
              {recError && <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">{recError}</div>}
              <button
                type="button"
                onClick={enrichRecommended}
                disabled={!blobUrl}
                className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {recPhase === 'error' ? 'Try again' : `Verify applicant’s ${recCount} suggested reviewer${recCount === 1 ? '' : 's'}`}
              </button>
            </div>
          )}
          {recPhase === 'running' && (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">Verifying &amp; enriching… this can take several minutes — please keep this tab open.</p>
              <ul className="text-xs text-gray-500 space-y-0.5">
                {recProgress.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}
          {recPhase === 'done' && (
            <div className="space-y-3">
              {recCandidates.length === 0 ? (
                <p className="text-sm text-gray-600">No recommended reviewers could be enriched.</p>
              ) : (
                <>
                  <p className="text-sm text-gray-600">
                    Verified {recCandidates.length} applicant-suggested reviewer{recCandidates.length === 1 ? '' : 's'} — metrics &amp; conflicts saved to their records.
                  </p>
                  <div className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
                    {recCandidates.map((c, i) => (
                      <CandidateCard key={`rec-${c.suggestionId || c.name}-${i}`} candidate={c} readOnly />
                    ))}
                  </div>
                  <button type="button" onClick={enrichRecommended} className="text-sm text-gray-500 underline">Re-verify</button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
    </>
  );
}
