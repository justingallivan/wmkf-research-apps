/**
 * API Route: /api/reviewer-finder/discover
 *
 * Stage 2 of Expert Reviewer Finder - Database Discovery
 *
 * Accepts analysis results from Stage 1 and:
 * - Track A: Verifies Claude's suggestions via PubMed
 * - Track B: Discovers new candidates from database searches
 * - Generates reasoning for discovered candidates (second Claude call)
 *
 * Uses streaming SSE for real-time progress updates.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { nextRateLimiter } from '../../../shared/api/middleware/rateLimiter';
import { BASE_CONFIG } from '../../../shared/config/baseConfig';
import { ClaudeReviewerService } from '../../../lib/services/claude-reviewer-service';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';
import { deriveProposalAuthorNames } from '../../../lib/utils/proposal-authors';
import { getReviewerTimeBudgetSeconds } from '../../../lib/services/reviewer-time-budget';
import { withReviewerProvenance } from '../../../lib/utils/reviewer-provenance';

const limiter = nextRateLimiter({ max: 10 });

// Enable verbose logging only in development with DEBUG_REVIEWER_FINDER env var
const DEBUG = process.env.DEBUG_REVIEWER_FINDER === 'true';

function withProvenanceList(candidates) {
  return (Array.isArray(candidates) ? candidates : []).map((candidate) => withReviewerProvenance(candidate));
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
  // Pinned at the Vercel Pro/Enterprise Fluid-Compute cap (800s) — the platform
  // hard wall. The live search budget is the admin-editable
  // `reviewer.time_budget_seconds` (default 600), enforced below via an
  // AbortSignal deadline (maxDuration is build-time-static, not runtime
  // configurable). See docs/REVIEWER_TIMEOUT_BUDGET_PLAN.md.
  maxDuration: 800,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require authentication + app access (before setting up SSE)
  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  await loadModelOverrides();

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Admin-configurable wall-clock budget for the whole discovery run (default
  // 600s, clamped [120,800]). External DB searches are best-effort (they don't
  // observe the signal), but a fired deadline aborts the Claude reasoning call
  // and the per-batch loop, so an over-budget search surfaces a clear timeout.
  const deadlineController = new AbortController();
  let deadlineTimer = null;
  let budgetSeconds = null;

  try {
    const {
      analysisResult,
      options = {},
      // Cross-run dedup + applicant/staff exclusions (S224). Names already
      // surfaced/excluded/saved for this request are filtered out of the
      // database results SERVER-SIDE, immediately after discovery and BEFORE the
      // per-candidate Claude reasoning call — so a re-run doesn't re-spend tokens
      // reasoning over people we already have. The client also hard-filters
      // (defense-in-depth); this is the token-saver.
      excludedNames = []
    } = req.body;

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      sendEvent('error', { message: 'Claude API key not configured on server' });
      return res.end();
    }

    const userProfileId = access.profileId;

    if (!analysisResult) {
      sendEvent('error', { message: 'Analysis result from Stage 1 is required' });
      return res.end();
    }

    const {
      searchPubmed = true,
      searchArxiv = true,
      searchBiorxiv = true,
      searchChemrxiv = true,
      generateReasoning = true
    } = options;

    if (DEBUG) {
      console.log('[Discover API] Received analysisResult:', {
        proposalTitle: analysisResult.proposalInfo?.title,
        authorInstitution: analysisResult.proposalInfo?.authorInstitution,
        proposalAuthors: analysisResult.proposalInfo?.proposalAuthors,
        suggestionCount: analysisResult.reviewerSuggestions?.length,
        suggestions: analysisResult.reviewerSuggestions?.map(s => ({ name: s.name, expertise: s.expertiseAreas }))
      });
    }

    // Always log COI-relevant info for debugging
    console.log('[Discover API] COI check info:', {
      authorInstitution: analysisResult.proposalInfo?.authorInstitution || '(NOT SET)',
      proposalAuthors: analysisResult.proposalInfo?.proposalAuthors || '(NOT SET)'
    });

    // Start the search budget clock (covers DB searches + reasoning).
    budgetSeconds = await getReviewerTimeBudgetSeconds();
    const deadlineAt = Date.now() + budgetSeconds * 1000;
    deadlineTimer = setTimeout(() => {
      const e = new Error('reviewer_time_budget_exceeded');
      e.code = 'reviewer_time_budget_exceeded';
      deadlineController.abort(e);
    }, budgetSeconds * 1000);

    sendEvent('progress', {
      stage: 'discovery',
      message: 'Starting database discovery...',
      options: { searchPubmed, searchArxiv, searchBiorxiv, searchChemrxiv }
    });

    // Import discovery service
    const { DiscoveryService } = require('../../../lib/services/discovery-service');

    // Run discovery
    const discoveryResults = await DiscoveryService.discover(analysisResult, {
      searchPubmed,
      searchArxiv,
      searchBiorxiv,
      searchChemrxiv,
      signal: deadlineController.signal,
      onProgress: (progress) => {
        sendEvent('progress', progress);
      }
    });

    // Cross-run dedup + applicant/staff exclusions (S224) — EXACT normalized-name
    // filter applied to verified + unverified + discovered NOW, before the
    // per-candidate `generateDiscoveredReasoning` Claude call below, so already-
    // surfaced/excluded names don't re-spend reasoning tokens. This is a SEPARATE
    // pass from the fuzzy `DeduplicationService.filterProposalAuthors` author COI
    // filter (which still runs below) — exact here, fuzzy there, by design.
    if (Array.isArray(excludedNames) && excludedNames.length > 0) {
      const { partitionByExcluded } = require('../../../lib/utils/reviewer-name-match');
      const before = discoveryResults.verified.length + discoveryResults.unverified.length + discoveryResults.discovered.length;
      discoveryResults.verified = partitionByExcluded(discoveryResults.verified, excludedNames).kept;
      discoveryResults.unverified = partitionByExcluded(discoveryResults.unverified, excludedNames).kept;
      discoveryResults.discovered = partitionByExcluded(discoveryResults.discovered, excludedNames).kept;
      const removed = before - (discoveryResults.verified.length + discoveryResults.unverified.length + discoveryResults.discovered.length);
      if (removed > 0) {
        sendEvent('progress', {
          stage: 'discovery',
          status: 'deduped',
          message: `Skipped ${removed} already-surfaced or excluded candidate(s) — searching for new reviewers only`
        });
      }
    }

    sendEvent('progress', {
      stage: 'discovery',
      status: 'verified',
      message: `Verified ${discoveryResults.verified.length} Claude suggestions`,
      data: {
        verified: discoveryResults.verified.length,
        unverified: discoveryResults.unverified.length
      }
    });

    const { DeduplicationService } = require('../../../lib/services/deduplication-service');

    // Filter out proposal authors (PI AND co-investigators) — they should never
    // be reviewers. Derived via the shared helper so this matches the COI set
    // used by enrich-recommended.js (S213 parity — co-PIs were previously
    // dropped here, so a co-PI could slip through as a candidate/coauthor-clean).
    const proposalAuthors = deriveProposalAuthorNames(analysisResult.proposalInfo);
    let verifiedCandidates = withProvenanceList(discoveryResults.verified);

    {
      if (proposalAuthors.length > 0) {
        const authorFilterResult = DeduplicationService.filterProposalAuthors(
          verifiedCandidates,
          proposalAuthors
        );

        if (authorFilterResult.excluded.length > 0) {
          console.log('[Discover API] Excluded proposal authors:',
            authorFilterResult.excluded.map(c => c.name));

          sendEvent('progress', {
            stage: 'author_filter',
            status: 'excluded',
            message: `Excluded ${authorFilterResult.excluded.length} candidate(s) who are proposal authors`,
            excluded: authorFilterResult.excluded.map(c => ({
              name: c.name,
              reason: c.excludedReason
            }))
          });
        }

        verifiedCandidates = authorFilterResult.filtered;
      }
    }

    // Mark institution COI (same institution as PI) - flag, don't filter
    const authorInstitution = analysisResult.proposalInfo?.authorInstitution;
    let verifiedWithCOI = verifiedCandidates;

    if (authorInstitution) {
      verifiedWithCOI = DeduplicationService.markInstitutionCOI(verifiedWithCOI, authorInstitution);
      const institutionCOICount = verifiedWithCOI.filter(c => c.hasInstitutionCOI).length;

      if (institutionCOICount > 0) {
        sendEvent('progress', {
          stage: 'coi_check',
          status: 'institution_coi',
          message: `Found ${institutionCOICount} candidate(s) from ${authorInstitution} (same institution as PI)`
        });
      }
    }

    // Check for coauthor COI if we have proposal authors (reuse the shared array)
    {
      const pubmedVerificationContract = DiscoveryService.pubMedVerificationContract({ searchPubmed, proposalInfo: analysisResult.proposalInfo });
      if (pubmedVerificationContract.enabled && proposalAuthors.length > 0 && verifiedWithCOI.length > 0) {
        sendEvent('progress', {
          stage: 'coi_check',
          status: 'starting',
          message: `Checking coauthorship history with ${proposalAuthors.length} proposal author(s)...`
        });

        verifiedWithCOI = await DiscoveryService.checkCoauthorshipsForCandidates(
          verifiedWithCOI,
          proposalAuthors,
          (progress) => sendEvent('progress', progress)
        );

        const coiCount = verifiedWithCOI.filter(c => c.hasCoauthorCOI).length;
        sendEvent('progress', {
          stage: 'coi_check',
          status: 'complete',
          message: coiCount > 0
            ? `Found ${coiCount} candidate(s) with coauthorship history`
            : 'No coauthorship conflicts found'
        });
      } else if (!pubmedVerificationContract.enabled && proposalAuthors.length > 0 && verifiedWithCOI.length > 0) {
        sendEvent('progress', {
          stage: 'coi_check',
          status: 'skipped',
          message: 'Skipped PubMed coauthorship check because PubMed verification is off'
        });
      }
    }

    sendEvent('progress', {
      stage: 'discovery',
      status: 'discovered',
      message: `Discovered ${discoveryResults.discovered.length} new candidates`,
      data: {
        discovered: discoveryResults.discovered.length,
        stats: discoveryResults.stats
      }
    });

    // Generate reasoning for discovered candidates (second Claude call)
    let enhancedDiscovered = discoveryResults.discovered;

    if (generateReasoning && discoveryResults.discovered.length > 0) {
      sendEvent('progress', {
        stage: 'reasoning',
        message: `Generating reasoning for ${discoveryResults.discovered.length} discovered candidates...`
      });

      enhancedDiscovered = await ClaudeReviewerService.generateDiscoveredReasoning(
        analysisResult.proposalInfo,
        discoveryResults.discovered,
        apiKey,
        (progress) => {
          sendEvent('progress', progress);
        },
        userProfileId,
        { signal: deadlineController.signal, deadlineAt }
      );

      // SURFACE (do NOT silently drop) candidates the reasoning pass marked off-topic
      // (S238). This gate culled GROUNDED, retrieval-originated real people on a
      // parametric Claude judgment with count-only visibility — the exact LLM-gatekeeping
      // the redesign exists to remove. Keep them, tag them so the UI warns and the ranker
      // sinks them to the bottom, and report the NAMES instead of a bare count.
      const aiFlaggedNames = enhancedDiscovered.filter(c => c.isRelevant === false).map(c => c.name);
      if (aiFlaggedNames.length > 0) {
        enhancedDiscovered = enhancedDiscovered.map(c =>
          c.isRelevant === false ? { ...c, aiFlaggedNotRelevant: true } : c
        );
        sendEvent('progress', {
          stage: 'filtering',
          status: 'ai_flagged_not_relevant',
          message: `${aiFlaggedNames.length} database candidate(s) flagged by AI as possibly off-topic — surfaced (ranked last), not dropped: ${aiFlaggedNames.join(', ')}`
        });
      }
    }

    // Filter out proposal authors from discovered candidates too (same shared set)
    if (enhancedDiscovered.length > 0) {
      if (proposalAuthors.length > 0) {
        const discoveredFilterResult = DeduplicationService.filterProposalAuthors(
          enhancedDiscovered,
          proposalAuthors
        );

        if (discoveredFilterResult.excluded.length > 0) {
          console.log('[Discover API] Excluded proposal authors from discovered:',
            discoveredFilterResult.excluded.map(c => c.name));

          sendEvent('progress', {
            stage: 'author_filter',
            status: 'excluded_discovered',
            message: `Excluded ${discoveredFilterResult.excluded.length} discovered candidate(s) who are proposal authors`
          });
        }

        enhancedDiscovered = discoveredFilterResult.filtered;
      }
    }

    // Mark institution COI on discovered candidates too
    if (authorInstitution && enhancedDiscovered.length > 0) {
      enhancedDiscovered = DeduplicationService.markInstitutionCOI(enhancedDiscovered, authorInstitution);
      const discoveredInstCOI = enhancedDiscovered.filter(c => c.hasInstitutionCOI).length;
      if (discoveredInstCOI > 0) {
        sendEvent('progress', {
          stage: 'coi_check',
          status: 'discovered_institution_coi',
          message: `Found ${discoveredInstCOI} discovered candidate(s) from ${authorInstitution}`
        });
      }
    }

    // Combine and rank all candidates
    const proposalKeywords = analysisResult.proposalInfo?.keywords?.split(',').map(k => k.trim()) || [];

    const combinedResults = {
      verified: verifiedWithCOI,
      unverified: withProvenanceList(discoveryResults.unverified),
      discovered: withProvenanceList(enhancedDiscovered),
      stats: discoveryResults.stats
    };

    const rankedCandidates = DiscoveryService.rankAllCandidates(
      combinedResults,
      proposalKeywords
    );

    // Close the boundary race: if the deadline fired while the final LLM call /
    // ranking was resolving, surface the timeout instead of a success result.
    if (deadlineController.signal.aborted) {
      throw deadlineController.signal.reason || new Error('reviewer_time_budget_exceeded');
    }

    verifiedWithCOI = withProvenanceList(verifiedWithCOI);
    const unverifiedWithProvenance = withProvenanceList(discoveryResults.unverified);
    enhancedDiscovered = withProvenanceList(enhancedDiscovered);
    const rankedWithProvenance = withProvenanceList(rankedCandidates);

    sendEvent('result', {
      verified: verifiedWithCOI,
      unverified: unverifiedWithProvenance,
      discovered: enhancedDiscovered,
      ranked: rankedWithProvenance,
      stats: discoveryResults.stats
    });

    sendEvent('complete', {
      message: 'Discovery complete',
      totalCandidates: rankedWithProvenance.length,
      verifiedCount: verifiedWithCOI.length,
      discoveredCount: enhancedDiscovered.length
    });

  } catch (error) {
    console.error('Discover API error:', error);
    if (deadlineController.signal.aborted) {
      const mins = budgetSeconds ? Math.round(budgetSeconds / 60) : null;
      sendEvent('error', {
        message: `Discovery stopped after exceeding the configured ${mins ? `${mins}-minute ` : ''}time budget. An admin can raise it (up to 13 minutes) under Settings at /admin.`,
        timeout: true,
      });
    } else {
      sendEvent('error', {
        message: BASE_CONFIG.ERROR_MESSAGES.PROCESSING_FAILED,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  } finally {
    clearTimeout(deadlineTimer);
  }

  res.end();
}
