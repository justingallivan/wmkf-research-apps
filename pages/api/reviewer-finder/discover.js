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

const limiter = nextRateLimiter({ max: 10 });

// Enable verbose logging only in development with DEBUG_REVIEWER_FINDER env var
const DEBUG = process.env.DEBUG_REVIEWER_FINDER === 'true';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
  maxDuration: 300, // Allow up to 5 minutes for database searches
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

  try {
    const {
      analysisResult,
      options = {}
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
      onProgress: (progress) => {
        sendEvent('progress', progress);
      }
    });

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

    // Filter out proposal authors (PI and co-authors) - they should never be reviewers
    const proposalAuthorsRaw = analysisResult.proposalInfo?.proposalAuthors;
    let verifiedCandidates = discoveryResults.verified;

    if (proposalAuthorsRaw && proposalAuthorsRaw.toLowerCase() !== 'not specified') {
      const proposalAuthors = proposalAuthorsRaw
        .split(',')
        .map(a => a.trim())
        .filter(a => a.length > 0);

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

    // Check for coauthor COI if we have proposal authors (reuse parsed array from earlier)
    if (proposalAuthorsRaw && proposalAuthorsRaw.toLowerCase() !== 'not specified') {
      const proposalAuthors = proposalAuthorsRaw
        .split(',')
        .map(a => a.trim())
        .filter(a => a.length > 0);

      if (proposalAuthors.length > 0 && verifiedWithCOI.length > 0) {
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
        userProfileId
      );

      // Filter out irrelevant candidates (those marked as not relevant by Claude)
      const beforeFilter = enhancedDiscovered.length;
      enhancedDiscovered = enhancedDiscovered.filter(c => c.isRelevant !== false);
      const filtered = beforeFilter - enhancedDiscovered.length;

      if (filtered > 0) {
        sendEvent('progress', {
          stage: 'filtering',
          message: `Filtered out ${filtered} irrelevant candidates from database discoveries`
        });
      }
    }

    // Filter out proposal authors from discovered candidates too
    if (proposalAuthorsRaw && proposalAuthorsRaw.toLowerCase() !== 'not specified' && enhancedDiscovered.length > 0) {
      const proposalAuthors = proposalAuthorsRaw
        .split(',')
        .map(a => a.trim())
        .filter(a => a.length > 0);

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
      unverified: discoveryResults.unverified,
      discovered: enhancedDiscovered,
      stats: discoveryResults.stats
    };

    const rankedCandidates = DiscoveryService.rankAllCandidates(
      combinedResults,
      proposalKeywords
    );

    sendEvent('result', {
      verified: verifiedWithCOI,
      unverified: discoveryResults.unverified,
      discovered: enhancedDiscovered,
      ranked: rankedCandidates,
      stats: discoveryResults.stats
    });

    sendEvent('complete', {
      message: 'Discovery complete',
      totalCandidates: rankedCandidates.length,
      verifiedCount: verifiedWithCOI.length,
      discoveredCount: enhancedDiscovered.length
    });

  } catch (error) {
    console.error('Discover API error:', error);
    sendEvent('error', {
      message: BASE_CONFIG.ERROR_MESSAGES.PROCESSING_FAILED,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }

  res.end();
}
