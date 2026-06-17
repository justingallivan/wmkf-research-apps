/**
 * ReviewerSearchSection — the in-panel reviewer candidate search for the
 * Workbench Find tab. Replaces the old "go to the standalone Reviewer Finder"
 * handoff: it reuses the proposal already loaded by ReviewerFindPanel (a Vercel
 * Blob URL) and the applicant exclude list, then runs the same endpoints the
 * standalone app uses —
 *   analyze (Claude) → discover (PubMed/preprint verify + rank)
 *     → enrich-contacts (ALL tiers — PubMed/ORCID/SerpAPI Google+Scholar/Claude
 *       web search; SerpAPI is ~free so there is no cost dialog) → save-candidates
 * — so saved candidates land in the SAME per-request pool the Invite tab reads.
 * Applicant-recommended rows use an explicit promotion route before joining that
 * pool.
 *
 * S211 parity build (matches the proven standalone workflow): per-source toggles,
 * candidate-count + additional-context inputs;
 * enrichment runs ON RESULTS (not at save) so cards show email + ORCID/Scholar +
 * REAL h-index/citations (fetched via the google_scholar_author engine) BEFORE the
 * user selects; rich candidate cards with COI / mismatch / confidence warnings;
 * results split by provenance group plus Unverified (the last is read-only).
 * The displayed "expertise match %" is verificationConfidence;
 * the composite relevanceScore drives ordering only — and because /discover ranks
 * BEFORE enrichment, the enriched list is RE-RANKED here (shared scorer in
 * lib/utils/relevance-score.js) so the fetched h-index/citations affect order.
 *
 * Props:
 *   - requestId             : akoya_request GUID (save target)
 *   - blobUrl               : proposal blob URL from load-proposal (required to search)
 *   - proposalKey           : stable SharePoint file key (`library::folder::name`) for applicant-enrichment cache
 *   - cycleCode             : grant cycle code (persisted with saved candidates)
 *   - excludedNames         : string[] of applicant-excluded names (prefills the editable box)
 *   - exclusionsUnavailable : true when ingestion failed to produce the exclude list
 *   - excludedRaw           : the applicant's original free-text exclusion field (shown as a disclosure under the box)
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
  hasValidApplicantEnrichmentCache,
  normalizeReviewerName,
  pruneCandidateForRoster,
} from './reviewer-search-logic';
import { rankByRelevance } from '../../../lib/utils/relevance-score';
import { buildScholarSearchUrl } from '../../../lib/utils/scholar-url';
import {
  PROVENANCE_KINDS,
  provenanceGroupOf,
  provenanceKindOf,
  provenanceLabelForCandidate,
  withReviewerProvenance,
} from '../../../lib/utils/reviewer-provenance';
import { DEFAULT_REVIEWER_COUNT } from '../../config/reviewerFinderPreferences';

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

function isApplicantOriginCandidate(c) {
  return !!c && (c.isApplicantRecommended || provenanceKindOf(c) === PROVENANCE_KINDS.APPLICANT_SUGGESTED);
}

function formatSaveFailureDetails(errors = []) {
  const first = Array.isArray(errors) ? errors.find((e) => e?.error || e?.name) : null;
  if (!first) return '';
  const name = first.name || 'Unknown candidate';
  const error = first.error || 'Save failed';
  return `${name}: ${error}`;
}

// Affiliation-pin provenance (S224 #16). enrichment may replace the discovery
// (PubMed-recency) affiliation with an identity-trusted CURRENT one from ORCID
// or OpenAlex (Slice 1b; `scholar_current` kept for legacy roster rows). Return a
// short source label for the "current (per X)" badge, or null for the default
// pubmed_recency / unset case (no badge — it's the norm).
function affiliationProvenance(source) {
  if (source === 'orcid_current') return 'ORCID';
  if (source === 'openalex_current') return 'OpenAlex';
  if (source === 'scholar_current') return 'Scholar'; // legacy roster rows (pre-Slice-1b)
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
  // S238 graded coauthor COI: 'likely' (strong tie) reads as a real conflict (red);
  // 'possible' (1..threshold-1 shared papers) may be incidental and reads softer (amber).
  // Fallback for any pre-S238 candidate lacking the strength field: treat as 'likely'.
  const coauthorStrength = c.coauthorCOIStrength || (hasCoauthorCOI ? 'likely' : null);
  const hasStrongCoauthorCOI = coauthorStrength === 'likely';
  const hasPossibleCoauthorCOI = coauthorStrength === 'possible';
  // Only a strong (likely) coauthor tie or an institution COI drives the red treatment.
  const hasAnyCOI = hasInstitutionCOI || hasStrongCoauthorCOI;
  const reason = c.reasoning || c.generatedReasoning || null;
  const provenanceLabel = provenanceLabelForCandidate(c);
  const pubs = Array.isArray(c.publications) ? c.publications : [];
  // Distinguish "0 publications" (a resolved profile with genuinely no recent
  // works) from "no bibliometric data" (the OpenAlex author never resolved —
  // e.g. an applicant-named person whose typed name doesn't match their
  // publishing name). For the latter, publicationCount5yr is null and there are
  // no pubs, so show "publication count unavailable" rather than a misleading 0.
  const hasPubCount = Number.isFinite(c.publicationCount5yr) || pubs.length > 0;
  const pubCount = Number.isFinite(c.publicationCount5yr) ? c.publicationCount5yr : pubs.length;
  // Track-B candidate surfaced below the minimum-publication bar (S238) — a warning,
  // not a drop: the count can be undercounted when dedup collapses a preprint + its
  // published version of the same work.
  const lowPublicationCount = !!c.lowPublicationCount;
  const lowPublicationFound = Number.isFinite(c.lowPublicationCountFound) ? c.lowPublicationCountFound : pubs.length;
  // AI-flagged-off-topic (S238) — surfaced + sorted last, not dropped; the reasoning
  // pass judged this retrieved candidate possibly off-topic. A warning, never a gate.
  const aiFlaggedNotRelevant = !!c.aiFlaggedNotRelevant;
  const enr = c.contactEnrichment || {};
  const email = c.email || enr.email || null;
  const website = c.website || enr.website || null;
  const orcidUrl = c.orcidUrl || enr.orcidUrl || null;
  const scholarUrl = c.googleScholarUrl || enr.googleScholarUrl || buildScholarSearchUrl(c.name, c.affiliation);
  const hasRealScholar = !!(c.googleScholarUrl || enr.googleScholarUrl);
  const hIndex = c.hIndex ?? enr.hIndex ?? null;
  const citations = c.totalCitations ?? enr.totalCitations ?? null;
  const coauthorships = Array.isArray(c.coauthorships) ? c.coauthorships : [];

  // A cited/PI-named candidate the spine couldn't auto-verify is selectable (the PI vouched for
  // them) but its contact/bibliometrics are force-nulled at save (save-candidates) until identity
  // is confirmed. Suppress the contact/affiliation/metric display so the card matches that promise
  // (Codex post-impl #4); show only name + reasoning + the amber "verify identity" pill.
  const identityUnverified = provenanceGroupOf(c) !== 'needs_identity_review'
    && (c.needsIdentification === true || c.identityStatus === 'unresolved' || c.verificationStatus === 'unresolved');

  const border = checked ? 'border-blue-500 bg-blue-50'
    : hasAnyCOI ? 'border-red-300 bg-red-50'
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
          {!identityUnverified && c.affiliation && (
            <p className="text-xs text-gray-500 mt-0.5 truncate" title={enr.priorAffiliation ? `Current affiliation (per ${affiliationSourceLabel(c.affiliationSource || enr.affiliationSource)}); previously: ${enr.priorAffiliation}` : undefined}>
              {c.affiliation}
              {affiliationProvenance(c.affiliationSource || enr.affiliationSource) && (
                <span className="ml-1 text-gray-400">· current (per {affiliationProvenance(c.affiliationSource || enr.affiliationSource)})</span>
              )}
            </p>
          )}

          {hasInstitutionCOI && (
            <div className="mt-2 p-2 bg-red-50 border border-red-300 rounded text-xs text-red-800">
              <span className="font-medium">🏛️ Institution COI:</span> Same institution as proposal PI
              {c.institutionCOIDetails?.reviewerInstitution && <span className="ml-1">({c.institutionCOIDetails.reviewerInstitution})</span>}
            </div>
          )}
          {hasCoauthorCOI && coauthorships.length > 0 && (
            <div className={`mt-2 p-2 rounded text-xs border ${hasStrongCoauthorCOI ? 'bg-red-50 border-red-300 text-red-800' : 'bg-amber-100 border-amber-300 text-amber-800'}`}>
              <span className="font-medium">
                {hasStrongCoauthorCOI
                  ? `🚨 Coauthor COI:`
                  : `⚠️ Possible coauthor overlap:`}
              </span>{' '}
              Co-authored {coauthorships.reduce((s, co) => s + (co.paperCount || 0), 0)} paper(s) with proposal author(s)
              {hasPossibleCoauthorCOI && <span> — may be incidental (e.g. a shared large-collaboration paper); verify</span>}:
              <ul className="mt-1 ml-4 list-disc">
                {coauthorships.map((co, idx) => (
                  <li key={idx}>
                    <strong>{co.proposalAuthor}</strong> ({co.paperCount} paper{co.paperCount > 1 ? 's' : ''})
                    {co.recentPapers?.[0]?.title && (
                      <span className={hasStrongCoauthorCOI ? 'text-red-600' : 'text-amber-700'}> — e.g., “{co.recentPapers[0].title.substring(0, 60)}…”</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {isLowConfidence && (
            <div className="mt-2 p-2 bg-amber-100 border border-amber-300 rounded text-xs text-amber-800">
              <span className="font-medium">⚠️ Low match ({Math.round(confidence * 100)}%):</span> Publications don't match Claude's description — could be a different person with the same name.
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

          {lowPublicationCount && (
            <div className="mt-2 p-2 bg-amber-100 border border-amber-300 rounded text-xs text-amber-800">
              <span className="font-medium">⚠️ Few publications found ({lowPublicationFound}):</span> below the usual minimum — surfaced rather than dropped, since the count can be undercounted (e.g. a preprint and its published version collapsing to one). Verify activity manually.
            </div>
          )}
          {aiFlaggedNotRelevant && (
            <div className="mt-2 p-2 bg-amber-100 border border-amber-300 rounded text-xs text-amber-800">
              <span className="font-medium">⚠️ AI flagged as possibly off-topic:</span> the reasoning pass judged this literature-retrieved author a weak topical match — surfaced (ranked last) rather than dropped. Verify relevance manually.
            </div>
          )}

          {reason && <p className="text-xs text-gray-700 mt-2"><span className="font-medium">Why: </span>{reason}</p>}

          {c.identityNote && <p className="text-[11px] text-gray-500 mt-2 italic border-t border-gray-100 pt-1.5">{c.identityNote}</p>}

          <div className="mt-2 flex items-center flex-wrap gap-x-2 gap-y-1 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <span className={hasAnyMismatch ? 'text-orange-500' : isLowConfidence ? 'text-amber-500' : isWeakMatch ? 'text-yellow-600' : 'text-green-500'}>
                {hasAnyMismatch || isLowConfidence ? '⚠' : isWeakMatch ? '⚡' : '✓'}
              </span>
              {hasPubCount ? `${pubCount} publications` : 'publication count unavailable'}
              {confidence !== undefined && <span className="text-gray-400">({Math.round(confidence * 100)}% expertise match)</span>}
            </span>
            {!identityUnverified && hIndex != null && <span>· h-index {hIndex}</span>}
            {!identityUnverified && citations != null && <span>· {citations.toLocaleString()} citations</span>}
            {c.isApplicantRecommended
              ? <Pill tone="green">Applicant recommended</Pill>
              : <Pill tone={provenanceGroupOf(c) === 'needs_identity_review' ? 'amber' : 'gray'}>{provenanceLabel}</Pill>}
            {/* A cited/PI-named candidate the spine couldn't auto-verify is SELECTABLE (the PI
                vouched for them) but its contact/bibliometrics are force-nulled at save until
                identity is confirmed — flag that, and suppress the unverified contact/metrics
                display below so the card matches the "no contact saved" promise. */}
            {identityUnverified && (
              <Pill tone="amber">⚠ Verify identity — no contact saved until confirmed</Pill>
            )}
          </div>

          {!identityUnverified && (email || website || orcidUrl) && (
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
            {!identityUnverified && pubs.length > 0 && (
              <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs text-blue-600 hover:text-blue-800" aria-expanded={expanded}>
                {expanded ? 'Show less' : `View ${pubs.length} recent paper${pubs.length === 1 ? '' : 's'}`}
              </button>
            )}
            {/* Scholar profile/search link suppressed for selectable-but-unverified rows — it
                would nudge staff toward a possibly-wrong namesake profile (Codex re-review LOW). */}
            {!identityUnverified && (
              <a href={scholarUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1" title={hasRealScholar ? "Open this researcher's Google Scholar profile" : 'Search Google Scholar for this researcher'}>
                🎓 {hasRealScholar ? 'Scholar Profile' : 'Scholar Search'}
              </a>
            )}
            {onExclude && (
              <button
                type="button"
                onClick={() => onExclude(c)}
                className="text-xs text-gray-400 hover:text-red-600 ml-auto"
                title="Set aside — moves to the Excluded list and won't be surfaced again by a search for this request (recoverable)"
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
  proposalKey = null,
  cycleCode,
  excludedNames = [],
  exclusionsUnavailable = false,
  excludedRaw = null,
  recommended = [],
  recommendedFailed = [],
  slotsPopulated = null,
  ingestLoading = false,
  ingestError = null,
  onRetryIngestion,
  savedPoolNames = [],
  onSaved,
  manualAddSlot = null,
}) {
  const [phase, setPhase] = useState('idle'); // idle | running | results | saving | done | error
  const [progress, setProgress] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [unverified, setUnverified] = useState([]); // Claude suggestions the searched databases couldn't verify (read-only)
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
  const [errorMeta, setErrorMeta] = useState(null);
  const [savedMsg, setSavedMsg] = useState(null);
  const [enrichNote, setEnrichNote] = useState(null);
  const [excludeText, setExcludeText] = useState((excludedNames || []).join(', '));
  const [excludedRemoved, setExcludedRemoved] = useState(0);
  const [searchSources, setSearchSources] = useState({ pubmed: true, arxiv: true, biorxiv: true, chemrxiv: true });
  const noSourcesSelected = !Object.values(searchSources).some(Boolean);
  const [reviewerCount, setReviewerCount] = useState(DEFAULT_REVIEWER_COUNT); // how many candidates Claude is asked to suggest (recall lever; see reviewerFinderPreferences)
  const [additionalNotes, setAdditionalNotes] = useState(''); // optional extra instructions for Claude
  const [exporting, setExporting] = useState(false); // Excel export in flight
  const [exportError, setExportError] = useState(null); // export-specific error (own surface; does not disturb search `error`/`phase`)
  const exportingRef = useRef(false);

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
    setSelected(new Set()); setError(null); setErrorMeta(null); setSavedMsg(null); setEnrichNote(null); setExportError(null);
    setExcludedRemoved(0); setRosterNote(null);
    setRosterActive([]); setRosterExcluded([]); setRosterNames([]); setExcludedOpen(false); setRosterLoaded(false);
    setSearchSources({ pubmed: true, arxiv: true, biorxiv: true, chemrxiv: true });
    setReviewerCount(DEFAULT_REVIEWER_COUNT);
    setAdditionalNotes('');
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
    setError(null); setErrorMeta(null); setProgress([]); setCandidates([]); setUnverified([]); setSelected(new Set());
    setSavedMsg(null); setEnrichNote(null); setAnalysis(null); setExcludedRemoved(0); setExportError(null);
    try {
      // 1. Analyze the proposal (Claude). excludedNames soft-blocks Claude's own
      //    suggestions; we still hard-filter discovery results below.
      const aRes = await fetch('/api/reviewer-finder/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blobUrl, excludedNames: effectiveExcluded, reviewerCount, additionalNotes: additionalNotes.trim() || undefined }),
      });
      let analysisResult = null;
      let streamError = null;
      await readSseStream(aRes, ({ event, data }) => {
        if (event === 'error') { streamError = data || { message: 'Analysis failed' }; return; }
        if (data?.error) { streamError = { message: data.error, status: data.status, retryable: data.retryable }; return; }
        if (data?.message) pushProgress(data.message);
        if (data?.proposalInfo) analysisResult = data;
      });
      if (streamError) {
        const err = new Error(streamError.message || 'Analysis failed');
        err.status = streamError.status;
        err.retryable = !!streamError.retryable;
        throw err;
      }
      // Stream ended cleanly but no result frame arrived — almost always a
      // timed-out or dropped connection during the long Claude analysis, not a
      // content problem. Name the likely cause so the user knows to just retry.
      if (!analysisResult) throw new Error("The proposal analysis didn't finish — the connection timed out or dropped before results came back. Please run the search again.");
      if (genRef.current !== myGen) return; // context changed — abort
      setAnalysis(analysisResult);

      // 2. Discover + verify + rank across databases.
      pushProgress('Searching databases for candidates…');
      const dRes = await fetch('/api/reviewer-finder/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisResult,
          // S240: let the server resolve the structured PI identity (Project Leader
          // contact → wmkf_orcid → exact OpenAlex author) for exclusion + COI.
          // Optional; absent/malformed → server falls back to proposal-text identity.
          requestId: requestId || null,
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
              // promotion (Codex P2#1). requestId lets the server use the structured
              // PI-institution union, matching discover's hard drop (S240).
              authorInstitution: analysisResult?.proposalInfo?.authorInstitution || null,
              requestId: requestId || null,
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
      enriched = rankByRelevance(enriched.map((c) => withReviewerProvenance(c)), proposalKeywords);
      // Preserve the server's "AI-flagged-off-topic sorts last" guarantee (S238) — the
      // shared scorer orders by relevance score only and would otherwise promote a flagged
      // candidate back to the top after enrichment.
      const offTopic = enriched.filter((c) => c.aiFlaggedNotRelevant);
      if (offTopic.length > 0) {
        enriched = [...enriched.filter((c) => !c.aiFlaggedNotRelevant), ...offTopic];
      }

      setCandidates(enriched);
      setUnverified(unverifiedKept.map((c) => withReviewerProvenance(c)));
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
            setRosterNote("Couldn't save this search to the request — these candidates may re-appear on a future search.");
          }
        } catch {
          if (genRef.current === myGen) setRosterNote("Couldn't save this search to the request — these candidates may re-appear on a future search.");
        }
      }
    } catch (e) {
      if (genRef.current === myGen) {
        setError(e.message);
        setErrorMeta({ status: e.status, retryable: !!e.retryable });
        setPhase('error');
      }
    } finally {
      runningRef.current = false;
    }
  }, [blobUrl, requestId, excludeText, rosterNames, savedPoolNames, rosterLoaded, searchSources, noSourcesSelected, reviewerCount, additionalNotes, pushProgress]);

  // Run the applicant-recommended reviewers through the full verify→COI→enrich
  // pipeline (server-side) and write the enrichment back to their existing rows.
  // Independent of the search; reuses the search's `analysis` when present so the
  // server can skip a second analyze call.
  const enrichRecommended = useCallback(async () => {
    if (!blobUrl || !proposalKey || recRunningRef.current) return;
    recRunningRef.current = true;
    const myGen = genRef.current;
    setRecPhase('running'); setRecError(null); setRecProgress([]); setRecCandidates([]);
    try {
      if (genRef.current !== myGen) return; // abort if context changed before the request fires
      const res = await fetch('/api/workbench/enrich-recommended', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, blobUrl, proposalKey, analysisResult: analysis || undefined }),
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
  }, [blobUrl, proposalKey, requestId, analysis]);

  // Auto-trigger applicant enrichment once both the proposal (blobUrl) and the
  // ingested recommendations are ready. Runs independently of the Claude search —
  // enrichment uses blobUrl directly for COI if no prior analysis result exists.
  // Defined after enrichRecommended to avoid a temporal dead zone reference error.
  const haveValidCache = hasValidApplicantEnrichmentCache(rosterActive, proposalKey);
  useEffect(() => {
    const selectableCount = recommended.length;
    if (recPhase !== 'idle' || recRunningRef.current) return;
    if (rosterLoaded && haveValidCache) {
      setRecPhase('done');
      return;
    }
    if (blobUrl && proposalKey && selectableCount > 0 && rosterLoaded && !haveValidCache) {
      enrichRecommended();
    }
  }, [blobUrl, proposalKey, recommended, recPhase, rosterLoaded, haveValidCache, enrichRecommended]);

  // The selectable list = the durable active roster ∪ this run's results, deduped
  // by normalized name (run results win — freshest enrichment). Renders + ranks
  // independent of `phase` so the roster shows on reload without a fresh search.
  // recCandidates (enriched applicant-suggested) prepend so fresh enrichment wins
  // over any stale roster copy of the same person.
  const displayRosterActive = rosterActive.filter((c) => (
    !isApplicantOriginCandidate(c) || (!!proposalKey && c.enrichedProposalKey === proposalKey)
  ));
  const displayCandidates = dedupeByName([...recCandidates, ...candidates, ...displayRosterActive].map((c) => withReviewerProvenance(c)));

  // Slice E: a candidate the system could not identity-resolve (deferred Track-B or
  // an unresolved verdict) is visible but NOT selectable/savable as a vetted reviewer
  // (anchor-or-abstain at the UI boundary). It renders read-only in its own section
  // and is excluded from select-all + the save set. The server (save-candidates) also
  // hard-rejects these rows, so this is the friendly gate, not the only one.
  // Not selectable if identity needs review OR there's a current same-institution COI
  // (S240 Chunk 2a hard drop): discovery already drops these, but enrichment can promote
  // a current affiliation that matches the PI's institution after the fact — those rows
  // become unselectable + unsavable (the save-candidates API also hard-rejects them).
  const isSelectable = (c) => provenanceGroupOf(c) !== 'needs_identity_review' && !c.hasInstitutionCOI;
  const selectableCandidates = displayCandidates.filter(isSelectable);

  // A Claude suggestion the server couldn't verify can ALSO surface — and verify —
  // from a database search, in this run or a prior one (it then lives in
  // displayCandidates / the active roster). Drop those from the "Unverified
  // suggestions" set so one reviewer can't appear under both headings; the
  // verified row always wins over its unverified twin. Excluded names drop too —
  // they already have their own collapsed section.
  const knownNameKeys = new Set(
    [...displayCandidates.map(candKey), ...rosterExcluded.map(candKey)].filter(Boolean)
  );
  const unverifiedToShow = unverified.filter((c) => !knownNameKeys.has(candKey(c)));

  const toggle = (key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const allSelected = selectableCandidates.length > 0 && selectableCandidates.every((c) => selected.has(candKey(c)));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectableCandidates.map(candKey)));

  // Move a surfaced candidate into the durable Excluded set (not deleted). Optimistic:
  // splice it out of the active view immediately, persist in the background, restore on
  // failure. The candidate stays in rosterNames so a re-run still won't re-surface it.
  const excludeCandidate = useCallback(async (cand) => {
    const key = candKey(cand);
    if (!key || !requestId) return;
    const pruned = pruneCandidateForRoster(cand);
    setCandidates((prev) => prev.filter((c) => candKey(c) !== key));
    setRecCandidates((prev) => prev.filter((c) => candKey(c) !== key));
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
      setRosterNote("Couldn't exclude that reviewer — please try again.");
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
      setRosterNote("Couldn't promote that reviewer — please try again.");
    }
  }, [requestId]);

  const saveSelected = useCallback(async () => {
    if (savingRef.current) return;
    // Filter by isSelectable too (not just `selected`): a needs-identity-review row
    // can't be checked, but this guarantees one never reaches save-candidates even if
    // a stale `selected` entry survives a reclassification (defense-in-depth; the
    // server 422s these anyway).
    const chosen = displayCandidates.filter((c) => selected.has(candKey(c)) && isSelectable(c));
    if (chosen.length === 0) return;
    savingRef.current = true;
    setPhase('saving');
    setError(null); setErrorMeta(null); setProgress([]); setSavedMsg(null);
    try {
      // Candidates were already enriched at results time (stage 4 of runSearch),
      // so the chosen rows carry contact info + bibliometrics — save them directly.
      const applicantChosen = [];
      const toSave = [];
      const failures = [];
      for (const c of chosen) {
        if (provenanceKindOf(c) === PROVENANCE_KINDS.APPLICANT_SUGGESTED) {
          if (c.suggestionId) applicantChosen.push(c);
          else failures.push({ name: c.name || 'Applicant-suggested reviewer', error: 'missing suggestionId' });
        } else {
          toSave.push(c);
        }
      }

      let saved = 0;
      let savedNames = [];
      if (toSave.length > 0) {
        pushProgress(`Saving ${toSave.length} candidate(s)…`);
        try {
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
          if (!sRes.ok || !sData.success) {
            const detail = formatSaveFailureDetails(sData.errors);
            throw new Error(detail ? `${sData.error || `Save failed (${sRes.status})`} ${detail}` : (sData.error || `Save failed (${sRes.status})`));
          }
          saved = sData.savedCount || 0;
          if (saved === 0) {
            const detail = formatSaveFailureDetails(sData.errors);
            throw new Error(detail ? `No candidates were saved: ${detail}` : 'No candidates were saved.');
          }
          savedNames = Array.isArray(sData.savedNames) ? sData.savedNames : [];
          const normalFailed = toSave.length - saved;
          if (normalFailed > 0 && Array.isArray(sData.errors)) failures.push(...sData.errors);
        } catch (e) {
          failures.push(...toSave.map((c) => ({ name: c.name || 'Unknown candidate', error: e.message })));
        }
      }

      let promoted = 0;
      const promotedNames = [];
      if (applicantChosen.length > 0) {
        pushProgress(`Promoting ${applicantChosen.length} applicant-suggested reviewer(s)…`);
        const results = await Promise.all(applicantChosen.map(async (c) => {
          try {
            const res = await fetch('/api/workbench/promote-applicant-reviewer', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ requestId, suggestionId: c.suggestionId }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
              throw new Error(data.error || `Promotion failed (${res.status})`);
            }
            return { ok: true, candidate: c };
          } catch (e) {
            return { ok: false, candidate: c, error: e.message };
          }
        }));
        for (const result of results) {
          if (result.ok) {
            promoted += 1;
            promotedNames.push(result.candidate.name);
          } else {
            failures.push({ name: result.candidate.name || 'Applicant-suggested reviewer', error: result.error });
          }
        }
      }

      const totalSucceeded = saved + promoted;
      if (totalSucceeded === 0) {
        const detail = formatSaveFailureDetails(failures);
        throw new Error(detail ? `No candidates were saved: ${detail}` : 'No candidates were saved.');
      }

      const messageParts = [];
      if (saved > 0) messageParts.push(`Saved ${saved} of ${toSave.length} to this request's candidate pool.`);
      if (promoted > 0) messageParts.push(`Promoted ${promoted} of ${applicantChosen.length} applicant-suggested reviewer${applicantChosen.length === 1 ? '' : 's'}.`);
      if (failures.length > 0) {
        const detail = failures.map((f) => `${f.name || 'Unknown candidate'}: ${f.error || 'failed'}`).join('; ');
        messageParts.push(`${failures.length} could not be saved (${detail}).`);
      }
      setSavedMsg(messageParts.join(' '));
      setPhase('done');

      // Graduate ONLY the successfully-saved names: flip them to status='saved'
      // in the roster (so they leave the active Find list → Candidates tab, but
      // stay deduped) and splice them out of the active view. Failed rows remain
      // active/selectable. Best-effort — a roster failure doesn't fail the save.
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
      if (promotedNames.length > 0) {
        const promotedKeys = new Set(promotedNames.map((n) => normalizeReviewerName(n)));
        setCandidates((prev) => prev.filter((c) => !promotedKeys.has(candKey(c))));
        setRecCandidates((prev) => prev.filter((c) => !promotedKeys.has(candKey(c))));
        setRosterActive((prev) => prev.filter((c) => !promotedKeys.has(candKey(c))));
        setSelected((prev) => { const next = new Set(prev); promotedKeys.forEach((k) => next.delete(k)); return next; });
        if (requestId) {
          try {
            await fetch('/api/workbench/reviewer-roster', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ requestId, action: 'saved', names: promotedNames }),
            });
          } catch {
            setRosterNote("Couldn't mark promoted applicant-suggested reviewers as saved in the Find roster — they may reappear after reload.");
          }
        }
      }
      if (onSaved && totalSucceeded > 0) onSaved();
    } catch (e) {
      setError(e.message);
      setPhase('error');
    } finally {
      savingRef.current = false;
    }
  }, [displayCandidates, selected, requestId, analysis, cycleCode, onSaved, pushProgress]);

  // Export the SELECTED candidates to an Excel workbook (Request Info + Candidates
  // sheets, built server-side). Slim DTO per row resolves the same fields the card
  // shows (email/orcid/scholar fall back to contactEnrichment); the server fetches
  // request metadata (number/institution/PI) authoritatively by requestId.
  const exportSelected = useCallback(async () => {
    if (exportingRef.current) return;
    const chosen = displayCandidates.filter((c) => selected.has(candKey(c)) && isSelectable(c));
    if (chosen.length === 0) return;
    exportingRef.current = true;
    setExporting(true);
    setExportError(null);
    try {
      const rows = chosen.map((c) => {
        const enr = c.contactEnrichment || {};
        const realScholar = c.googleScholarUrl || enr.googleScholarUrl || null;
        return {
          name: c.name,
          affiliation: c.affiliation || null,
          email: c.email || enr.email || null,
          reasoning: c.reasoning || c.generatedReasoning || null,
          isApplicantRecommended: !!c.isApplicantRecommended,
          provenance: c.provenance || null,
          orcidUrl: c.orcidUrl || enr.orcidUrl || null,
          scholarUrl: realScholar || buildScholarSearchUrl(c.name, c.affiliation),
          hasRealScholar: !!realScholar,
          hasInstitutionCOI: !!c.hasInstitutionCOI,
          institutionCOIDetails: c.institutionCOIDetails || null,
          hasCoauthorCOI: !!c.hasCoauthorCOI,
          coauthorCOIStrength: c.coauthorCOIStrength || null,
          coauthorships: Array.isArray(c.coauthorships) ? c.coauthorships : [],
          hIndex: c.hIndex ?? enr.hIndex ?? null,
          publicationCount5yr: c.publicationCount5yr ?? (Array.isArray(c.publications) ? c.publications.length : null),
          seniorityEstimate: c.seniorityEstimate || null,
        };
      });
      const res = await fetch('/api/workbench/export-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, candidates: rows }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : 'reviewer-candidates.xlsx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e.message);
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }, [displayCandidates, selected, requestId]);

  const busy = phase === 'running' || phase === 'saving';
  const onExcludeChange = (ev) => { excludeEditedRef.current = true; setExcludeText(ev.target.value); };

  // The two selectable sections are VIEWS over displayCandidates; selection is
  // keyed by candKey(c) (stable normalized name), so a roster splice can't
  // corrupt it (S224 — replaces the former flat-index invariant).
  const provenanceSections = [
    {
      key: 'cited_or_proposal_named',
      title: 'Cited / proposal-named',
      items: displayCandidates.filter((c) => provenanceGroupOf(c) === 'cited_or_proposal_named'),
    },
    {
      key: 'literature_retrieved',
      title: 'Literature-retrieved',
      items: displayCandidates.filter((c) => provenanceGroupOf(c) === 'literature_retrieved'),
    },
    {
      key: 'applicant_suggested',
      title: 'Applicant-suggested',
      items: displayCandidates.filter((c) => provenanceGroupOf(c) === 'applicant_suggested'),
    },
    {
      key: 'needs_identity_review',
      title: 'Needs identity review',
      items: displayCandidates.filter((c) => provenanceGroupOf(c) === 'needs_identity_review'),
    },
  ].filter((section) => section.items.length > 0);

  // Applicant rows now default to selected=false until explicit PD promotion;
  // removed-by-staff vs not-yet-promoted is not a distinct displayed state.
  const recCount = recommended.length;
  // Candidates with needsIdentification:true route to needs_identity_review, not
  // applicant_suggested — split the done-message count accordingly.
  const applicantDisplayCandidates = displayCandidates.filter(isApplicantOriginCandidate);
  const recVerifiedCount = applicantDisplayCandidates.filter((c) => provenanceGroupOf(withReviewerProvenance(c)) === 'applicant_suggested').length;
  const recIdentityReviewCount = applicantDisplayCandidates.filter((c) => provenanceGroupOf(withReviewerProvenance(c)) === 'needs_identity_review').length;

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
                  <p className="text-xs text-amber-700 mt-1">The applicant exclusion list couldn't be loaded — add exclusions manually above.</p>
                )}
                {excludedRaw && (
                  <details className="mt-2">
                    <summary className="text-xs text-gray-500 cursor-pointer">Applicant's original text</summary>
                    <pre className="text-xs bg-gray-50 text-gray-700 rounded p-2 mt-1 whitespace-pre-wrap">{excludedRaw}</pre>
                  </details>
                )}
              </div>
              {error && (
                <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
                  {errorMeta?.status === 'analysis_invalid' ? (
                    <>
                      The proposal analysis response was incomplete or unreliable. Please retry the analysis.
                      {errorMeta.retryable && <span className="block text-xs mt-1">Use Try again to rerun the analysis.</span>}
                    </>
                  ) : error}
                </div>
              )}
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
              {displayCandidates.length === 0 && rosterExcluded.length === 0 && unverifiedToShow.length === 0 ? (
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
                        {provenanceSections.map((section) => {
                          // Slice E: the needs-identity-review section is read-only.
                          const readOnlySection = section.key === 'needs_identity_review';
                          return (
                          <div key={section.key}>
                            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                              {section.title} ({section.items.length})
                            </p>
                            {section.key === 'needs_identity_review' && (
                              <p className="text-xs text-gray-400 mb-1.5">
                                Identity couldn't be confirmed for these — not selectable. Re-run a search or resolve the identity to consider them.
                              </p>
                            )}
                            {section.key === 'applicant_suggested' && (
                              <p className="text-xs text-gray-400 mb-1.5">
                                Named by the applicant — select to add to this request's candidate pool.
                              </p>
                            )}
                            <div className="space-y-2">
                              {section.items.map((c) => (
                                (readOnlySection || !isSelectable(c))
                                  ? <CandidateCard key={candKey(c)} candidate={c} readOnly onExclude={excludeCandidate} />
                                  : <CandidateCard key={candKey(c)} candidate={c} checked={selected.has(candKey(c))} onToggle={() => toggle(candKey(c))} onExclude={excludeCandidate} />
                              ))}
                            </div>
                          </div>
                          );
                        })}
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
                        <button
                          type="button"
                          onClick={exportSelected}
                          disabled={selected.size === 0 || exporting}
                          title={selected.size === 0 ? 'Select candidates — or use Select all — to export' : undefined}
                          className="px-4 py-2 bg-white text-gray-900 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {exporting ? 'Exporting…' : `Export ${selected.size > 0 ? selected.size : ''} to Excel`}
                        </button>
                        <button type="button" onClick={runSearch} disabled={!blobUrl || busy || !rosterLoaded} className="text-sm text-gray-500 underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed">Run another search</button>
                      </div>
                      {exportError && (
                        <p className="text-sm text-amber-700">Export failed: {exportError}</p>
                      )}
                      <p className="text-xs text-gray-400">
                        Saved candidates join this request's pool and appear in the Invite tab once you invite and they accept. Excluded and already-surfaced candidates are skipped by the next search.
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

                  {unverifiedToShow.length > 0 && (
                    <details className="border border-gray-200 rounded-lg p-2">
                      <summary className="text-xs font-medium text-gray-500 cursor-pointer">
                        Unverified suggestions ({unverifiedToShow.length}) — couldn't confirm these in the literature; not selectable
                      </summary>
                      <div className="space-y-2 mt-2">
                        {unverifiedToShow.map((c, i) => (
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

    {/* Manual reviewer add — slot rendered BELOW the search and ABOVE the optional
        verify card (state + handlers live in ReviewerFindPanel). */}
    {manualAddSlot}

    {/* Applicant-suggested reviewer status card — ingestion + enrichment state.
        Enriched candidates surface in the Applicant-suggested provenance section
        of the main candidate list above; this card is a status surface only.
        Enrichment fires automatically when both the proposal and the ingested
        recommendations are ready (no manual trigger required). */}
    <Card hover={false}>
      <div className="flex items-center justify-between mb-2">
        <p className="font-medium text-gray-900">Applicant-suggested reviewers</p>
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
          {recPhase === 'idle' && !blobUrl && recCount > 0 && (
            <p className="text-sm text-gray-500">
              {recCount} applicant-suggested reviewer{recCount === 1 ? '' : 's'} ingested — waiting for the proposal to load before verifying.
            </p>
          )}
          {recPhase === 'running' && (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">Verifying applicant-suggested reviewers — this can take a minute or two, please keep this tab open.</p>
              <ul className="text-xs text-gray-500 space-y-0.5">
                {recProgress.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}
          {recPhase === 'done' && (
            <p className="text-sm text-gray-600">
              {recVerifiedCount === 0 && recIdentityReviewCount === 0
                ? 'No applicant-suggested reviewers could be verified.'
                : <>
                    {recVerifiedCount > 0
                      ? `${recVerifiedCount} applicant-suggested reviewer${recVerifiedCount === 1 ? '' : 's'} verified — see the Applicant-suggested section above`
                      : 'No reviewers added to the Applicant-suggested section'}
                    {recIdentityReviewCount > 0 && <>; {recIdentityReviewCount} could not be confirmed — see the Identity review section</>}.
                  </>
              }
            </p>
          )}
          {recPhase === 'error' && (
            <div className="space-y-2">
              <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">{recError}</div>
              <button
                type="button"
                onClick={enrichRecommended}
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
    </>
  );
}
