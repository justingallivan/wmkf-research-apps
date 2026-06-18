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
const { bypassDynamicsRestrictions } = require('./dynamics-context');
const { resolveIdentity, evidenceFromEnrichment, mayPersistIdentity, isOpenAlexAuthorAccepted, RESOLVER_SOURCED_FIELDS } = require('./reviewer-identity-resolver');
const { OpenAlexService } = require('./openalex-service');

// A7 Part 6: output schema for the Tier-3 Claude web-search contact lookup.
// Validated after JSON.parse so an injected model cannot smuggle extra keys
// into the contact record.
const CLAUDE_WEB_SEARCH_SCHEMA = {
  type: 'object',
  fields: {
    email: { type: 'string', required: false, default: null, nullable: true, maxLength: 320 },
    facultyPageUrl: { type: 'string', required: false, default: null, nullable: true, maxLength: 2_000 },
    website: { type: 'string', required: false, default: null, nullable: true, maxLength: 2_000 },
  },
};
const { SerpContactService } = require('./serp-contact-service');
const { safeFetchInstitutionPage, hostWithinDomain } = require('../utils/safe-fetch.js');
const { getModelForApp } = require('../../shared/config/baseConfig');
const { normalizeOrcid } = require('./reviewer-work-author-resolver');

// Cost estimates for UI display
// Haiku: $0.80/MTok input, $4/MTok output + $0.01/search
// SerpAPI: ~$50/5000 searches = $0.01 per search, but we use num=10 results so ~$0.005
const COSTS = {
  PUBMED: 0,
  ORCID: 0,
  CLAUDE_WEB_SEARCH: 0.015, // ~$0.01 search + ~$0.005 Haiku tokens
  SERP_GOOGLE_SEARCH: 0.005, // ~$0.005 per search (cheaper than Claude)
};

/** Normalize an aborted signal's reason into an Error to throw out of a loop. */
function abortError(signal) {
  const r = signal?.reason;
  if (r instanceof Error) return r;
  const e = new Error('reviewer_time_budget_exceeded');
  e.code = 'reviewer_time_budget_exceeded';
  return e;
}

class ContactEnrichmentService {
  static _identityAnchorForCandidate(candidate = {}) {
    const orcid = normalizeOrcid(candidate.orcid || candidate.orcidId || candidate.contactEnrichment?.orcidId);
    if (!orcid) return null;
    return {
      orcid,
      institution: candidate.affiliation || candidate.institution || candidate.primaryAffiliation || null,
    };
  }

  static _cleanInstitution(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  static _effectiveInstitution(candidate = {}, enrichment = {}) {
    return this._cleanInstitution(enrichment.orcidAffiliation)
      || this._cleanInstitution(candidate.affiliation)
      || this._cleanInstitution(candidate.institution)
      || this._cleanInstitution(candidate.primaryAffiliation)
      || null;
  }

  static _searchCandidateWithInstitution(candidate = {}, institution = null) {
    if (!institution) return candidate;
    return { ...candidate, affiliation: institution };
  }

  static _anchorWithInstitution(anchor = null, institution = null) {
    if (!anchor && !institution) return null;
    return {
      ...(anchor || {}),
      institution: institution || anchor?.institution || null,
    };
  }

  static _hasOrcidAnchor(candidate = {}, enrichment = {}) {
    return !!normalizeOrcid(candidate.orcid || candidate.orcidId || enrichment.orcidId);
  }

  static _fieldPersistAllowed(enrichment = {}, fieldName, sourceName = null) {
    if (enrichment.contactStatus === 'unresolved') return false;
    if (enrichment[fieldName] === false) return false;
    if (enrichment[fieldName] === true) return true;
    return !['claude_search', 'serp_search'].includes(sourceName);
  }

  static _markUnanchoredAbstain(enrichment = {}) {
    enrichment.contactStatus = 'unresolved';
    enrichment.contactStatusReason = 'identity_anchor_required';
    enrichment.email = null;
    enrichment.emailSource = null;
    enrichment.website = null;
    enrichment.websiteSource = null;
    enrichment.facultyPageUrl = null;
    enrichment.googleScholarId = null;
    enrichment.googleScholarUrl = null;
    enrichment.hIndex = null;
    enrichment.i10Index = null;
    enrichment.totalCitations = null;
    enrichment.openAlexAffiliation = null;
    enrichment.verifiedInstitutionDomain = null;
    enrichment.emailPersistAllowed = false;
    enrichment.websitePersistAllowed = false;
    enrichment.affiliationPersistAllowed = false;
    enrichment.scholarPersistAllowed = false;
  }

  static async _getAnchoredOrcidProfile(orcid, credentials = {}, signal) {
    const profile = await ORCIDService.getProfile(
      orcid,
      credentials.orcidClientId,
      credentials.orcidClientSecret,
      signal ? { signal } : {},
    );
    if (!profile) {
      return {
        status: 'resolved',
        orcidId: orcid,
        orcidUrl: `https://orcid.org/${orcid}`,
        name: null,
        source: 'orcid_anchor',
        identityStatus: 'probable',
      };
    }
    return {
      status: 'resolved',
      orcidId: profile.orcidId,
      orcidUrl: profile.orcidUrl,
      name: profile.creditName || `${profile.givenNames || ''} ${profile.familyName || ''}`.trim(),
      email: profile.primaryEmail,
      website: profile.primaryUrl,
      affiliation: profile.currentAffiliation,
      institutionCorroborated: false,
      matchedInstitution: null,
      source: 'orcid_anchor',
      identityStatus: 'probable',
    };
  }

  static _institutionTokens(value) {
    return ContactParser.normalizeNameForMatch(value || '')
      .split(/\s+/)
      .filter((token) => token.length >= 4 && !['department', 'university', 'institute', 'school', 'college'].includes(token));
  }

  static _institutionsContradict(anchorInstitution, resultInstitution) {
    if (!anchorInstitution || !resultInstitution) return false;
    const anchorTokens = new Set(this._institutionTokens(anchorInstitution));
    const resultTokens = this._institutionTokens(resultInstitution);
    if (!anchorTokens.size || !resultTokens.length) return false;
    return !resultTokens.some((token) => anchorTokens.has(token));
  }

  static _resultContradictsAnchor(result = {}, anchor = null) {
    if (!anchor) return false;
    const resultOrcid = normalizeOrcid(result.orcid || result.orcidId);
    if (resultOrcid && anchor.orcid && resultOrcid !== anchor.orcid) return true;
    const resultInstitution = result.affiliation || result.institution || result.organization || null;
    return this._institutionsContradict(anchor.institution, resultInstitution);
  }

  // Normalize a domain for comparison: extract the host, lowercase, strip hyphens
  // (Google Scholar drops them in its "Verified email at X" hint, so its
  // mbiberlin.de must compare equal to the real mbi-berlin.de).
  static _normalizeDomain(value) {
    if (!value) return null;
    const m = String(value).toLowerCase().match(/[a-z0-9.-]+\.[a-z]{2,}/);
    return m ? m[0].replace(/-/g, '') : null;
  }

  static _emailDomain(email) {
    if (!email || !String(email).includes('@')) return null;
    return this._normalizeDomain(String(email).split('@').pop());
  }

  // Validate the captured contact email against the VERIFIED institutional domain.
  // Slice 1b re-sources this domain from the OpenAlex author's institution homepage
  // (`web.mit.edu` → `mit.edu`), ORCID/spine-anchored — a harder identity than the
  // retired Google Scholar self-reported "Verified email at X" hint. This is the
  // precise, signal-grounded replacement for the brittle lexical institution-NAME
  // guard (which wrongly rejected the REAL olga.smirnova@mbi-berlin.de). Runs in
  // _finalize, AFTER the OpenAlex metrics/domain are fetched. Keep-biased: only acts
  // when a verified domain is known — a clear MATCH confirms the contact for
  // persistence; a clear CONTRADICTION drops it as a likely namesake (the
  // olga.smirnova@…ifmo.ru class). With no verified domain it trusts the
  // institution-scoped search and leaves the email untouched.
  static _validateEmailAgainstVerifiedDomain(ce) {
    if (!ce || !ce.email) return;
    const verified = this._normalizeDomain(ce.verifiedInstitutionDomain);
    if (!verified) return;
    const emailDom = this._emailDomain(ce.email);
    if (!emailDom) return;
    // Label-boundary match only — exact, or one is a true subdomain of the other.
    // NO bare substring (which wrongly made summit.edu match mit.edu, or
    // notred.ac.uk.evil match ed.ac.uk). Hyphen-insensitive via _normalizeDomain.
    const related = emailDom === verified
      || emailDom.endsWith(`.${verified}`)
      || verified.endsWith(`.${emailDom}`);
    if (related) {
      ce.emailPersistAllowed = true;
      return;
    }
    // Only a SEARCH-sourced email (Serp/Claude web scrape) is dropped on a domain
    // contradiction — that is the namesake-collapse risk. ORCID/PubMed/affiliation
    // emails are researcher-maintained / publication-grounded and OUTRANK a Scholar
    // institutional-domain heuristic (a researcher may publish a personal or
    // cross-institution address), so a domain mismatch never overrides them.
    if (ce.emailSource !== 'serp_search' && ce.emailSource !== 'claude_search') return;
    ce.email = null;
    ce.emailSource = null;
    ce.emailPersistAllowed = false;
    ce.website = null;
    ce.websiteSource = null;
    ce.facultyPageUrl = null;
    ce.websitePersistAllowed = false;
    ce.contactStatus = ce.contactStatus || 'unresolved';
    ce.contactStatusReason = ce.contactStatusReason || 'verified_domain_contradiction';
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
          if (claudeResult.facultyPageUrl) {
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

  /**
   * Attach real bibliometrics (h-index / i10 / citations) + a current-affiliation
   * candidate + the verified institutional domain from OpenAlex (Slice 1b — replaces
   * the retired SerpAPI google_scholar_author calls). FREE, so it runs regardless of
   * the paid SerpAPI toggle — gated only on a trusted identity anchor. Best-effort: a
   * null/failed lookup leaves the metrics unset and never breaks enrichment. Mutates
   * `result.contactEnrichment` in place. Honors the abort `signal` (reviewer-search
   * deadline). The accepted author rides on `tierResults.openalex_author` (the 1a DTO);
   * the resolver re-proves acceptance — this method gates with the SAME allowlist
   * (`isOpenAlexAuthorAccepted`) so metrics/domain attach ONLY for an accepted author.
   *
   * Two accept paths (1a contract):
   *   - ORCID (hard key): getAuthorByOrcid(orcid) → DTO carries the record's orcid +
   *     the looked-up `claimedOrcid` (the resolver re-proves they match).
   *   - Spine: the discovery spine already resolved an OpenAlex author for this
   *     candidate (`candidate.openAlexId` + `candidate.identityStatus`); reuse that
   *     verdict (sourced, not asserted) and fetch metrics via getAuthorById — the spine
   *     is NOT re-run in the hot path. `identityStatus` already incorporated the forename
   *     gate, so `forenameContradicts` is omitted (undefined → resolver forename check passes).
   * No anchor, or no accepted author → ABSTAIN (no metrics/domain; leave the free Scholar
   * search link), mirroring the old Scholar-mismatch skip.
   */
  static async _attachOpenAlexMetrics(candidate, result, { signal, onProgress = () => {} } = {}) {
    const ce = result.contactEnrichment;
    const orcid = normalizeOrcid(candidate.orcid || candidate.orcidId || ce.orcidId);
    // Discovery attaches a resolved OpenAlex author id under TWO field names: the
    // OpenAlex/ORCID spine uses `openAlexId` (mapSpineVerificationResult), Track-B
    // work-grounding uses `openAlexAuthorId` (mapTrackBIdentityResult). Both pair with a
    // resolver-vocabulary `identityStatus` (confirmed/probable when trusted, else unresolved).
    const carriedAuthorId = candidate.openAlexId || candidate.openAlexAuthorId || null;
    const carriedStatus = candidate.identityStatus || null;

    if (!orcid && !(carriedAuthorId && carriedStatus)) {
      ce.scholarPersistAllowed = false;
      ce.tierResults.openalex_author = { skipped: 'identity_anchor_required' };
      onProgress({ tier: 4, status: 'skipped', message: `Bibliometrics skipped — no identity anchor for ${candidate.name}` });
      return;
    }

    try {
      let author = null;
      let dto = null;

      if (orcid) {
        author = await OpenAlexService.getAuthorByOrcid(orcid, { signal });
        if (author) {
          // 1b producer constraints: `orcid` = the record's returned ORCID, `claimedOrcid`
          // = the ORCID we looked up (already checksum-validated by getAuthorByOrcid);
          // `openAlexId` = the canonical mapAuthorRecord id (never an assembled URL).
          dto = this._buildOpenAlexAuthorDto(author, {
            acceptPath: 'orcid',
            orcid: author.orcid,
            claimedOrcid: orcid,
          });
        }
      }
      if (!author && carriedAuthorId && carriedStatus) {
        author = await OpenAlexService.getAuthorById(carriedAuthorId, { signal });
        if (author) {
          dto = this._buildOpenAlexAuthorDto(author, {
            acceptPath: 'spine',
            identityStatus: carriedStatus,
          });
        }
      }

      if (!author || !dto) {
        ce.scholarPersistAllowed = false;
        ce.tierResults.openalex_author = { skipped: 'openalex_author_unresolved' };
        onProgress({ tier: 4, status: 'not_found', message: `No OpenAlex author resolved for ${candidate.name}` });
        return;
      }

      // Re-prove acceptance with the SAME allowlist the resolver uses (one gate, no drift).
      // A non-accepted author (e.g. the ORCID record's id differs from the looked-up ORCID)
      // contributes NO metrics/affiliation/domain — mirrors the old Scholar name/institution-
      // mismatch abstain. The DTO is still recorded (with a skip reason) for transparency;
      // the resolver re-evaluates it into a rejected anchor.
      if (!isOpenAlexAuthorAccepted(dto)) {
        ce.scholarPersistAllowed = false;
        ce.tierResults.openalex_author = { ...dto, skipped: 'identity_gate_failed' };
        onProgress({ tier: 4, status: 'skipped', message: `Bibliometrics skipped — OpenAlex identity gate failed for ${candidate.name}` });
        return;
      }

      ce.tierResults.openalex_author = dto;
      ce.scholarPersistAllowed = true;
      ce.hIndex = author.hIndex;
      ce.i10Index = author.i10Index;
      ce.totalCitations = author.citedByCount;
      // #2 dropped (open decision): OpenAlex exposes no Google Scholar `user=` id, so new
      // candidates keep the free buildGoogleScholarUrl search link. googleScholarId = null.
      ce.googleScholarId = null;

      // Current-affiliation override CANDIDATE (authority 2, below ORCID) — replaces the
      // retired Scholar `scholarAffiliations`. Collected here; the override is applied in
      // _finalize gated on the resolver verdict.
      if (typeof author.lastKnownInstitution === 'string' && author.lastKnownInstitution.trim()) {
        ce.openAlexAffiliation = author.lastKnownInstitution.trim();
      }

      // Verified-domain guard re-sourced from the author's institution homepage. Best-effort:
      // a failed institution lookup just leaves the guard unsourced (keeps the email untouched).
      const instRef = author.lastKnownInstitutionId || author.lastKnownInstitutionRor;
      if (instRef) {
        try {
          const inst = await OpenAlexService.getInstitution(instRef, { signal });
          if (inst?.domain) ce.verifiedInstitutionDomain = inst.domain;
        } catch (instErr) {
          if (signal?.aborted) throw instErr;
          console.error('OpenAlex institution lookup error:', instErr.message);
        }
      }

      onProgress({
        tier: 4,
        status: 'found',
        message: `Found citation metrics${author.citedByCount != null ? ` (${author.citedByCount} citations, h-index ${author.hIndex ?? '—'})` : ''}`,
      });
    } catch (err) {
      // A deadline/cancel abort must propagate so enrichCandidates() stops; other errors
      // are best-effort (metrics are optional). Record a distinguishable skip marker so
      // an OpenAlex OUTAGE is not silently indistinguishable from "no anchor / not run"
      // (Codex S251 LOW), and so the persistence/UI fallbacks fail closed on it.
      if (signal?.aborted) throw err;
      console.error('OpenAlex metrics error:', err.message);
      ce.scholarPersistAllowed = false;
      ce.tierResults.openalex_author = { skipped: 'openalex_error', error: err.message };
    }
  }

  /**
   * Build the `tierResults.openalex_author` evidence DTO (Slice 1a contract shape). Only
   * the canonical `mapAuthorRecord.openAlexId` is passed (1b constraint #2); metrics ride
   * along for this method's own use. `identity` carries the path-specific proof fields.
   */
  static _buildOpenAlexAuthorDto(author, identity) {
    return {
      openAlexId: author.openAlexId,
      displayName: author.displayName,
      lastKnownInstitution: author.lastKnownInstitution,
      ror: author.lastKnownInstitutionRor || null,
      ...identity,
      hIndex: author.hIndex,
      i10Index: author.i10Index,
      citedByCount: author.citedByCount,
    };
  }

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
    const ed = this._emailDomain(email);
    const vd = this._normalizeDomain(verifiedDomain);
    if (!ed || !vd) return false;
    return ed === vd || ed.endsWith(`.${vd}`) || vd.endsWith(`.${ed}`);
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
   * Fetch a captured faculty/profile page (SSRF-bound to verifiedInstitutionDomain)
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
    const verifiedDomain = ce.verifiedInstitutionDomain;
    if (!verifiedDomain) return;
    const SEARCH_SOURCES = ['serp_search', 'claude_search'];
    const replaceable = !ce.email || SEARCH_SOURCES.includes(ce.emailSource);
    if (!replaceable) return; // an already-trusted email (orcid/pubmed/affiliation) wins

    const urls = this._orderCandidateUrls(ce, candidate.name);
    if (!urls.length) return;

    for (const url of urls) {
      if (signal?.aborted) throw abortError(signal);
      let host;
      try { host = new URL(url).hostname; } catch { continue; }
      if (!hostWithinDomain(host, verifiedDomain)) {
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
    // Resolved-page email tier (docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md): runs AFTER
    // _attachOpenAlexMetrics (which sets verifiedInstitutionDomain) and BEFORE the
    // domain cross-check below, so a recovered page email is still vetted. Only acts
    // when no trusted email exists yet (or a low-trust search email can be replaced).
    await this._attachEmailFromResolvedPage(candidate, result, { signal, deadlineAt, onProgress });
    // Now that the verified institutional domain is known, validate the captured contact
    // email against it: a domain MATCH confirms a real contact for persistence (recovers
    // olga.smirnova@mbi-berlin.de that the old lexical guard wrongly rejected), a clear
    // CONTRADICTION drops a likely namesake.
    this._validateEmailAgainstVerifiedDomain(result.contactEnrichment);
    // Post-enrichment identity classification (Phase 2 PR1). Pure/no network —
    // attaches the resolver's verdict so write paths can gate identity-bearing
    // persistence on it. Never breaks enrichment on a classifier error.
    try {
      const hypothesis = { name: candidate.name, claimedInstitution: candidate.affiliation };
      const evidence = evidenceFromEnrichment(result.contactEnrichment, hypothesis);
      result.contactEnrichment.identity = resolveIdentity(hypothesis, evidence);
    } catch (idErr) {
      console.error('Identity resolver error (non-fatal):', idErr.message);
    }
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
   * @param {Object} options - Same as enrichCandidate
   * @returns {Promise<Object>} Results with enriched candidates and stats
   */
  static async enrichCandidates(candidates, options = {}) {
    const { onProgress = () => {}, signal } = options;

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

    // NOTE: results are pushed in input order, one per candidate. Callers rely on
    // this 1:1 ordering to map results back to inputs by index (enrich-contacts.js
    // COI recompute). Preserve it if you refactor this loop.
    for (let i = 0; i < candidates.length; i++) {
      // Deadline reached between candidates → stop and let the route surface a
      // timeout rather than continuing to enrich (and return normal results)
      // after the budget expired.
      if (signal?.aborted) {
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

      const enriched = await this.enrichCandidate(candidate, {
        ...options,
        onProgress: (tierProgress) => {
          onProgress({
            overall: { current: i + 1, total: candidates.length, candidate: candidate.name },
            tier: tierProgress,
          });
        },
      });

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

    return results;
  }

  /**
   * Estimate the cost of enriching candidates
   *
   * @param {Array} candidates - Candidates to estimate
   * @param {Object} options - Which tiers will be used
   * @returns {Object} Cost estimate
   */
  static estimateCost(candidates, options = {}) {
    const { useClaudeSearch = false, useSerpSearch = false } = options;

    const estimate = {
      total: candidates.length,
      freeOperations: candidates.length, // PubMed + ORCID are free
      paidOperations: 0,
      estimatedCost: 0,
      breakdown: {
        pubmed: { count: candidates.length, cost: 0 },
        orcid: { count: candidates.length, cost: 0 },
        claude_search: { count: 0, cost: 0 },
        serp_search: { count: 0, cost: 0 },
      },
    };

    let estimatedNeedingPaidSearch = candidates.length * 0.5; // ~50% might need paid search

    if (useClaudeSearch) {
      // Estimate that ~50% of candidates might need Claude search
      // (those where PubMed and ORCID don't find contact info)
      const estimatedClaudeSearches = Math.ceil(estimatedNeedingPaidSearch);
      estimate.breakdown.claude_search = {
        count: estimatedClaudeSearches,
        cost: estimatedClaudeSearches * COSTS.CLAUDE_WEB_SEARCH,
      };
      estimate.paidOperations += estimatedClaudeSearches;
      estimate.estimatedCost += estimate.breakdown.claude_search.cost;

      // If Claude search is enabled, Tier 4 only runs for candidates where Claude failed
      // Estimate ~20% of those needing Claude search might still need Tier 4
      estimatedNeedingPaidSearch = estimatedNeedingPaidSearch * 0.2;
    }

    if (useSerpSearch) {
      // If no Claude search, ~50% need SerpAPI
      // If Claude search is enabled, only ~10% of total (20% of 50%) need SerpAPI
      const estimatedSerpSearches = Math.ceil(estimatedNeedingPaidSearch);
      estimate.breakdown.serp_search = {
        count: estimatedSerpSearches,
        cost: estimatedSerpSearches * COSTS.SERP_GOOGLE_SEARCH,
      };
      estimate.paidOperations += estimatedSerpSearches;
      estimate.estimatedCost += estimate.breakdown.serp_search.cost;
    }

    return estimate;
  }

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
    return bypassDynamicsRestrictions('contact-enrichment-save', async () => {
      let prUpdated = false;
      // Persist the effective (post-override) current affiliation when the
      // identity-gated pin fired — falls back to the original discovery
      // affiliation otherwise (S224 #15). upsertByEmail is fill-only, so this
      // only fills an empty field; it never clobbers a staff edit.
      const effectiveAffiliation = affiliationAllowed ? (enrichment.affiliation || candidate.affiliation) : null;
      const website = websiteAllowed ? enrichment.website : null;
      const facultyPageUrl = websiteAllowed ? enrichment.facultyPageUrl : null;
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
