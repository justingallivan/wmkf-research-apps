/**
 * ContactEnrichmentService - Tiered contact information lookup
 *
 * Implements a tiered system (Tier 0–4) for finding researcher contact information.
 * The W5 caller migration dropped the old "check the Postgres researcher cache first"
 * tier (see the comment at TIER 0 in enrichCandidate); the live order is:
 *
 * Tier 0: Affiliation-string embedded email (FREE)
 *   - PubMed affiliations often include "Electronic address: email@domain.com"
 *
 * Tier 1: PubMed (FREE)
 *   - Extract email from affiliation strings in recent publications
 *   - Trust emails from papers < 2 years old
 *
 * Tier 2: ORCID (FREE)
 *   - Query ORCID API for email, website, ORCID ID
 *   - Requires user to provide ORCID API credentials
 *
 * Tier 3: Claude Web Search (PAID)
 *   - Use Claude's web search tool to find faculty pages, emails
 *   - ~$0.01 per search + token costs
 *   - User must opt-in and provide Claude API key
 *
 * Tier 4: SerpAPI Google Search (PAID)
 *   - Opt-in; only runs when a prior tier did not yield an email
 */

const { ContactParser } = require('../utils/contact-parser');
const { ORCIDService } = require('./orcid-service');
// W5 caller migration: DatabaseService dropped. Enrichment writebacks now
// target Dataverse `wmkf_potentialreviewer` via the adapter chain (S213: the
// wmkf_appresearcher bibliometric sidecar was collapsed onto the person);
// the prior Postgres-researchers cache tier is removed
// (Dataverse is email-keyed, not name-keyed, so there's no name-lookup
// equivalent during the discovery phase).
const { resolveIdentity, evidenceFromEnrichment, mayPersistIdentity } = require('./reviewer-identity-resolver');

const { SerpContactService } = require('./serp-contact-service');
const { summarizeContactOutcomes } = require('./reviewer-contact-audit');
// Stage 1/2/4/5/6 removed the facade's OpenAlexService, normalizeOrcid,
// isOpenAlexAuthorAccepted, getModelForApp, safeFetchInstitutionPage, and
// hostWithinDomain imports — now used only inside the extracted modules.

// Stage 0 (docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md): constants and
// abort helpers extracted verbatim to lib/services/contact-enrichment/. The
// facade re-exposes COSTS as a static prop below (ContactEnrichmentService.COSTS).
const {
  COSTS,
} = require('./contact-enrichment/constants');
const { abortError, isDeadlineAbort } = require('./contact-enrichment/abort');
// Stage 1: identity-anchor cluster extracted. Facade delegates each (C2 surface).
const identityAnchor = require('./contact-enrichment/identity-anchor');
// Stage 2: domain-evidence cluster extracted. Facade delegates each (C2 surface).
const domainEvidence = require('./contact-enrichment/domain-evidence');
// Stage 4: openalex-metrics cluster extracted. Facade delegates each (C2 surface).
const openAlexMetrics = require('./contact-enrichment/openalex-metrics');
// Stage 6: search-tiers cluster (Tier 3 Claude web search + Scholar URL)
// extracted. Facade delegates each (C2 surface). Carries the A7
// prompt-injection surface marker (C6) — see search-tiers.js header.
const searchTiers = require('./contact-enrichment/search-tiers');
// Stage 7: cost estimation extracted. Facade delegates (C2 surface).
const cost = require('./contact-enrichment/cost');
// Stage 3: email-adjudication cluster extracted. Facade delegates each (C2 surface).
const emailAdjudication = require('./contact-enrichment/email-adjudication');
// Stage 5: resolved-page-email cluster extracted. Facade delegates each (C2 surface).
const pageEmail = require('./contact-enrichment/page-email');
// Stage 8: persistence (DAL write) cluster extracted (C5). Facade delegates
// each (C2/C10 surface). Does NOT re-export the adapters imported inside.
const persistence = require('./contact-enrichment/persistence');

class ContactEnrichmentService {
  static _identityAnchorForCandidate(candidate = {}) { return identityAnchor.identityAnchorForCandidate(candidate); }

  static _cleanInstitution(value) { return identityAnchor.cleanInstitution(value); }

  static _effectiveInstitution(candidate = {}, enrichment = {}) { return identityAnchor.effectiveInstitution(candidate, enrichment); }

  static _searchCandidateWithInstitution(candidate = {}, institution = null) { return identityAnchor.searchCandidateWithInstitution(candidate, institution); }

  static _anchorWithInstitution(anchor = null, institution = null) { return identityAnchor.anchorWithInstitution(anchor, institution); }

  static _hasOrcidAnchor(candidate = {}, enrichment = {}) { return identityAnchor.hasOrcidAnchor(candidate, enrichment); }

  static _fieldPersistAllowed(enrichment = {}, fieldName, sourceName = null) { return persistence.fieldPersistAllowed(enrichment, fieldName, sourceName); }

  static _markUnanchoredAbstain(enrichment = {}) { return identityAnchor.markUnanchoredAbstain(enrichment); }

  static async _getAnchoredOrcidProfile(orcid, credentials = {}, signal) { return identityAnchor.getAnchoredOrcidProfile(orcid, credentials, signal); }

  static _institutionTokens(value) { return domainEvidence.institutionTokens(value); }

  static _institutionsContradict(anchorInstitution, resultInstitution) { return domainEvidence.institutionsContradict(anchorInstitution, resultInstitution); }

  static _resultContradictsAnchor(result = {}, anchor = null) { return domainEvidence.resultContradictsAnchor(result, anchor); }

  static _normalizeDomain(value) { return domainEvidence.normalizeDomain(value); }

  static _emailDomain(email) { return domainEvidence.emailDomain(email); }

  static _domainRelated(domain, verifiedDomain) { return domainEvidence.domainRelated(domain, verifiedDomain); }

  static _emailDomainRelatedToAny(email, domains = []) { return domainEvidence.emailDomainRelatedToAny(email, domains); }

  static _addInstitutionDomain(set, domain) { return domainEvidence.addInstitutionDomain(set, domain); }

  static _currentOrcidInstitutionRefs(ce = {}) { return domainEvidence.currentOrcidInstitutionRefs(ce); }

  static _strongInstitutionDisplayMatch(query, displayName) { return domainEvidence.strongInstitutionDisplayMatch(query, displayName); }

  static async _buildInstitutionDomainEvidence(candidate, result, { signal } = {}) { return domainEvidence.buildInstitutionDomainEvidence(candidate, result, { signal }); }

  static _markEmailContested(ce, reason) { return emailAdjudication.markEmailContested(ce, reason); }

  static _readjudicateNameMismatchRejectedEmail(ce) { return emailAdjudication.readjudicateNameMismatchRejectedEmail(ce); }

  // ---- Slice 2a: quarantined contact leads (docs/REVIEWER_CONTACT_LEADS_SPEC.md) ----

  static _addContactLead(ce, lead = {}) { return emailAdjudication.addContactLead(ce, lead); }

  static _collectContactLeads(ce) { return emailAdjudication.collectContactLeads(ce); }

  static _validateEmailAgainstVerifiedDomain(ce) { return emailAdjudication.validateEmailAgainstVerifiedDomain(ce); }

  /**
   * Enrich a single candidate with contact information
   *
   * @param {Object} candidate - Candidate object with name, affiliation, publications
   * @param {Object} options - Enrichment options
   * @param {Object} options.credentials - API credentials { orcidClientId, orcidClientSecret, claudeApiKey, serpApiKey }
   * @param {boolean} options.usePubmed - Use Tier 1 (default: true)
   * @param {boolean} options.useOrcid - Use Tier 2 (default: true if credentials provided)
   * @param {boolean} options.useClaudeSearch - Use Tier 3 (default: false, requires opt-in)
   * @param {boolean} options.useSerpSearch - Use Tier 4 (default: false, requires opt-in)
   * @param {Function} options.onProgress - Progress callback
   * @returns {Promise<Object>} Enriched candidate with contact info
   */
  static async enrichCandidate(candidate, options = {}) {
    const {
      credentials = {},
      usePubmed = true,
      useOrcid = true,
      useClaudeSearch = false,
      useSerpSearch = false,
      // When false, enrichment is side-effect-free: _finalize skips the
      // email-keyed saveToDatabase so a caller that owns its OWN (e.g. id-keyed)
      // writeback isn't raced/forked by it. Defaults true — existing callers
      // (/enrich-contacts, the in-panel search) keep the current persist behavior.
      persist = true,
      onProgress = () => {},
      // Reviewer-search time budget: an AbortSignal + its deadline timestamp.
      // Threaded into the Tier-3 Claude web-search call so a fired deadline
      // cancels enrichment mid-flight. Both undefined for non-budgeted callers.
      signal = undefined,
      deadlineAt = undefined,
    } = options;

    const result = {
      ...candidate,
      contactEnrichment: {
        email: null,
        emailSource: null,
        emailYear: null,
        emailIsRecent: false,
        website: null,
        websiteSource: null,
        orcidId: null,
        orcidUrl: null,
        facultyPageUrl: null,
        googleScholarUrl: this.buildGoogleScholarUrl(candidate.name, candidate.affiliation),
        // Current-affiliation pinning (S224, Topic #2). `affiliation` is the
        // effective affiliation after the identity-gated override applied in
        // _finalize; `affiliationSource` is its provenance (orcid_current /
        // openalex_current / pubmed_recency). The per-source candidates
        // (orcidAffiliation / openAlexAffiliation) are COLLECTED during the
        // tiers WITHOUT mutating candidate.affiliation, so resolveIdentity runs
        // on the original discovery affiliation; the override is applied at the
        // END of _finalize gated on the resolver verdict.
        affiliation: candidate.affiliation || null,
        affiliationSource: candidate.affiliation ? 'pubmed_recency' : null,
        orcidAffiliation: null,
        // OpenAlex last-known-institution candidate (Slice 1b — replaces the
        // retired Scholar `scholarAffiliations`). Authority 2 (below ORCID).
        openAlexAffiliation: null,
        // Verified institutional DOMAIN for the email cross-check guard (Slice 1b —
        // re-sourced from the OpenAlex author's institution homepage; replaces the
        // retired Scholar "Verified email at X" hint `scholarVerifiedEmail`).
        verifiedInstitutionDomain: null,
        anchoredInstitutionDomains: [],
        plausibleInstitutionDomains: [],
        contactStatus: null,
        contactStatusReason: null,
        emailPersistAllowed: false,
        websitePersistAllowed: false,
        affiliationPersistAllowed: !!candidate.affiliation,
        scholarPersistAllowed: false,
        // Recency rank input (discovery-sourced) carried onto the enrichment
        // object so the Workbench client re-rank via mergeEnrichment matches the
        // server rank (S224 #16). Enrichment never changes it.
        publicationCount5yr: Number.isFinite(candidate.publicationCount5yr) ? candidate.publicationCount5yr : null,
        enrichedAt: new Date().toISOString(),
        tiersUsed: [],
        tierResults: {},
        // Slice 2a (REVIEWER_CONTACT_LEADS_SPEC §3/§6): quarantined staff-facing
        // breadcrumbs surfaced from contacts the tiers already fetched but
        // discarded (anchor/name/domain rejects) or pages found without an email.
        // NEVER sendable — every entry carries persistable:false and these never
        // feed email/website/facultyPageUrl or any *_PersistAllowed flag.
        contactLeads: [],
      },
    };
    const identityAnchor = this._identityAnchorForCandidate(candidate);

    // W5 caller migration: the previous "check database first" tier
    // (DatabaseService.findResearcher → Postgres researchers cache) was
    // dropped. Dataverse `wmkf_potentialreviewer` is email-keyed and we
    // don't have email yet at this point in the flow. A future
    // match-on-discovery pass can reintroduce a Dataverse-backed
    // pre-enrichment cache once email is available earlier (see
    // `lib/services/contact-history-service.js` plan spec).

    // ============================================
    // TIER 0: Check affiliation string for embedded email
    // (PubMed often includes "Electronic address: email@domain.com")
    // ============================================
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
        return this._finalize(candidate, result, { persist, onProgress, signal, deadlineAt });
      }
    }

    // ============================================
    // TIER 1: PubMed (FREE)
    // ============================================
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

        // If email is recent, we can trust it — finalize (still fetches Scholar
        // metrics for this early-email candidate before saving/returning).
        if (pubmedResult.isRecent) {
          return this._finalize(candidate, result, { persist, onProgress, signal, deadlineAt });
        }
        // Otherwise, continue to verify/supplement with other sources
      } else {
        onProgress({ tier: 1, status: 'not_found', message: 'No email in PubMed' });
      }
    }

    // ============================================
    // TIER 2: ORCID (FREE)
    // ============================================
    const hasOrcidCredentials = credentials.orcidClientId && credentials.orcidClientSecret;

    if (useOrcid && hasOrcidCredentials) {
      onProgress({ tier: 2, status: 'searching', message: 'Searching ORCID...' });
      result.contactEnrichment.tiersUsed.push('orcid');

      try {
        const orcidResult = identityAnchor?.orcid
          ? await this._getAnchoredOrcidProfile(identityAnchor.orcid, credentials, signal)
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
          // later in _finalize, gated on the verdict. Authority 1 (> Scholar).
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

    // If we already have a recent email, skip the PAID email-search tiers (Claude
    // Tier 3 + SerpAPI Google Tier 4) — but do NOT early-return: the Scholar
    // profile + bibliometrics lookup (also under Tier 4) must still run, since
    // h-index/citations are independent of having an email (Codex S211 catch:
    // early-email candidates were silently losing their bibliometrics). The single
    // saveToDatabase + return now happens at the end of the method.
    const emailAlreadyFound = !!(result.contactEnrichment.email && result.contactEnrichment.emailIsRecent);
    const effectiveInstitution = this._effectiveInstitution(candidate, result.contactEnrichment);
    const searchCandidate = this._searchCandidateWithInstitution(candidate, effectiveInstitution);
    const effectiveAnchor = this._anchorWithInstitution(identityAnchor, effectiveInstitution);
    const hasIdentityAnchor = !!effectiveInstitution || this._hasOrcidAnchor(candidate, result.contactEnrichment);

    // Abstain: no institution anchor and no ORCID → a bare-name paid search can
    // only return a namesake, so emit no sendable contact/bibliometrics. Note any
    // RECENT PubMed/affiliation email already early-returned via _finalize above;
    // only a NON-recent (older, likelier-stale) PubMed email can reach here, so
    // nulling it is the safe call rather than a loss of a fresh contact.
    if (!hasIdentityAnchor) {
      this._markUnanchoredAbstain(result.contactEnrichment);
    }

    // ============================================
    // TIER 3: Claude Web Search (PAID)
    // ============================================
    if (!emailAlreadyFound && hasIdentityAnchor && useClaudeSearch && credentials.claudeApiKey) {
      onProgress({
        tier: 3,
        status: 'searching',
        message: 'Searching web with Claude (paid)...',
      });
      result.contactEnrichment.tiersUsed.push('claude_search');

      try {
        const claudeResult = await this.claudeWebSearch(searchCandidate, credentials.claudeApiKey, { signal, deadlineAt });
        result.contactEnrichment.tierResults.claude_search = claudeResult;

        if (claudeResult && this._resultContradictsAnchor(claudeResult, effectiveAnchor)) {
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

    // ============================================
    // TIER 4: SerpAPI Google Search (PAID)
    // ============================================
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

          if (serpResult && this._resultContradictsAnchor(serpResult, effectiveAnchor)) {
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

    // OpenAlex bibliometrics + save happen in _finalize, which EVERY return path
    // routes through, so early-email candidates still get them.
    return this._finalize(candidate, result, { persist, onProgress, scholarCandidate: searchCandidate, signal, deadlineAt });
  }

  // Stage 4: _attachOpenAlexMetrics implementation + its full JSDoc live in
  // ./contact-enrichment/openalex-metrics.js. Facade delegates (C2 surface).
  static async _attachOpenAlexMetrics(candidate, result, { signal, onProgress = () => {} } = {}) { return openAlexMetrics.attachOpenAlexMetrics(candidate, result, { signal, onProgress }); }

  static _buildOpenAlexAuthorDto(author, identity) { return openAlexMetrics.buildOpenAlexAuthorDto(author, identity); }

  // ---- Resolved-page email tier (docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md) ----

  /** Deburr + lowercase + drop punctuation for name/window matching. */
  static _normForNameMatch(value) { return pageEmail.normForNameMatch(value); }

  /** Forename + surname tokens for the page forename-gate; null if <2 name tokens. */
  static _parseCandidateName(name) { return pageEmail.parseCandidateName(name); }

  /** Email's domain is related to the verified institution domain (email-validation relation). */
  static _emailDomainRelated(email, verifiedDomain) { return pageEmail.emailDomainRelated(email, verifiedDomain); }

  /** True when a text window names the candidate with ordered, near-contiguous evidence. */
  static _windowNamesCandidate(window, parsed) { return pageEmail.windowNamesCandidate(window, parsed); }

  /** Personal-page handle from a URL: `/~phbuck/` → `phbuck`, else last path segment. */
  static _personalPageSlug(pageUrl) { return pageEmail.personalPageSlug(pageUrl); }

  static _slugNamesCandidate(slug, parsed) { return pageEmail.slugNamesCandidate(slug, parsed); }

  /**
   * Select a page-grounded email. Among emails whose domain is related to the
   * verified institution domain, keep only those ASSOCIATED with the candidate, by
   * EITHER route:
   *   (a) name-adjacency — the candidate's name (surname + forename/initial) appears
   *       within a small window of the email; OR
   *   (b) page-owner match — the page IDENTIFIES the candidate (their name is in the
   *       <title>/<h1..3>) AND the email's local part equals the URL personal-page
   *       slug (e.g. `/~phbuck/` ↔ `phbuck@`). This recovers a first-person
   *       "contact me: phbuck@…" block whose address is nowhere near the name.
   * Return the address iff exactly one distinct candidate-associated email exists;
   * otherwise abstain. This is the trust gate — NOT isNameConsistentEmail (which
   * rejects opaque local parts like `phbuck`). Route (b) needs BOTH page-identity
   * and the slug↔local-part match, so a group roster's other members and a lone
   * lab-admin address stay out.
   */
  static _selectGroundedEmail(name, text, emails, verifiedDomain, opts = {}) { return pageEmail.selectGroundedEmail(name, text, emails, verifiedDomain, opts); }

  /** Captured profile/lab URLs to try, most person-specific first; drop search/aggregator links. */
  static _orderCandidateUrls(ce, name) { return pageEmail.orderCandidateUrls(ce, name); }

  /**
   * Fetch a captured faculty/profile page (SSRF-bound to anchored institution domains)
   * and recover a page-grounded institutional email. Runs only behind the
   * REVIEWER_PAGE_EMAIL_TIER_ENABLED flag, only when the domain is verified, and only
   * when there is no trusted email yet (a low-trust serp/claude email may be
   * replaced). Best-effort: every error is recorded and swallowed EXCEPT a
   * deadline/cancel abort, which propagates like the other tiers. Mutates
   * result.contactEnrichment in place.
   */
  static async _attachEmailFromResolvedPage(candidate, result, opts = {}) { return pageEmail.attachEmailFromResolvedPage(candidate, result, opts); }

  /**
   * Single exit point for enrichCandidate: fetch OpenAlex bibliometrics (for ALL
   * candidates, including early-email ones), persist, and return. Every `return`
   * in enrichCandidate routes through here so no path can skip the metrics.
   */
  static async _finalize(candidate, result, { persist = true, onProgress, scholarCandidate = candidate, signal, deadlineAt } = {}) {
    await this._attachOpenAlexMetrics(scholarCandidate, result, { signal, onProgress });
    try {
      const hypothesis = { name: candidate.name, claimedInstitution: candidate.affiliation };
      const evidence = evidenceFromEnrichment(result.contactEnrichment, hypothesis);
      result.contactEnrichment.identity = resolveIdentity(hypothesis, evidence);
    } catch (idErr) {
      console.error('Identity resolver error (non-fatal):', idErr.message);
    }
    await this._buildInstitutionDomainEvidence(candidate, result, { signal });
    // Resolved-page email tier (docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md): runs AFTER
    // _attachOpenAlexMetrics/domain-set construction and BEFORE the
    // domain cross-check below, so a recovered page email is still vetted. Only acts
    // when no trusted email exists yet (or a low-trust search email can be replaced).
    await this._attachEmailFromResolvedPage(candidate, result, { signal, deadlineAt, onProgress });
    // Now that the institutional domain sets are known, validate the captured contact
    // email against them. An anchored domain MATCH confirms persistence; a search
    // contradiction becomes contested/LOW rather than a silent hard drop.
    this._validateEmailAgainstVerifiedDomain(result.contactEnrichment);
    this._readjudicateNameMismatchRejectedEmail(result.contactEnrichment);
    // Slice 2a: surface already-fetched-but-discarded contacts + pages as
    // quarantined leads (no new network). Runs AFTER the domain cross-check so
    // the verified-domain-contradiction discards (captured inside it) and the
    // tier discards are both present.
    this._collectContactLeads(result.contactEnrichment);
    // Post-enrichment identity classification was attached before domain-set
    // construction so ORCID employment IDs can only contribute domains on a
    // confirmed/probable identity.
    // Pin the current affiliation from the highest-authority identity-trusted
    // source NOW — after resolveIdentity, so the override can never corrupt the
    // resolver's evidence basis (the Tsai→Nakano failure class).
    this._applyAffiliationOverride(result);
    // persist:false → caller owns the writeback (e.g. id-keyed). Skip the
    // email-keyed saveToDatabase so it can't race/fork the caller's write.
    if (persist) await this.saveToDatabase(candidate, result.contactEnrichment);
    return result;
  }

  /**
   * Pin the candidate's CURRENT affiliation from the highest-authority,
   * identity-trusted source collected during the tiers (ORCID > OpenAlex >
   * PubMed-recency), and record provenance in `affiliationSource` (S224, Topic
   * #2 piece #15).
   *
   * Sequencing (Codex BLOCKER): this runs at the END of _finalize, AFTER
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
  static _applyAffiliationOverride(result) {
    const ce = result.contactEnrichment;
    if (!ce) return;

    // Only override onto a trusted identity verdict.
    const status = ce.identity?.status;
    if (!status || !mayPersistIdentity(status)) return;

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

  /**
   * Enrich multiple candidates
   *
   * @param {Array} candidates - Array of candidates
   * @param {Object} options - Same as enrichCandidate. Set returnPartialOnAbort
   *   only for callers that can safely consume completed-prefix results.
   * @returns {Promise<Object>} Results with enriched candidates and stats
   */
  static async enrichCandidates(candidates, options = {}) {
    const {
      onProgress = () => {},
      signal,
      useClaudeSearch = false,
      useSerpSearch = false,
      returnPartialOnAbort = false,
    } = options;

    const results = {
      enriched: [],
      stats: {
        total: candidates.length,
        withEmail: 0,
        withWebsite: 0,
        withOrcid: 0,
        bySource: {
          affiliation: 0,
          database: 0,
          pubmed: 0,
          orcid: 0,
          claude_search: 0,
          serp_search: 0,
          institution_page: 0,
        },
        estimatedCost: 0,
        actualCost: 0,
      },
    };

    const finalizeResults = ({ partial = false } = {}) => {
      // Slice 1 (REVIEWER_CONTACT_LEADS_SPEC §6): classify each candidate's
      // missing-email reason into a histogram + non-lossy signal tally so the
      // dominant-bucket split is MEASURED, not assumed. Pure/no network — derived
      // from the enrichment results already computed above. Carried on stats so
      // the SSE complete event and server logs both see it.
      results.stats.contactAudit = summarizeContactOutcomes(results.enriched, {
        paidSearchEnabled: useClaudeSearch || useSerpSearch,
      });

      if (partial) {
        results.partial = true;
        results.timeout = true;
        results.completedCount = results.enriched.length;
        results.requestedCount = candidates.length;
        results.stats.partial = true;
        results.stats.timeout = true;
        results.stats.completed = results.enriched.length;
        results.stats.requested = candidates.length;
      }

      return results;
    };

    // NOTE: results are pushed in input order, one per candidate. Callers rely on
    // this 1:1 ordering to map results back to inputs by index (enrich-contacts.js
    // COI recompute). Preserve it if you refactor this loop.
    for (let i = 0; i < candidates.length; i++) {
      // Deadline reached between candidates → stop and let the route surface a
      // timeout rather than continuing to enrich (and return normal results)
      // after the budget expired.
      if (signal?.aborted) {
        if (returnPartialOnAbort && results.enriched.length > 0) {
          return finalizeResults({ partial: true });
        }
        throw abortError(signal);
      }
      const candidate = candidates[i];

      onProgress({
        overall: {
          current: i + 1,
          total: candidates.length,
          candidate: candidate.name,
        },
      });

      let enriched;
      try {
        enriched = await this.enrichCandidate(candidate, {
          ...options,
          onProgress: (tierProgress) => {
            onProgress({
              overall: { current: i + 1, total: candidates.length, candidate: candidate.name },
              tier: tierProgress,
            });
          },
        });
      } catch (error) {
        if (returnPartialOnAbort && isDeadlineAbort(error, signal) && results.enriched.length > 0) {
          return finalizeResults({ partial: true });
        }
        throw error;
      }

      results.enriched.push(enriched);

      // Update stats
      const ce = enriched.contactEnrichment;
      if (ce.email) {
        results.stats.withEmail++;
        if (ce.emailSource) {
          results.stats.bySource[ce.emailSource] = (results.stats.bySource[ce.emailSource] || 0) + 1;
        }
      }
      if (ce.website) results.stats.withWebsite++;
      if (ce.orcidId) results.stats.withOrcid++;
      if (ce.tiersUsed.includes('claude_search')) {
        results.stats.actualCost += COSTS.CLAUDE_WEB_SEARCH;
      }
      if (ce.tiersUsed.includes('serp_search')) {
        results.stats.actualCost += COSTS.SERP_GOOGLE_SEARCH;
      }
    }

    return finalizeResults();
  }

  /**
   * Estimate the cost of enriching candidates
   *
   * @param {Array} candidates - Candidates to estimate
   * @param {Object} options - Which tiers will be used
   * @returns {Object} Cost estimate
   */
  static estimateCost(candidates, options = {}) { return cost.estimateCost(candidates, options); }

  /**
   * Save enrichment results to Dataverse (only if a potentialreviewer
   * already exists for the enriched email). Stage 8: moved to
   * contact-enrichment/persistence.js (C5, the DAL write unit); the facade
   * keeps this thin delegating static so
   * `jest.spyOn(ContactEnrichmentService, 'saveToDatabase')` and internal
   * `this.saveToDatabase(...)` self-calls (e.g. `_finalize`) still intercept
   * the class-level method (C10).
   */
  static async saveToDatabase(candidate, enrichment) { return persistence.saveToDatabase(candidate, enrichment); }

  /**
   * Claude Web Search implementation (Tier 3). Stage 6: moved to
   * contact-enrichment/search-tiers.js; the facade keeps this thin delegating
   * static so `jest.spyOn(ContactEnrichmentService, 'claudeWebSearch')`
   * (used by Tier-3 callers/tests) still intercepts the class-level method
   * (C10).
   */
  static async claudeWebSearch(candidate, apiKey, options = {}) {
    return searchTiers.claudeWebSearch(candidate, apiKey, options);
  }

  /**
   * Build Google Scholar search URL for a researcher. Stage 6: moved to
   * contact-enrichment/search-tiers.js.
   */
  static buildGoogleScholarUrl(name, affiliation) {
    return searchTiers.buildGoogleScholarUrl(name, affiliation);
  }
}

// Export costs for UI
ContactEnrichmentService.COSTS = COSTS;

module.exports = { ContactEnrichmentService };
