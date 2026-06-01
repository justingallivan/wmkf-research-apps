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

    for (const candidate of candidates) {
      try {
        const normalizedName = candidate.name
          .toLowerCase()
          .replace(/^(dr\.?|prof\.?|professor)\s+/i, '')
          .replace(/[^a-z\s]/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        const candidateEmail = candidate.email || candidate.contactEnrichment?.email || null;
        const candidateAffiliation = candidate.affiliation || candidate.contactEnrichment?.affiliation || null;
        const candidateOrcid = candidate.orcid || candidate.contactEnrichment?.orcid || null;
        const candidateGoogleScholarId = candidate.googleScholarId || candidate.contactEnrichment?.googleScholarId || null;
        const candidateWebsite = candidate.website || candidate.contactEnrichment?.website || null;

        const expertiseForDv = Array.isArray(candidate.expertiseAreas)
          ? candidate.expertiseAreas.filter(Boolean).join('; ')
          : (candidate.expertise || null);

        const sources = [];
        if (candidate.isClaudeSuggestion || candidate.source === 'claude_suggestion') sources.push('claude');
        if (candidate.verificationSource === 'pubmed' || candidate.source === 'pubmed') sources.push('pubmed');
        if (candidate.source === 'arxiv') sources.push('arxiv');
        if (candidate.source === 'biorxiv') sources.push('biorxiv');
        if (sources.length === 0) sources.push(candidate.source || 'unknown');

        const relevanceScore = candidate.verificationConfidence || candidate.relevanceScore || 0.5;

        let matchReason = candidate.reasoning || candidate.generatedReasoning || '';
        if (candidate.hasInstitutionCOI) {
          matchReason += ' [Institution COI: Same institution as proposal PI]';
        }
        if (candidate.hasCoauthorCOI) {
          matchReason += ' [Coauthor COI: Has co-authored with proposal authors]';
        }

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
          orcid: candidateOrcid,
          orcidUrl: candidate.orcidUrl || candidate.contactEnrichment?.orcidUrl || null,
          googleScholarId: candidateGoogleScholarId,
          googleScholarUrl: candidate.googleScholarUrl || candidate.contactEnrichment?.googleScholarUrl || null,
          // Fall back to contactEnrichment like every other field above —
          // enrichment writes bibliometrics there, and not all callers promote
          // them to the candidate top-level (the standalone Reviewer Finder does
          // not), so reading candidate.* only would silently drop fetched metrics.
          hIndex: candidate.hIndex ?? candidate.contactEnrichment?.hIndex ?? null,
          i10Index: candidate.i10Index ?? candidate.contactEnrichment?.i10Index ?? null,
          totalCitations: candidate.totalCitations ?? candidate.contactEnrichment?.totalCitations ?? null,
          affiliation: candidateAffiliation,
          department: candidate.department || candidate.contactEnrichment?.department || null,
          website: candidateWebsite,
          facultyPageUrl: candidate.facultyPageUrl || candidate.contactEnrichment?.facultyPageUrl || null,
          keywords: expertiseForDv,
        }, { actingUserSystemId });

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
      } catch (candidateError) {
        console.error(`Error saving candidate ${candidate.name}:`, candidateError.message);
        errors.push({ name: candidate.name, error: candidateError.message });
      }
    }

    return res.status(200).json({
      success: true,
      savedCount,
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
