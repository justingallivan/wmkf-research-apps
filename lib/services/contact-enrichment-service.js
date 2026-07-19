/**
 * ContactEnrichmentService - Tiered contact information lookup
 *
 * Implements tiered contact lookup plus an identity-anchored scholarly-email step
 * (NCBI PubMed + Europe PMC) for finding researcher contact information.
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

// W5 caller migration: DatabaseService dropped. Enrichment writebacks now
// target Dataverse `wmkf_potentialreviewer` via the adapter chain (S213: the
// wmkf_appresearcher bibliometric sidecar was collapsed onto the person);
// the prior Postgres-researchers cache tier is removed
// (Dataverse is email-keyed, not name-keyed, so there's no name-lookup
// equivalent during the discovery phase).
const { summarizeContactOutcomes } = require('./reviewer-contact-audit');
// Stage 1/2/4/5/6 removed the facade's OpenAlexService, normalizeOrcid,
// isOpenAlexAuthorAccepted, getModelForApp, safeFetchInstitutionPage, and
// hostWithinDomain imports — now used only inside the extracted modules.
// Stage 9/10 removed the facade's ContactParser, ORCIDService,
// SerpContactService, and reviewer-identity-resolver (resolveIdentity /
// evidenceFromEnrichment / mayPersistIdentity) imports — the tier bodies and
// _finalize/_applyAffiliationOverride that used them moved to
// contact-enrichment/tiers.js, which imports them directly.

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
// Stage 9 (Checkpoint D, highest-risk): the five legacy Tier 0-4 bodies +
// _finalize + _applyAffiliationOverride extracted. The facade's
// enrichCandidate is now a shell that drives applyTier0..4, interprets each
// tier's 'finalize' | 'continue' signal, and calls this._finalize (which
// delegates to tiers.finalize). Tier 3's claudeWebSearch and _finalize's
// saveToDatabase / _applyAffiliationOverride dispatch through `this` (C10 —
// see tiers.js header) so jest.spyOn(ContactEnrichmentService, ...) keeps
// intercepting them.
const tiers = require('./contact-enrichment/tiers');

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
        emailEvidence: null,
        emailAction: 'missing',
        emailActionReason: 'No email address found',
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

    // TIER 0 (affiliation-embedded email) + TIER 1 (PubMed) — Stage 9: bodies
    // live in ./contact-enrichment/tiers.js as applyTier0/applyTier1. Each
    // returns 'finalize' (Tier 0 embedded email) or 'continue'. Tier 1 always
    // continues so the same address can be corroborated across distinct works
    // by the structured NCBI + Europe PMC tier below.
    if (tiers.applyTier0(candidate, result, { onProgress }) === 'finalize') {
      return this._finalize(candidate, result, { persist, onProgress, signal, deadlineAt });
    }
    if (tiers.applyTier1(candidate, result, { usePubmed, onProgress }) === 'finalize') {
      return this._finalize(candidate, result, { persist, onProgress, signal, deadlineAt });
    }

    // TIER 2 (ORCID) — never finalizes; always falls through (including on a
    // swallowed lookup error — see tiers.js).
    await tiers.applyTier2(candidate, result, { useOrcid, credentials, identityAnchor, signal, onProgress });

    const effectiveInstitution = this._effectiveInstitution(candidate, result.contactEnrichment);
    const searchCandidate = this._searchCandidateWithInstitution(candidate, effectiveInstitution);
    const effectiveAnchor = this._anchorWithInstitution(identityAnchor, effectiveInstitution);
    const hasIdentityAnchor = !!effectiveInstitution || this._hasOrcidAnchor(candidate, result.contactEnrichment);

    // Abstain: no institution anchor and no ORCID → a bare-name paid search can
    // only return a namesake, so emit no sendable contact/bibliometrics. Note any
    // affiliation-embedded email already early-returned via _finalize above.
    // Legacy PubMed evidence is allowed to remain only as quick-check; the
    // structured tier itself still requires an identity anchor.
    if (!hasIdentityAnchor) {
      this._markUnanchoredAbstain(result.contactEnrichment);
    }

    // Structured scholarly address evidence (FREE): query both NCBI PubMed and
    // Europe PMC after identity anchoring. The same publication returned by
    // both providers counts once; two distinct recent works are required for
    // invite-ready status.
    await tiers.applyScholarlyTier(searchCandidate, result, {
      usePubmed, hasIdentityAnchor, signal, onProgress,
    });

    // If we already have a recent structured/ORCID address, skip the PAID email
    // search tiers. Bibliometrics and final persistence still run below.
    const emailAlreadyFound = !!(result.contactEnrichment.email && result.contactEnrichment.emailIsRecent);

    // TIER 3 (Claude web search, PAID) — never finalizes; either falls through
    // or THROWS on a deadline/cancel abort (propagates uncaught, same as before).
    await tiers.applyTier3(candidate, result, {
      emailAlreadyFound, hasIdentityAnchor, effectiveAnchor, searchCandidate,
      useClaudeSearch, credentials, onProgress, signal, deadlineAt, service: this,
    });

    // TIER 4 (SerpAPI Google search, PAID) — never finalizes; always falls through.
    await tiers.applyTier4(candidate, result, {
      hasIdentityAnchor, effectiveAnchor, searchCandidate, useSerpSearch, credentials, onProgress,
    });

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
   * Select the unique best page-grounded mailbox. Full-name forms rank first;
   * initials/surname and exact-surname forms require title/sole-H1 identity;
   * exact URL slug and narrow full-forename adjacency are fallbacks. Equal-best
   * ties abstain. This deliberately does not reuse isNameConsistentEmail.
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
   * Stage 9: moved to contact-enrichment/tiers.js; the facade keeps this thin
   * delegating static, passing itself as the `service` so tiers.finalize's
   * internal `service.saveToDatabase` / `service._applyAffiliationOverride`
   * calls keep dispatching through the class (C10).
   */
  static async _finalize(candidate, result, opts = {}) { return tiers.finalize(this, candidate, result, opts); }

  /**
   * Pin the candidate's CURRENT affiliation from the highest-authority,
   * identity-trusted source collected during the tiers (ORCID > OpenAlex >
   * PubMed-recency). Stage 9: moved to contact-enrichment/tiers.js; the facade
   * keeps this thin delegating static (tests pin it by name; tiers.finalize
   * also calls it through `service._applyAffiliationOverride`, C10).
   */
  static _applyAffiliationOverride(result) { return tiers.applyAffiliationOverride(result); }

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
          scholarly_single: 0,
          scholarly_multi: 0,
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
