/**
 * API Route: /api/reviewer-finder/save-candidates
 *
 * Saves selected candidates to Dataverse for a proposal. Writes go to
 * three adapters (potential reviewer → researcher overlay → reviewer
 * suggestion), keyed by email and request GUID.
 *
 * Requires `requestId` (Dataverse akoya_request GUID). Postgres is no
 * longer written — Review Manager and My Candidates both read from
 * Dataverse, and the Postgres reviewer tables are scheduled for archival.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import * as potentialReviewerAdapter from '../../../lib/dataverse/adapters/potential-reviewer';
import * as researcherAdapter from '../../../lib/dataverse/adapters/researcher';
import * as reviewerSuggestionAdapter from '../../../lib/dataverse/adapters/reviewer-suggestion';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { mayPersistIdentity, RESOLVER_SOURCED_FIELDS } from '../../../lib/services/reviewer-identity-resolver';
import { saveSourceListForCandidate, withReviewerProvenance } from '../../../lib/utils/reviewer-provenance';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  // Trusted internal writeback — no field/table masking applies.
  return bypassDynamicsRestrictions('save-candidates', async () => {
  try {
    const {
      proposalTitle,
      programArea,
      requestId,
      grantCycleCode,
      candidates,
      summaryBlobUrl,
    } = req.body;

    if (!requestId) {
      return res.status(400).json({ error: 'requestId is required (Dataverse akoya_request GUID)' });
    }

    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ error: 'candidates array is required' });
    }

    let savedCount = 0;
    const errors = [];
    // The exact display names that saved successfully — the client flips ONLY
    // these to status='saved' in the Find-tab roster (S224), so a partial-failure
    // save never marks a failed row saved.
    const savedNames = [];

    for (const rawCandidate of candidates) {
      try {
        const candidate = withReviewerProvenance(rawCandidate);
        const normalizedName = candidate.name
          .toLowerCase()
          .replace(/^(dr\.?|prof\.?|professor)\s+/i, '')
          .replace(/[^a-z\s]/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        const candidateEmail = candidate.email || candidate.contactEnrichment?.email || null;
        const candidateAffiliation = candidate.affiliation || candidate.contactEnrichment?.affiliation || null;
        // Enrichment stores the ORCID iD as `orcidId` (not `orcid`); read that key
        // so a candidate carrying only contactEnrichment doesn't drop a real ORCID.
        const candidateOrcid = candidate.orcid || candidate.contactEnrichment?.orcidId || null;
        const candidateGoogleScholarId = candidate.googleScholarId || candidate.contactEnrichment?.googleScholarId || null;
        const candidateWebsite = candidate.website || candidate.contactEnrichment?.website || null;

        const expertiseForDv = Array.isArray(candidate.expertiseAreas)
          ? candidate.expertiseAreas.filter(Boolean).join('; ')
          : (candidate.expertise || null);

        const sources = saveSourceListForCandidate(candidate);
        if (sources.length === 0) sources.push('unknown');

        // Persist the recency-weighted relevance score (0–100), attached by
        // rankByRelevance at /discover + the Workbench re-rank. Prefer it over
        // the 0–1 verificationConfidence so `wmkf_relevancescore` reflects the
        // recency ranking for verified (Track A) candidates too — previously
        // Track A stored verificationConfidence (0–1) while Track B stored
        // relevanceScore (0–100), mixing scales in one field (S223). isFinite so
        // a legitimate 0 (dormant candidate) is kept; verificationConfidence is
        // the fallback only when no rank score is present.
        const relevanceScore = Number.isFinite(candidate.relevanceScore)
          ? candidate.relevanceScore
          : (candidate.verificationConfidence || 0.5);

        let matchReason = candidate.reasoning || candidate.generatedReasoning || '';
        if (candidate.hasInstitutionCOI) {
          matchReason += ' [Institution COI: Same institution as proposal PI]';
        }
        if (candidate.hasCoauthorCOI) {
          matchReason += ' [Coauthor COI: Has co-authored with proposal authors]';
        }

        // Identity gate (Phase 2 — REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md).
        // The resolver's verdict (attached to contactEnrichment.identity) is the
        // gate: bibliometrics/ORCID persist only when status ∈ {confirmed,probable}.
        //   - blockByIdentity: resolver verdict below probable → block ALL
        //     resolver-sourced fields (scholar id/url, metrics, ORCID id/url).
        //   - scholarSkipped: Phase-1 fallback when no resolver verdict is present
        //     (enrichment didn't run) — blocks the scholar id/url + metrics only.
        // Passing null is a safe no-op in the adapter (pruneEmpty drops it); a true
        // downgrade additionally CLEARS any stale value below via clearIdentityFields.
        const scholarSkipped = !!candidate.contactEnrichment?.tierResults?.scholar_profile?.skipped;
        const identity = candidate.contactEnrichment?.identity || null;
        // A candidate loaded from the durable Find-tab roster has had its
        // identity/tierResults pruned away, but `pruneCandidateForRoster` left
        // safe boolean persist flags so the gate still holds after a reload
        // (Codex post-impl HIGH). `=== false` so they only ever TIGHTEN the gate,
        // never loosen it for fresh (full-object) candidates that lack the flags.
        const blockByIdentity = (!!identity && !mayPersistIdentity(identity.status))
          || candidate.identityPersistAllowed === false;
        const blockScholar = scholarSkipped || blockByIdentity
          || candidate.scholarPersistAllowed === false;

        const { id: potentialReviewerId } = await potentialReviewerAdapter.upsertByEmail({
          name: candidate.name,
          email: candidateEmail,
          affiliation: candidateAffiliation,
          expertise: expertiseForDv,
          whyChosen: matchReason || null,
        }, { actingUserSystemId });

        await researcherAdapter.upsertByPotentialReviewer(potentialReviewerId, {
          name: candidate.name,
          normalizedName,
          email: candidateEmail,
          emailSource: candidate.contactEnrichment?.emailSource || null,
          orcid: blockByIdentity ? null : candidateOrcid,
          orcidUrl: blockByIdentity ? null : (candidate.orcidUrl || candidate.contactEnrichment?.orcidUrl || null),
          googleScholarId: blockScholar ? null : candidateGoogleScholarId,
          googleScholarUrl: blockScholar ? null : (candidate.googleScholarUrl || candidate.contactEnrichment?.googleScholarUrl || null),
          // Fall back to contactEnrichment like every other field above —
          // enrichment writes bibliometrics there, and not all callers promote
          // them to the candidate top-level (the standalone Reviewer Finder does
          // not), so reading candidate.* only would silently drop fetched metrics.
          hIndex: blockScholar ? null : (candidate.hIndex ?? candidate.contactEnrichment?.hIndex ?? null),
          i10Index: blockScholar ? null : (candidate.i10Index ?? candidate.contactEnrichment?.i10Index ?? null),
          totalCitations: blockScholar ? null : (candidate.totalCitations ?? candidate.contactEnrichment?.totalCitations ?? null),
          affiliation: candidateAffiliation,
          department: candidate.department || candidate.contactEnrichment?.department || null,
          website: candidateWebsite,
          facultyPageUrl: candidate.facultyPageUrl || candidate.contactEnrichment?.facultyPageUrl || null,
          keywords: expertiseForDv,
        }, { actingUserSystemId });

        // Persist the resolver decision on the person; on a downgrade, also CLEAR
        // any stale resolver-sourced identity fields (upsert's null is a no-op, so
        // an explicit null-PATCH is required to remove a previously-wrong value).
        if (identity) {
          await researcherAdapter.writeIdentityDecision(potentialReviewerId, identity, { actingUserSystemId });
          if (blockByIdentity) {
            await researcherAdapter.clearIdentityFields(potentialReviewerId, RESOLVER_SOURCED_FIELDS, { actingUserSystemId });
          }
        }

        await reviewerSuggestionAdapter.upsert({
          potentialReviewerId,
          requestId,
          suggestionLabel: proposalTitle ? `${proposalTitle} — ${candidate.name}` : null,
          grantCycleCode: grantCycleCode || null,
          programArea: programArea || null,
          relevanceScore,
          matchReason,
          sources: sources.join(','),
          selected: true,
          summaryBlobUrl: summaryBlobUrl || null,
        }, { actingUserSystemId });

        savedCount++;
        savedNames.push(candidate.name);
      } catch (candidateError) {
        console.error(`Error saving candidate ${rawCandidate?.name}:`, candidateError.message);
        errors.push({ name: rawCandidate?.name, error: candidateError.message });
      }
    }

    return res.status(200).json({
      success: true,
      savedCount,
      savedNames,
      totalRequested: candidates.length,
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (error) {
    console.error('Save candidates error:', error);
    return res.status(500).json({
      error: 'Failed to save candidates',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
  });
}
