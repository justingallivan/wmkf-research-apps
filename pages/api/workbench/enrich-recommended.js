/**
 * API: /api/workbench/enrich-recommended
 *
 * POST { requestId, blobUrl, analysisResult? }  (SSE)
 *
 * Runs this request's APPLICANT-RECOMMENDED reviewers through the SAME full
 * pipeline discovered candidates get, on an explicit PD click (Workbench Find
 * tab → "Enrich recommended reviewers"):
 *
 *   PubMed author-verification (publications + expertise)
 *   → COI vs the proposal's PI/authors (institution + coauthorship)
 *   → contact + real Google Scholar bibliometrics enrichment
 *   → idempotent bibliometric writeback onto each person row (S213: the
 *      wmkf_appresearcher sidecar was collapsed into wmkf_potentialreviewers;
 *      keyed by potentialReviewerId)
 *   → COI persisted onto the recommended junction row's match reason (so a
 *      conflicted recommendee doesn't read as "clean" in the Invite/Manage tab)
 *
 * The recommended people were materialized as `disposition=recommended` junction
 * rows by /api/workbench/applicant-reviewers; this endpoint only ENRICHES them.
 *
 * proposalInfo (needed for COI) comes from the client's already-run search
 * (`analysisResult`) when present, else from analyzing the loaded proposal blob.
 * If neither yields proposal authors/institution we fail loud rather than
 * silently enrich without COI.
 *
 * Per-request scoped; org-open like the other reviewer surfaces. The whole body
 * runs inside one bypassDynamicsRestrictions context (reads + writes).
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { nextRateLimiter } from '../../../shared/api/middleware/rateLimiter';
import { safeFetch } from '../../../lib/utils/safe-fetch';
import { normalizeName } from '../../../lib/utils/name-normalization';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';
import { ClaudeReviewerService } from '../../../lib/services/claude-reviewer-service';
import { DiscoveryService } from '../../../lib/services/discovery-service';
import { DeduplicationService } from '../../../lib/services/deduplication-service';
import { ContactEnrichmentService } from '../../../lib/services/contact-enrichment-service';
import * as reviewerSuggestionAdapter from '../../../lib/dataverse/adapters/reviewer-suggestion';
import * as potentialReviewerAdapter from '../../../lib/dataverse/adapters/potential-reviewer';
import * as researcherAdapter from '../../../lib/dataverse/adapters/researcher';
import { APPLICANT_DISPOSITION_MAP } from '../../../lib/dataverse/adapters/reviewer-suggestion';
import { mayPersistIdentity, RESOLVER_SOURCED_FIELDS } from '../../../lib/services/reviewer-identity-resolver';

const limiter = nextRateLimiter({ max: 10 });
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
  maxDuration: 300,
};

// Resolve proposal text from a Vercel Blob URL (mirrors analyze.js:77–137).
async function fetchProposalText(blobUrl) {
  const resp = await safeFetch(blobUrl);
  if (!resp.ok) throw new Error('Failed to fetch the proposal file');
  const contentType = resp.headers.get('content-type');
  if (contentType?.includes('application/pdf')) {
    const pdfParse = (await import('pdf-parse')).default;
    const buf = Buffer.from(await resp.arrayBuffer());
    const data = await pdfParse(buf);
    return data.text;
  }
  return resp.text();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  // Resolve per-app model overrides + register the tier→id resolver BEFORE any
  // Claude call (analyzeProposal / claudeWebSearch via enrichCandidates). Without
  // this, getModelForApp returns the unresolved 'sonnet' tier alias and Anthropic
  // 404s ("model: sonnet"). Mirrors analyze.js / discover.js.
  await loadModelOverrides();

  const { requestId, blobUrl, analysisResult } = req.body || {};
  if (!requestId || !GUID_RE.test(String(requestId))) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const apiKey = process.env.CLAUDE_API_KEY;
  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  try {
    await bypassDynamicsRestrictions('workbench-enrich-recommended', async () => {
      // 1. Load this request's applicant-RECOMMENDED junction rows.
      const rows = await reviewerSuggestionAdapter.findByRequest(requestId, { selectedOnly: true });
      const recommendedRows = rows.filter(
        (r) => r.wmkf_applicantdisposition === APPLICANT_DISPOSITION_MAP.recommended
      );
      if (recommendedRows.length === 0) {
        sendEvent('complete', { recommended: [] });
        return;
      }

      // 2. proposalInfo (needed for COI). Reuse the client's analysis if present;
      //    else analyze the loaded proposal blob. Fail loud if unavailable.
      let proposalInfo = analysisResult?.proposalInfo || null;
      if (!proposalInfo) {
        if (!apiKey) { sendEvent('error', { message: 'Claude API key not configured on server' }); return; }
        if (!blobUrl) { sendEvent('error', { message: 'No proposal loaded — cannot compute conflicts of interest. Run a reviewer search first, or reload the proposal.' }); return; }
        sendEvent('progress', { message: 'Analyzing the proposal for conflict-of-interest context…' });
        let text;
        try {
          text = await fetchProposalText(blobUrl);
        } catch (e) {
          sendEvent('error', { message: `Could not read the proposal document: ${e.message}` });
          return;
        }
        if (!text || text.trim().length < 100) {
          sendEvent('error', { message: 'Proposal text is too short or empty to analyze.' });
          return;
        }
        const analysis = await ClaudeReviewerService.analyzeProposal(text, apiKey, {
          reviewerCount: 1, // we don't use the suggestions here, only proposalInfo
          userProfileId: access.profileId,
          onProgress: (p) => sendEvent('progress', p),
        });
        proposalInfo = analysis?.proposalInfo || null;
      }
      if (!proposalInfo || (!proposalInfo.authorInstitution && !proposalInfo.proposalAuthors)) {
        sendEvent('error', { message: 'Could not determine the proposal’s authors/institution, so conflict-of-interest checks would be empty. Aborting.' });
        return;
      }

      // 3. Build verification suggestions, carrying potentialReviewerId +
      //    suggestionId through (verifyClaudeSuggestions spreads ...suggestion).
      const suggestions = [];
      for (const row of recommendedRows) {
        const prId = row._wmkf_potentialreviewer_value;
        const name = row._wmkf_potentialreviewer_value_formatted || row.wmkf_name || null;
        if (!prId || !name) continue;
        let affiliation = null;
        try {
          const person = await potentialReviewerAdapter.getById(prId);
          affiliation = person?.wmkf_primaryaffiliation || person?.wmkf_organizationname || null;
        } catch { /* affiliation is optional — verify fills it from PubMed */ }
        suggestions.push({
          name,
          affiliation,
          expertiseAreas: [],
          potentialReviewerId: prId,
          suggestionId: row.wmkf_appreviewersuggestionid,
        });
      }
      if (suggestions.length === 0) {
        sendEvent('complete', { recommended: [] });
        return;
      }

      // 4. Verify in PubMed (publications + expertise).
      sendEvent('progress', { message: `Verifying ${suggestions.length} recommended reviewer(s) in PubMed…` });
      const { verified, unverified } = await DiscoveryService.verifyClaudeSuggestions(
        suggestions,
        (p) => sendEvent('progress', p)
      );

      // 5. COI on the FULL set — verified AND unverified. Institution COI works
      //    on unverified rows too (they carry the affiliation fetched above), and
      //    a recommendee who fails PubMed verification must NOT display as
      //    "clean" when their known institution matches the PI's (Codex post-impl).
      let coiChecked = [...verified, ...unverified];
      if (proposalInfo.authorInstitution) {
        coiChecked = DeduplicationService.markInstitutionCOI(coiChecked, proposalInfo.authorInstitution);
      }
      // Coauthor COI vs PI + co-investigators. `proposalAuthors` is normalized to
      // the PI only (reviewer-finder.js:243); fold in `coInvestigators` so a
      // recommendee who co-authored with a listed co-PI is also flagged. (The
      // shared discover.js path only checks the PI — see the parity note in the
      // build plan.)
      const NOT_SET = (s) => !s || /^(not specified|not set|n\/a|none)$/i.test(s.trim());
      const authorBlob = [proposalInfo.proposalAuthors, proposalInfo.coInvestigators]
        .filter((s) => !NOT_SET(s))
        .join(', ');
      const proposalAuthors = authorBlob
        ? authorBlob.split(',').map((a) => a.trim()).filter(Boolean)
        : [];
      if (proposalAuthors.length > 0 && coiChecked.length > 0) {
        coiChecked = await DiscoveryService.checkCoauthorshipsForCandidates(
          coiChecked,
          proposalAuthors,
          (p) => sendEvent('progress', p)
        );
      }

      // 6. Enrich (all tiers; persist:false — THIS endpoint owns the id-keyed
      //    writeback, so enrichment must not run its own email-keyed save).
      const toEnrich = coiChecked;
      sendEvent('progress', { message: `Finding contact info & citation metrics for ${toEnrich.length} reviewer(s)…` });
      const enrichResult = await ContactEnrichmentService.enrichCandidates(toEnrich, {
        credentials: {
          claudeApiKey: apiKey,
          orcidClientId: process.env.ORCID_CLIENT_ID,
          orcidClientSecret: process.env.ORCID_CLIENT_SECRET,
          serpApiKey: process.env.SERP_API_KEY,
        },
        usePubmed: true,
        useOrcid: true,
        useSerpSearch: true,
        useClaudeSearch: true,
        persist: false,
        onProgress: (p) => sendEvent('progress', p),
      });
      const enriched = enrichResult.enriched || [];

      // 7 + 8. Writeback per person: sidecar metrics/contact (id-keyed, race-safe)
      //         + deterministic COI match-reason on the junction row.
      const out = [];
      for (const c of enriched) {
        const prId = c.potentialReviewerId;
        const ce = c.contactEnrichment || {};
        // Identity gate (Phase 2 — REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md).
        // The resolver verdict (ce.identity) gates identity-bearing persistence +
        // the UI payload: blockByIdentity (verdict < probable) drops ALL resolver-
        // sourced fields; scholarSkipped is the Phase-1 fallback (scholar id/url +
        // metrics) when no verdict is present. The adapter treats null as a no-op;
        // a true downgrade additionally CLEARS stale values via clearIdentityFields.
        const scholarSkipped = !!ce.tierResults?.scholar_profile?.skipped;
        const identity = ce.identity || null;
        const blockByIdentity = !!identity && !mayPersistIdentity(identity.status);
        const blockScholar = scholarSkipped || blockByIdentity;
        const hIndex = blockScholar ? null : (c.hIndex ?? ce.hIndex ?? null);
        const i10Index = blockScholar ? null : (c.i10Index ?? ce.i10Index ?? null);
        const totalCitations = blockScholar ? null : (c.totalCitations ?? ce.totalCitations ?? null);
        const googleScholarId = blockScholar ? null : (ce.googleScholarId || null);
        const googleScholarUrl = blockScholar ? null : (ce.googleScholarUrl || null);
        const orcidId = blockByIdentity ? null : (ce.orcidId || null);
        const orcidUrl = blockByIdentity ? null : (ce.orcidUrl || null);
        const email = c.email || ce.email || null;

        if (prId) {
          try {
            await researcherAdapter.upsertByPotentialReviewer(prId, {
              name: c.name,
              normalizedName: normalizeName(c.name),
              email,
              emailSource: ce.emailSource || null,
              orcid: orcidId,
              orcidUrl,
              googleScholarId,
              googleScholarUrl,
              hIndex,
              i10Index,
              totalCitations,
              affiliation: c.affiliation || null,
              department: ce.department || null,
              website: c.website || ce.website || null,
              facultyPageUrl: ce.facultyPageUrl || null,
              keywords: Array.isArray(c.expertiseAreas) ? c.expertiseAreas.filter(Boolean).join('; ') : null,
            }, { actingUserSystemId });
            // Persist the resolver decision; clear stale identity fields on downgrade.
            if (identity) {
              await researcherAdapter.writeIdentityDecision(prId, identity, { actingUserSystemId });
              if (blockByIdentity) {
                await researcherAdapter.clearIdentityFields(prId, RESOLVER_SOURCED_FIELDS, { actingUserSystemId });
              }
            }
          } catch (err) {
            sendEvent('progress', { message: `Could not save metrics for ${c.name}: ${err.message}` });
          }
        }

        // Deterministic COI match reason — SET (not append) so re-click is
        // idempotent. Only when the person actually has COI.
        if (c.suggestionId && (c.hasInstitutionCOI || c.hasCoauthorCOI)) {
          let reason = 'Recommended by applicant (legacy reviewer slot).';
          if (c.hasInstitutionCOI) reason += ' [Institution COI: Same institution as proposal PI]';
          if (c.hasCoauthorCOI) reason += ' [Coauthor COI: Has co-authored with proposal authors]';
          try {
            await reviewerSuggestionAdapter.setMatchReason(c.suggestionId, reason, { actingUserSystemId });
          } catch (err) {
            sendEvent('progress', { message: `Could not flag COI for ${c.name}: ${err.message}` });
          }
        }

        out.push({
          potentialReviewerId: prId || null,
          suggestionId: c.suggestionId || null,
          name: c.name,
          affiliation: c.affiliation || null,
          seniorityEstimate: c.seniorityEstimate || null,
          verified: c.verified !== false,
          unverified: c.verified === false,
          verificationConfidence: typeof c.verificationConfidence === 'number' ? c.verificationConfidence : null,
          publications: Array.isArray(c.publications) ? c.publications : [],
          publicationCount5yr: c.publicationCount5yr ?? null,
          reasoning: c.reasoning || c.generatedReasoning || null,
          hasInstitutionCOI: !!c.hasInstitutionCOI,
          hasCoauthorCOI: !!c.hasCoauthorCOI,
          institutionCOIDetails: c.institutionCOIDetails || null,
          coauthorships: Array.isArray(c.coauthorships) ? c.coauthorships : [],
          institutionMismatch: !!c.institutionMismatch,
          suggestedInstitution: c.suggestedInstitution || null,
          expertiseMismatch: !!c.expertiseMismatch,
          expertiseAreas: Array.isArray(c.expertiseAreas) ? c.expertiseAreas : [],
          email,
          emailSource: ce.emailSource || null,
          website: c.website || ce.website || null,
          orcidUrl: ce.orcidUrl || null,
          googleScholarUrl,
          hIndex,
          totalCitations,
          // Flag the UI uses to badge these rows distinctly.
          isApplicantRecommended: true,
        });
      }

      sendEvent('complete', { recommended: out });
    });
  } catch (err) {
    console.error('enrich-recommended error:', err);
    sendEvent('error', { message: err?.message || 'Failed to enrich recommended reviewers' });
  }

  res.end();
}
