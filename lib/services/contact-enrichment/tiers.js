/**
 * ContactEnrichmentService — tier cluster (Stage 9, Checkpoint D, the
 * highest-risk cut — docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md).
 *
 * Holds the five legacy Tier 0-4 bodies (as `applyTier0..4`) plus the
 * identity-anchored scholarly-email step moved out of
 * `enrichCandidate`, plus `finalize` (was `_finalize`) and
 * `applyAffiliationOverride` (was `_applyAffiliationOverride`). This is NOT
 * pure byte-identical motion: each tier used to `return this._finalize(...)`
 * as an early exit from a single 433-line method; split into standalone
 * functions, each `applyTierN` instead returns a STRING SIGNAL —
 * `'finalize'` or `'continue'` — that the facade's `enrichCandidate` SHELL
 * interprets (Tier 3 never returns 'finalize'; it either returns 'continue'
 * or THROWS, and the shell lets that throw propagate uncaught, exactly as
 * the original code did).
 *
 * The inter-tier "glue" block between Tier 2 and Tier 3 (computing
 * `effectiveInstitution` / `searchCandidate` / `effectiveAnchor` /
 * `hasIdentityAnchor`, and the no-anchor abstain call) is NOT one of the five
 * tier bodies and is shared prep consumed by BOTH Tier 3 and Tier 4 — it
 * stays on the facade shell (unchanged, still dispatched via `this._foo(...)`
 * facade wrappers) and is threaded into `applyTier3`/`applyTier4` as part of
 * their options object. See the plan's Stage 9 note + the session build
 * report for this placement's rationale (a judgment call: the plan's module
 * table doesn't explicitly assign this glue a home).
 *
 * C10 (spyable facade dispatch): `applyTier3` needs `this.claudeWebSearch`
 * and `finalize` needs `this.saveToDatabase` to keep resolving through
 * `ContactEnrichmentService` (jest.spyOn targets), NOT via a closed-over
 * import — so both take an explicit `service` argument (the facade class,
 * passed as `this` from the calling facade method) and dispatch through it.
 * `finalize` ALSO dispatches `applyAffiliationOverride` through
 * `service._applyAffiliationOverride(...)` rather than calling the
 * same-file function directly — a deliberate extension of the C10 pattern
 * (not required by the plan's C10 list, which only names
 * saveToDatabase/claudeWebSearch/enrichCandidate) so the step-order
 * characterization suite's spy on `ContactEnrichmentService._applyAffiliationOverride`
 * keeps intercepting the internal call after this extraction, exactly as it
 * did before. All cross-module calls below use namespaced `mod.fn(...)`
 * property access (never destructured at require time), so a
 * `jest.spyOn(mod, 'fn')` from a test can always intercept them — the same
 * discipline C10 requires for the facade edges, applied uniformly.
 */

const { ContactParser } = require('../../utils/contact-parser');
const { ORCIDService } = require('../orcid-service');
const { SerpContactService } = require('../serp-contact-service');
const identityResolver = require('../reviewer-identity-resolver');
const identityAnchorLib = require('./identity-anchor');
const domainEvidence = require('./domain-evidence');
const emailAdjudication = require('./email-adjudication');
const openAlexMetrics = require('./openalex-metrics');
const pageEmail = require('./page-email');
const scholarlyEmail = require('./scholarly-email');
const { emailConfidence } = require('../../utils/reviewer-invite');

// ============================================
// TIER 0: Affiliation string embedded email (FREE)
// ============================================
function applyTier0(candidate, result, { onProgress }) {
  if (candidate.affiliation) {
    const affiliationEmail = ContactParser.extractPrimaryEmail(candidate.affiliation);
    if (affiliationEmail) {
      onProgress({ tier: 0, status: 'found', message: 'Found email in affiliation' });
      result.contactEnrichment.email = affiliationEmail;
      result.contactEnrichment.emailSource = 'affiliation';
      result.contactEnrichment.emailIsRecent = true; // Affiliation is from recent verification
      result.contactEnrichment.emailPersistAllowed = true;
      result.contactEnrichment.affiliationPersistAllowed = true;
      result.contactEnrichment.tiersUsed.push('affiliation');
      return 'finalize';
    }
  }
  return 'continue';
}

// ============================================
// TIER 1: PubMed (FREE)
// ============================================
function applyTier1(candidate, result, { usePubmed, onProgress }) {
  if (usePubmed && candidate.publications && candidate.publications.length > 0) {
    onProgress({ tier: 1, status: 'searching', message: 'Checking PubMed publications...' });
    result.contactEnrichment.tiersUsed.push('pubmed');

    const pubmedResult = ContactParser.extractContactFromPublications(
      candidate.publications,
      candidate.name,
      { maxEmailAge: 2 }
    );

    result.contactEnrichment.tierResults.pubmed = pubmedResult;

    if (pubmedResult.email) {
      result.contactEnrichment.email = pubmedResult.email;
      result.contactEnrichment.emailSource = 'pubmed';
      result.contactEnrichment.emailYear = pubmedResult.emailYear;
      result.contactEnrichment.emailIsRecent = pubmedResult.isRecent;
      result.contactEnrichment.emailPersistAllowed = true;
      result.contactEnrichment.affiliationPersistAllowed = !!candidate.affiliation;

      onProgress({
        tier: 1,
        status: 'found',
        message: `Found email in PubMed (${pubmedResult.emailYear})`,
      });

      // Continue through the live structured scholarly tier. A single legacy
      // PubMed publication is only quick-check evidence; a second distinct
      // recent work can promote the same address to invite-ready.
    } else {
      onProgress({ tier: 1, status: 'not_found', message: 'No email in PubMed' });
    }
  }
  return 'continue';
}

// ============================================
// TIER 2: ORCID (FREE)
// ============================================
async function applyTier2(candidate, result, { useOrcid, credentials, identityAnchor, signal, onProgress }) {
  const hasOrcidCredentials = credentials.orcidClientId && credentials.orcidClientSecret;

  if (useOrcid && hasOrcidCredentials) {
    onProgress({ tier: 2, status: 'searching', message: 'Searching ORCID...' });
    result.contactEnrichment.tiersUsed.push('orcid');

    try {
      const orcidResult = identityAnchor?.orcid
        ? await identityAnchorLib.getAnchoredOrcidProfile(identityAnchor.orcid, credentials, signal)
        : await ORCIDService.findContact({
            name: candidate.name,
            affiliation: candidate.affiliation,
            clientId: credentials.orcidClientId,
            clientSecret: credentials.orcidClientSecret,
          });

      result.contactEnrichment.tierResults.orcid = orcidResult;

      if (orcidResult && orcidResult.status === 'ambiguous') {
        // Multiple plausible ORCID records, none disambiguable — do NOT attach
        // anyone's identity. Kept in tierResults so the identity resolver can
        // map this to an `ambiguous` status.
        onProgress({ tier: 2, status: 'skipped', message: `ORCID ambiguous (${orcidResult.candidateCount} plausible records) — not attached` });
      } else if (orcidResult) {
        // Always capture ORCID ID if found
        if (orcidResult.orcidId) {
          result.contactEnrichment.orcidId = orcidResult.orcidId;
          result.contactEnrichment.orcidUrl = orcidResult.orcidUrl;
        }

        // Capture website if found and useful (filter out generic directory pages)
        if (orcidResult.website && ContactParser.isUsefulWebsiteUrl(orcidResult.website, candidate.name)) {
          result.contactEnrichment.website = orcidResult.website;
          result.contactEnrichment.websiteSource = 'orcid';
          result.contactEnrichment.websitePersistAllowed = true;
        }

        // Collect ORCID's current affiliation as an override CANDIDATE (S224
        // #15). Do NOT write candidate.affiliation here — the resolver must
        // run on the original discovery affiliation; the override is applied
        // later in finalize, gated on the verdict. Authority 1 (> Scholar).
        if (typeof orcidResult.affiliation === 'string' && orcidResult.affiliation.trim()) {
          result.contactEnrichment.orcidAffiliation = orcidResult.affiliation.trim();
          result.contactEnrichment.affiliationPersistAllowed = true;
        }

        // Use ORCID email if we don't have one, or if ORCID is more authoritative
        if (orcidResult.email && !result.contactEnrichment.email) {
          result.contactEnrichment.email = orcidResult.email;
          result.contactEnrichment.emailSource = 'orcid';
          result.contactEnrichment.emailIsRecent = true; // ORCID emails are maintained by researchers
          result.contactEnrichment.emailPersistAllowed = true;
        }

        onProgress({
          tier: 2,
          status: 'found',
          message: `Found ORCID: ${orcidResult.orcidId}${orcidResult.email ? ' (with email)' : ''}`,
        });
      } else {
        onProgress({ tier: 2, status: 'not_found', message: 'Not found in ORCID' });
      }
    } catch (error) {
      console.error('ORCID lookup error:', error.message);
      onProgress({ tier: 2, status: 'error', message: `ORCID error: ${error.message}` });
      result.contactEnrichment.tierResults.orcid = { error: error.message };
    }
  } else if (useOrcid && !hasOrcidCredentials) {
    onProgress({ tier: 2, status: 'skipped', message: 'ORCID skipped (no credentials)' });
  }
  return 'continue';
}

// ============================================
// STRUCTURED SCHOLARLY EMAIL: NCBI + EUROPE PMC (FREE)
// ============================================
async function applyScholarlyTier(candidate, result, {
  usePubmed, hasIdentityAnchor, signal, onProgress,
}) {
  const ce = result.contactEnrichment;
  if (!usePubmed) return 'continue';
  if (ce.emailSource === 'orcid') {
    onProgress({ tier: 'scholarly', status: 'skipped', message: 'Structured publications skipped (ORCID address found)' });
    return 'continue';
  }
  if (!hasIdentityAnchor) {
    onProgress({ tier: 'scholarly', status: 'skipped', message: 'Structured publications skipped (identity anchor required)' });
    return 'continue';
  }

  onProgress({ tier: 'scholarly', status: 'searching', message: 'Checking NCBI and Europe PMC author affiliations...' });
  ce.tiersUsed.push('scholarly_email');
  const scholarlyCandidate = {
    ...candidate,
    orcidId: ce.orcidId || candidate.orcidId || candidate.orcid || null,
  };

  try {
    const scholarlyResult = await scholarlyEmail.findScholarlyEmail(scholarlyCandidate, { signal });
    ce.tierResults.scholarly_email = scholarlyResult;

    if (scholarlyResult.status !== 'found') {
      // A structured tie is stronger evidence than the legacy single-publication
      // extraction above. Do not leave that earlier `pubmed` address available as
      // quick-check when the current cross-provider evidence cannot choose between
      // equally supported addresses.
      if (scholarlyResult.status === 'conflict' && ce.emailSource === 'pubmed') {
        ce.email = null;
        ce.emailSource = null;
        ce.emailYear = null;
        ce.emailIsRecent = false;
        ce.emailPersistAllowed = false;
      }
      const providerError = scholarlyResult.status === 'provider_error';
      const message = scholarlyResult.status === 'conflict'
        ? 'Structured publications returned conflicting addresses — abstaining'
        : providerError
          ? 'Structured publication services unavailable — address not checked'
          : 'No identity-grounded email in recent structured publications';
      onProgress({ tier: 'scholarly', status: providerError ? 'error' : 'not_found', message });
      return 'continue';
    }

    const action = scholarlyResult.publicationCount >= 2 ? 'ready' : 'quick_check';
    ce.email = scholarlyResult.email;
    ce.emailSource = action === 'ready' ? 'scholarly_multi' : 'scholarly_single';
    ce.emailYear = scholarlyResult.latestYear;
    ce.emailIsRecent = true;
    ce.emailPersistAllowed = true;
    ce.emailEvidence = {
      sourceKind: 'scholarly_publication',
      action,
      ownership: 'author_affiliation',
      affiliationMatched: true,
      publicationCount: scholarlyResult.publicationCount,
      providers: scholarlyResult.providers,
      sourceUrl: scholarlyResult.publications[0]?.url || null,
      publications: scholarlyResult.publications,
      deliverabilityChecked: false,
    };

    onProgress({
      tier: 'scholarly',
      status: 'found',
      message: action === 'ready'
        ? `Address confirmed in ${scholarlyResult.publicationCount} distinct recent publications`
        : 'Address confirmed in one recent publication — quick check recommended',
    });
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    ce.tierResults.scholarly_email = { status: 'error', error: error.message };
    onProgress({ tier: 'scholarly', status: 'error', message: `Structured publication error: ${error.message}` });
  }
  return 'continue';
}

// ============================================
// TIER 3: Claude Web Search (PAID)
// ============================================
async function applyTier3(candidate, result, {
  emailAlreadyFound, hasIdentityAnchor, effectiveAnchor, searchCandidate,
  useClaudeSearch, credentials, onProgress, signal, deadlineAt, service,
}) {
  if (!emailAlreadyFound && hasIdentityAnchor && useClaudeSearch && credentials.claudeApiKey) {
    onProgress({
      tier: 3,
      status: 'searching',
      message: 'Searching web with Claude (paid)...',
    });
    result.contactEnrichment.tiersUsed.push('claude_search');

    try {
      const claudeResult = await service.claudeWebSearch(searchCandidate, credentials.claudeApiKey, { signal, deadlineAt });
      result.contactEnrichment.tierResults.claude_search = claudeResult;

      if (claudeResult && domainEvidence.resultContradictsAnchor(claudeResult, effectiveAnchor)) {
        result.contactEnrichment.tierResults.claude_search = {
          ...claudeResult,
          rejectedReason: 'identity_anchor_contradiction',
        };
        onProgress({
          tier: 3,
          status: 'skipped',
          message: 'Discarded web-search contact that contradicted the anchored identity',
        });
      } else if (claudeResult) {
        // Use Claude results if we still don't have email
        if (claudeResult.email && !result.contactEnrichment.email) {
          result.contactEnrichment.email = claudeResult.email;
          result.contactEnrichment.emailSource = 'claude_search';
          result.contactEnrichment.emailEvidence = claudeResult.emailEvidence || null;
          result.contactEnrichment.emailIsRecent = true;
          result.contactEnrichment.emailPersistAllowed = true;
        }

        // Capture faculty page URL
        if (claudeResult.facultyPageUrl && !ContactParser.isDocumentUrl(claudeResult.facultyPageUrl)) {
          result.contactEnrichment.facultyPageUrl = claudeResult.facultyPageUrl;
          result.contactEnrichment.websitePersistAllowed = true;
        }

        // Capture website if we don't have one and it's useful
        if (claudeResult.website && !result.contactEnrichment.website && ContactParser.isUsefulWebsiteUrl(claudeResult.website, candidate.name)) {
          result.contactEnrichment.website = claudeResult.website;
          result.contactEnrichment.websiteSource = 'claude_search';
          result.contactEnrichment.websitePersistAllowed = true;
        }

        if (claudeResult.emailRejectedReason === 'name_mismatch') {
          onProgress({
            tier: 3,
            status: 'email_rejected',
            message: `Discarded a web-search email that didn’t match ${candidate.name} (possible wrong person or fabricated address)`,
          });
        }

        onProgress({
          tier: 3,
          status: 'found',
          message: claudeResult.email ? 'Found contact via web search' : 'Found profile page',
        });
      } else {
        onProgress({ tier: 3, status: 'not_found', message: 'No results from web search' });
      }
    } catch (error) {
      // A deadline/cancel abort must NOT be downgraded to a per-tier error —
      // rethrow so enrichCandidates() stops and the route surfaces a timeout
      // instead of returning normal results after the budget expired.
      if (signal?.aborted) throw error;
      console.error('Claude web search error:', error.message);
      onProgress({ tier: 3, status: 'error', message: `Search error: ${error.message}` });
      result.contactEnrichment.tierResults.claude_search = { error: error.message };
    }
  } else if (!emailAlreadyFound && useClaudeSearch && !hasIdentityAnchor) {
    onProgress({ tier: 3, status: 'skipped', message: 'Web search skipped (identity anchor required)' });
  } else if (!emailAlreadyFound && useClaudeSearch && !credentials.claudeApiKey) {
    onProgress({ tier: 3, status: 'skipped', message: 'Web search skipped (no API key)' });
  }
  return 'continue';
}

// ============================================
// TIER 4: SerpAPI Google Search (PAID)
// ============================================
async function applyTier4(candidate, result, {
  hasIdentityAnchor, effectiveAnchor, searchCandidate, useSerpSearch, credentials, onProgress,
}) {
  if (useSerpSearch && credentials.serpApiKey) {
    // Only run if we still don't have an email after Tier 3
    if (!result.contactEnrichment.email && hasIdentityAnchor) {
      onProgress({
        tier: 4,
        status: 'searching',
        message: 'Searching Google with SerpAPI (paid)...',
      });
      result.contactEnrichment.tiersUsed.push('serp_search');

      try {
        const serpResult = await SerpContactService.findContact(searchCandidate, credentials.serpApiKey);
        result.contactEnrichment.tierResults.serp_search = serpResult;

        if (serpResult && domainEvidence.resultContradictsAnchor(serpResult, effectiveAnchor)) {
          result.contactEnrichment.tierResults.serp_search = {
            ...serpResult,
            rejectedReason: 'identity_anchor_contradiction',
          };
          onProgress({
            tier: 4,
            status: 'skipped',
            message: 'Discarded Google-search contact that contradicted the anchored identity',
          });
        } else if (serpResult) {
          // Same name-grounding guard as Tier 3: a Google-scraped email can
          // belong to a same-named different person. Reject if it doesn't match.
          if (serpResult.email && !ContactParser.isNameConsistentEmail(serpResult.email, candidate.name)) {
            onProgress({
              tier: 4,
              status: 'email_rejected',
              message: `Discarded a Google-search email that didn’t match ${candidate.name} (possible wrong person)`,
            });
            // Stamp a durable rejection marker on the stored tier result BEFORE
            // nulling, mirroring the Claude tier (claudeWebSearch sets
            // emailRejectedReason). serpResult is the same object stored at
            // tierResults.serp_search, so the discard survives for the Slice 1
            // audit (lead_found_not_persisted) and the Slice 2a quarantined lead
            // instead of being destroyed in place. rejectedEmail preserves the
            // value for the lead before the null.
            serpResult.emailRejectedReason = 'name_mismatch';
            serpResult.rejectedEmail = serpResult.email;
            serpResult.email = null;
          }
          // Use SerpAPI results if we still don't have email
          if (serpResult.email && !result.contactEnrichment.email) {
            result.contactEnrichment.email = serpResult.email;
            result.contactEnrichment.emailSource = 'serp_search';
            result.contactEnrichment.emailEvidence = serpResult.emailEvidence || null;
            result.contactEnrichment.emailIsRecent = true;
            result.contactEnrichment.emailPersistAllowed = true;
          }

          // Capture faculty page URL if we don't have one
          if (serpResult.facultyPageUrl && !result.contactEnrichment.facultyPageUrl) {
            result.contactEnrichment.facultyPageUrl = serpResult.facultyPageUrl;
            result.contactEnrichment.websitePersistAllowed = true;
          }

          // Capture website if we don't have one and it's useful
          if (serpResult.website && !result.contactEnrichment.website && ContactParser.isUsefulWebsiteUrl(serpResult.website, candidate.name)) {
            result.contactEnrichment.website = serpResult.website;
            result.contactEnrichment.websiteSource = 'serp_search';
            result.contactEnrichment.websitePersistAllowed = true;
          }

          onProgress({
            tier: 4,
            status: 'found',
            message: serpResult.email ? 'Found contact via Google search' : 'Found profile page',
          });
        } else {
          onProgress({ tier: 4, status: 'not_found', message: 'No results from Google search' });
        }
      } catch (error) {
        console.error('SerpAPI Google search error:', error.message);
        onProgress({ tier: 4, status: 'error', message: `Search error: ${error.message}` });
        result.contactEnrichment.tierResults.serp_search = { error: error.message };
      }
    } else if (!result.contactEnrichment.email && !hasIdentityAnchor) {
      onProgress({ tier: 4, status: 'skipped', message: 'Google search skipped (identity anchor required)' });
    } else {
      // Skip Tier 4 email search if we already have an email
      onProgress({ tier: 4, status: 'skipped', message: 'Skipped (email already found)' });
    }
  } else if (useSerpSearch && !credentials.serpApiKey) {
    onProgress({ tier: 4, status: 'skipped', message: 'Google search skipped (no API key)' });
  }
  return 'continue';
}

/**
 * Single exit point for enrichCandidate: fetch OpenAlex bibliometrics (for ALL
 * candidates, including early-email ones), persist, and return. Every `return`
 * in enrichCandidate routes through here so no path can skip the metrics.
 */
async function finalize(service, candidate, result, { persist = true, onProgress, scholarCandidate = candidate, signal, deadlineAt } = {}) {
  await openAlexMetrics.attachOpenAlexMetrics(scholarCandidate, result, { signal, onProgress });
  try {
    const hypothesis = { name: candidate.name, claimedInstitution: candidate.affiliation };
    const evidence = identityResolver.evidenceFromEnrichment(result.contactEnrichment, hypothesis);
    result.contactEnrichment.identity = identityResolver.resolveIdentity(hypothesis, evidence);
  } catch (idErr) {
    console.error('Identity resolver error (non-fatal):', idErr.message);
  }
  await domainEvidence.buildInstitutionDomainEvidence(candidate, result, { signal });
  // Resolved-page email tier (docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md): runs AFTER
  // attachOpenAlexMetrics/domain-set construction and BEFORE the
  // domain cross-check below, so a recovered page email is still vetted. Only acts
  // when no trusted email exists yet (or a low-trust search email can be replaced).
  await pageEmail.attachEmailFromResolvedPage(candidate, result, { signal, deadlineAt, onProgress });
  // Now that the institutional domain sets are known, validate the captured contact
  // email against them. An anchored domain MATCH confirms persistence; a search
  // contradiction becomes contested/LOW rather than a silent hard drop.
  emailAdjudication.validateEmailAgainstVerifiedDomain(result.contactEnrichment);
  emailAdjudication.readjudicateNameMismatchRejectedEmail(result.contactEnrichment);
  const confidence = emailConfidence({
    email: result.contactEnrichment.email,
    emailSource: result.contactEnrichment.emailSource,
  });
  result.contactEnrichment.emailAction = confidence.action;
  result.contactEnrichment.emailActionReason = confidence.reason;
  // Slice 2a: surface already-fetched-but-discarded contacts + pages as
  // quarantined leads (no new network). Runs AFTER the domain cross-check so
  // the verified-domain-contradiction discards (captured inside it) and the
  // tier discards are both present.
  emailAdjudication.collectContactLeads(result.contactEnrichment);
  // Post-enrichment identity classification was attached before domain-set
  // construction so ORCID employment IDs can only contribute domains on a
  // confirmed/probable identity.
  // Pin the current affiliation from the highest-authority identity-trusted
  // source NOW — after resolveIdentity, so the override can never corrupt the
  // resolver's evidence basis (the Tsai→Nakano failure class). Dispatched
  // through `service` (C10-style, see file header) so the class-level
  // `_applyAffiliationOverride` stays spyable/observable exactly as before.
  service._applyAffiliationOverride(result);
  // persist:false → caller owns the writeback (e.g. id-keyed). Skip the
  // email-keyed saveToDatabase so it can't race/fork the caller's write.
  if (persist) await service.saveToDatabase(candidate, result.contactEnrichment);
  return result;
}

/**
 * Pin the candidate's CURRENT affiliation from the highest-authority,
 * identity-trusted source collected during the tiers (ORCID > OpenAlex >
 * PubMed-recency), and record provenance in `affiliationSource` (S224, Topic
 * #2 piece #15).
 *
 * Sequencing (Codex BLOCKER): this runs at the END of finalize, AFTER
 * resolveIdentity. The tiers only COLLECT `orcidAffiliation` /
 * `openAlexAffiliation` — they never touch candidate.affiliation — so the
 * resolver classifies on the original discovery affiliation. We only override
 * when the resolver trusts the match (`mayPersistIdentity` → probable/
 * confirmed); an unresolved/ambiguous candidate keeps its PubMed-recency
 * affiliation rather than being "corrected" to a possibly-wrong person's job.
 *
 * Mutates `result` (a copy of the input candidate) in place: it sets the
 * effective `result.affiliation` (so the pinned value flows through
 * mergeEnrichment → save-candidates → display) plus the provenance fields on
 * `result.contactEnrichment`. The input `candidate` object the resolver read
 * is never mutated.
 */
function applyAffiliationOverride(result) {
  const ce = result.contactEnrichment;
  if (!ce) return;

  // Only override onto a trusted identity verdict.
  const status = ce.identity?.status;
  if (!status || !identityResolver.mayPersistIdentity(status)) return;

  // Authority order: ORCID current > OpenAlex current. (PubMed-recency is the
  // default already on ce.affiliation/affiliationSource — no override needed.)
  const pinned =
    (typeof ce.orcidAffiliation === 'string' && ce.orcidAffiliation.trim())
      ? { value: ce.orcidAffiliation.trim(), source: 'orcid_current' }
      : (typeof ce.openAlexAffiliation === 'string' && ce.openAlexAffiliation.trim())
        ? { value: ce.openAlexAffiliation.trim(), source: 'openalex_current' }
        : null;
  if (!pinned) return;

  // Preserve the pre-override discovery affiliation for display ("formerly …")
  // and debugging, but don't clobber an already-recorded prior on re-runs.
  if (result.affiliation && result.affiliation !== pinned.value && !ce.priorAffiliation) {
    ce.priorAffiliation = result.affiliation;
  }
  ce.affiliation = pinned.value;
  ce.affiliationSource = pinned.source;
  result.affiliation = pinned.value;
}

module.exports = {
  applyTier0,
  applyTier1,
  applyTier2,
  applyScholarlyTier,
  applyTier3,
  applyTier4,
  finalize,
  applyAffiliationOverride,
};
