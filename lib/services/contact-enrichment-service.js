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
const potentialReviewerAdapter = require('../dataverse/adapters/potential-reviewer');
const researcherAdapter = require('../dataverse/adapters/researcher');
const { withDalContext } = require('../dataverse/core/context');
const { resolveIdentity, evidenceFromEnrichment, mayPersistIdentity, RESOLVER_SOURCED_FIELDS } = require('./reviewer-identity-resolver');

const { SerpContactService } = require('./serp-contact-service');
const { summarizeContactOutcomes } = require('./reviewer-contact-audit');
const { safeFetchInstitutionPage, hostWithinDomain } = require('../utils/safe-fetch.js');
const { getModelForApp } = require('../../shared/config/baseConfig');
// Stage 1/2/4 removed the facade's OpenAlexService, normalizeOrcid, and
// isOpenAlexAuthorAccepted imports — now used only inside the extracted modules.

// Stage 0 (docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md): constants and
// abort helpers extracted verbatim to lib/services/contact-enrichment/. The
// facade re-exposes COSTS as a static prop below (ContactEnrichmentService.COSTS).
const {
  CLAUDE_WEB_SEARCH_SCHEMA,
  SEARCH_EMAIL_SOURCES,
  EXPLICIT_EMAIL_PERSIST_SOURCES,
  COSTS,
} = require('./contact-enrichment/constants');
const { abortError, isDeadlineAbort } = require('./contact-enrichment/abort');
// Stage 1: identity-anchor cluster extracted. Facade delegates each (C2 surface).
const identityAnchor = require('./contact-enrichment/identity-anchor');
// Stage 2: domain-evidence cluster extracted. Facade delegates each (C2 surface).
const domainEvidence = require('./contact-enrichment/domain-evidence');
// Stage 4: openalex-metrics cluster extracted. Facade delegates each (C2 surface).
const openAlexMetrics = require('./contact-enrichment/openalex-metrics');
// Stage 7: cost estimation extracted. Facade delegates (C2 surface).
const cost = require('./contact-enrichment/cost');

class ContactEnrichmentService {
  static _identityAnchorForCandidate(candidate = {}) { return identityAnchor.identityAnchorForCandidate(candidate); }

  static _cleanInstitution(value) { return identityAnchor.cleanInstitution(value); }

  static _effectiveInstitution(candidate = {}, enrichment = {}) { return identityAnchor.effectiveInstitution(candidate, enrichment); }

  static _searchCandidateWithInstitution(candidate = {}, institution = null) { return identityAnchor.searchCandidateWithInstitution(candidate, institution); }

  static _anchorWithInstitution(anchor = null, institution = null) { return identityAnchor.anchorWithInstitution(anchor, institution); }

  static _hasOrcidAnchor(candidate = {}, enrichment = {}) { return identityAnchor.hasOrcidAnchor(candidate, enrichment); }

  static _fieldPersistAllowed(enrichment = {}, fieldName, sourceName = null) {
    if (enrichment.contactStatus === 'unresolved') return false;
    if (enrichment[fieldName] === false) return false;
    if (enrichment[fieldName] === true) return true;
    return !EXPLICIT_EMAIL_PERSIST_SOURCES.has(sourceName);
  }

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

  static _markEmailContested(ce, reason) {
    if (!ce?.email) return;
    ce.emailSource = 'search_contested';
    ce.emailPersistAllowed = true;
    ce.websitePersistAllowed = false;
    ce.contactStatus = null;
    ce.contactStatusReason = reason || 'search_contested';
  }

  static _readjudicateNameMismatchRejectedEmail(ce) {
    if (!ce || ce.email) return;
    const plausibleDomains = Array.isArray(ce.plausibleInstitutionDomains) ? ce.plausibleInstitutionDomains : [];
    if (!plausibleDomains.length) return;
    const tr = ce.tierResults || {};
    for (const source of ['claude_search', 'serp_search']) {
      const r = tr[source];
      if (!r || r.emailRejectedReason !== 'name_mismatch' || !r.rejectedEmail) continue;
      if (!this._emailDomainRelatedToAny(r.rejectedEmail, plausibleDomains)) continue;
      ce.email = r.rejectedEmail;
      ce.emailIsRecent = true;
      this._markEmailContested(ce, 'name_mismatch_plausible_contested');
      if (r.facultyPageUrl && !ce.facultyPageUrl) ce.facultyPageUrl = r.facultyPageUrl;
      if (r.website && !ce.website) ce.website = r.website;
      return;
    }
  }

  // ---- Slice 2a: quarantined contact leads (docs/REVIEWER_CONTACT_LEADS_SPEC.md) ----

  /**
   * Single push point for a contact lead. Quarantine guarantee: it FORCE-sets
   * `persistable: false` (no caller can override it), normalizes the spec shape,
   * and dedups by (type, value, source). Leads are staff-facing breadcrumbs only
   * — they never populate email/website/facultyPageUrl or any *_PersistAllowed
   * flag, never make an unresolved identity saveable, and never reach an invite
   * (SPEC §7). Mutates `ce.contactLeads` in place.
   */
  static _addContactLead(ce, lead = {}) {
    if (!ce || !lead || !lead.value) return;
    if (!Array.isArray(ce.contactLeads)) ce.contactLeads = [];
    const value = String(lead.value).trim();
    if (!value) return;
    const type = lead.type || 'email'; // email | website | faculty_page | profile
    const source = lead.source || null;
    const dupe = ce.contactLeads.some((l) => l.type === type && l.value === value && l.source === source);
    if (dupe) return;
    ce.contactLeads.push({
      type,
      value,
      sourceUrl: lead.sourceUrl || null,
      source,
      confidence: lead.confidence || 'low', // high | medium | low | rejected
      persistable: false, // INVARIANT — a lead is never a sendable contact
      rejectedReason: lead.rejectedReason || null,
      warnings: Array.isArray(lead.warnings) ? lead.warnings : [],
      evidence: lead.evidence && typeof lead.evidence === 'object' ? lead.evidence : {},
    });
  }

  /**
   * Slice 2a: surface already-fetched-but-discarded contacts as quarantined
   * leads — NO new network calls. Reads the markers the tiers already stamped on
   * `tierResults` (identity-anchor contradiction + name-mismatch, the latter with
   * the value preserved on `rejectedEmail` before the in-place null) and promotes
   * any faculty/profile page found when no usable email survived. Runs in
   * _finalize AFTER _validateEmailAgainstVerifiedDomain (which captures the
   * verified-domain-contradiction class itself, before it nulls the fields).
   */
  static _collectContactLeads(ce) {
    if (!ce) return;
    // NOTE: this runs regardless of whether a primary email was resolved. A
    // fully-resolved candidate can still carry rejected-tier leads — a tier that
    // ran before the winning tier may have discarded a contact — and surfacing
    // those quarantined discards is intended (they are audit/staff breadcrumbs,
    // never the shown contact). The has_page_no_email page lead below is the only
    // part gated on `!ce.email`, so a resolved candidate is not given a duplicate
    // page lead for the contact it already shows.
    const tr = ce.tierResults || {};
    for (const source of ['claude_search', 'serp_search']) {
      const r = tr[source];
      if (!r || typeof r !== 'object') continue;
      // Anchor contradiction: the whole result is a different person — every
      // field is a rejected lead (kept for audit/staff, never the primary).
      if (r.rejectedReason === 'identity_anchor_contradiction') {
        const sourceUrl = r.facultyPageUrl || r.website || null;
        if (r.email) this._addContactLead(ce, { type: 'email', value: r.email, source, sourceUrl, confidence: 'rejected', rejectedReason: 'identity_anchor_contradiction' });
        if (r.facultyPageUrl) this._addContactLead(ce, { type: 'faculty_page', value: r.facultyPageUrl, source, sourceUrl: r.facultyPageUrl, confidence: 'rejected', rejectedReason: 'identity_anchor_contradiction' });
        if (r.website) this._addContactLead(ce, { type: 'website', value: r.website, source, sourceUrl: r.website, confidence: 'rejected', rejectedReason: 'identity_anchor_contradiction' });
      }
      // Name-mismatch email: local part didn't match this person; the value was
      // preserved on rejectedEmail by the pre-null capture hook in each tier.
      if (r.emailRejectedReason === 'name_mismatch' && r.rejectedEmail) {
        if (ce.emailSource === 'search_contested' && String(ce.email || '').toLowerCase() === String(r.rejectedEmail).toLowerCase()) continue;
        this._addContactLead(ce, { type: 'email', value: r.rejectedEmail, source, confidence: 'rejected', rejectedReason: 'name_mismatch' });
      }
    }
    // Faculty/profile page found but no usable email survived → low-confidence
    // breadcrumb so staff can open it (the has_page_no_email recovery).
    if (!ce.email) {
      if (ce.facultyPageUrl) this._addContactLead(ce, { type: 'faculty_page', value: ce.facultyPageUrl, source: ce.websiteSource || null, sourceUrl: ce.facultyPageUrl, confidence: 'low' });
      if (ce.website) this._addContactLead(ce, { type: 'website', value: ce.website, source: ce.websiteSource || null, sourceUrl: ce.website, confidence: 'low' });
    }
  }

  // Validate the captured contact email against identity-anchored institutional
  // domains, with name-resolved domains allowed only to route into contested LOW.
  // Slice 1b re-sources this domain from the OpenAlex author's institution homepage
  // (`web.mit.edu` → `mit.edu`), ORCID/spine-anchored — a harder identity than the
  // retired Google Scholar self-reported "Verified email at X" hint. This is the
  // precise, signal-grounded replacement for the brittle lexical institution-NAME
  // guard (which wrongly rejected the REAL olga.smirnova@mbi-berlin.de). Runs in
  // _finalize, AFTER the OpenAlex metrics/domain are fetched. Keep-biased: only acts
  // when a verified domain is known — a clear MATCH confirms the contact for
  // persistence; a clear SEARCH-sourced contradiction is kept only as
  // `search_contested` so send time requires staff confirmation. With no domain
  // evidence it trusts the institution-scoped search and leaves the email untouched.
  static _validateEmailAgainstVerifiedDomain(ce) {
    if (!ce || !ce.email) return;
    const anchoredDomains = Array.isArray(ce.anchoredInstitutionDomains)
      ? ce.anchoredInstitutionDomains
      : [ce.verifiedInstitutionDomain].filter(Boolean);
    const plausibleDomains = Array.isArray(ce.plausibleInstitutionDomains)
      ? ce.plausibleInstitutionDomains
      : anchoredDomains;
    if (this._emailDomainRelatedToAny(ce.email, anchoredDomains)) {
      ce.emailPersistAllowed = true;
      return;
    }
    // Only a SEARCH-sourced email (Serp/Claude web scrape) is contested on a domain
    // contradiction — that is the namesake-collapse risk. ORCID/PubMed/affiliation
    // emails are researcher-maintained / publication-grounded and OUTRANK an OpenAlex
    // institutional-domain heuristic (a researcher may publish a personal or
    // cross-institution address), so a domain mismatch never overrides them.
    if (!SEARCH_EMAIL_SOURCES.has(ce.emailSource)) return;
    if (!anchoredDomains.length && !plausibleDomains.length) return;
    const reason = this._emailDomainRelatedToAny(ce.email, plausibleDomains)
      ? 'verified_domain_plausible_contested'
      : 'verified_domain_contradiction_contested';
    this._markEmailContested(ce, reason);
  }

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
  static _normForNameMatch(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/\p{Mn}/gu, '')
      .toLowerCase()
      .replace(/[.,]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Forename + surname tokens for the page forename-gate; null if <2 name tokens. */
  static _parseCandidateName(name) {
    const tokens = this._normForNameMatch(ContactParser.stripHonorifics(name || ''))
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    if (tokens.length < 2) return null;
    return { forename: tokens[0], surname: tokens[tokens.length - 1] };
  }

  /** Email's domain is related to the verified institution domain (email-validation relation). */
  static _emailDomainRelated(email, verifiedDomain) {
    return this._domainRelated(this._emailDomain(email), verifiedDomain);
  }

  /** True when a text window names the candidate with ordered, near-contiguous evidence. */
  static _windowNamesCandidate(window, { forename, surname }) {
    if (!forename || !surname || surname.length < 3) return false;
    const tokens = this._normForNameMatch(window).split(/\s+/).filter(Boolean);
    const NEAR = 3;
    const isForename = (token) => token === forename || token === forename[0];
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] !== surname) continue;
      for (let j = Math.max(0, i - NEAR); j < i; j++) {
        if (isForename(tokens[j])) return true;
      }
      for (let j = i + 1; j <= Math.min(tokens.length - 1, i + NEAR); j++) {
        if (isForename(tokens[j])) return true;
      }
    }
    return false;
  }

  /** Personal-page handle from a URL: `/~phbuck/` → `phbuck`, else last path segment. */
  static _personalPageSlug(pageUrl) {
    let pathname;
    try { pathname = new URL(pageUrl).pathname; } catch { return null; }
    const tilde = pathname.match(/\/~([a-z0-9._-]+)/i);
    if (tilde) return tilde[1].toLowerCase();
    const segs = pathname.split('/').filter(Boolean);
    return segs.length ? segs[segs.length - 1].toLowerCase().replace(/\.(html?|php|aspx?)$/, '') : null;
  }

  static _slugNamesCandidate(slug, { forename, surname }) {
    const compact = String(slug || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!compact || !forename || !surname || surname.length < 3) return false;
    if (compact.includes(surname)) return true;
    const stemLength = Math.min(surname.length, 4);
    const surnameStem = surname.slice(0, stemLength);
    const idx = compact.indexOf(surnameStem);
    if (idx < 0) return false;
    const prefix = compact.slice(0, idx);
    if (!prefix) return false;
    return prefix === forename[0] || forename.startsWith(prefix);
  }

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
  static _selectGroundedEmail(name, text, emails, verifiedDomain, { identityText = '', pageUrl = '' } = {}) {
    const parsed = this._parseCandidateName(name);
    if (!parsed || !Array.isArray(emails) || !emails.length) return null;
    const ASSOC_WINDOW = 100;
    // Page-identity zone = <title>/<h1..3> PLUS the leading body region. Senior-faculty
    // pages are often hand-built (no proper <title>/<h1>) yet name the person near the
    // top (e.g. "Phil's CV / Philip Bucksbaum …"). The slug route below still also
    // requires localPart === the page's own URL handle, so widening identity here
    // cannot, by itself, attach a non-owner address.
    const identityZone = `${identityText} ${text.slice(0, 800)}`;
    const pageIdentifiesCandidate = this._windowNamesCandidate(identityZone, parsed);
    const slug = pageIdentifiesCandidate ? this._personalPageSlug(pageUrl) : null;
    const associated = new Set();
    for (const { email, index } of emails) {
      if (!this._emailDomainRelated(email, verifiedDomain)) continue;
      const window = text.slice(Math.max(0, index - ASSOC_WINDOW), index + ASSOC_WINDOW);
      const localPart = email.slice(0, email.indexOf('@')).toLowerCase();
      const adjacency = this._windowNamesCandidate(window, parsed);
      const ownerMatch = !!slug && localPart === slug && this._slugNamesCandidate(slug, parsed);
      if (adjacency || ownerMatch) associated.add(email);
    }
    return associated.size === 1 ? [...associated][0] : null;
  }

  /** Captured profile/lab URLs to try, most person-specific first; drop search/aggregator links. */
  static _orderCandidateUrls(ce, name) {
    const parsed = this._parseCandidateName(name);
    const surname = parsed?.surname || '';
    const skipHost = /(^|\.)(scholar\.google\.|google\.|orcid\.org|researchgate\.net|linkedin\.com)/i;
    const urls = [ce.facultyPageUrl, ce.website].filter((u) => typeof u === 'string' && u.trim());
    const seen = new Set();
    const cleaned = [];
    for (const u of urls) {
      let host;
      try { host = new URL(u).hostname; } catch { continue; }
      if (skipHost.test(host)) continue;
      // Never fetch a document/media file. facultyPageUrl from the Claude tier is
      // captured without isFacultyPageUrl's gate, so a PDF could reach here; the
      // shared document gate keeps the email tier off non-page files.
      if (ContactParser.isDocumentUrl(u)) continue;
      if (seen.has(u)) continue;
      seen.add(u);
      cleaned.push(u);
    }
    // Person-specific (surname/name token in the URL) first.
    return cleaned.sort((a, b) => {
      const aHit = surname && a.toLowerCase().includes(surname) ? 0 : 1;
      const bHit = surname && b.toLowerCase().includes(surname) ? 0 : 1;
      return aHit - bHit;
    });
  }

  /**
   * Fetch a captured faculty/profile page (SSRF-bound to anchored institution domains)
   * and recover a page-grounded institutional email. Runs only behind the
   * REVIEWER_PAGE_EMAIL_TIER_ENABLED flag, only when the domain is verified, and only
   * when there is no trusted email yet (a low-trust serp/claude email may be
   * replaced). Best-effort: every error is recorded and swallowed EXCEPT a
   * deadline/cancel abort, which propagates like the other tiers. Mutates
   * result.contactEnrichment in place.
   */
  static async _attachEmailFromResolvedPage(candidate, result, { signal, deadlineAt, onProgress = () => {} } = {}) {
    if (process.env.REVIEWER_PAGE_EMAIL_TIER_ENABLED !== 'true') return;
    const ce = result.contactEnrichment;
    if (!ce) return;
    const anchoredDomains = Array.isArray(ce.anchoredInstitutionDomains) && ce.anchoredInstitutionDomains.length
      ? ce.anchoredInstitutionDomains
      : (ce.verifiedInstitutionDomain ? [ce.verifiedInstitutionDomain] : []);
    if (!anchoredDomains.length) return;
    const replaceable = !ce.email || SEARCH_EMAIL_SOURCES.has(ce.emailSource) || ce.emailSource === 'search_contested';
    if (!replaceable) return; // an already-trusted email (orcid/pubmed/affiliation) wins

    const urls = this._orderCandidateUrls(ce, candidate.name);
    if (!urls.length) return;

    for (const url of urls) {
      if (signal?.aborted) throw abortError(signal);
      let host;
      try { host = new URL(url).hostname; } catch { continue; }
      const verifiedDomain = anchoredDomains.find((domain) => hostWithinDomain(host, domain));
      if (!verifiedDomain) {
        ce.tierResults.institution_page = { url, skipped: 'host_not_in_verified_domain' };
        continue;
      }
      const remainingMs = deadlineAt != null ? Math.max(1, deadlineAt - Date.now()) : 8000;
      const timeoutMs = Math.min(8000, remainingMs);
      try {
        onProgress({ tier: 5, status: 'searching', message: `Reading ${host} for a contact email…` });
        const page = await safeFetchInstitutionPage(url, { allowedDomain: verifiedDomain, signal, timeoutMs });
        if (!page || !page.ok || !page.text) {
          ce.tierResults.institution_page = { url, skipped: page ? `status_${page.status}` : 'no_response' };
          continue;
        }
        const { text, identityText, emails } = ContactParser.extractEmailsFromHtml(page.text);
        const grounded = this._selectGroundedEmail(candidate.name, text, emails, verifiedDomain, {
          identityText,
          pageUrl: page.finalUrl || url,
        });
        if (grounded) {
          ce.email = grounded;
          ce.emailSource = 'institution_page';
          ce.emailIsRecent = true;
          ce.emailPersistAllowed = true;
          ce.facultyPageUrl = ce.facultyPageUrl || (page.finalUrl || url);
          ce.contactStatus = null;
          ce.contactStatusReason = null;
          ce.tierResults.institution_page = { url: page.finalUrl || url, email: grounded, grounding: 'candidate_associated_unique' };
          onProgress({ tier: 5, status: 'found', message: 'Found a verified institutional email on the faculty page' });
          return;
        }
        ce.tierResults.institution_page = { url, skipped: 'no_grounded_email' };
      } catch (err) {
        if (signal?.aborted) throw err;
        ce.tierResults.institution_page = { url, error: err.message };
      }
    }
  }

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
   * already exists for the enriched email).
   *
   * W5 caller migration: previously wrote to Postgres `researchers` via
   * `DatabaseService.createOrUpdateResearcher`. Now writes to Dataverse:
   *   1. `wmkf_potentialreviewer` (email-keyed canonical person record)
   *      — only if a row already exists for this email (mirrors prior
   *      "only update if researcher already exists" gating)
   *   2. bibliometric fields on `wmkf_potentialreviewer` (S213: formerly the
   *      `wmkf_appresearcher` 1:1 sidecar, now folded onto the person)
   *
   * The condition "researcher hasn't been saved by user yet — skip" maps
   * to "no `wmkf_potentialreviewer` row exists for this email yet — skip"
   * since save-candidates.js (the user-explicit-save path) is the only
   * code creating those rows.
   */
  static async saveToDatabase(candidate, enrichment) {
    if (!enrichment?.email) return;
    const emailAllowed = this._fieldPersistAllowed(enrichment, 'emailPersistAllowed', enrichment.emailSource);
    const websiteAllowed = this._fieldPersistAllowed(enrichment, 'websitePersistAllowed', enrichment.websiteSource);
    const affiliationAllowed = enrichment.affiliationPersistAllowed !== false && enrichment.contactStatus !== 'unresolved';
    if (!emailAllowed) return;

    // Establish a Dynamics context for this save (Codex W5-step-1 Q7).
    // DynamicsService.queryRecords fails closed without an ALS/bypass
    // context; some callers of contact-enrichment establish one upstream
    // (e.g. save-candidates.js), but enrichment runs from multiple paths
    // — wrap defensively so a missing-context environment doesn't
    // silently swallow the failure through the catch below.
    return withDalContext('contact-enrichment-save', async () => {
      let prUpdated = false;
      // Persist the effective (post-override) current affiliation when the
      // identity-gated pin fired — falls back to the original discovery
      // affiliation otherwise (S224 #15). upsertByEmail is fill-only, so this
      // only fills an empty field; it never clobbers a staff edit.
      const effectiveAffiliation = affiliationAllowed ? (enrichment.affiliation || candidate.affiliation) : null;
      const website = websiteAllowed ? enrichment.website : null;
      const rawFacultyPageUrl = websiteAllowed ? enrichment.facultyPageUrl : null;
      const facultyPageUrl = rawFacultyPageUrl && !ContactParser.isDocumentUrl(rawFacultyPageUrl) ? rawFacultyPageUrl : null;
      try {
        const existing = await potentialReviewerAdapter.getByEmail(enrichment.email);
        if (!existing) {
          // Person not yet saved by user — skip. Mirrors prior PG behavior.
          return;
        }

        // 1. Update potentialreviewer with newly enriched fields. The
        //    adapter's upsertByEmail is "fill-only" — it preserves staff
        //    edits and only fills empty fields, which is exactly the
        //    behavior we want here.
        await potentialReviewerAdapter.upsertByEmail({
          name: candidate.name,
          email: enrichment.email,
          affiliation: effectiveAffiliation,
        });
        prUpdated = true;

        // 2. Update sidecar researcher row with the bibliometric/contact
        //    enrichment payload. potentialReviewerId is the existing row's
        //    PK (note: `wmkf_potentialreviewersid` plural-with-s, see W4
        //    backfill notes). A failure here AFTER step 1 succeeded
        //    leaves the system mid-update (potentialreviewer has fresh
        //    data, sidecar doesn't) — log distinguishably so the partial-
        //    failure state is visible vs. a clean skip (Codex W5-step-1
        //    Q3).
        // Identity gate (Phase 2) — this email-keyed side path (enrich-contacts
        // with persist:true) must honor the resolver verdict too, or merely
        // enriching can persist an unresolved/wrong ORCID/Scholar onto a person.
        // Fail-open like the id-keyed paths: act only on an actual <probable
        // verdict (don't wipe data on a resolver error or an un-enriched re-save).
        const identity = enrichment.identity || null;
        const blockByIdentity = !!identity && !mayPersistIdentity(identity.status);
        // Phase-1 fallback (no resolver verdict): the OpenAlex author was skipped
        // (no anchor / unresolved / identity gate failed). Slice 1b renamed this
        // tierResult from `scholar_profile` to `openalex_author`.
        const blockScholar = !!enrichment.tierResults?.openalex_author?.skipped || blockByIdentity;
        const personId = existing.wmkf_potentialreviewersid;
        try {
          await researcherAdapter.upsertByPotentialReviewer(
            personId,
            {
              name: candidate.name,
              email: enrichment.email,
              emailSource: enrichment.emailSource,
              orcid: blockByIdentity ? null : enrichment.orcidId,
              orcidUrl: blockByIdentity ? null : enrichment.orcidUrl,
              googleScholarUrl: blockScholar ? null : enrichment.googleScholarUrl,
              affiliation: effectiveAffiliation,
              facultyPageUrl,
              website,
            },
          );
          // Record the verdict; clear stale resolver-sourced fields on downgrade.
          if (identity) {
            await researcherAdapter.writeIdentityDecision(personId, identity);
            if (blockByIdentity) await researcherAdapter.clearIdentityFields(personId, RESOLVER_SOURCED_FIELDS);
          }
        } catch (sidecarErr) {
          console.error(
            `Dataverse enrichment partial-failure: potentialreviewer ${existing.wmkf_potentialreviewersid} updated, ` +
              `but sidecar researcher upsert failed: ${sidecarErr.message}`,
          );
          throw sidecarErr;
        }
      } catch (error) {
        if (prUpdated) {
          // Already logged the partial-failure context above; the outer
          // catch is just to keep the original "log + return" contract.
          return;
        }
        console.error('Dataverse enrichment save error:', error.message);
      }
    });
  }

  /**
   * Claude Web Search implementation (Tier 3)
   * Uses Claude's web_search tool to find contact information
   * Uses Haiku for cost efficiency with a minimal prompt
   * Temperature set to 0.2 for deterministic, accurate contact extraction
   */
  static async claudeWebSearch(candidate, apiKey, { signal, deadlineAt } = {}) {
    // Extract just institution name for cleaner search
    const institution = candidate.affiliation
      ? candidate.affiliation.split(',')[0].trim()
      : '';

    // Clean name by removing honorifics (Dr., Prof., etc.)
    const cleanName = ContactParser.stripHonorifics(candidate.name);

    // The candidate name/affiliation are U-EXT discovery data (A7 Part 6) —
    // wrap them in nonce-bearing sentinels and harden the system prompt so a
    // malicious "name" cannot inject instructions. This file is CommonJS;
    // the boundary helpers are ESM, so import dynamically.
    const { wrapUntrustedContent, buildUntrustedContentPreamble, DATA_CLASSES } =
      await import('../utils/ai-payload-boundary.js');
    const wrappedCandidate = wrapUntrustedContent({
      text: `Name: ${cleanName}\nInstitution: ${institution || 'unknown'}`,
      source: 'contact-enrichment.candidate',
      dataClass: DATA_CLASSES.EXTERNAL_API_TEXT,
      maxChars: 2_000,
      label: 'candidate identity',
    });

    // Route through the canonical LLMClient wrapper (SSRF allowlist, abortable
    // timeout, 429/529 retry, API-key redaction) instead of a raw Anthropic
    // fetch (A7 follow-up step 5). The `web_search` tool is preserved via
    // `complete()`'s `tools` passthrough. This file is CommonJS; LLMClient is
    // ESM, so import dynamically.
    const { LLMClient } = await import('./llm-client.js');
    const clientOpts = {
      apiKey,
      model: getModelForApp('contact-enrichment'),
      appName: 'contact-enrichment',
    };
    // Under a reviewer-search deadline, bound this attempt by min(remaining
    // budget, 180s); otherwise leave the LLMClient default (120s).
    if (deadlineAt != null) {
      const remainingMs = deadlineAt - Date.now();
      clientOpts.timeoutMs = Math.max(1, Math.min(remainingMs, 180_000));
    }
    const client = new LLMClient(clientOpts);

    let result;
    try {
      result = await client.complete({
        maxTokens: 256,
        temperature: 0.2, // Low temperature for accurate, deterministic contact extraction
        system: buildUntrustedContentPreamble([wrappedCandidate.nonce]),
        signal,
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: 1,
          },
        ],
        messages: [
          {
            role: 'user',
            content: `Find the verified institutional email address and faculty/profile page for the researcher identified in the untrusted block below, using the web_search results.

RULES (this contact will be used to send an invitation, so accuracy matters more than completeness):
- Only return an email you actually found published on an authoritative page (faculty directory, lab site, or institutional page) for THIS EXACT person at THIS institution.
- If you cannot find a real published email for this specific person, set "email" to null. NEVER guess, construct, infer, or pattern-match an address (e.g. "firstname@gmail.com"). A null email is the correct, expected answer when none is published.
- Never return an email that belongs to a different person who merely shares part of the name.

Return ONLY JSON: {"email": <string|null>, "facultyPageUrl": <string|null>, "website": <string|null>}\n\n${wrappedCandidate.text}`,
          },
        ],
      });
    } catch (e) {
      // Preserve a deadline/cancel abort as-is so the route can surface a
      // timeout rather than a generic "Claude API error".
      if (signal?.aborted) throw e;
      throw new Error(`Claude API error: ${e.message}`);
    }

    // `result.text` joins all text content blocks (the web_search tool also
    // emits non-text blocks, which we don't need here).
    const responseText = result.text;
    if (!responseText) {
      return null;
    }

    // Parse + validate JSON from response (A7 Part 6) — drop any keys an
    // injected model added before the contact record is used.
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const { validateAiJson } = await import('../utils/ai-output-schema.js');
        const validated = validateAiJson(parsed, CLAUDE_WEB_SEARCH_SCHEMA);
        if (validated.ok) {
          const value = validated.value;
          // Grounding guard: the web_search tier is the only contact source that
          // can hallucinate or surface a same-named different person's address
          // (Anthropic web_search page content is encrypted, so we can't verify
          // against the result text directly). Reject any returned email whose
          // local part doesn't plausibly match THIS person's name before it can
          // be used to send an invitation. Faculty page / website are kept.
          if (value.email && !ContactParser.isNameConsistentEmail(value.email, candidate.name)) {
            value.emailRejectedReason = 'name_mismatch';
            value.rejectedEmail = value.email; // preserved for the quarantined lead (Slice 2a)
            value.email = null;
          }
          return value;
        }
        console.warn('Contact enrichment output failed schema validation:', validated.errors.join('; '));
      }
    } catch (e) {
      console.error('Failed to parse Claude response:', e.message);
    }

    return null;
  }

  /**
   * Build Google Scholar search URL for a researcher
   */
  static buildGoogleScholarUrl(name, affiliation) {
    if (!name) return null;

    // Clean up name
    const cleanName = name.replace(/^(Dr\.?|Prof\.?|Professor)\s+/i, '').trim();

    // Extract institution name from affiliation
    let institution = '';
    if (affiliation) {
      const parts = affiliation.split(',').map(p => p.trim());
      const instPart = parts.find(p =>
        /university|institute|college/i.test(p) &&
        !/^(department|dept|division|school)/i.test(p)
      );
      institution = instPart || parts[0] || '';
    }

    const query = institution ? `${cleanName} ${institution}` : cleanName;
    return `https://scholar.google.com/citations?view_op=search_authors&mauthors=${encodeURIComponent(query)}`;
  }
}

// Export costs for UI
ContactEnrichmentService.COSTS = COSTS;

module.exports = { ContactEnrichmentService };
