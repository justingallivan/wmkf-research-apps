/**
 * ContactEnrichmentService - Tiered contact information lookup
 *
 * Implements a 3-tier system for finding researcher contact information:
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
 */

const { ContactParser } = require('../utils/contact-parser');
const { ORCIDService } = require('./orcid-service');
// W5 caller migration: DatabaseService dropped. Enrichment writebacks now
// target Dataverse `wmkf_potentialreviewer` + `wmkf_appresearcher` via the
// adapter chain; the prior Postgres-researchers cache tier is removed
// (Dataverse is email-keyed, not name-keyed, so there's no name-lookup
// equivalent during the discovery phase).
const potentialReviewerAdapter = require('../dataverse/adapters/potential-reviewer');
const researcherAdapter = require('../dataverse/adapters/researcher');
const { bypassDynamicsRestrictions } = require('./dynamics-context');

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
const { getModelForApp } = require('../../shared/config/baseConfig');

// Cost estimates for UI display
// Haiku: $0.80/MTok input, $4/MTok output + $0.01/search
// SerpAPI: ~$50/5000 searches = $0.01 per search, but we use num=10 results so ~$0.005
const COSTS = {
  PUBMED: 0,
  ORCID: 0,
  CLAUDE_WEB_SEARCH: 0.015, // ~$0.01 search + ~$0.005 Haiku tokens
  SERP_GOOGLE_SEARCH: 0.005, // ~$0.005 per search (cheaper than Claude)
};

class ContactEnrichmentService {
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
        enrichedAt: new Date().toISOString(),
        tiersUsed: [],
        tierResults: {},
      },
    };

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
        result.contactEnrichment.tiersUsed.push('affiliation');
        return this._finalize(candidate, result, { useSerpSearch, serpApiKey: credentials.serpApiKey, persist, onProgress });
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

        onProgress({
          tier: 1,
          status: 'found',
          message: `Found email in PubMed (${pubmedResult.emailYear})`,
        });

        // If email is recent, we can trust it — finalize (still fetches Scholar
        // metrics for this early-email candidate before saving/returning).
        if (pubmedResult.isRecent) {
          return this._finalize(candidate, result, { useSerpSearch, serpApiKey: credentials.serpApiKey, persist, onProgress });
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
        const orcidResult = await ORCIDService.findContact({
          name: candidate.name,
          affiliation: candidate.affiliation,
          clientId: credentials.orcidClientId,
          clientSecret: credentials.orcidClientSecret,
        });

        result.contactEnrichment.tierResults.orcid = orcidResult;

        if (orcidResult) {
          // Always capture ORCID ID if found
          if (orcidResult.orcidId) {
            result.contactEnrichment.orcidId = orcidResult.orcidId;
            result.contactEnrichment.orcidUrl = orcidResult.orcidUrl;
          }

          // Capture website if found and useful (filter out generic directory pages)
          if (orcidResult.website && ContactParser.isUsefulWebsiteUrl(orcidResult.website)) {
            result.contactEnrichment.website = orcidResult.website;
            result.contactEnrichment.websiteSource = 'orcid';
          }

          // Use ORCID email if we don't have one, or if ORCID is more authoritative
          if (orcidResult.email && !result.contactEnrichment.email) {
            result.contactEnrichment.email = orcidResult.email;
            result.contactEnrichment.emailSource = 'orcid';
            result.contactEnrichment.emailIsRecent = true; // ORCID emails are maintained by researchers
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

    // ============================================
    // TIER 3: Claude Web Search (PAID)
    // ============================================
    if (!emailAlreadyFound && useClaudeSearch && credentials.claudeApiKey) {
      onProgress({
        tier: 3,
        status: 'searching',
        message: 'Searching web with Claude (paid)...',
      });
      result.contactEnrichment.tiersUsed.push('claude_search');

      try {
        const claudeResult = await this.claudeWebSearch(candidate, credentials.claudeApiKey);
        result.contactEnrichment.tierResults.claude_search = claudeResult;

        if (claudeResult) {
          // Use Claude results if we still don't have email
          if (claudeResult.email && !result.contactEnrichment.email) {
            result.contactEnrichment.email = claudeResult.email;
            result.contactEnrichment.emailSource = 'claude_search';
            result.contactEnrichment.emailIsRecent = true;
          }

          // Capture faculty page URL
          if (claudeResult.facultyPageUrl) {
            result.contactEnrichment.facultyPageUrl = claudeResult.facultyPageUrl;
          }

          // Capture website if we don't have one and it's useful
          if (claudeResult.website && !result.contactEnrichment.website && ContactParser.isUsefulWebsiteUrl(claudeResult.website)) {
            result.contactEnrichment.website = claudeResult.website;
            result.contactEnrichment.websiteSource = 'claude_search';
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
        console.error('Claude web search error:', error.message);
        onProgress({ tier: 3, status: 'error', message: `Search error: ${error.message}` });
        result.contactEnrichment.tierResults.claude_search = { error: error.message };
      }
    } else if (!emailAlreadyFound && useClaudeSearch && !credentials.claudeApiKey) {
      onProgress({ tier: 3, status: 'skipped', message: 'Web search skipped (no API key)' });
    }

    // ============================================
    // TIER 4: SerpAPI Google Search (PAID)
    // ============================================
    if (useSerpSearch && credentials.serpApiKey) {
      // Only run if we still don't have an email after Tier 3
      if (!result.contactEnrichment.email) {
        onProgress({
          tier: 4,
          status: 'searching',
          message: 'Searching Google with SerpAPI (paid)...',
        });
        result.contactEnrichment.tiersUsed.push('serp_search');

        try {
          const serpResult = await SerpContactService.findContact(candidate, credentials.serpApiKey);
          result.contactEnrichment.tierResults.serp_search = serpResult;

          if (serpResult) {
            // Use SerpAPI results if we still don't have email
            if (serpResult.email && !result.contactEnrichment.email) {
              result.contactEnrichment.email = serpResult.email;
              result.contactEnrichment.emailSource = 'serp_search';
              result.contactEnrichment.emailIsRecent = true;
            }

            // Capture faculty page URL if we don't have one
            if (serpResult.facultyPageUrl && !result.contactEnrichment.facultyPageUrl) {
              result.contactEnrichment.facultyPageUrl = serpResult.facultyPageUrl;
            }

            // Capture website if we don't have one and it's useful
            if (serpResult.website && !result.contactEnrichment.website) {
              result.contactEnrichment.website = serpResult.website;
              result.contactEnrichment.websiteSource = 'serp_search';
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
      } else {
        // Skip Tier 4 email search if we already have an email
        onProgress({ tier: 4, status: 'skipped', message: 'Skipped (email already found)' });
      }
    } else if (useSerpSearch && !credentials.serpApiKey) {
      onProgress({ tier: 4, status: 'skipped', message: 'Google search skipped (no API key)' });
    }

    // Scholar profile + bibliometrics + save happen in _finalize, which EVERY
    // return path routes through, so early-email candidates still get them.
    return this._finalize(candidate, result, { useSerpSearch, serpApiKey: credentials.serpApiKey, persist, onProgress });
  }

  /**
   * Fetch the Google Scholar profile + real bibliometrics (h-index/i10/citations)
   * via SerpAPI, independent of whether an email was found. Best-effort: a null
   * result leaves the metrics unset and never breaks enrichment. No-op unless
   * SerpAPI is enabled + configured. Mutates `result.contactEnrichment` in place.
   */
  static async _attachScholarMetrics(candidate, result, useSerpSearch, serpApiKey, onProgress) {
    if (!useSerpSearch || !serpApiKey) return;
    // Already resolved to a real profile with metrics — nothing to do.
    const ce = result.contactEnrichment;
    const haveRealProfile = ce.googleScholarUrl && !ce.googleScholarUrl.includes('view_op=search');
    if (haveRealProfile && ce.hIndex != null) return;
    try {
      const scholarResult = await SerpContactService.findScholarProfile(candidate, serpApiKey);
      if (scholarResult && scholarResult.institutionMismatch) {
        // The matched profile names a different institution than the candidate's
        // known affiliation — almost certainly a different person with the same
        // name. Do NOT persist the wrong profile/metrics (S211 1002794 fix).
        ce.tierResults.scholar_profile = { ...scholarResult, skipped: 'institution_mismatch' };
        onProgress({ tier: 4, status: 'skipped', message: `Scholar profile skipped — institution mismatch for ${candidate.name}` });
      } else if (scholarResult && scholarResult.scholarProfileUrl) {
        ce.googleScholarUrl = scholarResult.scholarProfileUrl;
        ce.googleScholarId = scholarResult.scholarId || null;
        ce.tierResults.scholar_profile = scholarResult;
        let metrics = null;
        if (scholarResult.scholarId) {
          metrics = await SerpContactService.fetchScholarMetrics(scholarResult.scholarId, serpApiKey);
          if (metrics) {
            ce.hIndex = metrics.hIndex;
            ce.i10Index = metrics.i10Index;
            ce.totalCitations = metrics.totalCitations;
          }
        }
        onProgress({
          tier: 4,
          status: 'found',
          message: `Found Google Scholar profile${metrics?.totalCitations != null ? ` (${metrics.totalCitations} citations, h-index ${metrics.hIndex ?? '—'})` : ''}`,
        });
      }
    } catch (scholarError) {
      console.error('Google Scholar search error:', scholarError.message);
    }
  }

  /**
   * Single exit point for enrichCandidate: fetch Scholar bibliometrics (for ALL
   * candidates, including early-email ones), persist, and return. Every `return`
   * in enrichCandidate routes through here so no path can skip the metrics.
   */
  static async _finalize(candidate, result, { useSerpSearch, serpApiKey, persist = true, onProgress }) {
    await this._attachScholarMetrics(candidate, result, useSerpSearch, serpApiKey, onProgress);
    // persist:false → caller owns the writeback (e.g. id-keyed). Skip the
    // email-keyed saveToDatabase so it can't race/fork the caller's write.
    if (persist) await this.saveToDatabase(candidate, result.contactEnrichment);
    return result;
  }

  /**
   * Enrich multiple candidates
   *
   * @param {Array} candidates - Array of candidates
   * @param {Object} options - Same as enrichCandidate
   * @returns {Promise<Object>} Results with enriched candidates and stats
   */
  static async enrichCandidates(candidates, options = {}) {
    const { onProgress = () => {} } = options;

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
        },
        estimatedCost: 0,
        actualCost: 0,
      },
    };

    for (let i = 0; i < candidates.length; i++) {
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
   *   2. `wmkf_appresearcher` (1:1 sidecar with bibliometric data)
   *
   * The condition "researcher hasn't been saved by user yet — skip" maps
   * to "no `wmkf_potentialreviewer` row exists for this email yet — skip"
   * since save-candidates.js (the user-explicit-save path) is the only
   * code creating those rows.
   */
  static async saveToDatabase(candidate, enrichment) {
    if (!enrichment?.email) return;

    // Establish a Dynamics context for this save (Codex W5-step-1 Q7).
    // DynamicsService.queryRecords fails closed without an ALS/bypass
    // context; some callers of contact-enrichment establish one upstream
    // (e.g. save-candidates.js), but enrichment runs from multiple paths
    // — wrap defensively so a missing-context environment doesn't
    // silently swallow the failure through the catch below.
    return bypassDynamicsRestrictions('contact-enrichment-save', async () => {
      let prUpdated = false;
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
          affiliation: candidate.affiliation,
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
        try {
          await researcherAdapter.upsertByPotentialReviewer(
            existing.wmkf_potentialreviewersid,
            {
              name: candidate.name,
              email: enrichment.email,
              emailSource: enrichment.emailSource,
              orcid: enrichment.orcidId,
              orcidUrl: enrichment.orcidUrl,
              googleScholarUrl: enrichment.googleScholarUrl,
              affiliation: candidate.affiliation,
              facultyPageUrl: enrichment.facultyPageUrl,
              website: enrichment.website,
            },
          );
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
  static async claudeWebSearch(candidate, apiKey) {
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
    const client = new LLMClient({
      apiKey,
      model: getModelForApp('contact-enrichment'),
      appName: 'contact-enrichment',
    });

    let result;
    try {
      result = await client.complete({
        maxTokens: 256,
        temperature: 0.2, // Low temperature for accurate, deterministic contact extraction
        system: buildUntrustedContentPreamble([wrappedCandidate.nonce]),
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
            content: `Find the email address and faculty page for the researcher identified in the untrusted block below. Return ONLY JSON: {"email":"...","facultyPageUrl":"...","website":"..."}\n\n${wrappedCandidate.text}`,
          },
        ],
      });
    } catch (e) {
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
        if (validated.ok) return validated.value;
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
