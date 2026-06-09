/**
 * Expert Reviewer Finder v2
 *
 * A tiered, progressive reviewer discovery system that combines:
 * - Claude's analytical reasoning (the "why")
 * - Real database verification (the "who")
 *
 * Two-tab interface:
 * - Tab 1: New Search - Upload proposal and find reviewers
 * - Tab 2: My Candidates - Saved/selected candidates with email generation
 *
 * (The Database tab and its Postgres-backed admin CRUD retired in W6 of the
 * Reviewer Finder Postgres→Dataverse migration; under the 1:1 contact model
 * there is no longer a shared researcher pool to browse.)
 */

import { useState, useEffect, useRef, useContext, useCallback } from 'react';
import Layout, { PageHeader, Card, Button } from '../shared/components/Layout';
import HelpButton from '../shared/components/HelpButton';
import FileUploaderSimple from '../shared/components/FileUploaderSimple';
import EmailSettingsPanel from '../shared/components/EmailSettingsPanel';
import EmailGeneratorModal from '../shared/components/EmailGeneratorModal';
import SettingsModal from '../shared/components/SettingsModal';
import { getModelDisplayName } from '../shared/utils/modelNames';
import { BASE_CONFIG } from '../shared/config/baseConfig';
import { resolveStoredCycle, formatCycleForStorage } from '../shared/config/reviewerFinderPreferences';
import ProfileContext from '../shared/context/ProfileContext';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import { readSseStream } from '../shared/components/reviewers/sse';
import { provenanceGroupOf } from '../lib/utils/reviewer-provenance';

// Helper to extract email from affiliation string (fallback when email field is null)
function extractEmailFromAffiliation(affiliation) {
  if (!affiliation) return null;
  // Match common email patterns in affiliation strings
  const emailMatch = affiliation.match(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/);
  return emailMatch ? emailMatch[0] : null;
}

function formatSaveFailureDetails(errors = []) {
  const first = Array.isArray(errors) ? errors.find((e) => e?.error || e?.name) : null;
  if (!first) return '';
  const name = first.name || 'Unknown candidate';
  const error = first.error || 'Save failed';
  return `${name}: ${error}`;
}

// Tab component
function Tab({ label, active, onClick, icon }) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-2 px-6 py-3 font-medium text-sm
        border-b-2 transition-all duration-200
        ${active
          ? 'border-gray-900 text-gray-900 bg-gray-50'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
        }
      `}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// Progress indicator for stages
function StageProgress({ stages }) {
  return (
    <div className="flex items-center justify-center gap-4 py-4">
      {stages.map((stage, index) => (
        <div key={stage.id} className="flex items-center">
          <div className={`
            flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium
            ${stage.status === 'complete' ? 'bg-green-500 text-white' :
              stage.status === 'active' ? 'bg-blue-500 text-white animate-pulse' :
              stage.status === 'error' ? 'bg-red-500 text-white' :
              'bg-gray-200 text-gray-500'}
          `}>
            {stage.status === 'complete' ? '✓' :
             stage.status === 'error' ? '✗' :
             index + 1}
          </div>
          <span className={`ml-2 text-sm ${
            stage.status === 'active' ? 'text-blue-600 font-medium' :
            stage.status === 'complete' ? 'text-green-600' :
            stage.status === 'error' ? 'text-red-600' :
            'text-gray-400'
          }`}>
            {stage.label}
          </span>
          {index < stages.length - 1 && (
            <div className={`w-12 h-0.5 mx-4 ${
              stage.status === 'complete' ? 'bg-green-300' : 'bg-gray-200'
            }`} />
          )}
        </div>
      ))}
    </div>
  );
}

// Build Google Scholar author search URL
function buildScholarSearchUrl(name, affiliation) {
  // Safety check - return empty search if no name
  if (!name) {
    return 'https://scholar.google.com/citations?view_op=search_authors&mauthors=';
  }

  // Clean up name - remove titles like Dr., Prof., Professor
  const cleanName = name
    .replace(/^(Dr\.?|Prof\.?|Professor)\s+/i, '')
    .trim();

  // Extract just the institution name from full affiliation
  // Affiliations often look like: "Department of Biology, University of Minnesota, Minneapolis, MN 55455, USA"
  // We want just: "University of Minnesota"
  let cleanAffiliation = '';
  if (affiliation) {
    // Remove email addresses first
    const affWithoutEmail = affiliation.replace(/\S+@\S+/g, '').trim();

    // Split by comma and look for actual institution names (university/institute/college)
    // Prioritize actual institutions over departments/schools
    const parts = affWithoutEmail.split(',').map(p => p.trim()).filter(p => p.length > 0);

    // First, look for "University" or "Institute" (actual institutions)
    let institutionPart = parts.find(p =>
      /\buniversity\b|\binstitute\b|\bcollege\b/i.test(p) &&
      !/^(department|dept|division|school|faculty|center|centre)\s+of/i.test(p)
    );

    // If not found, try "School of Medicine", "Medical School", etc. (standalone schools)
    if (!institutionPart) {
      institutionPart = parts.find(p =>
        /\bschool\b|\blaboratory\b|\blab\b/i.test(p)
      );
    }

    cleanAffiliation = institutionPart || parts[0] || '';

    // Remove department prefixes if they slipped through
    cleanAffiliation = cleanAffiliation
      .replace(/^(department of|dept\.? of|division of|school of|faculty of|center for|centre for)\s+/i, '')
      .trim();
  }

  // Use the author profile search which finds researcher pages
  const query = cleanAffiliation
    ? `${cleanName} ${cleanAffiliation}`
    : cleanName;
  return `https://scholar.google.com/citations?view_op=search_authors&mauthors=${encodeURIComponent(query)}`;
}

// Candidate card component
function CandidateCard({ candidate, selected, onSelect, readOnly = false }) {
  const [expanded, setExpanded] = useState(false);  // For "View papers" toggle

  const isClaudeSuggestion = candidate.isClaudeSuggestion || candidate.source === 'claude_suggestion';
  const reasoning = candidate.reasoning || candidate.generatedReasoning || 'No reasoning available';

  // Check verification confidence - categorize into ranges
  const confidence = candidate.verificationConfidence;
  const isLowConfidence = confidence !== undefined && confidence < 0.35;
  const isWeakMatch = confidence !== undefined && confidence >= 0.35 && confidence < 0.65;

  // Check for mismatches (wrong person or wrong expertise)
  const hasInstitutionMismatch = candidate.institutionMismatch;
  const hasExpertiseMismatch = candidate.expertiseMismatch;
  const hasAnyMismatch = hasInstitutionMismatch || hasExpertiseMismatch;

  const hasCoauthorCOI = candidate.hasCoauthorCOI;
  const hasInstitutionCOI = candidate.hasInstitutionCOI;
  const hasAnyCOI = hasCoauthorCOI || hasInstitutionCOI;
  // Parser normalizes no-concern values to null; trim guards a whitespace-only
  // value so the advisory block matches the Workbench card. (Codex nit.)
  const potentialConcerns = typeof candidate.potentialConcerns === 'string' ? candidate.potentialConcerns.trim() : '';

  return (
    <div className={`
      border rounded-lg p-4 transition-all duration-200
      ${selected ? 'border-blue-500 bg-blue-50' :
        hasAnyCOI ? 'border-red-300 bg-red-50' :
        potentialConcerns ? 'border-amber-300 bg-amber-50' :
        hasAnyMismatch ? 'border-orange-300 bg-orange-50' :
        isLowConfidence ? 'border-amber-300 bg-amber-50' :
        isWeakMatch ? 'border-yellow-200 bg-yellow-50' :
        'border-gray-200 hover:border-gray-300'}
    `}>
      <div className="flex items-start gap-3">
        {readOnly ? (
          <span
            className="mt-1 h-4 w-4 shrink-0 rounded border border-gray-300 bg-gray-100"
            title="Identity unconfirmed — not selectable"
            aria-hidden="true"
          />
        ) : (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onSelect(candidate)}
          className="mt-1 h-4 w-4 text-blue-600 rounded border-gray-300"
        />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-medium text-gray-900 truncate">
              {candidate.name}
            </h4>
            <span className={`
              px-2 py-0.5 text-xs rounded-full
              ${candidate.seniorityEstimate === 'Senior' ? 'bg-purple-100 text-purple-700' :
                candidate.seniorityEstimate === 'Mid-career' ? 'bg-blue-100 text-blue-700' :
                'bg-green-100 text-green-700'}
            `}>
              {candidate.seniorityEstimate || 'Unknown'}
            </span>
          </div>

          {candidate.affiliation && (() => {
            // Affiliation-pin provenance (S224 #16): enrichment may have replaced
            // the discovery affiliation with an identity-trusted CURRENT one.
            const affSource = candidate.affiliationSource || candidate.contactEnrichment?.affiliationSource;
            const affVia = affSource === 'orcid_current' ? 'ORCID' : affSource === 'scholar_current' ? 'Scholar' : null;
            const prior = candidate.contactEnrichment?.priorAffiliation;
            return (
              <p
                className="text-sm text-gray-500 truncate"
                title={prior ? `Current affiliation (per ${affVia || 'recent publications'}); previously: ${prior}` : undefined}
              >
                {candidate.affiliation}
                {affVia && <span className="ml-1 text-gray-400">· current (per {affVia})</span>}
              </p>
            );
          })()}

          {/* Institution COI warning */}
          {candidate.hasInstitutionCOI && (
            <div className="mt-2 p-2 bg-red-50 border border-red-300 rounded text-xs text-red-800">
              <span className="font-medium">🏛️ Institution COI:</span> {candidate.institutionCOIDetails?.historical ? 'Former shared institution with proposal PI' : 'Same institution as proposal PI'}
              {candidate.institutionCOIDetails && (
                <span className="ml-1">
                  ({candidate.institutionCOIDetails.reviewerInstitution})
                </span>
              )}
            </div>
          )}

          {/* Model-flagged concern (POTENTIAL_CONCERNS) — parser normalizes
              no-concern values to null, so any value here is a real warning. */}
          {potentialConcerns && (
            <div className="mt-2 p-2 bg-amber-100 border border-amber-300 rounded text-xs text-amber-800">
              <span className="font-medium">⚠️ Potential concern (AI-flagged):</span> {potentialConcerns}
            </div>
          )}

          {/* Coauthor COI warning */}
          {candidate.hasCoauthorCOI && candidate.coauthorships && candidate.coauthorships.length > 0 && (
            <div className="mt-2 p-2 bg-red-50 border border-red-300 rounded text-xs text-red-800">
              <span className="font-medium">🚨 Coauthor COI:</span> Co-authored {
                candidate.coauthorships.reduce((sum, c) => sum + c.paperCount, 0)
              } paper(s) with proposal author(s):
              <ul className="mt-1 ml-4 list-disc">
                {candidate.coauthorships.map((coauth, idx) => (
                  <li key={idx}>
                    <strong>{coauth.proposalAuthor}</strong> ({coauth.paperCount} paper{coauth.paperCount > 1 ? 's' : ''})
                    {coauth.recentPapers && coauth.recentPapers.length > 0 && (
                      <span className="text-red-600"> - e.g., "{coauth.recentPapers[0].title?.substring(0, 60)}..."</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Low confidence warning (< 35%) */}
          {isLowConfidence && (
            <div className="mt-2 p-2 bg-amber-100 border border-amber-300 rounded text-xs text-amber-800">
              <span className="font-medium">⚠️ Low match ({Math.round(confidence * 100)}%):</span> Publications don't match Claude's description.
              This could be a different person with the same name.
            </div>
          )}

          {/* Weak match warning (35-65%) */}
          {isWeakMatch && !hasAnyMismatch && (
            <div className="mt-2 p-2 bg-yellow-50 border border-yellow-300 rounded text-xs text-yellow-800">
              <span className="font-medium">⚡ Weak match ({Math.round(confidence * 100)}%):</span> Some publications match, but relevance is uncertain. Verify expertise manually.
            </div>
          )}

          {/* Institution mismatch warning - may have verified wrong person */}
          {hasInstitutionMismatch && candidate.suggestedInstitution && (
            <div className="mt-2 p-2 bg-orange-100 border border-orange-300 rounded text-xs text-orange-800">
              <span className="font-medium">⚠️ Institution mismatch:</span> Claude suggested <strong>{candidate.suggestedInstitution}</strong>,
              but PubMed shows <strong>{candidate.affiliation?.split(',')[0] || 'different institution'}</strong>.
              This may be a different person with the same name.
            </div>
          )}

          {/* Expertise mismatch warning - Claude may have fabricated expertise */}
          {hasExpertiseMismatch && candidate.expertiseAreas && (
            <div className="mt-2 p-2 bg-orange-100 border border-orange-300 rounded text-xs text-orange-800">
              <span className="font-medium">⚠️ Expertise mismatch:</span> Claude claimed expertise in "{candidate.expertiseAreas.slice(0, 2).join(', ')}"
              but no publications found with these specific terms. Actual research focus may differ.
            </div>
          )}

          <div className="mt-2">
            <p className="text-sm text-gray-700">
              <span className="font-medium">Why: </span>
              {reasoning}
            </p>
          </div>

          <div className="mt-2 flex items-center flex-wrap gap-2 text-xs text-gray-500">
            {candidate.verified !== false && (
              <span className="flex items-center gap-1">
                <span className={
                  hasAnyMismatch ? 'text-orange-500' :
                  isLowConfidence ? 'text-amber-500' :
                  isWeakMatch ? 'text-yellow-600' :
                  'text-green-500'
                }>
                  {hasAnyMismatch ? '⚠' : isLowConfidence ? '⚠' : isWeakMatch ? '⚡' : '✓'}
                </span>
                {candidate.publicationCount5yr || candidate.publications?.length || 0} publications
                {confidence !== undefined && (
                  <span className={
                    hasAnyMismatch ? 'text-orange-500' :
                    isLowConfidence ? 'text-amber-500' :
                    isWeakMatch ? 'text-yellow-600' :
                    'text-gray-400'
                  }>
                    ({Math.round(confidence * 100)}% match)
                  </span>
                )}
              </span>
            )}
            <span className={`
              px-2 py-0.5 rounded-full
              ${isClaudeSuggestion ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}
            `}>
              {isClaudeSuggestion ? 'Claude suggestion' : candidate.source || 'Database'}
            </span>
          </div>

          {/* Contact info (if enriched) */}
          {candidate.contactEnrichment && (candidate.contactEnrichment.email || candidate.contactEnrichment.website || candidate.contactEnrichment.orcidUrl) && (
            <div className="mt-2 flex items-center flex-wrap gap-2 text-xs">
              {candidate.contactEnrichment.email && (
                <a
                  href={`mailto:${candidate.contactEnrichment.email}`}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                  title={`Email (from ${candidate.contactEnrichment.emailSource || 'enrichment'}${candidate.contactEnrichment.emailYear ? `, ${candidate.contactEnrichment.emailYear}` : ''})`}
                >
                  📧 {candidate.contactEnrichment.email}
                </a>
              )}
              {candidate.contactEnrichment.website && (
                <a
                  href={candidate.contactEnrichment.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 rounded hover:bg-green-100"
                  title="Faculty/Personal website"
                >
                  🔗 Website
                </a>
              )}
              {candidate.contactEnrichment.orcidUrl && (
                <a
                  href={candidate.contactEnrichment.orcidUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100"
                  title="ORCID Profile"
                >
                  ORCID
                </a>
              )}
            </div>
          )}

          {/* Action buttons: View papers + Scholar lookup */}
          <div className="mt-2 flex items-center gap-3">
            {candidate.publications && candidate.publications.length > 0 && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                {expanded ? 'Show less' : `View ${candidate.publications.length} papers`}
              </button>
            )}
            <a
              href={buildScholarSearchUrl(candidate.name, candidate.affiliation)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1"
              title="Search Google Scholar for this researcher's profile, h-index, and citations"
            >
              🎓 Scholar Profile
            </a>
          </div>

          {expanded && candidate.publications && (
            <div className="mt-2 space-y-1">
              {candidate.publications.map((pub, i) => (
                <div key={i} className="text-xs text-gray-600">
                  • {pub.title} ({pub.year || 'N/A'})
                  {pub.url && (
                    <a href={pub.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-blue-500">
                      [Link]
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Proposal picker — fetches the authenticated PD's proposals from Dynamics
// and loads the chosen one's Project Narrative from SharePoint into Vercel
// Blob, then hands the blob URL back via onProposalLoaded so the parent
// flow treats it like an upload.
function ProposalPickerCard({ onProposalLoaded, onError }) {
  const [cycles, setCycles] = useState(null);
  const [cyclesError, setCyclesError] = useState(null);
  const [selectedCycle, setSelectedCycle] = useState(null);
  const [statusMode, setStatusMode] = useState('actionable');
  const [proposals, setProposals] = useState(null);
  const [proposalsError, setProposalsError] = useState(null);
  const [pdName, setPdName] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingProposalId, setLoadingProposalId] = useState(null);

  // Load the cycle list on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const r = await fetch('/api/reviewer-finder/my-proposals');
        const data = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setCyclesError(data.error || `Failed to load cycles (${r.status})`);
          return;
        }
        setCycles(data.cycles || []);
        setPdName(data.programDirector?.fullName || null);
        // Auto-select the most recent cycle.
        if (data.cycles && data.cycles.length > 0) {
          setSelectedCycle(data.cycles[0].code);
        }
      } catch (err) {
        if (!cancelled) setCyclesError(err.message || 'Failed to load cycles');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load proposals whenever cycle or statusMode changes.
  useEffect(() => {
    if (!selectedCycle) return;
    let cancelled = false;
    (async () => {
      try {
        setProposals(null);
        setProposalsError(null);
        const params = new URLSearchParams({ cycleCode: selectedCycle, status: statusMode });
        const r = await fetch(`/api/reviewer-finder/my-proposals?${params}`);
        const data = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setProposalsError(data.error || `Failed to load proposals (${r.status})`);
          return;
        }
        setProposals(data.proposals || []);
      } catch (err) {
        if (!cancelled) setProposalsError(err.message || 'Failed to load proposals');
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCycle, statusMode]);

  const handlePick = async (proposal) => {
    setLoadingProposalId(proposal.requestId);
    try {
      const r = await fetch('/api/reviewer-finder/load-proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: proposal.requestId }),
      });
      const data = await r.json();
      if (!r.ok) {
        const msg = data.error || `Failed to load proposal (${r.status})`;
        if (onError) onError(msg);
        return;
      }
      onProposalLoaded({
        url: data.blobUrl,
        name: data.filename,
        size: data.size,
        mimeType: data.contentType,
        sourceProposal: {
          requestId: proposal.requestId,
          requestNumber: proposal.requestNumber,
          applicant: proposal.applicant,
          projectLeader: proposal.projectLeader,
          programArea: proposal.programArea,
          meetingDate: proposal.meetingDate,
          cycleCode: selectedCycle,
        },
      });
    } catch (err) {
      if (onError) onError(err.message || 'Failed to load proposal');
    } finally {
      setLoadingProposalId(null);
    }
  };

  if (cyclesError) {
    return (
      <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
        {cyclesError}
      </div>
    );
  }
  if (loading || !cycles) {
    return <div className="text-sm text-gray-500">Loading your proposals…</div>;
  }
  if (cycles.length === 0) {
    return (
      <div className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded p-3">
        No proposals found in Dynamics for {pdName || 'your account'}.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-sm flex-wrap">
        <span className="text-gray-600">{pdName ? `${pdName} —` : ''} cycle:</span>
        <select
          value={selectedCycle || ''}
          onChange={(e) => setSelectedCycle(e.target.value)}
          className="px-3 py-1.5 bg-purple-50 text-purple-700 rounded font-medium border-0 cursor-pointer pr-8"
        >
          {cycles.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} ({c.count})
            </option>
          ))}
        </select>
        <label className="ml-2 inline-flex items-center gap-2 text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={statusMode === 'all'}
            onChange={(e) => setStatusMode(e.target.checked ? 'all' : 'actionable')}
          />
          <span>Show completed too</span>
        </label>
      </div>

      {proposalsError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
          {proposalsError}
        </div>
      )}

      {proposals && proposals.length === 0 && !proposalsError && (
        <div className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded p-3">
          {statusMode === 'actionable'
            ? `No proposals in ${selectedCycle} need reviewers right now. Toggle "Show completed too" to see all Phase II Pending.`
            : `No Phase II Pending proposals in ${selectedCycle}.`}
        </div>
      )}

      {proposals && proposals.length > 0 && (
        <div className="border rounded divide-y">
          {proposals.map((p) => (
            <div key={p.requestId} className="p-3 flex items-center justify-between gap-3 hover:bg-gray-50">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-gray-500">#{p.requestNumber}</span>
                  <span className="text-gray-400">·</span>
                  <span className="font-medium truncate">{p.applicant || '—'}</span>
                </div>
                <div className="text-xs text-gray-600 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                  {p.projectLeader && <span>PI: {p.projectLeader}</span>}
                  {p.programArea && <span>{p.programArea}</span>}
                  {p.meetingDateFormatted && <span>Meeting: {p.meetingDateFormatted}</span>}
                  <span>
                    {(() => {
                      // Prefer Postgres-tracked counts (lifecycle ledger); fall
                      // back to slot population if no candidates saved yet.
                      const invited = p.reviewerInvited ?? p.reviewerSlotsFilled;
                      const accepted = p.reviewerAccepted ?? 0;
                      const declined = p.reviewerDeclined ?? 0;
                      if (invited === 0) return 'no reviewers invited yet';
                      const parts = [`${invited} invited`];
                      if (accepted > 0) parts.push(`${accepted} accepted`);
                      if (declined > 0) parts.push(`${declined} declined`);
                      parts.push('goal: 3');
                      return parts.join(' · ');
                    })()}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handlePick(p)}
                disabled={loadingProposalId !== null}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm rounded whitespace-nowrap"
              >
                {loadingProposalId === p.requestId ? 'Loading…' : 'Use this proposal'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// New Search Tab content
function NewSearchTab({ apiCapabilities, onCandidatesSaved, searchState, setSearchState, userProfileId }) {
  // Use lifted state from parent (persists across tab switches)
  const { uploadedFiles, analysisResult, discoveryResult, selectedCandidates } = searchState;

  // Helper to update lifted state (support both direct values and callback functions)
  const setUploadedFiles = (filesOrFn) => setSearchState(prev => ({
    ...prev,
    uploadedFiles: typeof filesOrFn === 'function' ? filesOrFn(prev.uploadedFiles) : filesOrFn
  }));
  const setAnalysisResult = (resultOrFn) => setSearchState(prev => ({
    ...prev,
    analysisResult: typeof resultOrFn === 'function' ? resultOrFn(prev.analysisResult) : resultOrFn
  }));
  const setDiscoveryResult = (resultOrFn) => setSearchState(prev => ({
    ...prev,
    discoveryResult: typeof resultOrFn === 'function' ? resultOrFn(prev.discoveryResult) : resultOrFn
  }));
  const setSelectedCandidates = (candidatesOrFn) => setSearchState(prev => ({
    ...prev,
    selectedCandidates: typeof candidatesOrFn === 'function' ? candidatesOrFn(prev.selectedCandidates) : candidatesOrFn
  }));

  // Entry mode: 'crm' (Dataverse-native picker) or 'upload' (legacy PDF upload).
  // Default 'crm'; falls back to 'upload' if the user prefers or if Dynamics is
  // unavailable. See project_reviewer_finder_dataverse_entry_path memory.
  const [entryMode, setEntryMode] = useState('crm');

  // Local state (OK to reset on tab switch)
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [excludedNames, setExcludedNames] = useState('');
  const [temperature, setTemperature] = useState(0.3); // Default: conservative, predictable
  const [reviewerCount, setReviewerCount] = useState(12); // Default: 12 candidates
  const [searchSources, setSearchSources] = useState({
    pubmed: true,
    arxiv: true,
    biorxiv: true,
    chemrxiv: true
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [currentStage, setCurrentStage] = useState(null);
  const [progressMessages, setProgressMessages] = useState([]);
  const [error, setError] = useState(null);
  const [errorMeta, setErrorMeta] = useState(null);
  const [saveMessage, setSaveMessage] = useState(null);

  // Contact enrichment state
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichmentProgress, setEnrichmentProgress] = useState(null);
  const [enrichmentResults, setEnrichmentResults] = useState(null);
  const [showEnrichmentModal, setShowEnrichmentModal] = useState(false);
  const [enrichmentOptions, setEnrichmentOptions] = useState({
    usePubmed: true,
    useOrcid: true,
    useClaudeSearch: false,
    useSerpSearch: false,
  });

  // Current cycle state
  const [currentCycleInfo, setCurrentCycleInfo] = useState(null);
  const [availableCycles, setAvailableCycles] = useState([]); // Recent cycles (rolling window)
  const [allCyclesList, setAllCyclesList] = useState([]); // All active cycles
  const [showAllCycles, setShowAllCycles] = useState(false); // Toggle for showing all cycles

  // Generate cycle options for current year and next year (18 months coverage)
  const generateCycleOptions = () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const nextYear = currentYear + 1;
    const yy = (currentYear % 100).toString();
    const yyNext = (nextYear % 100).toString();

    return [
      { shortCode: `J${yy}`, name: `June ${currentYear}` },
      { shortCode: `D${yy}`, name: `December ${currentYear}` },
      { shortCode: `J${yyNext}`, name: `June ${nextYear}` },
      { shortCode: `D${yyNext}`, name: `December ${nextYear}` },
    ];
  };

  // Load cycles and ensure current+next year cycles exist
  useEffect(() => {
    const loadAndEnsureCycles = async () => {
      try {
        const response = await fetch('/api/reviewer-finder/grant-cycles');
        if (!response.ok) return;

        const data = await response.json();
        const existingCycles = data.cycles || [];
        const neededCycles = generateCycleOptions();

        // Find which cycles need to be created
        const cyclesToCreate = neededCycles.filter(
          needed => !existingCycles.some(existing => existing.shortCode === needed.shortCode)
        );

        // Create missing cycles
        for (const cycle of cyclesToCreate) {
          await fetch('/api/reviewer-finder/grant-cycles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: cycle.name,
              shortCode: cycle.shortCode,
              programName: 'W. M. Keck Foundation',
            }),
          });
        }

        // Re-fetch to get all cycles with IDs
        const refreshResponse = await fetch('/api/reviewer-finder/grant-cycles');
        if (refreshResponse.ok) {
          const refreshData = await refreshResponse.json();
          const allCycles = refreshData.cycles || [];

          // Filter to only show current+next year cycles in dropdown
          const relevantShortCodes = neededCycles.map(c => c.shortCode);
          let relevantCycles = allCycles.filter(c =>
            relevantShortCodes.includes(c.shortCode) && c.isActive
          );

          // Deduplicate by shortCode (keep the first/oldest one)
          const seenShortCodes = new Set();
          relevantCycles = relevantCycles.filter(c => {
            if (seenShortCodes.has(c.shortCode)) {
              return false;
            }
            seenShortCodes.add(c.shortCode);
            return true;
          });

          // Sort: current year first, then by J before D
          relevantCycles.sort((a, b) => {
            const aYear = parseInt(a.shortCode.slice(1), 10);
            const bYear = parseInt(b.shortCode.slice(1), 10);
            if (aYear !== bYear) return aYear - bYear;
            return a.shortCode[0] === 'J' ? -1 : 1;
          });

          setAvailableCycles(relevantCycles);

          // Also store all active cycles for "show all" mode
          let allActiveCycles = allCycles.filter(c => c.isActive);
          // Deduplicate
          const seenAll = new Set();
          allActiveCycles = allActiveCycles.filter(c => {
            if (seenAll.has(c.shortCode)) return false;
            seenAll.add(c.shortCode);
            return true;
          });
          // Sort by year descending (newest first), then D before J
          allActiveCycles.sort((a, b) => {
            const aYear = parseInt(a.shortCode.slice(1), 10);
            const bYear = parseInt(b.shortCode.slice(1), 10);
            if (aYear !== bYear) return bYear - aYear; // Descending
            return a.shortCode[0] === 'D' ? -1 : 1; // D before J within same year
          });
          setAllCyclesList(allActiveCycles);

          // Set current cycle from localStorage or default to first option.
          // Tolerant-reader pattern (Codex S147): the stored value may be a
          // legacy Postgres integer ID OR a shortcode like "J26". Resolve via
          // helper; on legacy hit, opportunistically rewrite localStorage to
          // the shortcode shape so future reads skip the parseInt branch.
          const storedCycleId = localStorage.getItem(CURRENT_CYCLE_KEY);
          if (storedCycleId) {
            const { cycle: storedCycle, needsWriteback } = resolveStoredCycle(storedCycleId, allCycles);
            if (storedCycle) {
              setCurrentCycleInfo(storedCycle);
              if (needsWriteback) {
                localStorage.setItem(CURRENT_CYCLE_KEY, formatCycleForStorage(storedCycle));
              }
            } else if (relevantCycles.length > 0) {
              setCurrentCycleInfo(relevantCycles[0]);
              localStorage.setItem(CURRENT_CYCLE_KEY, formatCycleForStorage(relevantCycles[0]));
            }
          } else if (relevantCycles.length > 0) {
            setCurrentCycleInfo(relevantCycles[0]);
            localStorage.setItem(CURRENT_CYCLE_KEY, formatCycleForStorage(relevantCycles[0]));
          }
        }
      } catch (err) {
        console.error('Failed to load/create cycles:', err);
      }
    };
    loadAndEnsureCycles();
  }, []);

  // Handle cycle selection change. After Codex S147 preference-shape
  // migration, the dropdown emits a shortcode string (not an integer ID).
  const handleCycleChange = (cycleShortCode) => {
    const cycle = availableCycles.find(c => c.shortCode === cycleShortCode);
    if (cycle) {
      setCurrentCycleInfo(cycle);
      localStorage.setItem(CURRENT_CYCLE_KEY, formatCycleForStorage(cycle));
    }
  };

  const progressRef = useRef(null);

  const stages = [
    { id: 'analysis', label: 'Claude Analysis', status: currentStage === 'analysis' ? 'active' : analysisResult ? 'complete' : 'pending' },
    { id: 'discovery', label: 'Database Discovery', status: currentStage === 'discovery' ? 'active' : discoveryResult ? 'complete' : 'pending' },
    { id: 'results', label: 'Results', status: discoveryResult ? 'complete' : 'pending' }
  ];

  // Auto-scroll progress
  useEffect(() => {
    if (progressRef.current) {
      progressRef.current.scrollTop = progressRef.current.scrollHeight;
    }
  }, [progressMessages]);

  const handleFilesUploaded = (files) => {
    setUploadedFiles(files);
    setError(null);
    setErrorMeta(null);
    // Reset results when new file uploaded
    setAnalysisResult(null);
    setDiscoveryResult(null);
    setSelectedCandidates(new Set());
  };

  const addProgressMessage = (message, type = 'info') => {
    setProgressMessages(prev => [...prev, { time: new Date().toLocaleTimeString(), message, type }]);
  };

  const runAnalysis = async () => {
    if (uploadedFiles.length === 0) {
      setError('Please upload a proposal PDF first');
      return;
    }

    setIsProcessing(true);
    setCurrentStage('analysis');
    setProgressMessages([]);
    setError(null);
    setErrorMeta(null);
    setAnalysisResult(null);
    setDiscoveryResult(null);

    try {
      // Stage 1: Claude Analysis
      addProgressMessage('Starting Claude analysis...');

      // Get summary pages setting from localStorage (for PDF extraction)
      let summaryPages = '2'; // Default to page 2
      try {
        const grantCycleStored = localStorage.getItem('email_grant_cycle');
        if (grantCycleStored) {
          const grantCycle = JSON.parse(atob(grantCycleStored));
          if (grantCycle.summaryPages) {
            summaryPages = grantCycle.summaryPages;
          }
        }
      } catch (e) {
        console.warn('Could not read summary pages setting:', e);
      }

      const response = await fetch('/api/reviewer-finder/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blobUrl: uploadedFiles[0].url,
          additionalNotes,
          excludedNames: excludedNames.split(',').map(n => n.trim()).filter(Boolean),
          temperature,
          reviewerCount,
          summaryPages
        })
      });

      let analysisData = null;
      let streamError = null;

      await readSseStream(response, ({ event, data }) => {
        if (event === 'error') {
          streamError = data || { message: 'Analysis failed' };
          return;
        }
        if (data?.error) {
          streamError = { message: data.error || data.message, status: data.status, retryable: data.retryable };
          return;
        }
        if (data?.message) {
          // Detect fallback status from message or status field
          const isFallback = data.status === 'fallback' || data.message?.toLowerCase().includes('fallback');
          addProgressMessage(data.message, isFallback ? 'fallback' : 'info');
        }
        if (data?.proposalInfo) {
          analysisData = data;
        }
      });
      if (streamError) {
        const err = new Error(streamError.message || 'Analysis failed');
        err.status = streamError.status;
        err.retryable = !!streamError.retryable;
        throw err;
      }

      if (!analysisData) {
        throw new Error('Analysis did not return results');
      }

      setAnalysisResult(analysisData);
      addProgressMessage(`Found ${analysisData.reviewerSuggestions?.length || 0} Claude suggestions`);

      // Stage 2: Database Discovery
      setCurrentStage('discovery');
      addProgressMessage('Starting database discovery...');

      const discoverResponse = await fetch('/api/reviewer-finder/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisResult: analysisData,
          options: {
            searchPubmed: searchSources.pubmed,
            searchArxiv: searchSources.arxiv,
            searchBiorxiv: searchSources.biorxiv,
            searchChemrxiv: searchSources.chemrxiv,
            generateReasoning: true
          }
        })
      });

      let discoveryData = null;
      streamError = null;
      await readSseStream(discoverResponse, ({ event, data }) => {
        if (event === 'error') {
          streamError = data || { message: 'Discovery failed' };
          return;
        }
        if (data?.error) {
          streamError = { message: data.error || data.message, status: data.status, retryable: data.retryable };
          return;
        }
        if (data?.message) {
          // Detect fallback status from message or status field
          const isFallback = data.status === 'fallback' || data.message?.toLowerCase().includes('fallback');
          addProgressMessage(data.message, isFallback ? 'fallback' : 'info');
        }
        if (data?.ranked) {
          discoveryData = data;
        }
      });
      if (streamError) {
        const err = new Error(streamError.message || 'Discovery failed');
        err.status = streamError.status;
        err.retryable = !!streamError.retryable;
        throw err;
      }

      if (discoveryData) {
        setDiscoveryResult(discoveryData);
        addProgressMessage(`Discovery complete: ${discoveryData.verified?.length || 0} verified, ${discoveryData.discovered?.length || 0} discovered`);
      }

      setCurrentStage('results');

    } catch (err) {
      console.error('Processing error:', err);
      setError(err.message);
      setErrorMeta({ status: err.status, retryable: !!err.retryable });
      addProgressMessage(`Error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Slice E (S235): a candidate the system could not identity-resolve is shown but NOT
  // selectable/savable as a vetted reviewer. This page has no provenance grouping, so it
  // gates on the same helper the Workbench uses; `save-candidates` also hard-rejects
  // these rows server-side.
  const isSelectable = (c) => provenanceGroupOf(c) !== 'needs_identity_review';

  const toggleCandidate = (candidate) => {
    if (!isSelectable(candidate)) return; // identity-unresolved rows are not selectable
    const newSelected = new Set(selectedCandidates);
    const key = candidate.name;
    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.add(key);
    }
    setSelectedCandidates(newSelected);
  };

  const allCandidates = discoveryResult?.ranked || [];
  const verifiedCount = discoveryResult?.verified?.length || 0;
  const discoveredCount = discoveryResult?.discovered?.length || 0;

  // Apply enrichment results to candidates in discoveryResult
  const applyEnrichmentResults = (enrichmentData) => {
    if (!enrichmentData?.results || !discoveryResult) return;

    // Create a map of enriched candidates by name for quick lookup
    const enrichedMap = new Map();
    enrichmentData.results.forEach(result => {
      enrichedMap.set(result.name, result.contactEnrichment);
    });

    // Update the discoveryResult with enriched contact info
    const updateCandidate = (candidate) => {
      const enrichment = enrichedMap.get(candidate.name);
      if (enrichment) {
        return {
          ...candidate,
          contactEnrichment: enrichment,
          // Promote the identity-trusted CURRENT affiliation pin + provenance
          // (S224 #16) so the card shows "current (per ORCID)" and the saved
          // record carries the current affiliation, not the postdoc-era one.
          affiliation: enrichment.affiliation || candidate.affiliation,
          affiliationSource: enrichment.affiliationSource || candidate.affiliationSource,
          // Institution COI re-evaluated against the post-enrichment affiliation
          // (enrich-contacts). `coiRecomputed` distinguishes "ran and found none"
          // (override) from "didn't run" (keep the discover value). (Codex P2#1.)
          hasInstitutionCOI: enrichment.coiRecomputed ? !!enrichment.hasInstitutionCOI : candidate.hasInstitutionCOI,
          institutionCOIDetails: enrichment.coiRecomputed ? (enrichment.institutionCOIDetails || null) : (candidate.institutionCOIDetails || null),
        };
      }
      return candidate;
    };

    setDiscoveryResult(prev => ({
      ...prev,
      ranked: prev.ranked?.map(updateCandidate) || [],
      verified: prev.verified?.map(updateCandidate) || [],
      discovered: prev.discovered?.map(updateCandidate) || [],
    }));
  };

  // Get selected candidate objects
  const getSelectedCandidateObjects = () => {
    return allCandidates.filter(c => selectedCandidates.has(c.name) && isSelectable(c));
  };

  // Generate a consistent proposal ID from the title (no timestamp for deduplication)
  const generateProposalId = () => {
    const title = analysisResult?.proposalInfo?.title || 'untitled';
    // Create a deterministic slug from title - same title = same ID
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 50);
    return slug;
  };

  // Save candidates to database
  // Optional enrichmentData parameter allows saving with freshly enriched contact info
  const handleSaveCandidates = async (enrichmentData = null) => {
    let selected = getSelectedCandidateObjects();
    if (selected.length === 0) return;

    // If enrichment data is provided, merge it into candidates before saving
    if (enrichmentData?.results) {
      const enrichedMap = new Map();
      enrichmentData.results.forEach(result => {
        enrichedMap.set(result.name, result.contactEnrichment);
      });

      selected = selected.map(candidate => {
        const enrichment = enrichedMap.get(candidate.name);
        if (enrichment) {
          return {
            ...candidate,
            contactEnrichment: enrichment,
            // Also set top-level email/website for database storage
            email: enrichment.email || candidate.email,
            website: enrichment.website || candidate.website,
            // Persist the identity-trusted CURRENT affiliation pin (S224 #16) —
            // save-candidates reads candidate.affiliation first, so promote it
            // or the postdoc-era discovery affiliation would be stored.
            affiliation: enrichment.affiliation || candidate.affiliation,
            affiliationSource: enrichment.affiliationSource || candidate.affiliationSource,
            // Persist the COI re-evaluated against the post-enrichment affiliation
            // so the saved matchReason isn't stale (mirror the display merge). (Codex P2.)
            hasInstitutionCOI: enrichment.coiRecomputed ? !!enrichment.hasInstitutionCOI : candidate.hasInstitutionCOI,
            institutionCOIDetails: enrichment.coiRecomputed ? (enrichment.institutionCOIDetails || null) : (candidate.institutionCOIDetails || null),
          };
        }
        return candidate;
      });
    }

    setIsSaving(true);
    setSaveMessage(null);

    try {
      const response = await fetch('/api/reviewer-finder/save-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: generateProposalId(),
          proposalTitle: analysisResult?.proposalInfo?.title || 'Untitled Proposal',
          proposalAbstract: analysisResult?.proposalInfo?.abstract || '',
          proposalAuthors: analysisResult?.proposalInfo?.proposalAuthors || '',
          proposalInstitution: analysisResult?.proposalInfo?.authorInstitution || '',
          programArea: analysisResult?.proposalInfo?.programArea || null,
          summaryBlobUrl: analysisResult?.summaryBlobUrl || null,
          // save-candidates reads `grantCycleCode` only — dropping legacy
          // `grantCycleId` payload (which the API silently discarded).
          userProfileId: userProfileId || null,
          requestId: uploadedFiles[0]?.sourceProposal?.requestId || null,
          grantCycleCode: uploadedFiles[0]?.sourceProposal?.cycleCode || null,
          candidates: selected
        })
      });

      const result = await response.json();

      if (response.ok && result.success) {
        // Surface identity-unresolved rejections (Slice E) so a partial save isn't
        // silently reported as a clean success.
        const rejected = result.rejectedUnresolved || 0;
        const saved = result.savedCount || 0;
        const failed = Math.max(0, selected.length - saved);
        const failureDetail = failed > 0 ? formatSaveFailureDetails(result.errors) : '';
        setSaveMessage({
          type: rejected > 0 || failed > 0 ? 'warning' : 'success',
          text: failed > 0
            ? `Saved ${saved} candidate(s) to My Candidates. ${failed} failed${failureDetail ? ` (${failureDetail})` : ''}.`
            : rejected > 0
              ? `Saved ${saved} candidate(s) to My Candidates. ${rejected} skipped — identity unconfirmed (needs identity review).`
              : `Saved ${saved} candidate(s) to My Candidates`
        });
        // Notify parent to refresh My Candidates tab
        if (onCandidatesSaved) {
          onCandidatesSaved();
        }
      } else {
        setSaveMessage({
          type: 'error',
          text: formatSaveFailureDetails(result.errors)
            ? `${result.error || 'Failed to save candidates'} ${formatSaveFailureDetails(result.errors)}`
            : (result.error || 'Failed to save candidates')
        });
      }
    } catch (err) {
      setSaveMessage({
        type: 'error',
        text: err.message || 'Failed to save candidates'
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Enrich selected candidates with contact information
  const handleEnrichContacts = async () => {
    const selected = getSelectedCandidateObjects();
    if (selected.length === 0) return;

    setIsEnriching(true);
    setEnrichmentProgress(null);
    setEnrichmentResults(null);
    setShowEnrichmentModal(true);

    try {
      const response = await fetch('/api/reviewer-finder/enrich-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidates: selected,
          options: enrichmentOptions,
          // Lets the route re-evaluate institution COI on the post-enrichment
          // affiliation so the badge stays accurate (Codex P2#1).
          authorInstitution: analysisResult?.proposalInfo?.authorInstitution || null,
        }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'estimate') {
                setEnrichmentProgress({ type: 'estimate', ...data.estimate });
              } else if (data.type === 'progress') {
                setEnrichmentProgress(prev => ({ ...prev, ...data }));
              } else if (data.type === 'complete') {
                setEnrichmentResults(data);
                setEnrichmentProgress({ type: 'complete' });
              } else if (data.type === 'error') {
                setEnrichmentProgress({ type: 'error', message: data.message });
              }
            } catch (e) {
              console.error('Parse error:', e);
            }
          }
        }
      }
    } catch (err) {
      setEnrichmentProgress({ type: 'error', message: err.message });
    } finally {
      setIsEnriching(false);
    }
  };

  // Export selected candidates as Markdown
  const exportAsMarkdown = () => {
    const selected = getSelectedCandidateObjects();
    if (selected.length === 0) return;

    const proposalTitle = analysisResult?.proposalInfo?.title || 'Untitled Proposal';
    const date = new Date().toLocaleDateString();

    let markdown = `# Expert Reviewers for "${proposalTitle}"\n\n`;
    markdown += `Generated: ${date}\n\n`;
    markdown += `---\n\n`;
    markdown += `## Selected Candidates (${selected.length})\n\n`;

    selected.forEach((candidate, index) => {
      markdown += `### ${index + 1}. ${candidate.name}\n\n`;

      if (candidate.affiliation) {
        markdown += `**Affiliation:** ${candidate.affiliation}\n\n`;
      }

      const isClaudeSuggestion = candidate.isClaudeSuggestion || candidate.source === 'claude_suggestion';
      markdown += `**Source:** ${isClaudeSuggestion ? 'Claude suggestion (verified)' : candidate.source || 'Database discovery'}\n\n`;

      if (candidate.seniorityEstimate) {
        markdown += `**Seniority:** ${candidate.seniorityEstimate}\n\n`;
      }

      // Contact information (from enrichment)
      if (candidate.contactEnrichment) {
        const ce = candidate.contactEnrichment;
        if (ce.email || ce.website || ce.orcidUrl) {
          markdown += `**Contact:**\n`;
          if (ce.email) {
            markdown += `- Email: [${ce.email}](mailto:${ce.email})`;
            if (ce.emailSource) markdown += ` _(from ${ce.emailSource}${ce.emailYear ? `, ${ce.emailYear}` : ''})_`;
            markdown += '\n';
          }
          if (ce.website) {
            markdown += `- Website: [${ce.website}](${ce.website})\n`;
          }
          if (ce.facultyPageUrl && ce.facultyPageUrl !== ce.website) {
            markdown += `- Faculty Page: [${ce.facultyPageUrl}](${ce.facultyPageUrl})\n`;
          }
          if (ce.orcidUrl) {
            markdown += `- ORCID: [${ce.orcidId || 'Profile'}](${ce.orcidUrl})\n`;
          }
          markdown += '\n';
        }
      }

      const reasoning = candidate.reasoning || candidate.generatedReasoning;
      if (reasoning) {
        markdown += `**Why this reviewer:** ${reasoning}\n\n`;
      }

      // COI Warnings
      if (candidate.hasInstitutionCOI) {
        markdown += `**🏛️ Institution COI:** Same institution as proposal PI`;
        if (candidate.institutionCOIDetails?.reviewerInstitution) {
          markdown += ` (${candidate.institutionCOIDetails.reviewerInstitution})`;
        }
        markdown += '\n\n';
      }

      if (candidate.hasCoauthorCOI && candidate.coauthorships) {
        markdown += `**🚨 Coauthor COI:** Has co-authored papers with proposal authors:\n`;
        candidate.coauthorships.forEach(coauth => {
          markdown += `- ${coauth.paperCount} paper(s) with ${coauth.proposalAuthor}\n`;
        });
        markdown += '\n';
      }

      // Publications
      if (candidate.publications && candidate.publications.length > 0) {
        markdown += `**Recent Publications (${candidate.publications.length}):**\n`;
        candidate.publications.slice(0, 5).forEach(pub => {
          const url = pub.url || (pub.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}` : '');
          if (url) {
            markdown += `- [${pub.title}](${url}) (${pub.year || 'N/A'})\n`;
          } else {
            markdown += `- ${pub.title} (${pub.year || 'N/A'})\n`;
          }
        });
        markdown += '\n';
      }

      markdown += `---\n\n`;
    });

    // Download the file
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reviewers-${proposalTitle.replace(/[^a-z0-9]/gi, '-').substring(0, 30)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Export selected candidates as CSV
  const exportAsCSV = () => {
    const selected = getSelectedCandidateObjects();
    if (selected.length === 0) return;

    const proposalTitle = analysisResult?.proposalInfo?.title || 'Untitled Proposal';

    // CSV header - now includes contact info columns
    let csv = 'Name,Affiliation,Email,Email_Source,Website,ORCID,Source,Seniority,Publications_5yr,COI_Warning,Reasoning\n';

    selected.forEach(candidate => {
      const isClaudeSuggestion = candidate.isClaudeSuggestion || candidate.source === 'claude_suggestion';
      const source = isClaudeSuggestion ? 'Claude suggestion' : (candidate.source || 'Database');
      const pubCount = candidate.publicationCount5yr || candidate.publications?.length || 0;

      // Build COI warning string
      const coiParts = [];
      if (candidate.hasInstitutionCOI) coiParts.push('Institution COI');
      if (candidate.hasCoauthorCOI) coiParts.push('Coauthor COI');
      const coiWarning = coiParts.length > 0 ? coiParts.join(', ') : 'No';

      const reasoning = (candidate.reasoning || candidate.generatedReasoning || '').replace(/"/g, '""');

      // Contact enrichment fields
      const ce = candidate.contactEnrichment || {};
      const email = ce.email || '';
      const emailSource = ce.emailSource ? `${ce.emailSource}${ce.emailYear ? ` (${ce.emailYear})` : ''}` : '';
      const website = ce.website || ce.facultyPageUrl || '';
      const orcid = ce.orcidUrl || '';

      csv += `"${candidate.name}","${candidate.affiliation || ''}","${email}","${emailSource}","${website}","${orcid}","${source}","${candidate.seniorityEstimate || ''}",${pubCount},"${coiWarning}","${reasoning}"\n`;
    });

    // Download the file
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reviewers-${proposalTitle.replace(/[^a-z0-9]/gi, '-').substring(0, 30)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Handle export with format selection
  const handleExportSelected = () => {
    // For now, export both formats. Could add a dropdown later.
    exportAsMarkdown();
  };

  return (
    <div className="space-y-6">
      {/* Configuration Section */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Upload Proposal</h3>
          {/* Grant Cycle Selector */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">Grant Cycle:</span>
            <select
              value={currentCycleInfo?.shortCode || ''}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '__show_all__') {
                  setShowAllCycles(true);
                } else if (val === '__show_recent__') {
                  setShowAllCycles(false);
                } else {
                  handleCycleChange(val);
                }
              }}
              className="px-3 py-1.5 bg-purple-50 text-purple-700 rounded font-medium border-0 cursor-pointer appearance-none pr-8"
              style={{
                backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%237c3aed\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")',
                backgroundPosition: 'right 0.5rem center',
                backgroundRepeat: 'no-repeat',
                backgroundSize: '1rem'
              }}
            >
              {(showAllCycles ? allCyclesList : availableCycles).filter(c => c.shortCode).map(cycle => (
                <option key={cycle.id} value={cycle.shortCode}>
                  {cycle.shortCode} - {cycle.name}
                </option>
              ))}
              <option disabled>───────────</option>
              {showAllCycles ? (
                <option value="__show_recent__">↩ Show recent only</option>
              ) : (
                <option value="__show_all__">Show all cycles ({allCyclesList.length})...</option>
              )}
            </select>
          </div>
        </div>

        {/* Entry mode toggle: pick from CRM (new default) vs upload PDF (legacy) */}
        <div className="mb-3 inline-flex rounded border bg-gray-50 p-0.5 text-sm">
          <button
            type="button"
            onClick={() => setEntryMode('crm')}
            className={`px-3 py-1 rounded ${entryMode === 'crm' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}
          >
            From My Proposals
          </button>
          <button
            type="button"
            onClick={() => setEntryMode('upload')}
            className={`px-3 py-1 rounded ${entryMode === 'upload' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}
          >
            Upload PDF
          </button>
        </div>

        {entryMode === 'crm' ? (
          <ProposalPickerCard
            onProposalLoaded={(file) => {
              handleFilesUploaded([file]);
              setError(null);
            }}
            onError={(msg) => setError(msg)}
          />
        ) : (
          <FileUploaderSimple
            onFilesUploaded={handleFilesUploaded}
            multiple={false}
            accept=".pdf"
          />
        )}

        {entryMode === 'crm' && uploadedFiles.length > 0 && (
          <div className="mt-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded p-2 flex items-center justify-between">
            <span>
              Loaded: <span className="font-medium">{uploadedFiles[0].name}</span>
              {uploadedFiles[0].sourceProposal && (
                <span className="text-gray-600"> — request #{uploadedFiles[0].sourceProposal.requestNumber}</span>
              )}
            </span>
            <button
              type="button"
              onClick={() => setUploadedFiles([])}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Clear
            </button>
          </div>
        )}

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Search Sources
            </label>
            <div className="flex gap-3 flex-wrap">
              {[
                { key: 'pubmed', label: 'PubMed', icon: '📚', desc: 'Biomedical literature' },
                { key: 'arxiv', label: 'ArXiv', icon: '📄', desc: 'Physics, math, CS' },
                { key: 'biorxiv', label: 'BioRxiv', icon: '🧬', desc: 'Life sciences' },
                { key: 'chemrxiv', label: 'ChemRxiv', icon: '🧪', desc: 'Chemistry' },
              ].map(({ key, label, icon, desc }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSearchSources(prev => ({ ...prev, [key]: !prev[key] }))}
                  className={`px-3 py-2 rounded-lg border transition-all flex flex-col items-center min-w-[90px] ${
                    searchSources[key]
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-gray-50 border-gray-200 text-gray-400'
                  }`}
                >
                  <span className="text-lg">{icon}</span>
                  <span className="font-medium text-sm">{label}</span>
                  <span className="text-xs opacity-75">{desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Number of Candidates: {reviewerCount}
            </label>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-8">1</span>
              <input
                type="range"
                min="1"
                max="25"
                step="1"
                value={reviewerCount}
                onChange={(e) => setReviewerCount(parseInt(e.target.value, 10))}
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <span className="text-xs text-gray-500 w-8 text-right">25</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reviewer Diversity: {temperature.toFixed(1)}
            </label>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-20">Conservative</span>
              <input
                type="range"
                min="0.3"
                max="1.0"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <span className="text-xs text-gray-500 w-16 text-right">Creative</span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {temperature <= 0.4 ? 'More predictable, established reviewers' :
               temperature <= 0.6 ? 'Balanced mix of established and diverse candidates' :
               temperature <= 0.8 ? 'More diverse, potentially unconventional suggestions' :
               'Maximum creativity, broader range of candidates'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Excluded Names (conflicts of interest)
            </label>
            <input
              type="text"
              value={excludedNames}
              onChange={(e) => setExcludedNames(e.target.value)}
              placeholder="John Smith, Jane Doe (comma-separated)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Additional Context (optional)
            </label>
            <textarea
              value={additionalNotes}
              onChange={(e) => setAdditionalNotes(e.target.value)}
              placeholder="Any specific requirements or context for reviewer selection..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              rows={2}
            />
          </div>
        </div>

        <div className="mt-6">
          <Button
            onClick={runAnalysis}
            disabled={isProcessing || uploadedFiles.length === 0}
            loading={isProcessing}
            className="w-full"
          >
            {isProcessing ? 'Processing...' : 'Find Reviewers'}
          </Button>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {errorMeta?.status === 'analysis_invalid' ? (
              <>
                The proposal analysis response was incomplete or unreliable. Please retry the analysis.
                {errorMeta.retryable && <span className="block text-xs mt-1">Use Find Reviewers to rerun the analysis.</span>}
              </>
            ) : error}
          </div>
        )}
      </Card>

      {/* Progress Section */}
      {(isProcessing || progressMessages.length > 0) && (
        <Card>
          <h3 className="text-lg font-semibold mb-4">Progress</h3>
          <StageProgress stages={stages} />

          <div
            ref={progressRef}
            className="mt-4 bg-gray-50 rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-xs"
          >
            {progressMessages.map((msg, i) => (
              <div key={i} className={`${msg.type === 'fallback' ? 'text-amber-600 bg-amber-50 px-1 rounded' : 'text-gray-600'}`}>
                <span className="text-gray-400">[{msg.time}]</span>{' '}
                {msg.type === 'fallback' && <span className="font-medium">⚠️ </span>}
                {msg.message}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Results Section */}
      {discoveryResult && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">
              Results ({allCandidates.length} candidates)
            </h3>
            <div className="text-sm text-gray-500">
              {verifiedCount} verified • {discoveredCount} discovered
            </div>
          </div>

          {analysisResult?.proposalInfo && (
            <div className="mb-4 p-3 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-700">
                <strong>Proposal:</strong> {analysisResult.proposalInfo.title || 'Untitled'}
              </p>
              {analysisResult.proposalInfo.primaryResearchArea && (
                <p className="text-sm text-gray-500">
                  {analysisResult.proposalInfo.primaryResearchArea}
                </p>
              )}
            </div>
          )}

          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm text-gray-500">
              {selectedCandidates.size} selected
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedCandidates(new Set(allCandidates.filter(isSelectable).map(c => c.name)))}
              >
                Select All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedCandidates(new Set())}
              >
                Clear
              </Button>
            </div>
          </div>

          {/* Claude Suggestions Section */}
          {verifiedCount > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs">
                  Claude Suggestions
                </span>
                <span className="text-gray-400">({verifiedCount} verified)</span>
              </h4>
              <div className="space-y-3">
                {allCandidates
                  .filter(c => (c.isClaudeSuggestion || c.source === 'claude_suggestion') && isSelectable(c))
                  .map((candidate, i) => (
                    <CandidateCard
                      key={candidate.name + i}
                      candidate={candidate}
                      selected={selectedCandidates.has(candidate.name)}
                      onSelect={toggleCandidate}
                    />
                  ))}
              </div>
            </div>
          )}

          {/* Discovered Section */}
          {discoveredCount > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">
                  Database Discoveries
                </span>
                <span className="text-gray-400">({discoveredCount} found)</span>
              </h4>
              <div className="space-y-3">
                {allCandidates
                  .filter(c => !c.isClaudeSuggestion && c.source !== 'claude_suggestion' && isSelectable(c))
                  .map((candidate, i) => (
                    <CandidateCard
                      key={candidate.name + i}
                      candidate={candidate}
                      selected={selectedCandidates.has(candidate.name)}
                      onSelect={toggleCandidate}
                    />
                  ))}
              </div>
            </div>
          )}

          {/* Needs-identity-review Section (Slice E): identity-unresolved rows are shown
              for context but are read-only — not selectable/savable as vetted reviewers. */}
          {allCandidates.some(c => !isSelectable(c)) && (
            <div className="mt-6">
              <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs">
                  Needs identity review
                </span>
                <span className="text-gray-400">
                  ({allCandidates.filter(c => !isSelectable(c)).length} — identity unconfirmed, not selectable)
                </span>
              </h4>
              <div className="space-y-3">
                {allCandidates
                  .filter(c => !isSelectable(c))
                  .map((candidate, i) => (
                    <CandidateCard
                      key={candidate.name + i}
                      candidate={candidate}
                      selected={false}
                      readOnly
                    />
                  ))}
              </div>
            </div>
          )}

          {/* Actions */}
          {selectedCandidates.size > 0 && (
            <div className="mt-6 pt-4 border-t border-gray-200">
              {saveMessage && (
                <div className={`mb-3 p-2 rounded text-sm ${
                  saveMessage.type === 'success'
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : saveMessage.type === 'warning'
                      ? 'bg-amber-50 text-amber-700 border border-amber-200'
                      : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {saveMessage.type === 'success' ? '✓ ' : saveMessage.type === 'warning' ? '⚠ ' : '✗ '}
                  {saveMessage.text}
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="primary"
                  onClick={() => setShowEnrichmentModal(true)}
                  disabled={isEnriching}
                >
                  📧 Find Contacts & Save ({selectedCandidates.size})
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={exportAsMarkdown}>
                    Export Markdown
                  </Button>
                  <Button variant="outline" onClick={exportAsCSV}>
                    Export CSV
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Unverified Section */}
      {discoveryResult?.unverified?.length > 0 && (
        <Card className="bg-gray-50">
          <details>
            <summary className="cursor-pointer text-sm font-medium text-gray-600">
              Unverified Suggestions ({discoveryResult.unverified.length})
            </summary>
            <div className="mt-3 space-y-2">
              {discoveryResult.unverified.map((candidate, i) => (
                <div key={i} className="text-sm text-gray-500">
                  <span className="font-medium">{candidate.name}</span>
                  <span className="ml-2 text-gray-400">— {candidate.reason}</span>
                </div>
              ))}
            </div>
          </details>
        </Card>
      )}

      {/* Contact Enrichment Modal */}
      {showEnrichmentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">
                  📧 Find Contacts & Save
                </h3>
                <button
                  onClick={() => setShowEnrichmentModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {/* Pre-enrichment: Options */}
              {!isEnriching && !enrichmentResults && (
                <div className="space-y-6">
                  <p className="text-sm text-gray-600">
                    Find email addresses and websites for {selectedCandidates.size} selected candidate(s)
                    using our tiered lookup system.
                  </p>

                  {/* Tier options */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium text-gray-700">Search Methods:</h4>

                    <label className="flex items-start gap-3 p-3 bg-green-50 border border-green-200 rounded-lg cursor-pointer">
                      <input
                        type="checkbox"
                        checked={enrichmentOptions.usePubmed}
                        onChange={(e) => setEnrichmentOptions(prev => ({ ...prev, usePubmed: e.target.checked }))}
                        className="mt-0.5"
                      />
                      <div>
                        <div className="font-medium text-green-800">Tier 1: PubMed</div>
                        <div className="text-xs text-green-600">
                          Extract emails from recent publication affiliations. <strong>Free</strong>
                        </div>
                      </div>
                    </label>

                    <label className={`flex items-start gap-3 p-3 rounded-lg ${
                      apiCapabilities?.orcid
                        ? 'bg-green-50 border border-green-200 cursor-pointer'
                        : 'bg-gray-50 border border-gray-200 cursor-not-allowed opacity-60'
                    }`}>
                      <input
                        type="checkbox"
                        checked={enrichmentOptions.useOrcid && apiCapabilities?.orcid}
                        onChange={(e) => setEnrichmentOptions(prev => ({ ...prev, useOrcid: e.target.checked }))}
                        className="mt-0.5"
                        disabled={!apiCapabilities?.orcid}
                      />
                      <div>
                        <div className={`font-medium ${apiCapabilities?.orcid ? 'text-green-800' : 'text-gray-500'}`}>
                          Tier 2: ORCID
                        </div>
                        <div className={`text-xs ${apiCapabilities?.orcid ? 'text-green-600' : 'text-gray-500'}`}>
                          Look up email, website, and ORCID ID. <strong>Free</strong>
                          {!apiCapabilities?.orcid && (
                            <span className="ml-1 text-amber-600">(ORCID not configured on server)</span>
                          )}
                        </div>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={enrichmentOptions.useClaudeSearch}
                        onChange={(e) => setEnrichmentOptions(prev => ({ ...prev, useClaudeSearch: e.target.checked }))}
                        className="mt-0.5"
                      />
                      <div>
                        <div className="font-medium text-amber-800">
                          Tier 3: Claude Web Search
                        </div>
                        <div className="text-xs text-amber-600">
                          Search faculty pages and directories with AI. <strong>~$0.015 per candidate</strong>
                        </div>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={enrichmentOptions.useSerpSearch}
                        onChange={(e) => setEnrichmentOptions(prev => ({ ...prev, useSerpSearch: e.target.checked }))}
                        className="mt-0.5"
                      />
                      <div>
                        <div className="font-medium text-blue-800">
                          Tier 4: Google Search (SerpAPI)
                        </div>
                        <div className="text-xs text-blue-600">
                          Search Google for faculty pages and emails. <strong>~$0.005 per candidate</strong>
                          {!apiCapabilities?.serp && (
                            <span className="ml-1 text-amber-600">(SerpAPI not configured on server)</span>
                          )}
                          <div className="mt-1 text-blue-500">
                            Only runs if Tiers 1-3 don't find contact info.
                          </div>
                        </div>
                      </div>
                    </label>
                  </div>

                  {/* Cost estimate */}
                  {(enrichmentOptions.useClaudeSearch || enrichmentOptions.useSerpSearch) && (
                    <div className="p-4 bg-gray-100 rounded-lg">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">Estimated cost (worst case):</span>
                        <span className="font-medium text-gray-900">
                          ${(() => {
                            let cost = 0;
                            if (enrichmentOptions.useClaudeSearch) {
                              cost += selectedCandidates.size * 0.015;
                            }
                            if (enrichmentOptions.useSerpSearch) {
                              // If Claude search is enabled, only ~10% might need Tier 4
                              const multiplier = enrichmentOptions.useClaudeSearch ? 0.1 : 0.5;
                              cost += selectedCandidates.size * multiplier * 0.005;
                            }
                            return cost.toFixed(2);
                          })()}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Paid tiers only run if free tiers don't find contact info. Actual cost is usually lower.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* During enrichment: Progress */}
              {isEnriching && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="animate-spin text-2xl">⏳</div>
                    <div>
                      <div className="font-medium text-gray-900">
                        {enrichmentProgress?.overall?.candidate || 'Starting enrichment...'}
                      </div>
                      <div className="text-sm text-gray-500">
                        Candidate {enrichmentProgress?.overall?.current || 1} of {enrichmentProgress?.overall?.total || selectedCandidates.size}
                      </div>
                    </div>
                  </div>

                  {/* Current tier status */}
                  <div className="space-y-2">
                    <div className={`flex items-center gap-2 text-sm p-2 rounded ${
                      enrichmentProgress?.tier?.tier === 1 ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'
                    }`}>
                      <span>{enrichmentProgress?.tier?.tier === 1 ? '🔄' : '⬜'}</span>
                      <span className="font-medium">Tier 1: PubMed</span>
                      {enrichmentProgress?.tier?.tier === 1 && (
                        <span className="ml-auto text-xs">{enrichmentProgress.tier.message}</span>
                      )}
                    </div>
                    <div className={`flex items-center gap-2 text-sm p-2 rounded ${
                      enrichmentProgress?.tier?.tier === 2 ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'
                    }`}>
                      <span>{enrichmentProgress?.tier?.tier === 2 ? '🔄' : '⬜'}</span>
                      <span className="font-medium">Tier 2: ORCID</span>
                      {enrichmentProgress?.tier?.tier === 2 && (
                        <span className="ml-auto text-xs">{enrichmentProgress.tier.message}</span>
                      )}
                    </div>
                    {enrichmentOptions.useClaudeSearch && (
                      <div className={`flex items-center gap-2 text-sm p-2 rounded ${
                        enrichmentProgress?.tier?.tier === 3 ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-500'
                      }`}>
                        <span>{enrichmentProgress?.tier?.tier === 3 ? '🔄' : '⬜'}</span>
                        <span className="font-medium">Tier 3: Web Search</span>
                        {enrichmentProgress?.tier?.tier === 3 && (
                          <span className="ml-auto text-xs">{enrichmentProgress.tier.message}</span>
                        )}
                      </div>
                    )}
                    {enrichmentOptions.useSerpSearch && (
                      <div className={`flex items-center gap-2 text-sm p-2 rounded ${
                        enrichmentProgress?.tier?.tier === 4 ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-500'
                      }`}>
                        <span>{enrichmentProgress?.tier?.tier === 4 ? '🔄' : '⬜'}</span>
                        <span className="font-medium">Tier 4: Google Search</span>
                        {enrichmentProgress?.tier?.tier === 4 && (
                          <span className="ml-auto text-xs">{enrichmentProgress.tier.message}</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{
                        width: `${((enrichmentProgress?.overall?.current || 0) / (enrichmentProgress?.overall?.total || selectedCandidates.size)) * 100}%`
                      }}
                    />
                  </div>

                  <p className="text-xs text-gray-400 text-center">
                    Looking up contact information for each candidate...
                  </p>
                </div>
              )}

              {/* After enrichment: Results */}
              {enrichmentResults && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 text-green-600">
                    <span className="text-2xl">✓</span>
                    <span className="font-medium">Enrichment Complete</span>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-3 bg-gray-50 rounded-lg">
                      <div className="text-2xl font-bold text-gray-900">{enrichmentResults.stats?.withEmail || 0}</div>
                      <div className="text-xs text-gray-500">Emails Found</div>
                    </div>
                    <div className="text-center p-3 bg-gray-50 rounded-lg">
                      <div className="text-2xl font-bold text-gray-900">{enrichmentResults.stats?.withWebsite || 0}</div>
                      <div className="text-xs text-gray-500">Websites Found</div>
                    </div>
                    <div className="text-center p-3 bg-gray-50 rounded-lg">
                      <div className="text-2xl font-bold text-gray-900">{enrichmentResults.stats?.withOrcid || 0}</div>
                      <div className="text-xs text-gray-500">ORCID IDs</div>
                    </div>
                  </div>

                  {/* Results list */}
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {enrichmentResults.results?.map((result, i) => (
                      <div key={i} className="flex items-center justify-between p-2 bg-gray-50 rounded text-sm">
                        <span className="font-medium truncate">{result.name}</span>
                        <div className="flex items-center gap-2 text-xs">
                          {result.contactEnrichment?.email && (
                            <a href={`mailto:${result.contactEnrichment.email}`} className="text-blue-600 hover:underline">
                              📧 {result.contactEnrichment.email}
                            </a>
                          )}
                          {result.contactEnrichment?.website && (
                            <a href={result.contactEnrichment.website} target="_blank" rel="noopener noreferrer" className="text-blue-600">
                              🔗
                            </a>
                          )}
                          {result.contactEnrichment?.orcidUrl && (
                            <a href={result.contactEnrichment.orcidUrl} target="_blank" rel="noopener noreferrer" className="text-green-600">
                              ORCID
                            </a>
                          )}
                          {!result.contactEnrichment?.email && !result.contactEnrichment?.website && (
                            <span className="text-gray-400">No contact found</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {enrichmentResults.stats?.actualCost > 0 && (
                    <div className="text-sm text-gray-500 text-center">
                      Actual cost: ${enrichmentResults.stats.actualCost.toFixed(2)}
                    </div>
                  )}
                </div>
              )}

              {/* Error state */}
              {enrichmentProgress?.type === 'error' && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                  <div className="font-medium">Error</div>
                  <div className="text-sm">{enrichmentProgress.message}</div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              {!isEnriching && !enrichmentResults && (
                <>
                  <Button variant="outline" onClick={() => setShowEnrichmentModal(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={handleEnrichContacts}>
                    Start Enrichment
                  </Button>
                </>
              )}
              {enrichmentResults && (
                <Button variant="primary" onClick={async () => {
                  // Apply enrichment results to candidates display
                  applyEnrichmentResults(enrichmentResults);

                  // Save to My Candidates with enrichment data
                  await handleSaveCandidates(enrichmentResults);

                  setShowEnrichmentModal(false);
                  setEnrichmentResults(null);
                  setEnrichmentProgress(null);
                }}>
                  Save to My Candidates
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Edit Candidate Modal
function EditCandidateModal({ isOpen, candidate, onClose, onSave }) {
  const [formData, setFormData] = useState({
    name: '',
    affiliation: '',
    email: '',
    website: '',
    hIndex: ''
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  // Reset form when candidate changes
  useEffect(() => {
    if (candidate) {
      setFormData({
        name: candidate.name || '',
        affiliation: candidate.affiliation || '',
        email: candidate.email || '',
        website: candidate.website || '',
        hIndex: candidate.hIndex || ''
      });
      setError(null);
    }
  }, [candidate]);

  if (!isOpen || !candidate) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      // Build update payload with only changed fields
      const updates = {};
      if (formData.name !== candidate.name) updates.name = formData.name;
      if (formData.affiliation !== candidate.affiliation) updates.affiliation = formData.affiliation;
      if (formData.email !== (candidate.email || '')) updates.email = formData.email;
      if (formData.website !== (candidate.website || '')) updates.website = formData.website;
      if (formData.hIndex !== (candidate.hIndex || '')) {
        updates.hIndex = formData.hIndex ? parseInt(formData.hIndex, 10) : null;
      }

      if (Object.keys(updates).length === 0) {
        onClose();
        return;
      }

      const response = await fetch('/api/reviewer-finder/my-candidates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suggestionId: candidate.suggestionId,
          ...updates
        })
      });

      if (!response.ok) {
        const data = await response.json();
        // Prefer the human-readable `message` (set for translated errors like
        // duplicate-key 409s); fall back to the machine code or generic.
        throw new Error(data.message || data.error || 'Failed to update candidate');
      }

      // Call parent callback with updated data
      await onSave(candidate.suggestionId, updates);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-gray-900">Edit Candidate</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Affiliation</label>
            <input
              type="text"
              value={formData.affiliation}
              onChange={(e) => setFormData({ ...formData, affiliation: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="researcher@university.edu"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
            <input
              type="url"
              value={formData.website}
              onChange={(e) => setFormData({ ...formData, website: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="https://..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">h-index</label>
            <input
              type="number"
              value={formData.hIndex}
              onChange={(e) => setFormData({ ...formData, hIndex: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              min="0"
              placeholder="e.g., 25"
            />
          </div>

          <p className="text-xs text-gray-500">
            Changes apply to all proposals containing this researcher.
          </p>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Helper to format date for display
function formatShortDate(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Saved Candidate Card (simpler than search results)
function SavedCandidateCard({ candidate, onUpdate, onRemove, onEdit, isSelectedForDeletion, onToggleSelection }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [notes, setNotes] = useState(candidate.notes || '');
  const [isSavingNotes, setIsSavingNotes] = useState(false);

  const handleToggleInvited = async () => {
    const newInvited = !candidate.invited;
    // If marking as invited, set email_sent_at to now; if unmarking, clear it
    await onUpdate(candidate.suggestionId, {
      invited: newInvited,
      emailSentAt: newInvited ? 'now' : null
    });
  };

  const handleToggleAccepted = async () => {
    const newAccepted = !candidate.accepted;
    await onUpdate(candidate.suggestionId, {
      accepted: newAccepted,
      declined: false,
      responseType: newAccepted ? 'accepted' : null,
      responseReceivedAt: newAccepted ? 'now' : null
    });
  };

  const handleToggleDeclined = async () => {
    const newDeclined = !candidate.declined;
    await onUpdate(candidate.suggestionId, {
      declined: newDeclined,
      accepted: false,
      responseType: newDeclined ? 'declined' : null,
      responseReceivedAt: newDeclined ? 'now' : null
    });
  };

  const handleMarkBounced = async () => {
    await onUpdate(candidate.suggestionId, {
      responseType: 'bounced',
      responseReceivedAt: 'now'
    });
  };

  const handleMarkNoResponse = async () => {
    await onUpdate(candidate.suggestionId, {
      responseType: 'no_response',
      responseReceivedAt: 'now'
    });
  };

  // Mark as sent (for retroactive tracking of older candidates)
  const handleMarkAsSent = async () => {
    await onUpdate(candidate.suggestionId, {
      invited: true,
      emailSentAt: 'now'
    });
  };

  const handleSaveNotes = async () => {
    setIsSavingNotes(true);
    await onUpdate(candidate.suggestionId, { notes });
    setIsSavingNotes(false);
  };

  const hasCoauthorCOI = candidate.reasoning?.includes('[COI WARNING');
  const hasInstitutionCOI = candidate.reasoning?.includes('Institution COI') || candidate.hasInstitutionCOI;
  const hasAnyCOI = hasCoauthorCOI || hasInstitutionCOI;

  // Use email from database, or extract from affiliation as fallback
  const displayEmail = candidate.email || extractEmailFromAffiliation(candidate.affiliation);

  return (
    <div className={`border rounded-lg p-4 ${
      isSelectedForDeletion ? 'border-red-400 bg-red-50' :
      hasAnyCOI ? 'border-red-200 bg-red-50' : 'border-gray-200'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <input
          type="checkbox"
          checked={isSelectedForDeletion}
          onChange={onToggleSelection}
          className="mt-1 h-4 w-4 text-red-600 rounded border-gray-300 flex-shrink-0"
          title="Select for deletion"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-gray-900">{candidate.name}</h4>
            {candidate.hIndex && (
              <span className="text-xs text-gray-500">h-index: {candidate.hIndex}</span>
            )}
          </div>
          {candidate.affiliation && (
            <p className="text-sm text-gray-500 truncate">{candidate.affiliation}</p>
          )}
          {(displayEmail || candidate.website) && (
            <div className="flex items-center gap-3 mt-1">
              {displayEmail && (
                <a
                  href={`mailto:${displayEmail}`}
                  className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                  title={displayEmail}
                >
                  ✉️ {displayEmail}
                </a>
              )}
              {candidate.website && (
                <a
                  href={candidate.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                  title={candidate.website}
                >
                  🔗 Website
                </a>
              )}
            </div>
          )}
          {hasAnyCOI && (
            <p className="text-xs text-red-600 mt-1">
              {hasInstitutionCOI && '🏛️ Institution COI'}
              {hasInstitutionCOI && hasCoauthorCOI && ' • '}
              {hasCoauthorCOI && '🚨 Coauthor COI'}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Status buttons */}
          <button
            onClick={handleToggleInvited}
            className={`px-2 py-1 text-xs rounded ${
              candidate.invited
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
            title={candidate.emailSentAt ? `Sent: ${formatShortDate(candidate.emailSentAt)}` : 'Mark as invited'}
          >
            {candidate.invited ? '✓ Invited' : 'Invited'}
          </button>
          <button
            onClick={handleToggleAccepted}
            className={`px-2 py-1 text-xs rounded ${
              candidate.accepted
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {candidate.accepted ? '✓ Accepted' : 'Accepted'}
          </button>
          <button
            onClick={handleToggleDeclined}
            className={`px-2 py-1 text-xs rounded ${
              candidate.declined
                ? 'bg-red-100 text-red-700'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {candidate.declined ? '✓ Declined' : 'Declined'}
          </button>
          {/* Bounced indicator - only show if email was sent */}
          {candidate.emailSentAt && candidate.responseType === 'bounced' && (
            <span className="px-2 py-1 text-xs rounded bg-orange-100 text-orange-700">
              ⚠ Bounced
            </span>
          )}
          {/* No Response indicator - only show if email was sent */}
          {candidate.emailSentAt && candidate.responseType === 'no_response' && (
            <span className="px-2 py-1 text-xs rounded bg-gray-200 text-gray-600">
              — No Response
            </span>
          )}
          {/* Mark as Sent button - show for candidates without emailSentAt who aren't declined/accepted */}
          {!candidate.emailSentAt && !candidate.accepted && !candidate.declined && (
            <button
              onClick={handleMarkAsSent}
              className="px-2 py-1 text-xs rounded bg-blue-50 text-blue-600 hover:bg-blue-100"
              title="Mark email as sent (for retroactive tracking)"
            >
              📧 Mark Sent
            </button>
          )}
          {/* Edit and Remove buttons */}
          <button
            onClick={() => onEdit(candidate)}
            className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-500 hover:bg-blue-100 hover:text-blue-600"
            title="Edit candidate info"
          >
            ✏️
          </button>
          <button
            onClick={() => onRemove(candidate.suggestionId)}
            className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-500 hover:bg-red-100 hover:text-red-600"
            title="Remove from list"
          >
            ✕
          </button>
          {/* Email sent timestamp - show below buttons */}
          {candidate.emailSentAt && (
            <span className="text-xs text-gray-400 ml-auto" title={new Date(candidate.emailSentAt).toLocaleString()}>
              📧 {formatShortDate(candidate.emailSentAt)}
            </span>
          )}
        </div>
      </div>

      {/* Action buttons: Show details + Scholar lookup */}
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs text-blue-600 hover:text-blue-800"
        >
          {isExpanded ? 'Hide details' : 'Show details'}
        </button>
        <a
          href={buildScholarSearchUrl(candidate.name, candidate.affiliation)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1"
          title="Search Google Scholar for this researcher's profile, h-index, and citations"
        >
          🎓 Scholar Profile
        </a>
      </div>

      {isExpanded && (
        <div className="mt-3 space-y-3">
          {candidate.reasoning && (
            <div>
              <p className="text-xs font-medium text-gray-600">Why this reviewer:</p>
              <p className="text-sm text-gray-700">{candidate.reasoning}</p>
            </div>
          )}

          {displayEmail && (
            <p className="text-xs text-gray-500">
              <span className="font-medium">Email:</span>{' '}
              <a href={`mailto:${displayEmail}`} className="text-blue-600">{displayEmail}</a>
              {!candidate.email && <span className="text-gray-400 ml-1">(from affiliation)</span>}
            </p>
          )}

          {candidate.website && (
            <p className="text-xs text-gray-500">
              <span className="font-medium">Website:</span>{' '}
              <a href={candidate.website} target="_blank" rel="noopener noreferrer" className="text-blue-600">
                {candidate.website}
              </a>
            </p>
          )}

          <div>
            <label className="text-xs font-medium text-gray-600">Notes:</label>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes..."
                className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
              />
              <button
                onClick={handleSaveNotes}
                disabled={isSavingNotes || notes === candidate.notes}
                className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
              >
                {isSavingNotes ? '...' : 'Save'}
              </button>
            </div>
          </div>

          {/* Email tracking details */}
          {candidate.emailSentAt && (() => {
            const sentDate = new Date(candidate.emailSentAt);
            const daysSinceSent = Math.floor((new Date() - sentDate) / (1000 * 60 * 60 * 24));
            const isPending = !candidate.responseType && !candidate.accepted && !candidate.declined;
            return (
              <div className="flex items-center gap-2 text-xs flex-wrap">
                <span className="text-gray-500">
                  Email sent: {sentDate.toLocaleDateString()}
                </span>
                {isPending && daysSinceSent > 0 && (
                  <span className={`px-1.5 py-0.5 rounded ${
                    daysSinceSent > 14 ? 'bg-red-100 text-red-700' :
                    daysSinceSent > 7 ? 'bg-yellow-100 text-yellow-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {daysSinceSent} day{daysSinceSent !== 1 ? 's' : ''} ago
                  </span>
                )}
                {candidate.responseType && candidate.responseType !== 'bounced' && (
                  <span className="text-gray-500">
                    | Response: {candidate.responseType}
                    {candidate.responseReceivedAt && ` (${formatShortDate(candidate.responseReceivedAt)})`}
                  </span>
                )}
                {candidate.responseType !== 'bounced' && candidate.responseType !== 'no_response' && isPending && (
                  <>
                    <button
                      onClick={handleMarkBounced}
                      className="px-2 py-0.5 text-xs rounded bg-orange-50 text-orange-600 hover:bg-orange-100"
                      title="Mark email as bounced"
                    >
                      Mark Bounced
                    </button>
                    <button
                      onClick={handleMarkNoResponse}
                      className="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-600 hover:bg-gray-200"
                      title="Mark as no response received (close out)"
                    >
                      No Response
                    </button>
                  </>
                )}
              </div>
            );
          })()}

          <p className="text-xs text-gray-400">
            Saved: {new Date(candidate.savedAt).toLocaleDateString()}
          </p>
        </div>
      )}
    </div>
  );
}

// Storage key for current cycle
const CURRENT_CYCLE_KEY = 'reviewer_finder_current_cycle';

// Inline-editable PI name and institution for a proposal
function ProposalMetadataRow({ proposal }) {
  // PI comes from akoya_request.wmkf_projectleader, institution from the
  // applicant account's AKA — both are managed in CRM and render read-only
  // here. (Previously this row had inline-edit affordances that always
  // failed silently: the PATCH on /api/reviewer-finder/my-candidates
  // rejects proposalAuthors/proposalInstitution by design.)
  const hasPi = !!proposal.proposalAuthors;
  const hasInst = !!proposal.proposalInstitution;
  return (
    <p className="text-sm text-gray-600 flex items-center flex-wrap gap-x-1">
      {proposal.requestNumber && (
        <>
          <span className="font-mono text-xs text-gray-500">#{proposal.requestNumber}</span>
          <span className="text-gray-300">&middot;</span>
        </>
      )}
      {hasPi && <span>PI: {proposal.proposalAuthors}</span>}
      {hasPi && hasInst && <span className="text-gray-300">·</span>}
      {hasInst && <span>{proposal.proposalInstitution}</span>}
    </p>
  );
}

// My Candidates Tab
function MyCandidatesTab({ refreshTrigger, userProfileId }) {
  const [proposals, setProposals] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedForDeletion, setSelectedForDeletion] = useState(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailModalData, setEmailModalData] = useState({ candidates: [], proposalInfo: {} });
  const [editingCandidate, setEditingCandidate] = useState(null);

  // Grant cycles state
  const [cycles, setCycles] = useState([]);
  const [selectedCycleId, setSelectedCycleId] = useState('all'); // Always default to 'all' to show everything
  const [expandedProposals, setExpandedProposals] = useState(new Set());
  const [unassignedCount, setUnassignedCount] = useState({ proposals: 0, candidates: 0 });

  // Additional filters
  const [institutionFilter, setInstitutionFilter] = useState('all');
  const [piFilter, setPiFilter] = useState('all');
  const [programFilter, setProgramFilter] = useState('all');
  const [emailStatusFilter, setEmailStatusFilter] = useState('all'); // 'all', 'not_invited', 'invited', 'pending', 'accepted', 'declined', 'bounced', 'no_response'

  // Fetch grant cycles
  const fetchCycles = async () => {
    try {
      const response = await fetch('/api/reviewer-finder/grant-cycles');
      if (response.ok) {
        const data = await response.json();
        setCycles(data.cycles || []);
        setUnassignedCount({
          proposals: data.unassigned?.proposalCount || 0,
          candidates: data.unassigned?.candidateCount || 0
        });
      }
    } catch (err) {
      console.error('Failed to fetch cycles:', err);
    }
  };

  const fetchCandidates = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setSelectedForDeletion(new Set());
    try {
      // Build URL with cycle and user profile filters
      const params = new URLSearchParams();
      if (selectedCycleId && selectedCycleId !== 'all') {
        // After W3 cutover (preference-shape + endpoint), `selectedCycleId`
        // holds a shortcode like "J26" or the special token "unassigned".
        // The my-candidates API expects `cycleCode` (NOT `cycleId`); the
        // old `cycleId` query param was silently ignored by the API even
        // pre-cutover, so the filter never worked.
        params.set('cycleCode', selectedCycleId);
      }
      if (userProfileId) {
        params.set('userProfileId', userProfileId);
      }
      let url = '/api/reviewer-finder/my-candidates';
      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      const response = await fetch(url);
      const data = await response.json();
      if (data.success) {
        setProposals(data.proposals);
      } else {
        setError(data.error || 'Failed to fetch candidates');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [selectedCycleId, userProfileId]);

  useEffect(() => {
    fetchCycles();
  }, []);

  // fetchCandidates is memoized on [selectedCycleId, userProfileId], so listing
  // it covers those inputs; refreshTrigger stays as the manual re-fetch signal.
  useEffect(() => {
    fetchCandidates();
  }, [refreshTrigger, fetchCandidates]);

  // Handle cycle filter change
  const handleCycleChange = (value) => {
    setSelectedCycleId(value);
    setExpandedProposals(new Set()); // Collapse all when switching cycles
  };

  // Toggle proposal expanded state
  const toggleProposalExpanded = (proposalId) => {
    setExpandedProposals(prev => {
      const next = new Set(prev);
      if (next.has(proposalId)) {
        next.delete(proposalId);
      } else {
        next.add(proposalId);
      }
      return next;
    });
  };

  // Expand all proposals
  const expandAll = () => {
    setExpandedProposals(new Set(proposals.map(p => p.proposalId)));
  };

  // Collapse all proposals
  const collapseAll = () => {
    setExpandedProposals(new Set());
  };

  const handleUpdateCandidate = async (suggestionId, updates) => {
    try {
      await fetch('/api/reviewer-finder/my-candidates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId, ...updates })
      });
      // Refresh to get updated data
      fetchCandidates();
    } catch (err) {
      console.error('Update failed:', err);
    }
  };

  const handleRemoveCandidate = async (suggestionId) => {
    if (!confirm('Remove this candidate from your list?')) return;
    try {
      const resp = await fetch('/api/reviewer-finder/my-candidates', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId })
      });
      // The DELETE now also revokes any magic link server-side, so a non-ok
      // here can mean the removal genuinely didn't happen — don't refresh as if
      // it succeeded (Codex S213). fetch() doesn't throw on 4xx/5xx.
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        alert(`Could not remove candidate: ${data.error || data.message || data.details || resp.status}`);
        return;
      }
      fetchCandidates();
    } catch (err) {
      console.error('Remove failed:', err);
      alert(`Network error removing candidate: ${err.message}`);
    }
  };

  const handleUpdateProposalProgram = async (proposalId, programArea) => {
    try {
      await fetch('/api/reviewer-finder/my-candidates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId, programArea })
      });
      fetchCandidates();
    } catch (err) {
      console.error('Update program area failed:', err);
    }
  };

  const handleUpdateProposalCycle = async (proposalId, grantCycleCode) => {
    try {
      // my-candidates PATCH expects `grantCycleCode` (shortcode string).
      // Pre-W3 the frontend sent `grantCycleId` (integer); the API
      // discarded it silently. Fixed at W3 cutover.
      await fetch('/api/reviewer-finder/my-candidates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId, grantCycleCode })
      });
      fetchCandidates();
    } catch (err) {
      console.error('Update grant cycle failed:', err);
    }
  };

  const handleToggleSelection = (suggestionId) => {
    setSelectedForDeletion(prev => {
      const next = new Set(prev);
      if (next.has(suggestionId)) {
        next.delete(suggestionId);
      } else {
        next.add(suggestionId);
      }
      return next;
    });
  };

  const handleSelectAllInProposal = (proposal) => {
    const allIds = proposal.candidates.map(c => c.suggestionId);
    const allSelected = allIds.every(id => selectedForDeletion.has(id));

    setSelectedForDeletion(prev => {
      const next = new Set(prev);
      if (allSelected) {
        allIds.forEach(id => next.delete(id));
      } else {
        allIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    if (selectedForDeletion.size === 0) return;
    if (!confirm(`Remove ${selectedForDeletion.size} candidate(s) from your list?`)) return;

    setIsDeleting(true);
    try {
      // Delete all selected candidates. Each DELETE now also revokes any magic
      // link server-side, so a non-ok response can mean a removal didn't happen
      // — count failures and tell the user rather than refreshing as if all
      // succeeded (Codex S213). fetch() doesn't throw on 4xx/5xx.
      const results = await Promise.all(
        Array.from(selectedForDeletion).map(suggestionId =>
          fetch('/api/reviewer-finder/my-candidates', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ suggestionId })
          }).then(r => r.ok).catch(() => false)
        )
      );
      const failed = results.filter(ok => !ok).length;
      if (failed > 0) {
        alert(`${failed} of ${results.length} candidate(s) could not be removed. The list shows the current state.`);
      }
      fetchCandidates();
    } catch (err) {
      console.error('Bulk delete failed:', err);
      alert(`Network error during bulk remove: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // Get selected candidate objects with their proposal info for email generation
  const getSelectedCandidatesWithProposalInfo = () => {
    const selectedCandidates = [];
    let proposalInfo = {};

    for (const proposal of proposals) {
      const candidatesFromProposal = proposal.candidates.filter(c =>
        selectedForDeletion.has(c.suggestionId)
      );

      if (candidatesFromProposal.length > 0) {
        // Use first proposal's info if we have multiple
        if (!proposalInfo.title) {
          proposalInfo = {
            title: proposal.proposalTitle,
            abstract: proposal.proposalAbstract || '',
            authors: proposal.proposalAuthors || '',
            institution: proposal.proposalInstitution || '',
            summaryBlobUrl: proposal.summaryBlobUrl || ''
          };
        }

        selectedCandidates.push(...candidatesFromProposal.map(c => ({
          suggestionId: c.suggestionId,
          name: c.name,
          email: c.email || extractEmailFromAffiliation(c.affiliation),
          affiliation: c.affiliation,
          expertise: c.expertiseAreas || [],
          reasoning: c.reasoning
        })));
      }
    }

    return { selectedCandidates, proposalInfo };
  };

  // Open email modal with selected candidates
  const handleOpenEmailModal = (isFollowUp = false) => {
    const { selectedCandidates, proposalInfo } = getSelectedCandidatesWithProposalInfo();
    if (selectedCandidates.length === 0) return;

    setEmailModalData({
      candidates: selectedCandidates,
      proposalInfo,
      isFollowUp
    });
    setShowEmailModal(true);
  };

  // Select all pending (awaiting response) candidates
  const selectAllPending = () => {
    const pendingIds = new Set();
    filteredProposals.forEach(p => {
      p.candidates.forEach(c => {
        if (c.emailSentAt && !c.responseType && !c.accepted && !c.declined) {
          pendingIds.add(c.suggestionId);
        }
      });
    });
    setSelectedForDeletion(pendingIds);
  };

  if (isLoading) {
    return (
      <Card className="text-center py-12">
        <div className="animate-spin text-4xl mb-4">⏳</div>
        <p className="text-gray-500">Loading saved candidates...</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="text-center py-12">
        <div className="text-4xl mb-4">⚠️</div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">Error</h3>
        <p className="text-red-600">{error}</p>
        <Button onClick={fetchCandidates} className="mt-4">Retry</Button>
      </Card>
    );
  }

  if (proposals.length === 0) {
    return (
      <Card className="text-center py-12">
        <div className="text-6xl mb-4">📋</div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">No Saved Candidates</h3>
        <p className="text-gray-500 max-w-md mx-auto">
          Run a search and save candidates to build your reviewer list.
          They'll appear here organized by proposal.
        </p>
      </Card>
    );
  }

  // Extract unique values for filter dropdowns
  const uniqueInstitutions = [...new Set(
    proposals
      .map(p => p.proposalInstitution)
      .filter(Boolean)
  )].sort();

  const uniquePIs = [...new Set(
    proposals
      .map(p => p.proposalAuthors)
      .filter(Boolean)
  )].sort();

  const uniquePrograms = [...new Set(
    proposals
      .map(p => p.programArea)
      .filter(Boolean)
  )].sort();

  // Helper: check if candidate matches email status filter
  const candidateMatchesEmailFilter = (c) => {
    if (emailStatusFilter === 'all') return true;
    if (emailStatusFilter === 'not_invited') return !c.invited && !c.emailSentAt;
    if (emailStatusFilter === 'invited') return c.invited || c.emailSentAt;
    if (emailStatusFilter === 'pending') return c.emailSentAt && !c.responseType && !c.accepted && !c.declined;
    if (emailStatusFilter === 'accepted') return c.accepted || c.responseType === 'accepted';
    if (emailStatusFilter === 'declined') return c.declined || c.responseType === 'declined';
    if (emailStatusFilter === 'bounced') return c.responseType === 'bounced';
    if (emailStatusFilter === 'no_response') return c.responseType === 'no_response';
    return true;
  };

  // Helper: calculate days since a date
  const daysSince = (dateStr) => {
    if (!dateStr) return null;
    const sent = new Date(dateStr);
    const now = new Date();
    const diffTime = now - sent;
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  };

  // Apply filters to proposals (filter candidates within each proposal)
  const filteredProposals = proposals
    .filter(p => {
      if (institutionFilter !== 'all' && p.proposalInstitution !== institutionFilter) {
        return false;
      }
      if (piFilter !== 'all' && p.proposalAuthors !== piFilter) {
        return false;
      }
      if (programFilter !== 'all' && p.programArea !== programFilter) {
        return false;
      }
      return true;
    })
    .map(p => ({
      ...p,
      candidates: p.candidates.filter(candidateMatchesEmailFilter)
    }))
    .filter(p => p.candidates.length > 0 || emailStatusFilter === 'all');

  // Enhanced metrics calculation (use ALL proposals for accurate totals, filtered for display)
  const allCandidates = proposals.flatMap(p => p.candidates);
  const filteredCandidates = filteredProposals.flatMap(p => p.candidates);

  const metrics = {
    total: allCandidates.length,
    filtered: filteredCandidates.length,
    notInvited: allCandidates.filter(c => !c.invited && !c.emailSentAt).length,
    invited: allCandidates.filter(c => c.invited || c.emailSentAt).length,
    pending: allCandidates.filter(c => c.emailSentAt && !c.responseType && !c.accepted && !c.declined).length,
    accepted: allCandidates.filter(c => c.accepted || c.responseType === 'accepted').length,
    declined: allCandidates.filter(c => c.declined || c.responseType === 'declined').length,
    bounced: allCandidates.filter(c => c.responseType === 'bounced').length,
    noResponse: allCandidates.filter(c => c.responseType === 'no_response').length,
  };

  // Response rate (of those invited who have responded)
  const responded = metrics.accepted + metrics.declined;
  const responseRate = metrics.invited > 0 ? ((responded / metrics.invited) * 100).toFixed(0) : 0;
  const acceptanceRate = responded > 0 ? ((metrics.accepted / responded) * 100).toFixed(0) : 0;

  // CSV Export function
  const exportTrackingCSV = () => {
    const rows = [];
    rows.push([
      'Proposal Title', 'PI', 'Institution', 'Program Area',
      'Reviewer Name', 'Email', 'Affiliation', 'H-Index',
      'Invited', 'Email Sent Date', 'Days Since Sent',
      'Response Type', 'Response Date', 'Notes'
    ].join(','));

    proposals.forEach(p => {
      p.candidates.forEach(c => {
        const days = daysSince(c.emailSentAt);
        rows.push([
          `"${(p.proposalTitle || '').replace(/"/g, '""')}"`,
          `"${(p.proposalAuthors || '').replace(/"/g, '""')}"`,
          `"${(p.proposalInstitution || '').replace(/"/g, '""')}"`,
          `"${(p.programArea || '').replace(/"/g, '""')}"`,
          `"${(c.name || '').replace(/"/g, '""')}"`,
          `"${(c.email || '').replace(/"/g, '""')}"`,
          `"${(c.affiliation || '').replace(/"/g, '""')}"`,
          c.hIndex || '',
          c.invited ? 'Yes' : 'No',
          c.emailSentAt ? new Date(c.emailSentAt).toLocaleDateString() : '',
          days !== null ? days : '',
          c.responseType || (c.accepted ? 'accepted' : c.declined ? 'declined' : ''),
          c.responseReceivedAt ? new Date(c.responseReceivedAt).toLocaleDateString() : '',
          `"${(c.notes || '').replace(/"/g, '""')}"`
        ].join(','));
      });
    });

    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // After W3 cutover `selectedCycleId` IS a shortcode (or 'all'/'unassigned').
    const cycleName = selectedCycleId && selectedCycleId !== 'all' ? selectedCycleId : 'all';
    a.download = `email-tracking-${cycleName}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Legacy counts for backward compatibility
  const totalCandidates = metrics.filtered;
  const invitedCount = metrics.invited;
  const acceptedCount = metrics.accepted;
  const declinedCount = metrics.declined;

  return (
    <div className="space-y-6">
      {/* Summary Stats & Dashboard */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">My Saved Candidates</h3>
            <p className="text-sm text-gray-500">
              {totalCandidates} candidate(s) across {filteredProposals.length} proposal(s)
              {(emailStatusFilter !== 'all' || filteredProposals.length !== proposals.length) && (
                <span className="text-gray-400"> (filtered from {metrics.total} total)</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportTrackingCSV}
              className="px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 text-sm"
              title="Export email tracking data to CSV"
            >
              Export CSV
            </button>
            {metrics.pending > 0 && selectedForDeletion.size === 0 && (
              <button
                onClick={selectAllPending}
                className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200 text-sm"
                title="Select all candidates awaiting response for follow-up"
              >
                Select Pending ({metrics.pending})
              </button>
            )}
            {selectedForDeletion.size > 0 && (
              <>
                <button
                  onClick={() => handleOpenEmailModal(false)}
                  className="px-3 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 text-sm"
                >
                  Email Selected ({selectedForDeletion.size})
                </button>
                {/* Show Re-invite button if any selected candidates are pending */}
                {(() => {
                  const selectedPending = [...selectedForDeletion].filter(id => {
                    for (const p of filteredProposals) {
                      const c = p.candidates.find(c => c.suggestionId === id);
                      if (c && c.emailSentAt && !c.responseType && !c.accepted && !c.declined) {
                        return true;
                      }
                    }
                    return false;
                  });
                  return selectedPending.length > 0 ? (
                    <button
                      onClick={() => handleOpenEmailModal(true)}
                      className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200 text-sm"
                      title="Send follow-up emails to non-responders"
                    >
                      Re-invite ({selectedPending.length})
                    </button>
                  ) : null;
                })()}
                <button
                  onClick={handleDeleteSelected}
                  disabled={isDeleting}
                  className="px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50 text-sm"
                >
                  {isDeleting ? 'Deleting...' : `Delete Selected (${selectedForDeletion.size})`}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Response Tracking Dashboard */}
        {metrics.total > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              <button
                onClick={() => setEmailStatusFilter(emailStatusFilter === 'not_invited' ? 'all' : 'not_invited')}
                className={`text-center p-2 rounded-lg transition-colors ${
                  emailStatusFilter === 'not_invited' ? 'bg-gray-200 ring-2 ring-gray-400' : 'bg-gray-50 hover:bg-gray-100'
                }`}
              >
                <div className="text-xl font-bold text-gray-600">{metrics.notInvited}</div>
                <div className="text-xs text-gray-500">Not Invited</div>
              </button>
              <button
                onClick={() => setEmailStatusFilter(emailStatusFilter === 'invited' ? 'all' : 'invited')}
                className={`text-center p-2 rounded-lg transition-colors ${
                  emailStatusFilter === 'invited' ? 'bg-blue-200 ring-2 ring-blue-400' : 'bg-blue-50 hover:bg-blue-100'
                }`}
              >
                <div className="text-xl font-bold text-blue-600">{metrics.invited}</div>
                <div className="text-xs text-blue-500">Invited</div>
              </button>
              <button
                onClick={() => setEmailStatusFilter(emailStatusFilter === 'pending' ? 'all' : 'pending')}
                className={`text-center p-2 rounded-lg transition-colors ${
                  emailStatusFilter === 'pending' ? 'bg-yellow-200 ring-2 ring-yellow-400' : 'bg-yellow-50 hover:bg-yellow-100'
                }`}
              >
                <div className="text-xl font-bold text-yellow-600">{metrics.pending}</div>
                <div className="text-xs text-yellow-600">Awaiting</div>
              </button>
              <button
                onClick={() => setEmailStatusFilter(emailStatusFilter === 'accepted' ? 'all' : 'accepted')}
                className={`text-center p-2 rounded-lg transition-colors ${
                  emailStatusFilter === 'accepted' ? 'bg-green-200 ring-2 ring-green-400' : 'bg-green-50 hover:bg-green-100'
                }`}
              >
                <div className="text-xl font-bold text-green-600">{metrics.accepted}</div>
                <div className="text-xs text-green-500">Accepted</div>
              </button>
              <button
                onClick={() => setEmailStatusFilter(emailStatusFilter === 'declined' ? 'all' : 'declined')}
                className={`text-center p-2 rounded-lg transition-colors ${
                  emailStatusFilter === 'declined' ? 'bg-red-200 ring-2 ring-red-400' : 'bg-red-50 hover:bg-red-100'
                }`}
              >
                <div className="text-xl font-bold text-red-600">{metrics.declined}</div>
                <div className="text-xs text-red-500">Declined</div>
              </button>
              {metrics.bounced > 0 && (
                <button
                  onClick={() => setEmailStatusFilter(emailStatusFilter === 'bounced' ? 'all' : 'bounced')}
                  className={`text-center p-2 rounded-lg transition-colors ${
                    emailStatusFilter === 'bounced' ? 'bg-orange-200 ring-2 ring-orange-400' : 'bg-orange-50 hover:bg-orange-100'
                  }`}
                >
                  <div className="text-xl font-bold text-orange-600">{metrics.bounced}</div>
                  <div className="text-xs text-orange-500">Bounced</div>
                </button>
              )}
              {metrics.noResponse > 0 && (
                <button
                  onClick={() => setEmailStatusFilter(emailStatusFilter === 'no_response' ? 'all' : 'no_response')}
                  className={`text-center p-2 rounded-lg transition-colors ${
                    emailStatusFilter === 'no_response' ? 'bg-gray-300 ring-2 ring-gray-400' : 'bg-gray-100 hover:bg-gray-200'
                  }`}
                >
                  <div className="text-xl font-bold text-gray-600">{metrics.noResponse}</div>
                  <div className="text-xs text-gray-500">No Response</div>
                </button>
              )}
              {metrics.invited > 0 && (
                <div className="text-center p-2 rounded-lg bg-purple-50">
                  <div className="text-xl font-bold text-purple-600">{responseRate}%</div>
                  <div className="text-xs text-purple-500">Response Rate</div>
                  {responded > 0 && (
                    <div className="text-xs text-purple-400 mt-1">{acceptanceRate}% accepted</div>
                  )}
                </div>
              )}
            </div>
            {emailStatusFilter !== 'all' && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-sm text-gray-500">
                  Showing: <span className="font-medium">{emailStatusFilter.replace('_', ' ')}</span>
                </span>
                <button
                  onClick={() => setEmailStatusFilter('all')}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  Clear filter
                </button>
              </div>
            )}
          </div>
        )}

        {/* Filters & Expand/Collapse Controls */}
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Cycle:</label>
              <select
                value={selectedCycleId}
                onChange={(e) => handleCycleChange(e.target.value || 'all')}
                className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All</option>
                {unassignedCount.candidates > 0 && (
                  <option value="unassigned">Unassigned ({unassignedCount.candidates})</option>
                )}
                {cycles.filter(c => c.isActive && c.shortCode).map(cycle => (
                  <option key={cycle.id} value={cycle.shortCode}>
                    {cycle.shortCode}
                  </option>
                ))}
              </select>
            </div>
            {uniqueInstitutions.length > 1 && (
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">Institution:</label>
                <select
                  value={institutionFilter}
                  onChange={(e) => setInstitutionFilter(e.target.value)}
                  className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 max-w-[200px]"
                >
                  <option value="all">All ({uniqueInstitutions.length})</option>
                  {uniqueInstitutions.map(inst => (
                    <option key={inst} value={inst} title={inst}>
                      {inst.length > 30 ? inst.substring(0, 30) + '...' : inst}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {uniquePIs.length > 1 && (
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">PI:</label>
                <select
                  value={piFilter}
                  onChange={(e) => setPiFilter(e.target.value)}
                  className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 max-w-[180px]"
                >
                  <option value="all">All ({uniquePIs.length})</option>
                  {uniquePIs.map(pi => (
                    <option key={pi} value={pi} title={pi}>
                      {pi.length > 25 ? pi.substring(0, 25) + '...' : pi}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {uniquePrograms.length > 1 && (
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">Program:</label>
                <select
                  value={programFilter}
                  onChange={(e) => setProgramFilter(e.target.value)}
                  className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All ({uniquePrograms.length})</option>
                  {uniquePrograms.map(prog => (
                    <option key={prog} value={prog}>
                      {prog.includes('Medical') ? 'Medical' : 'Science & Eng'}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {(institutionFilter !== 'all' || piFilter !== 'all' || programFilter !== 'all' || emailStatusFilter !== 'all') && (
              <button
                onClick={() => { setInstitutionFilter('all'); setPiFilter('all'); setProgramFilter('all'); setEmailStatusFilter('all'); }}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Clear all filters
              </button>
            )}
          </div>
          {filteredProposals.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={expandAll}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Expand All
              </button>
              <span className="text-gray-300">|</span>
              <button
                onClick={collapseAll}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Collapse All
              </button>
            </div>
          )}
        </div>
      </Card>

      {/* Email Settings (collapsible) */}
      <EmailSettingsPanel />

      {/* Proposals with Candidates */}
      {filteredProposals.map((proposal) => {
        const allIds = proposal.candidates.map(c => c.suggestionId);
        const allSelected = allIds.length > 0 && allIds.every(id => selectedForDeletion.has(id));
        const someSelected = allIds.some(id => selectedForDeletion.has(id));
        const isExpanded = expandedProposals.has(proposal.proposalId);

        return (
          <Card key={proposal.proposalId}>
            {/* Collapsible Header */}
            <div
              className="flex items-center justify-between cursor-pointer"
              onClick={() => toggleProposalExpanded(proposal.proposalId)}
            >
              <div className="flex items-center gap-3">
                <span className="text-gray-400 text-sm w-4">
                  {isExpanded ? '▼' : '▶'}
                </span>
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={el => {
                    if (el) el.indeterminate = someSelected && !allSelected;
                  }}
                  onChange={(e) => {
                    e.stopPropagation();
                    handleSelectAllInProposal(proposal);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="h-4 w-4 text-red-600 rounded border-gray-300"
                  title="Select all candidates in this proposal"
                />
                <div>
                  <h4 className="font-medium text-gray-900">
                    {proposal.proposalTitle}
                  </h4>
                  <ProposalMetadataRow proposal={proposal} />
                  <p className="text-xs text-gray-400 flex items-center flex-wrap gap-1">
                    <span>{proposal.candidates.length} candidate(s)</span>
                    {(() => {
                      const invitedCount = proposal.candidates.filter(c => c.invited || c.emailSentAt).length;
                      const acceptedCount = proposal.candidates.filter(c => c.accepted || c.responseType === 'accepted').length;
                      const pendingCount = proposal.candidates.filter(c => c.emailSentAt && !c.responseType && !c.accepted && !c.declined).length;
                      return (
                        <>
                          {invitedCount > 0 && (
                            <span className="text-blue-500">· {invitedCount} invited</span>
                          )}
                          {pendingCount > 0 && (
                            <span className="text-amber-500">· {pendingCount} pending</span>
                          )}
                          {acceptedCount > 0 && (
                            <span className={acceptedCount >= 3 ? 'text-green-600 font-medium' : 'text-gray-500'}>
                              · {acceptedCount} accepted
                            </span>
                          )}
                        </>
                      );
                    })()}
                    <select
                      value={proposal.programArea || ''}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleUpdateProposalProgram(proposal.proposalId, e.target.value || null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className={`ml-1 px-1.5 py-0.5 rounded text-xs border-0 cursor-pointer appearance-none pr-4 ${
                        proposal.programArea?.includes('Medical')
                          ? 'bg-red-50 text-red-600'
                          : proposal.programArea?.includes('Science')
                          ? 'bg-blue-50 text-blue-600'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                      style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0 center', backgroundRepeat: 'no-repeat', backgroundSize: '1rem' }}
                      title="Click to change program area"
                    >
                      <option value="">Not assigned</option>
                      <option value="Science and Engineering Research Program">Science & Eng</option>
                      <option value="Medical Research Program">Medical</option>
                    </select>
                    <select
                      value={proposal.grantCycleCode || ''}
                      onChange={(e) => {
                        e.stopPropagation();
                        const cycleCode = e.target.value || null;
                        handleUpdateProposalCycle(proposal.proposalId, cycleCode);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className={`ml-1 px-1.5 py-0.5 rounded text-xs border-0 cursor-pointer appearance-none pr-4 ${
                        proposal.grantCycleCode
                          ? 'bg-purple-50 text-purple-600'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                      style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0 center', backgroundRepeat: 'no-repeat', backgroundSize: '1rem' }}
                      title="Click to change grant cycle"
                    >
                      <option value="">No cycle</option>
                      {cycles.filter(c => c.isActive && c.shortCode).map(cycle => (
                        <option key={cycle.id} value={cycle.shortCode}>
                          {cycle.shortCode}
                        </option>
                      ))}
                    </select>
                  </p>
                </div>
              </div>
              {/* Summary Status (read-only; re-extract retired in W5 step 5) */}
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                {proposal.summaryBlobUrl ? (
                  <span className="text-xs text-green-600 flex items-center gap-1">
                    <span>✓</span> Summary
                  </span>
                ) : (
                  <span className="text-xs text-gray-400">No summary</span>
                )}
              </div>
            </div>

            {/* Collapsible Content */}
            {isExpanded && (
              <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                {proposal.candidates.map((candidate) => (
                  <SavedCandidateCard
                    key={candidate.suggestionId}
                    candidate={candidate}
                    onUpdate={handleUpdateCandidate}
                    onRemove={handleRemoveCandidate}
                    onEdit={setEditingCandidate}
                    isSelectedForDeletion={selectedForDeletion.has(candidate.suggestionId)}
                    onToggleSelection={() => handleToggleSelection(candidate.suggestionId)}
                  />
                ))}
              </div>
            )}
          </Card>
        );
      })}

      {/* Email Generator Modal */}
      {showEmailModal && (
        <EmailGeneratorModal
          isOpen={showEmailModal}
          onClose={() => setShowEmailModal(false)}
          candidates={emailModalData.candidates}
          proposalInfo={emailModalData.proposalInfo}
          onEmailsGenerated={fetchCandidates}
          isFollowUp={emailModalData.isFollowUp}
        />
      )}

      {/* Edit Candidate Modal */}
      <EditCandidateModal
        isOpen={!!editingCandidate}
        candidate={editingCandidate}
        onClose={() => setEditingCandidate(null)}
        onSave={async (suggestionId, updates) => {
          // Refresh to get updated data from database
          await fetchCandidates();
        }}
      />

    </div>
  );
}

// Main Page Component
function ReviewerFinderPage() {
  const [activeTab, setActiveTab] = useState('search');
  const [myCandidatesRefresh, setMyCandidatesRefresh] = useState(0);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [apiCapabilities, setApiCapabilities] = useState({ orcid: false, ncbi: false, serp: false });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/api-capabilities')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setApiCapabilities(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Get current profile ID for user scoping. useContext returns null when no
  // ProfileProvider is mounted (non-public pages always have one — see
  // pages/_app.js); unconditional hook call satisfies rules-of-hooks.
  const profileContext = useContext(ProfileContext);
  const userProfileId = profileContext?.currentProfile?.id || null;

  // Lifted state from NewSearchTab to persist across tab switches
  const [searchState, setSearchState] = useState({
    uploadedFiles: [],
    analysisResult: null,
    discoveryResult: null,
    selectedCandidates: new Set(),
  });

  // Callback to trigger refresh of My Candidates tab
  const handleCandidatesSaved = () => {
    setMyCandidatesRefresh(prev => prev + 1);
  };

  const tabs = [
    { id: 'search', label: 'Search', icon: '🔍' },
    { id: 'candidates', label: 'My Candidates', icon: '📋' }
  ];

  return (
    <Layout
      title="Reviewer Finder"
      description="Find qualified peer reviewers using AI analysis and academic database verification"
    >
      <PageHeader
        title="Reviewer Finder"
        subtitle="Combine Claude's analytical reasoning with real database verification to find qualified reviewers"
        icon="🎯"
      >
        <HelpButton appKey="reviewer-finder" className="mt-3" />
      </PageHeader>

      <div className="py-8 space-y-6">
        {/* Model Indicator */}
        <Card>
          <div className="flex items-center gap-2">
            <span className="text-lg">🤖</span>
            <span className="text-sm text-gray-600">
              Model: <strong className="text-gray-800">{getModelDisplayName(BASE_CONFIG.APP_MODELS?.['reviewer-finder']?.model || BASE_CONFIG.CLAUDE.DEFAULT_MODEL)}</strong>
            </span>
          </div>
        </Card>

        {/* Tab Navigation */}
        <div className="border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex">
              {tabs.map((tab) => (
                <Tab
                  key={tab.id}
                  label={tab.label}
                  icon={tab.icon}
                  active={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                />
              ))}
            </div>
            {/* Settings Gear Icon */}
            <button
              onClick={() => setShowSettingsModal(true)}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors mr-2"
              title="Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="min-h-[400px]">
          {activeTab === 'search' && <NewSearchTab apiCapabilities={apiCapabilities} onCandidatesSaved={handleCandidatesSaved} searchState={searchState} setSearchState={setSearchState} userProfileId={userProfileId} />}
          {activeTab === 'candidates' && <MyCandidatesTab refreshTrigger={myCandidatesRefresh} userProfileId={userProfileId} />}
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
      />
    </Layout>
  );
}

export default function ReviewerFinderGuard() {
  return <RequireAppAccess appKey="reviewer-finder"><ReviewerFinderPage /></RequireAppAccess>;
}
