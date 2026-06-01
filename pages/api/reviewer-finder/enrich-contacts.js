/**
 * API Endpoint: Enrich Contacts
 *
 * POST /api/reviewer-finder/enrich-contacts
 *
 * Enriches selected candidates with contact information using the tiered system:
 * - Tier 1: PubMed (free)
 * - Tier 2: ORCID (free, requires credentials)
 * - Tier 3: Claude Web Search (paid, requires opt-in)
 *
 * Request body:
 * {
 *   candidates: [{ name, affiliation, publications }],
 *   options: { usePubmed, useOrcid, useClaudeSearch, useSerpSearch }
 * }
 *
 * All third-party API credentials (ORCID, NCBI, SerpAPI) are read from
 * server-side environment variables. Browser-provided credentials are
 * intentionally NOT honored — the per-user override path was removed in
 * the 2026-04-26 security pass.
 *
 * Response: Server-Sent Events (SSE) stream with progress updates
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { nextRateLimiter } from '../../../shared/api/middleware/rateLimiter';
import { BASE_CONFIG } from '../../../shared/config/baseConfig';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';

const limiter = nextRateLimiter({ max: 10 });

const { ContactEnrichmentService } = require('../../../lib/services/contact-enrichment-service');

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require authentication + app access
  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  // Register the tier→model-id resolver before any claudeWebSearch (Tier 3):
  // getModelForApp otherwise returns the raw 'sonnet' tier alias and Anthropic
  // 404s. This is its own request (separate from analyze/discover), so it must
  // load overrides itself rather than relying on a warm process.
  await loadModelOverrides();

  const { candidates, options = {} } = req.body;

  // Validate input
  if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
    return res.status(400).json({ error: 'No candidates provided' });
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // First, send cost estimate
    const estimate = ContactEnrichmentService.estimateCost(candidates, options);
    sendEvent({
      type: 'estimate',
      estimate,
    });

    // Enrich candidates with progress updates
    // All credentials sourced server-side (no browser pass-through)
    const results = await ContactEnrichmentService.enrichCandidates(candidates, {
      credentials: {
        claudeApiKey: process.env.CLAUDE_API_KEY,
        orcidClientId: process.env.ORCID_CLIENT_ID,
        orcidClientSecret: process.env.ORCID_CLIENT_SECRET,
        serpApiKey: process.env.SERP_API_KEY,
      },
      usePubmed: options.usePubmed !== false,
      useOrcid: options.useOrcid !== false,
      useClaudeSearch: options.useClaudeSearch === true,
      useSerpSearch: options.useSerpSearch === true,
      onProgress: (progress) => {
        sendEvent({
          type: 'progress',
          ...progress,
        });
      },
    });

    // Send final results
    sendEvent({
      type: 'complete',
      results: results.enriched,
      stats: results.stats,
    });

  } catch (error) {
    console.error('Contact enrichment error:', error);
    sendEvent({
      type: 'error',
      message: BASE_CONFIG.ERROR_MESSAGES.PROCESSING_FAILED,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  } finally {
    res.end();
  }
}
