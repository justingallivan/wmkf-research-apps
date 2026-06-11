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
import { ContactParser } from '../../../lib/utils/contact-parser';
import { deriveProposalAuthorNames } from '../../../lib/utils/proposal-authors';
import { resolveProposalPI, appendPiName, piInstitutions } from '../../../lib/services/proposal-pi-identity';
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
import { backPropReviewerOrcidToContact } from '../../../lib/services/backprop-reviewer-orcid';
import { getReviewerTimeBudgetSeconds } from '../../../lib/services/reviewer-time-budget';

const limiter = nextRateLimiter({ max: 10 });
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
  // Pinned at the Vercel Pro/Enterprise Fluid-Compute cap (800s). Live budget is
  // `reviewer.time_budget_seconds` (default 600), enforced via an AbortSignal
  // deadline. See docs/REVIEWER_TIMEOUT_BUDGET_PLAN.md.
  maxDuration: 800,
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

  // Admin-configurable wall-clock budget (default 600s, clamped [120,800]),
  // enforced via an AbortSignal deadline on the analyze + enrich Claude calls.
  // See docs/REVIEWER_TIMEOUT_BUDGET_PLAN.md.
  const deadlineController = new AbortController();
  const budgetSeconds = await getReviewerTimeBudgetSeconds();
  const deadlineAt = Date.now() + budgetSeconds * 1000;
  const deadlineTimer = setTimeout(() => {
    const e = new Error('reviewer_time_budget_exceeded');
    e.code = 'reviewer_time_budget_exceeded';
    deadlineController.abort(e);
  }, budgetSeconds * 1000);

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
          analysisPurpose: 'proposal_info',
          userProfileId: access.profileId,
          signal: deadlineController.signal,
          deadlineAt,
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
      // Retain each person's contact pointer (design §5 hydration contract) so
      // the post-writeback ORCID back-prop can target an already-linked contact.
      const suggestions = [];
      const contactValueByPr = new Map();
      for (const row of recommendedRows) {
        const prId = row._wmkf_potentialreviewer_value;
        const name = row._wmkf_potentialreviewer_value_formatted || row.wmkf_name || null;
        if (!prId || !name) continue;
        let affiliation = null;
        try {
          const person = await potentialReviewerAdapter.getById(prId);
          affiliation = person?.wmkf_primaryaffiliation || person?.wmkf_organizationname || null;
          if (person?._wmkf_contact_value) contactValueByPr.set(prId, person._wmkf_contact_value);
        } catch { /* affiliation is optional — verify fills it from PubMed */ }
        suggestions.push({
          name,
          affiliation,
          // Whether the applicant gave us anything to disambiguate a name-only
          // PubMed match. A bare name (no affiliation) matches ANY same-named
          // author, so a "verified" hit on one is not trustworthy (S220: a fake
          // "Justin_test Gallivan" matched a real Queen's psychologist). Carried
          // through verifyClaudeSuggestions (which spreads ...suggestion).
          hadAffiliation: !!affiliation,
          expertiseAreas: [],
          isApplicantRecommended: true,
          potentialReviewerId: prId,
          suggestionId: row.wmkf_appreviewersuggestionid,
        });
      }
      if (suggestions.length === 0) {
        sendEvent('complete', { recommended: [] });
        return;
      }

      // 4. Verify in PubMed (publications + expertise).
      const pubmedVerificationContract = DiscoveryService.pubMedVerificationContract({
        searchPubmed: !DiscoveryService.isClearlyNonBiomedicalVerifierArea(proposalInfo.primaryResearchArea),
        proposalInfo,
      });
      sendEvent('progress', {
        message: pubmedVerificationContract.enabled
          ? `Verifying ${suggestions.length} recommended reviewer(s) in PubMed…`
          : `Skipping PubMed verification for ${suggestions.length} recommended reviewer(s) — non-biomedical proposal area`,
      });
      const { verified, unverified } = await DiscoveryService.verifyClaudeSuggestions(
        suggestions,
        (p) => sendEvent('progress', p),
        { searchPubmed: pubmedVerificationContract.enabled, proposalInfo }
      );

      // 5. COI on the FULL set — verified AND unverified. Institution COI works
      //    on unverified rows too (they carry the affiliation fetched above), and
      //    a recommendee who fails PubMed verification must NOT display as
      //    "clean" when their known institution matches the PI's (Codex post-impl).
      let coiChecked = [...verified, ...unverified];

      // S240: resolve the structured PI ONCE — used for both the institution-COI union
      // and the canonical PI name for coauthor COI. Already inside the Dynamics bypass.
      // Fail-open on non-abort errors; abort/budget rethrown.
      let pi = null;
      try {
        pi = await resolveProposalPI(requestId, { signal: deadlineController.signal });
      } catch (err) {
        if (deadlineController.signal.aborted
          || err?.name === 'AbortError'
          || err?.code === 'openalex_timeout'
          || err?.code === 'reviewer_time_budget_exceeded') {
          throw err;
        }
        console.error('[enrich-recommended] PI identity resolution failed (fail-open):', err.message);
      }

      // Institution COI on the applicant-recommended path = FLAG, not drop (S240 D3):
      // the applicant explicitly named these reviewers, so surface a same-institution
      // conflict for the PD rather than silently dropping their pick. Current-affiliation
      // only (no historical), matched against the PI-institution UNION (structured +
      // LLM); falls back to the LLM authorInstitution when the PI is unresolved.
      const recInstitutions = piInstitutions(pi, proposalInfo.authorInstitution);
      if (recInstitutions.length) {
        coiChecked = DeduplicationService.markInstitutionCOI(coiChecked, recInstitutions);
      }

      // Coauthor COI vs PI + co-investigators. `proposalAuthors` is normalized to
      // the PI only (reviewer-finder.js:243); the shared helper folds in
      // `coInvestigators` so a recommendee who co-authored with a listed co-PI is
      // also flagged. discover.js now derives the SAME set (S213 parity closed).
      // S240 parity (Codex #7): appendPiName folds the structured canonical PI name in
      // (append-only, never replaces the LLM PI + co-Is).
      const proposalAuthors = appendPiName(deriveProposalAuthorNames(proposalInfo), pi);
      if (pubmedVerificationContract.enabled && proposalAuthors.length > 0 && coiChecked.length > 0) {
        coiChecked = await DiscoveryService.checkCoauthorshipsForCandidates(
          coiChecked,
          proposalAuthors,
          (p) => sendEvent('progress', p)
        );
      } else if (!pubmedVerificationContract.enabled && proposalAuthors.length > 0 && coiChecked.length > 0) {
        sendEvent('progress', {
          stage: 'coi_check',
          status: 'skipped',
          message: 'Skipped PubMed coauthorship check because this proposal has no PubMed verifier contract',
        });
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
        signal: deadlineController.signal,
        deadlineAt,
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

        // Unconfirmed-identity guard (S220): when the applicant gave no
        // affiliation, a name-only match can be the wrong same-named person (a
        // fake "Justin_test Gallivan" matched a real Queen's psychologist).
        // Trust it only if the identity resolver independently reached ≥probable;
        // otherwise treat the match as UNconfirmed and withhold EVERY
        // match-derived field — email, scholar/ORCID, metrics, affiliation,
        // keywords — from both the writeback and the returned card, so a
        // stranger's data never lands on the person. (Codex S220: the prior
        // guard only nulled affiliation/keywords, so email + metrics still leaked
        // when the resolver returned no verdict, which is exactly the unconfirmed
        // case — `blockByIdentity`/`blockScholar` are false when `identity` null.)
        // (Codex S221: the gate previously also excluded `c.verified === false`
        // rows — but contact enrichment (web/SerpAPI/Scholar) runs on the bare
        // name for verified AND unverified candidates alike, so a PubMed-unverified,
        // no-affiliation row could still leak a same-named stranger's website /
        // faculty page / Scholar metrics. The PubMed-verified flag is irrelevant
        // to the wrong-person risk; only affiliation or a ≥probable resolver
        // verdict disambiguates, so gate on those alone.)
        const identityConfirmed = !!identity && mayPersistIdentity(identity.status);
        const unconfirmedMatch = !c.hadAffiliation && !identityConfirmed;
        if (unconfirmedMatch) {
          sendEvent('progress', { message: `Couldn’t confirm ${c.name} is the right person (applicant gave no affiliation) — leaving their record unchanged.` });
        }

        const blockScholar = scholarSkipped || blockByIdentity || unconfirmedMatch;
        const blockIdentityFields = blockByIdentity || unconfirmedMatch;
        const hIndex = blockScholar ? null : (c.hIndex ?? ce.hIndex ?? null);
        const i10Index = blockScholar ? null : (c.i10Index ?? ce.i10Index ?? null);
        const totalCitations = blockScholar ? null : (c.totalCitations ?? ce.totalCitations ?? null);
        const googleScholarId = blockScholar ? null : (ce.googleScholarId || null);
        const googleScholarUrl = blockScholar ? null : (ce.googleScholarUrl || null);
        const orcidId = blockIdentityFields ? null : (ce.orcidId || null);
        const orcidUrl = blockIdentityFields ? null : (ce.orcidUrl || null);
        // Email: drop it for an unconfirmed match, and ALSO re-run the final
        // persisted address through the name-consistency guard regardless of the
        // tier that produced it — PubMed/affiliation/ORCID-sourced emails bypass
        // the Tier-3/4 filter, so a wrong same-named author's address could still
        // reach Dataverse without this (Codex S220).
        const rawEmail = c.email || ce.email || null;
        const email = (unconfirmedMatch || (rawEmail && !ContactParser.isNameConsistentEmail(rawEmail, c.name)))
          ? null
          : rawEmail;
        const emailSource = email ? (ce.emailSource || null) : null;

        if (prId) {
          try {
            await researcherAdapter.upsertByPotentialReviewer(prId, {
              name: c.name,
              normalizedName: normalizeName(c.name),
              email,
              emailSource,
              orcid: orcidId,
              orcidUrl,
              googleScholarId,
              googleScholarUrl,
              hIndex,
              i10Index,
              totalCitations,
              // Match-derived fields are suppressed for an unconfirmed name-only
              // match so a stranger's affiliation/expertise can't be written.
              affiliation: unconfirmedMatch ? null : (c.affiliation || null),
              department: unconfirmedMatch ? null : (ce.department || null),
              website: unconfirmedMatch ? null : (c.website || ce.website || null),
              facultyPageUrl: unconfirmedMatch ? null : (ce.facultyPageUrl || null),
              keywords: unconfirmedMatch ? null : (Array.isArray(c.expertiseAreas) ? c.expertiseAreas.filter(Boolean).join('; ') : null),
            }, { actingUserSystemId });
            // Persist the resolver decision; clear stale identity fields on downgrade.
            if (identity) {
              // For an unconfirmed name-only match the resolver's anchors +
              // evidence summary can encode a same-named STRANGER's ORCID/Scholar
              // canonicalKey + sourceUrl. writeIdentityDecision persists those in
              // wmkf_identityverifiedanchorsjson, which is NOT in RESOLVER_SOURCED_
              // FIELDS so clearIdentityFields below can't scrub them. Record only
              // the bare 'unresolved' status (useful audit) with anchors/evidence
              // stripped, so a stranger's identifiers never land on this person
              // (Codex S221).
              const decisionToWrite = unconfirmedMatch
                ? { ...identity, anchors: [], evidenceSummary: 'Unconfirmed name-only match (applicant gave no affiliation); identifiers withheld.' }
                : identity;
              await researcherAdapter.writeIdentityDecision(prId, decisionToWrite, { actingUserSystemId });
              if (blockByIdentity) {
                await researcherAdapter.clearIdentityFields(prId, RESOLVER_SOURCED_FIELDS, { actingUserSystemId });
              }
            }
          } catch (err) {
            sendEvent('progress', { message: `Could not save metrics for ${c.name}: ${err.message}` });
          }

          // ORCID back-prop (design §5): if this person is already linked to a
          // contact, flow the just-persisted, identity-gated ORCID onto it now
          // instead of waiting for a later send. The helper enforces eligibility
          // (valid iD + confirmed/probable status); a null/blocked ORCID or a
          // non-promoted person is a clean skip. Non-fatal.
          const contactValue = contactValueByPr.get(prId) || null;
          if (contactValue) {
            try {
              await backPropReviewerOrcidToContact({
                reviewer: {
                  wmkf_orcid: orcidId,
                  wmkf_identitystatus: identity?.status || null,
                  _wmkf_contact_value: contactValue,
                },
                contactId: contactValue,
                actingUserSystemId,
              });
            } catch (bpErr) {
              sendEvent('progress', { message: `Could not back-propagate ORCID for ${c.name}: ${bpErr.message}` });
            }
          }
        }

        // Deterministic COI match reason — SET (not append) so re-click is
        // idempotent. Only when the person actually has COI — and only for a
        // CONFIRMED match (an unconfirmed name-only match computed COI against a
        // possibly-wrong same-named person, so its COI verdict is meaningless).
        if (!unconfirmedMatch && c.suggestionId && (c.hasInstitutionCOI || c.hasCoauthorCOI)) {
          let reason = 'Recommended by applicant (legacy reviewer slot).';
          if (c.hasInstitutionCOI) reason += ' [Institution COI: Same institution as proposal PI]';
          if (c.hasCoauthorCOI) reason += c.coauthorCOIStrength === 'possible'
            ? ' [Possible coauthor overlap: shared paper(s) with proposal author(s) — may be incidental]'
            : ' [Coauthor COI: Has co-authored with proposal authors]';
          try {
            await reviewerSuggestionAdapter.setMatchReason(c.suggestionId, reason, { actingUserSystemId });
          } catch (err) {
            sendEvent('progress', { message: `Could not flag COI for ${c.name}: ${err.message}` });
          }
        }

        // For an unconfirmed name-only match, present the row as needs-review and
        // withhold the (possibly-wrong) matched person's data from the card —
        // never show a stranger's publications/affiliation/email under this name.
        out.push(unconfirmedMatch ? {
          potentialReviewerId: prId || null,
          suggestionId: c.suggestionId || null,
          name: c.name,
          affiliation: null,
          seniorityEstimate: null,
          verified: false,
          unverified: true,
          needsIdentification: true,
          verificationConfidence: null,
          publications: [],
          publicationCount5yr: null,
          reasoning: 'Could not confirm this is the right person — the applicant listed only a name (no affiliation), and a name-only search can match the wrong same-named researcher. Add an affiliation, then re-enrich.',
          hasInstitutionCOI: false,
          hasCoauthorCOI: false,
          institutionCOIDetails: null,
          coauthorships: [],
          institutionMismatch: false,
          suggestedInstitution: null,
          expertiseMismatch: false,
          expertiseAreas: [],
          email: null,
          emailSource: null,
          website: null,
          orcidUrl: null,
          googleScholarUrl: null,
          hIndex: null,
          totalCitations: null,
          isApplicantRecommended: true,
        } : {
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
          emailSource,
          website: c.website || ce.website || null,
          orcidUrl,
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
    if (deadlineController.signal.aborted) {
      const mins = Math.round(budgetSeconds / 60);
      sendEvent('error', {
        message: `Enrichment stopped after exceeding the configured ${mins}-minute time budget. An admin can raise it (up to 13 minutes) under Settings at /admin.`,
        timeout: true,
      });
    } else {
      sendEvent('error', { message: err?.message || 'Failed to enrich recommended reviewers' });
    }
  } finally {
    clearTimeout(deadlineTimer);
  }

  res.end();
}
