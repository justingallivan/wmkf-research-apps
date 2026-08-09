/**
 * Workbench — applicant-recommended reviewer enrichment service (SSE)
 * (Route→Service Consolidation Plan, Stage 4 series B — streaming, on the
 * ratified 2s template).
 *
 * Holds ALL business logic for POST /api/workbench/enrich-recommended; the
 * route is a thin streaming shell (method dispatch, auth, rate limit, model
 * warm, GUID 400, SSE framing + res.end). Contract (Decision 1a + P1s):
 *   - emits every SSE event through `onEvent({ event, data })` — the shell
 *     owns headers, `event:`/`data:` serialization, and `res.end()`;
 *   - NEVER touches `res`;
 *   - NEVER THROWS for flow errors: terminal failures (time-budget abort,
 *     pipeline throw, pre-pipeline aborts) emit ONE `error` event and RESOLVE;
 *   - ASSUMES a trusted DAL context already exists — never establishes one.
 *
 * Pipeline (unchanged from the route): applicant-recommended junction rows →
 * proposalInfo (client analysisResult or blob analysis; fail loud without
 * authors/institution) → PubMed verification → institution + coauthor COI
 * (flag, not drop — S240 D3) → contact/bibliometric enrichment
 * (persist:false) → id-keyed writeback with the S220/S221 unconfirmed-match
 * and identity-resolver gates → deterministic COI match reason (SET, not
 * append) → durable roster persistence → `complete { recommended }`.
 */

import { safeFetch } from '../../utils/safe-fetch';
import { normalizeName } from '../../utils/name-normalization';
import { ContactParser } from '../../utils/contact-parser';
import { deriveProposalAuthorNames } from '../../utils/proposal-authors';
import { resolveProposalPI, appendPiName, piInstitutions } from '../proposal-pi-identity';
import { ClaudeReviewerService } from '../claude-reviewer-service';
import { DiscoveryService } from '../discovery-service';
import { DeduplicationService } from '../deduplication-service';
import { ContactEnrichmentService } from '../contact-enrichment-service';
import { OpenAlexService } from '../openalex-service';
import * as reviewerSuggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import * as researcherAdapter from '../../dataverse/adapters/researcher';
import * as potentialReviewerAdapter from '../../dataverse/adapters/potential-reviewer';
import { mayPersistIdentity } from '../reviewer-identity-resolver';
import { createInstitutionConsistencyChecker } from '../institution-affiliation-consistency';
import { createInstitutionIdentityResolver } from '../institution-identity-resolver';
import { backPropReviewerOrcidToContact } from '../backprop-reviewer-orcid';
import { getReviewerTimeBudgetSeconds } from '../reviewer-time-budget';
import { loadReviewerRequestContext } from '../reviewer-request-context';
import {
  APPLICANT_ENRICHMENT_CACHE_VERSION,
  pruneCandidateForRoster,
} from '../../../shared/components/reviewers/reviewer-search-logic';
import { findCandidateBySuggestion, recordSurfaced } from '../reviewer-roster-store';
import { reviewerSuggestionCandidateKey } from '../../utils/reviewer-candidate-key';
import { loadApplicantKnownReviewerContext } from './applicant-known-reviewer-service';
import { projectCanonicalApplicantContact } from '../../utils/applicant-known-reviewer';
import {
  addressConflictDisposition,
  addressTrustDecision,
  createConflictPendingState,
} from '../../utils/reviewer-address-trust';
import { reviewerEngagementProjection } from '../../../shared/utils/reviewer-engagement';

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

function throwIfDeadlineAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason || Object.assign(new Error('reviewer_time_budget_exceeded'), { code: 'reviewer_time_budget_exceeded' });
}

function hasServerIdentityConfirmation(candidate) {
  const confirmationId = candidate?.pdIdentityConfirmationId;
  return candidate?.pdIdentityConfirmed === true
    && typeof confirmationId === 'string'
    && confirmationId.length > 0
    && candidate?.staffIdentityConfirmation?.confirmationId === confirmationId;
}

function suggestionSnapshotKey(suggestionId) {
  return typeof suggestionId === 'string' && suggestionId.trim()
    ? suggestionId.trim().toLowerCase()
    : null;
}

function institutionNames(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

function resolvedIdentityInstitutions(candidate = {}, enrichment = {}) {
  return institutionNames([
    candidate.affiliation,
    enrichment.orcidAffiliation,
    enrichment.openAlexAffiliation,
    ...(Array.isArray(enrichment.tierResults?.orcid?.affiliations)
      ? enrichment.tierResults.orcid.affiliations.map((affiliation) => affiliation?.organization)
      : []),
  ]);
}

function hydrationFailureCandidate(row, applicantKnownReviewer, proposalKey) {
  const code = applicantKnownReviewer?.code || 'person_unavailable';
  const reason = code === 'person_inactive'
    ? 'The exact applicant-linked reviewer record is inactive and must be repaired before selection.'
    : code === 'email_conflict'
      ? 'The exact applicant-linked reviewer has an ambiguous or conflicting stored email owner.'
      : 'The exact applicant-linked reviewer record could not be loaded. Retry before selection.';
  return {
    potentialReviewerId: row?._wmkf_potentialreviewer_value || null,
    suggestionId: row?.wmkf_appreviewersuggestionid || null,
    enrichedProposalKey: proposalKey,
    name: applicantKnownReviewer?.name
      || row?._wmkf_potentialreviewer_value_formatted
      || row?.wmkf_name
      || 'Applicant-recommended reviewer',
    affiliation: applicantKnownReviewer?.affiliation || null,
    isApplicantRecommended: true,
    applicantKnownReviewer,
    identityStatus: 'unresolved',
    verificationStatus: 'unresolved',
    needsIdentification: true,
    verified: false,
    unverified: true,
    reasoning: reason,
    email: null,
    emailSource: null,
    contactEnrichment: {
      contactStatus: 'unresolved',
      contactStatusReason: code,
      identity: { status: 'unresolved' },
      email: null,
      emailSource: null,
      emailPersistAllowed: false,
    },
  };
}

function canonicalizeApplicantCandidates(candidates) {
  return (Array.isArray(candidates) ? candidates : []).map((candidate) => ({
    ...candidate,
    candidateKey: reviewerSuggestionCandidateKey(candidate?.suggestionId),
  }));
}

function completionPayload(recommended, handled) {
  const payload = { recommended: canonicalizeApplicantCandidates(recommended) };
  if (handled.length > 0) payload.handled = canonicalizeApplicantCandidates(handled);
  return payload;
}

export async function institutionEvidenceConnectsIdentity({
  evidenceInstitution,
  resolvedInstitutions,
  finalAffiliation,
  legacyChecker,
  stagedChecker,
  signal,
}) {
  if (!evidenceInstitution || !finalAffiliation) return null;
  if (resolvedInstitutions.some((resolvedInstitution) =>
    DeduplicationService.institutionDirectMatch(evidenceInstitution, resolvedInstitution))) {
    return true;
  }
  // NOTE (S400 review; Wave 6 2026-08-09; Codex round-6 composite fix
  // 2026-08-09): raw PubMed byline evidence ("Department of X, <Institution>,
  // City, ST, USA") used to defeat both the direct matcher and OpenAlex
  // resolution, so same-institution pairs compared false — the known
  // false-mismatch class attributed in the S400 capture (e.g. request
  // 1002912, "Lunenfeld-Tanenbaum Research Institute" byline vs
  // "Lunenfeld-Tanenbaum Research Institute, University of Toronto" recorded
  // affiliation). An earlier core-extraction fallback was built and
  // REVERTED: the borrowed aggregation-key extractor collapsed
  // comma-qualified sibling institutions (UC San Diego/San Francisco) into
  // false CONSISTENTs, which would clear identityNeedsReview and enable
  // writes for a wrong identity. False negatives are tolerable at this seam;
  // false positives are not.
  //
  // Two checkers are evaluated here, in sequence, and a clear from EITHER is
  // accepted (Codex round-6 finding, owner-approved "compose, don't choose"):
  // `legacyChecker` (opt default) preserves the pre-existing one-hop
  // associated-link corroboration (`institutionsConsistent`'s
  // associatedIdentityMatches) — the evidence that clears the VUMC-class
  // pair ("Vanderbilt University Medical Center" byline vs "Vanderbilt
  // University" recorded affiliation, related-but-distinct entities common
  // in biomedical hospital-vs-university affiliations). A staged-only checker
  // at this seam (the brief Wave 6 flip) dropped that corroboration and
  // regressed the VUMC class, turning `institutionContradicted` true and
  // blocking email/ORCID/metrics/researcher writes for a correct identity.
  // `stagedChecker` (the opt-in comparison mode, constructed with the
  // segment-comparison option) is a conservative segment-whole extractor —
  // exact segment match plus decoration proof, never free core extraction —
  // and it is what clears the Lunenfeld/Sicheri class above. Its
  // sibling-institution false pins (the 148-row uc-sibling live suite) are
  // the evidence that this widening does not reopen the reverted hazard; see
  // docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md Stage 1 for the full
  // mechanism and gate history, and the Wave 6 section for the round-6
  // composite-fix rationale. The union is strictly additive versus
  // pre-Wave-6 production: every clear the legacy arm alone produced still
  // clears; the only NEW clears are the staged arm's decoration clears.
  //
  // Sequential, not parallel: legacy runs first so a clear there skips the
  // staged arm's provider traffic entirely. Neither arm's failure is
  // swallowed into the other's success or into a bare `false` — a `throw`
  // from EITHER checker propagates unchanged to the caller's fail-closed
  // catch (a comparison outage must read as "could not complete", never as
  // an affirmative contradiction).
  if (await legacyChecker.areConsistent(evidenceInstitution, finalAffiliation, { signal })) {
    return true;
  }
  return stagedChecker.areConsistent(evidenceInstitution, finalAffiliation, { signal });
}

function clipInstitutionForCopy(value, max = 140) {
  const text = String(value || '').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Human-readable institution-verdict reason, honest about provenance: an
 * affirmative contradiction names BOTH compared institutions; a comparison
 * error says the check could not complete (fail-closed, not evidence); a
 * carried prior flag says so. Never claims "PubMed shows a different
 * institution" without naming it (S399 finding 1).
 */
export function institutionVerdictReason({ contradictionSource, contradictedEvidence, finalAffiliation }) {
  if (contradictionSource === 'comparison_error') {
    return 'the institution comparison could not be completed, so the match is treated as unverified';
  }
  // "recorded affiliation", not "listed": finalAffiliation is
  // c.affiliation || ce.affiliation, which an ORCID/OpenAlex enrichment
  // override may have replaced — it is not necessarily the applicant-listed
  // institution (Codex S400 review, MEDIUM).
  if (contradictionSource === 'compared' && contradictedEvidence && finalAffiliation) {
    return `the matched publications place them at “${clipInstitutionForCopy(contradictedEvidence)}”, which could not be reconciled with their recorded affiliation “${clipInstitutionForCopy(finalAffiliation)}”`;
  }
  if (contradictionSource === 'prior_flag') {
    return 'an earlier verification pass raised an institution concern, but their institution could not be compared this run, so it remains unresolved';
  }
  return 'the matched publications contradict the listed institution';
}

async function persistRecommendedRoster({
  requestId,
  proposalKey,
  candidates,
  signal,
  expectedUpdatedAtBySuggestion,
}) {
  const outcome = { attempted: 0, recorded: 0, skipped: 0 };
  if (!proposalKey || !requestId || !Array.isArray(candidates) || candidates.length === 0) return outcome;
  throwIfDeadlineAborted(signal);
  for (const candidate of candidates) {
    throwIfDeadlineAborted(signal);
    try {
      const pruned = pruneCandidateForRoster({
        ...candidate,
        enrichedProposalKey: proposalKey,
        applicantEnrichmentCacheVersion: APPLICANT_ENRICHMENT_CACHE_VERSION,
      });
      if (!pruned?.name) continue;
      outcome.attempted += 1;
      const snapshotKey = suggestionSnapshotKey(pruned.suggestionId);
      const guarded = snapshotKey && expectedUpdatedAtBySuggestion?.has(snapshotKey);
      const recorded = await recordSurfaced(
        requestId,
        [pruned],
        guarded ? { expectedUpdatedAt: expectedUpdatedAtBySuggestion.get(snapshotKey) } : {},
      );
      outcome.recorded += recorded;
      if (recorded === 0) {
        outcome.skipped += 1;
        console.warn(
          '[enrich-recommended] roster persist preserved a newer or terminal row:',
          candidate?.name || 'unknown',
        );
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      outcome.skipped += 1;
      console.error('[enrich-recommended] roster persist failed:', candidate?.name || 'unknown', err?.message || err);
    }
  }
  return outcome;
}

/**
 * Enrich a request's applicant-recommended reviewers, streaming events
 * through `onEvent({ event, data })`. Always resolves; terminal failures
 * emit one `error` event first (2s template).
 *
 * @param {Object} args
 * @param {string} args.requestId - GUID (already validated by the shell)
 * @param {string|undefined} args.blobUrl
 * @param {Object|undefined} args.analysisResult - client's prior search analysis
 * @param {string|null} args.proposalKey - sanitized roster key
 * @param {string|undefined} args.apiKey - CLAUDE_API_KEY
 * @param {string|null} args.actingUserSystemId
 * @param {string|number|null} args.userProfileId
 * @param {function({event: string, data: object}): void} onEvent
 * @returns {Promise<void>}
 */
export async function enrichRecommended({
  requestId, blobUrl, analysisResult, proposalKey, apiKey, actingUserSystemId, userProfileId,
}, onEvent) {
  const sendEvent = (event, data) => onEvent({ event, data });

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
    // 1. Load this request's applicant-RECOMMENDED junction rows.
    const recommendedRows = await reviewerSuggestionAdapter.findApplicantRecommendedByRequest(requestId);
    if (recommendedRows.length === 0) {
      sendEvent('complete', { recommended: [] });
      return;
    }
    const handled = [];
    const actionableRows = [];
    for (const row of recommendedRows) {
      const engagement = reviewerEngagementProjection(row);
      if (!engagement.handled) {
        actionableRows.push(row);
        continue;
      }
      const suggestionId = row.wmkf_appreviewersuggestionid || null;
      handled.push({
        suggestionId,
        name: row._wmkf_potentialreviewer_value_formatted || row.wmkf_name || 'Applicant-recommended reviewer',
        stage: engagement.stage,
      });
    }
    if (actionableRows.length === 0) {
      sendEvent('complete', completionPayload([], handled));
      return;
    }

    // Preserve authenticated staff confirmations across every automated rerun.
    // A retry may be manual, or automatic because a legacy/partial cache is
    // incomplete. In either case, replacing a confirmed row with fresh automated
    // output would discard the actor-bound confirmation and manual contact. Read
    // the canonical server row first, carry confirmed rows forward unchanged, and
    // enrich only the remaining suggestions.
    const preservedConfirmed = [];
    const rowsToEnrich = [];
    const expectedUpdatedAtBySuggestion = new Map();
    for (const row of actionableRows) {
      const suggestionId = row.wmkf_appreviewersuggestionid;
      let existing = null;
      if (suggestionId) {
        existing = await findCandidateBySuggestion(requestId, suggestionId);
        expectedUpdatedAtBySuggestion.set(
          suggestionSnapshotKey(suggestionId),
          existing?.rosterUpdatedAt || null,
        );
      }
      if (hasServerIdentityConfirmation(existing)) {
        const prId = row._wmkf_potentialreviewer_value;
        const refreshedKnownReviewer = prId
          ? (await loadApplicantKnownReviewerContext(prId)).applicantKnownReviewer
          : null;
        const applicantKnownReviewer = (
          refreshedKnownReviewer?.status === 'unavailable'
          && existing?.applicantKnownReviewer?.status === 'known'
        )
          ? existing.applicantKnownReviewer
          : refreshedKnownReviewer;
        if (refreshedKnownReviewer?.status === 'unavailable') {
          sendEvent('progress', {
            stage: 'applicant_hydration',
            status: 'failed',
            suggestionId: suggestionId || null,
            potentialReviewerId: prId || null,
            code: refreshedKnownReviewer.code || 'person_unavailable',
            message: `${existing?.name || 'Applicant-recommended reviewer'} could not be re-read from Dataverse; the prior actor-confirmed roster evidence was preserved for retry.`,
          });
        }
        preservedConfirmed.push({
          ...existing,
          candidateKey: reviewerSuggestionCandidateKey(suggestionId),
          suggestionId,
          enrichedProposalKey: proposalKey,
          isApplicantRecommended: true,
          applicantKnownReviewer,
        });
      } else {
        rowsToEnrich.push(row);
      }
    }
    if (rowsToEnrich.length === 0) {
      const rosterOutcome = await persistRecommendedRoster({
        requestId,
        proposalKey,
        candidates: preservedConfirmed,
        signal: deadlineController.signal,
        expectedUpdatedAtBySuggestion,
      });
      if (rosterOutcome.skipped > 0) {
        sendEvent('progress', { message: `${rosterOutcome.skipped} reviewer row(s) changed while enrichment was running and were left unchanged.` });
      }
      sendEvent('complete', completionPayload(preservedConfirmed, handled));
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
      const requestContext = await loadReviewerRequestContext(requestId);
      const analysis = await ClaudeReviewerService.analyzeProposal(text, apiKey, {
        reviewerCount: 1, // we don't use the suggestions here, only proposalInfo
        analysisPurpose: 'proposal_info',
        userProfileId,
        signal: deadlineController.signal,
        deadlineAt,
        requestContext,
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
    const hydrationFailures = [];
    const contactValueByPr = new Map();
    for (const row of rowsToEnrich) {
      const prId = row._wmkf_potentialreviewer_value;
      const fallbackName = row._wmkf_potentialreviewer_value_formatted || row.wmkf_name || null;
      if (!prId) {
        const applicantKnownReviewer = {
          status: 'unavailable',
          code: 'person_unavailable',
          potentialReviewerId: null,
          name: fallbackName,
          affiliation: null,
          email: null,
          emailSource: null,
          emailReadiness: { level: 'low', action: 'missing', reason: 'No email address found' },
          orcid: null,
          contactLinked: false,
        };
        hydrationFailures.push(hydrationFailureCandidate(row, applicantKnownReviewer, proposalKey));
        sendEvent('progress', {
          stage: 'applicant_hydration',
          status: 'failed',
          suggestionId: row.wmkf_appreviewersuggestionid || null,
          potentialReviewerId: null,
          code: 'person_unavailable',
          message: `${fallbackName || 'An applicant-recommended reviewer'} has no linked person record.`,
        });
        continue;
      }
      const { applicantKnownReviewer, contactId } = await loadApplicantKnownReviewerContext(prId);
      if (applicantKnownReviewer.status !== 'known') {
        hydrationFailures.push(hydrationFailureCandidate(row, applicantKnownReviewer, proposalKey));
        sendEvent('progress', {
          stage: 'applicant_hydration',
          status: 'failed',
          suggestionId: row.wmkf_appreviewersuggestionid || null,
          potentialReviewerId: prId,
          code: applicantKnownReviewer.code || 'person_unavailable',
          message: `${applicantKnownReviewer.name || fallbackName || 'Applicant-recommended reviewer'} could not be safely hydrated from Dataverse.`,
        });
        continue;
      }
      const name = applicantKnownReviewer.name || fallbackName;
      if (!name) {
        hydrationFailures.push(hydrationFailureCandidate(row, applicantKnownReviewer, proposalKey));
        continue;
      }
      const affiliation = applicantKnownReviewer.affiliation;
      if (contactId) contactValueByPr.set(prId, contactId);
      suggestions.push({
        name,
        affiliation,
        // Preserve the listed/stored institution separately: PubMed verification
        // replaces `affiliation` with the matched author's affiliation and needs
        // this claimed value to detect an actual contradiction.
        suggestedInstitution: affiliation,
        hadAffiliation: !!affiliation,
        expertiseAreas: [],
        isApplicantRecommended: true,
        applicantKnownReviewer,
        orcid: applicantKnownReviewer.orcid || null,
        potentialReviewerId: prId,
        suggestionId: row.wmkf_appreviewersuggestionid,
      });
    }
    if (suggestions.length === 0) {
      const out = canonicalizeApplicantCandidates([...preservedConfirmed, ...hydrationFailures]);
      const rosterOutcome = await persistRecommendedRoster({
        requestId,
        proposalKey,
        candidates: out,
        signal: deadlineController.signal,
        expectedUpdatedAtBySuggestion,
      });
      if (rosterOutcome.skipped > 0) {
        sendEvent('progress', { message: `${rosterOutcome.skipped} reviewer row(s) changed while enrichment was running and were left unchanged.` });
      }
      sendEvent('complete', completionPayload(out, handled));
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
    // and the canonical PI name for coauthor COI. Already inside the trusted context.
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
      coiChecked = await DeduplicationService.markInstitutionCOIResolved(
        coiChecked,
        recInstitutions,
        { signal: deadlineController.signal },
      );
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
        (p) => sendEvent('progress', p),
        { signal: deadlineController.signal }
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
    // One shared resolver instance backs BOTH checker configurations so live
    // OpenAlex calls aren't doubled per candidate (mirrors
    // benchmarks/institution-pair-consistency/run-pair-gates.js's two-arm
    // pattern). Both checkers are constructed per-run, function-locally, here
    // — their (shared) resolver cache dies with this pipeline run; nothing
    // survives across requests.
    const sharedInstitutionResolver = createInstitutionIdentityResolver();
    const legacyInstitutionChecker = createInstitutionConsistencyChecker({ resolver: sharedInstitutionResolver });
    const stagedInstitutionChecker = createInstitutionConsistencyChecker({ resolver: sharedInstitutionResolver, segmentComparison: true });

    // Slice 1 contact-leads audit (REVIEWER_CONTACT_LEADS_SPEC §6): structured
    // log of the missing-email reason buckets so the dominant-bucket split is
    // observable in logs before any UI lands. Names only — no proposal content.
    if (enrichResult?.stats?.contactAudit) {
      console.log('[enrich-recommended] contact-leads audit:', JSON.stringify(enrichResult.stats.contactAudit));
    }

    // 7 + 8. Writeback per person: sidecar metrics/contact (id-keyed, race-safe)
    //         + deterministic COI match-reason on the junction row.
    const out = [...preservedConfirmed, ...hydrationFailures];
    for (const c of enriched) {
      const prId = c.potentialReviewerId;
      const ce = c.contactEnrichment || {};
      const eligibilityStatus = c.eligibilityStatus || ce.eligibilityStatus || 'unknown';
      if (eligibilityStatus === 'deceased') {
        // Preserve the evidence in the durable roster/dedup ledger, but do not
        // write contact, identity, metrics, or COI updates to the existing
        // applicant-recommended person and never return it as selectable.
        out.push({
          potentialReviewerId: prId || null,
          suggestionId: c.suggestionId || null,
          enrichedProposalKey: proposalKey,
          name: c.name,
          affiliation: c.affiliation || ce.affiliation || null,
          isApplicantRecommended: true,
          applicantKnownReviewer: c.applicantKnownReviewer || null,
          eligibilityStatus: 'deceased',
          eligibilityReason: c.eligibilityReason || ce.eligibilityReason || null,
          eligibilityEvidence: c.eligibilityEvidence || ce.eligibilityEvidence || null,
          contactEnrichment: {
            eligibilityStatus: 'deceased',
            eligibilityReason: c.eligibilityReason || ce.eligibilityReason || null,
            eligibilityEvidence: c.eligibilityEvidence || ce.eligibilityEvidence || null,
          },
        });
        continue;
      }
      // Identity gate (Phase 2 — REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md).
      // Applicant-supplied or previously stored affiliation is a search hint, not
      // an identity verdict: it can itself belong to a namesake or be stale. Require
      // the resolver to reach ≥probable and reject an explicit PubMed institution
      // contradiction before any matched contact, affiliation, bibliometrics, COI,
      // or identifiers can be written or shown.
      const scholarSkipped = !!ce.tierResults?.openalex_author?.skipped;
      const identity = ce.identity || null;
      const identityConfirmed = !!identity && mayPersistIdentity(identity.status);
      // `affiliationHistory` is current-run verifier evidence carried through
      // enrichment unchanged: PubMed bylines on the biomedical path, ORCID
      // employment on the identity-spine path. The former is independent of
      // enrichment; the latter provides only cross-resolver coherence. Keeping
      // it separate prevents a stored primary affiliation from being the sole
      // evidence after an earlier automated match contaminated that field.
      const verificationInstitution = Array.isArray(c.affiliationHistory) && c.affiliationHistory.length > 0
        ? (ce.priorAffiliation || c.affiliationHistory[0])
        : null;
      const finalAffiliation = c.affiliation || ce.affiliation || null;
      const resolvedInstitutions = resolvedIdentityInstitutions(c, ce);
      let institutionContradicted = c.institutionMismatch === true;
      // Verdict provenance for honest copy: 'prior_flag' (carried from
      // verification with no decided comparison this run), 'compared' (a
      // decided comparison contradicted), or 'comparison_error' (fail-closed
      // catch). Distinct copy per source — an error must never read as an
      // affirmative contradiction claim (S399 finding 1).
      let contradictionSource = institutionContradicted ? 'prior_flag' : null;
      let contradictedEvidence = null;
      try {
        const comparisons = [];
        // Current-run verifier evidence outranks the applicant/stored institution.
        // Comparing both let one stale prior affiliation veto a coherent current
        // PubMed/ORCID match. When the verifier has no institution, retain the
        // listed institution as the fail-closed fallback.
        const evidenceInstitutions = institutionNames([
          verificationInstitution || c.suggestedInstitution,
        ]);
        for (const evidenceInstitution of evidenceInstitutions) {
          comparisons.push(await institutionEvidenceConnectsIdentity({
            evidenceInstitution,
            resolvedInstitutions,
            finalAffiliation,
            legacyChecker: legacyInstitutionChecker,
            stagedChecker: stagedInstitutionChecker,
            signal: deadlineController.signal,
          }));
        }
        const decidedComparisons = comparisons.filter((value) => value !== null);
        if (decidedComparisons.length > 0) {
          institutionContradicted = decidedComparisons.some((value) => value === false);
          contradictionSource = institutionContradicted ? 'compared' : null;
          contradictedEvidence = institutionContradicted
            ? evidenceInstitutions[comparisons.indexOf(false)] || null
            : null;
        }
      } catch (err) {
        if (deadlineController.signal.aborted) throw err;
        // A comparison was required but could not be completed. Fail closed so a
        // provider outage cannot turn a late namesake substitution into a write.
        institutionContradicted = true;
        contradictionSource = 'comparison_error';
        sendEvent('progress', { message: `Could not reconcile institution affiliations for ${c.name}: ${err.message}` });
      }
      // Durable verdict observability (S399 finding 2): one compact line per
      // candidate so Vercel runtime logs can attribute any verdict without
      // re-instrumenting. No network calls; institution strings clipped.
      console.log('[institution-verdict]', JSON.stringify({
        suggestionId: c.suggestionId || null,
        identityConfirmed,
        institutionContradicted,
        contradictionSource,
        evidence: clipInstitutionForCopy(contradictedEvidence || verificationInstitution || c.suggestedInstitution || ''),
        finalAffiliation: clipInstitutionForCopy(finalAffiliation || ''),
      }));
      const identityNeedsReview = !identityConfirmed || institutionContradicted;
      if (identityNeedsReview) {
        const reason = !identityConfirmed
          ? 'the identity resolver did not establish a probable match'
          : institutionVerdictReason({ contradictionSource, contradictedEvidence, finalAffiliation });
        sendEvent('progress', { message: `Couldn’t confirm ${c.name} is the right person (${reason}) — leaving their record unchanged.` });
      }

      const blockScholar = scholarSkipped || identityNeedsReview;
      const blockIdentityFields = identityNeedsReview;
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
      // reach Dataverse without this (Codex S220). The structured scholarly
      // tier is the exception: it already proved address ownership from the
      // full-name-matched author's own institution-corroborated affiliation, so
      // opaque local parts must not be discarded by a weaker lexical heuristic.
      const rawEmail = c.email || ce.email || null;
      const scholarlyOwnershipGrounded = (
        ce.emailSource === 'scholarly_multi'
        || ce.emailSource === 'scholarly_single'
      ) && rawEmail === ce.email;
      const enrichedEmail = (identityNeedsReview || (
        rawEmail
        && !scholarlyOwnershipGrounded
        && !ContactParser.isNameConsistentEmail(rawEmail, c.name)
      ))
        ? null
        : rawEmail;
      const enrichedEmailSource = enrichedEmail ? (ce.emailSource || null) : null;
      const canonicalContact = projectCanonicalApplicantContact({
        applicantKnownReviewer: c.applicantKnownReviewer,
        candidate: {
          ...c,
          email: enrichedEmail,
          contactEnrichment: { ...ce, email: enrichedEmail },
        },
      });
      let applicantContactMismatch = canonicalContact.decision === 'contact_claim_mismatch';
      const email = canonicalContact.email || enrichedEmail;
      const emailSource = canonicalContact.email
        ? canonicalContact.emailSource
        : enrichedEmailSource;
      // A source describes one specific address. When enrichment found B but
      // the exact canonical person stores A, never pass B's source into the
      // fill/upgrade writer for A.
      const writebackEmail = applicantContactMismatch ? null : enrichedEmail;
      const storedCanonicalEmail = String(c.applicantKnownReviewer?.email || '').trim().toLowerCase();
      const writebackEmailSource = (
        !applicantContactMismatch
        && storedCanonicalEmail
        && storedCanonicalEmail === String(enrichedEmail || '').trim().toLowerCase()
      )
        ? enrichedEmailSource
        : null;
      let applicantKnownReviewer = c.applicantKnownReviewer || null;
      let addressConflictPending = false;
      let conflictRecordUnavailable = false;
      let resolvedAddressPair = false;
      if (applicantContactMismatch) {
        // A confirmed exact-person lookup plus an independently enriched,
        // persist-worthy contradictory address is durable safety state. Record
        // it on the person immediately so every request and every send path
        // fails closed until staff resolves the exact address.
        if (prId && enrichedEmail && storedCanonicalEmail && ce.emailPersistAllowed === true) {
          try {
            const currentPerson = await potentialReviewerAdapter.getById(prId);
            if (!currentPerson?._etag) throw new Error('Exact reviewer version is unavailable');
            const currentTrust = addressTrustDecision(currentPerson);
            const disposition = addressConflictDisposition(currentTrust.state, {
              email: currentPerson.wmkf_emailaddress,
              foundEmail: enrichedEmail,
              reason: 'email_mismatch',
            });
            if (disposition === 'resolved') {
              applicantContactMismatch = false;
              resolvedAddressPair = true;
            } else {
              let conflictState = disposition === 'existing' ? currentTrust.state : null;
              if (disposition === 'write') {
                conflictState = createConflictPendingState({
                  currentState: currentTrust.state,
                  email: currentPerson.wmkf_emailaddress,
                  reason: 'email_mismatch',
                  foundEmail: enrichedEmail,
                  source: enrichedEmailSource,
                  requestId,
                  candidateKey: reviewerSuggestionCandidateKey(c.suggestionId) || c.candidateKey || `person:${prId}`,
                });
                await potentialReviewerAdapter.update(prId, {
                  addressTrustStateJson: JSON.stringify(conflictState),
                }, {
                  actingUserSystemId,
                  ifMatch: currentPerson._etag,
                });
              }
              addressConflictPending = true;
              applicantKnownReviewer = {
                ...applicantKnownReviewer,
                addressTrustVerified: false,
                addressConflictPending: true,
                emailReadiness: {
                  level: 'low',
                  action: 'blocked',
                  reason: 'Stored and newly found addresses conflict and require resolution',
                },
              };
            }
          } catch (err) {
            conflictRecordUnavailable = true;
            sendEvent('progress', {
              stage: 'applicant_hydration',
              status: 'failed',
              suggestionId: c.suggestionId || null,
              potentialReviewerId: prId || null,
              code: 'conflict_record_unavailable',
              message: `The address conflict for ${c.name} could not be recorded. Retry or create a repair request.`,
            });
          }
        }
        if (applicantContactMismatch && !conflictRecordUnavailable) {
          sendEvent('progress', {
            stage: 'applicant_hydration',
            status: 'failed',
            suggestionId: c.suggestionId || null,
            potentialReviewerId: prId || null,
            code: 'contact_claim_mismatch',
            message: `Stored and newly enriched email claims disagree for ${c.name}; neither address was changed.`,
          });
        }
      }

      // A rejected B address from an already-adjudicated A/B pair is retained
      // only as historical server evidence. The active browser DTO must project
      // canonical A consistently at both email layers; otherwise the shared
      // promotion policy reconstructs a mismatch that the durable trust state
      // has already resolved.
      const projectedEnrichmentEmail = resolvedAddressPair ? email : enrichedEmail;
      const projectedEnrichmentEmailSource = resolvedAddressPair ? emailSource : enrichedEmailSource;
      const projectedEmailPersistAllowed = resolvedAddressPair
        ? false
        : (ce.emailPersistAllowed === true && !!enrichedEmail);

      // 5-year publication count. Applicant-recommended rows skip PubMed/preprint
      // discovery, so they arrive with no publications list and would otherwise show
      // a FALSE "0 publications" next to a real h-index (e.g. Paul Corkum, h-index 108).
      // Backfill the count from the OpenAlex author we already resolved for the metrics:
      // the same window as DiscoveryService.countRecentPublications (year >= currentYear-5)
      // via getWorksByAuthor's from_publication_date filter, one count-only query
      // (per-page 1, reads meta.count). Gated on `blockScholar` like the other metrics so
      // an unconfirmed/wrong-person match never shows a stranger's count. Best-effort: a
      // failure leaves it null and the card falls back to its prior behavior.
      const openAlexAuthorId = blockScholar ? null : (ce.tierResults?.openalex_author?.openAlexId || null);
      let publicationCount5yr = Number.isFinite(c.publicationCount5yr) ? c.publicationCount5yr : null;
      if (publicationCount5yr == null && openAlexAuthorId) {
        try {
          const yearFrom = new Date().getFullYear() - DiscoveryService.YEARS_LOOKBACK;
          const { totalCount } = await OpenAlexService.getWorksByAuthor(openAlexAuthorId, {
            yearFrom, limit: 1, signal: deadlineController.signal,
          });
          if (Number.isFinite(totalCount)) publicationCount5yr = totalCount;
        } catch (err) {
          if (deadlineController.signal.aborted) throw err;
          sendEvent('progress', { message: `Could not fetch publication count for ${c.name}: ${err.message}` });
        }
      }

      // Rejected/ambiguous matches do not touch the existing Dataverse person at
      // all. This preserves any prior staff-entered contact/identity data and
      // avoids even fill-only affiliation or audit-timestamp writes from a
      // possibly wrong namesake.
      if (prId && !identityNeedsReview) {
        try {
          await researcherAdapter.upsertByPotentialReviewer(prId, {
            name: c.name,
            normalizedName: normalizeName(c.name),
            email: writebackEmail,
            emailSource: writebackEmailSource,
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
          // Only a persist-worthy verdict reaches this branch.
          if (identity) {
            await researcherAdapter.writeIdentityDecision(prId, identity, {
              actingUserSystemId,
              identityOrigin: 'automated',
            });
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
      if (!identityNeedsReview && c.suggestionId && (c.hasInstitutionCOI || c.hasCoauthorCOI)) {
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

      // For an unresolved or institution-contradicted match, present the row as
      // needs-review and
      // withhold the (possibly-wrong) matched person's data from the card —
      // never show a stranger's publications/affiliation/email under this name.
      out.push(identityNeedsReview ? {
        potentialReviewerId: prId || null,
        suggestionId: c.suggestionId || null,
        enrichedProposalKey: proposalKey,
        name: c.name,
        affiliation: null,
        seniorityEstimate: null,
        verified: false,
        unverified: true,
        needsIdentification: true,
        identityStatus: 'unresolved',
        verificationStatus: 'unresolved',
        verificationConfidence: null,
        publications: [],
        publicationCount5yr: null,
        reasoning: !identityConfirmed
          ? 'Could not confirm this is the right person because the identity resolver did not establish a probable match. Confirm or correct the identity before selecting this reviewer.'
          : `Could not confirm this is the right person because ${institutionVerdictReason({ contradictionSource, contradictedEvidence, finalAffiliation })}. Confirm or correct the identity before selecting this reviewer.`,
        hasInstitutionCOI: false,
        hasCoauthorCOI: false,
        institutionCOIDetails: null,
        coauthorships: [],
        institutionMismatch: institutionContradicted,
        suggestedInstitution: c.suggestedInstitution || null,
        expertiseMismatch: false,
        expertiseAreas: [],
        email: null,
        emailSource: null,
        contactEnrichment: {
          identity: { status: 'unresolved' },
          email: null,
          emailSource: null,
          emailPersistAllowed: false,
        },
        website: null,
        orcidUrl: null,
        googleScholarUrl: null,
        hIndex: null,
        totalCitations: null,
        isApplicantRecommended: true,
        applicantKnownReviewer,
        applicantContactMismatch,
        addressConflictPending,
        conflictRecordUnavailable,
        eligibilityStatus,
        eligibilityReason: c.eligibilityReason || ce.eligibilityReason || null,
        eligibilityEvidence: c.eligibilityEvidence || ce.eligibilityEvidence || null,
      } : {
        potentialReviewerId: prId || null,
        suggestionId: c.suggestionId || null,
        enrichedProposalKey: proposalKey,
        name: c.name,
        identityStatus: identity.status,
        needsIdentification: false,
        affiliation: c.affiliation || null,
        seniorityEstimate: c.seniorityEstimate || null,
        verified: c.verified !== false,
        unverified: c.verified === false,
        verificationConfidence: typeof c.verificationConfidence === 'number' ? c.verificationConfidence : null,
        publications: Array.isArray(c.publications) ? c.publications : [],
        publicationCount5yr,
        reasoning: c.reasoning || c.generatedReasoning || null,
        hasInstitutionCOI: !!c.hasInstitutionCOI,
        hasCoauthorCOI: !!c.hasCoauthorCOI,
        institutionCOIDetails: c.institutionCOIDetails || null,
        coauthorships: Array.isArray(c.coauthorships) ? c.coauthorships : [],
        coauthorCheckStatus: c.coauthorCheckStatus || null,
        coauthorCheckFailures: Array.isArray(c.coauthorCheckFailures) ? c.coauthorCheckFailures : [],
        // Reconciled verdict, not the pre-comparison flag: on this (confirmed)
        // path institutionContradicted is necessarily false, and writing the
        // stale c.institutionMismatch could keep a mismatch banner on a card
        // whose contradiction the checker just cleared.
        institutionMismatch: institutionContradicted,
        suggestedInstitution: c.suggestedInstitution || null,
        expertiseMismatch: !!c.expertiseMismatch,
        expertiseAreas: Array.isArray(c.expertiseAreas) ? c.expertiseAreas : [],
        email,
        emailSource,
        contactEnrichment: {
          identity: { status: identity.status },
          email: projectedEnrichmentEmail,
          emailSource: projectedEnrichmentEmailSource,
          emailPersistAllowed: projectedEmailPersistAllowed,
        },
        website: c.website || ce.website || null,
        orcidUrl,
        googleScholarUrl,
        hIndex,
        totalCitations,
        // Flag the UI uses to badge these rows distinctly.
        isApplicantRecommended: true,
        applicantKnownReviewer,
        applicantContactMismatch,
        addressConflictPending,
        conflictRecordUnavailable,
        eligibilityStatus,
        eligibilityReason: c.eligibilityReason || ce.eligibilityReason || null,
        eligibilityEvidence: c.eligibilityEvidence || ce.eligibilityEvidence || null,
      });
    }

    // Persist applicant-enriched rows into the durable Find roster so a reload
    // can restore them without re-running the enrichment pipeline. Best-effort
    // per row; never fail the SSE response for a roster write problem.
    const keyedOut = canonicalizeApplicantCandidates(out);
    const rosterOutcome = await persistRecommendedRoster({
      requestId,
      proposalKey,
      candidates: keyedOut,
      signal: deadlineController.signal,
      expectedUpdatedAtBySuggestion,
    });
    if (rosterOutcome.skipped > 0) {
      sendEvent('progress', { message: `${rosterOutcome.skipped} reviewer row(s) changed while enrichment was running and were left unchanged.` });
    }

    sendEvent('complete', completionPayload(keyedOut, handled));
  } catch (err) {
    // Terminal failures emit ONE error event and RESOLVE (2s template) — the
    // shell only frames and ends the stream.
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
}
