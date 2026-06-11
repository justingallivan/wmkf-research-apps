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
import { getReviewerTimeBudgetSeconds } from '../../../lib/services/reviewer-time-budget';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { resolveProposalPI, piInstitutions } from '../../../lib/services/proposal-pi-identity';

const limiter = nextRateLimiter({ max: 10 });

const { ContactEnrichmentService } = require('../../../lib/services/contact-enrichment-service');
const { DeduplicationService } = require('../../../lib/services/deduplication-service');

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb',
    },
  },
  // Pinned at the Vercel Pro/Enterprise Fluid-Compute cap (800s). Live budget is
  // `reviewer.time_budget_seconds` (default 600), enforced via an AbortSignal
  // deadline. See docs/REVIEWER_TIMEOUT_BUDGET_PLAN.md.
  maxDuration: 800,
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

  const { candidates, options = {}, authorInstitution = null, requestId = null } = req.body;

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

  // Admin-configurable wall-clock budget (default 600s, clamped [120,800]),
  // enforced via an AbortSignal deadline on the Tier-3 Claude web-search calls.
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
      signal: deadlineController.signal,
      deadlineAt,
      onProgress: (progress) => {
        sendEvent({
          type: 'progress',
          ...progress,
        });
      },
    });

    // S240 Chunk 2a: resolve the PI-institution UNION server-side (structured
    // ORCID-current + OpenAlex last-known + LLM authorInstitution) so the recompute
    // matches discover's hard drop instead of clobbering it with the LLM-only value
    // (Codex #8). Fail-open: no requestId / unresolved → the LLM authorInstitution.
    let coiInstitutions = authorInstitution;
    if (requestId) {
      try {
        const pi = await bypassDynamicsRestrictions(
          'reviewer-enrich-contacts-pi-identity',
          () => resolveProposalPI(requestId, { signal: deadlineController.signal })
        );
        const union = piInstitutions(pi, authorInstitution);
        if (union.length) coiInstitutions = union;
      } catch (err) {
        if (deadlineController.signal.aborted
          || err?.name === 'AbortError'
          || err?.code === 'openalex_timeout'
          || err?.code === 'reviewer_time_budget_exceeded') {
          throw err;
        }
        console.error('[enrich-contacts] PI identity resolution failed (fail-open):', err.message);
      }
    }

    // Re-evaluate institution COI on the POST-enrichment affiliation. Enrichment may
    // promote an identity-trusted current affiliation (ORCID/Scholar) over the
    // PubMed-recency one /discover computed COI against, which would otherwise leave
    // hasInstitutionCOI / institutionCOIDetails stale relative to the affiliation the
    // card now shows. CURRENT-affiliation only (S240 — historical no longer counts).
    // The `coiRecomputed` marker lets the client merge override a now-false COI (vs.
    // when we didn't run, when no institution is known, leaving the discover value
    // intact). (Codex P2#1, S229.)
    const haveCoiInstitutions = Array.isArray(coiInstitutions) ? coiInstitutions.length : !!coiInstitutions;
    if (haveCoiInstitutions && Array.isArray(results?.enriched)) {
      const origList = Array.isArray(candidates) ? candidates : [];
      results.enriched.forEach((r, idx) => {
        if (!r || !r.contactEnrichment) return;
        // enrichCandidates preserves input order, so index is the reliable mapping
        // — matching by name alone cross-wires duplicate names. Fall back to name
        // only if the order ever drifts. (Codex P3.)
        let orig = origList[idx];
        if (!orig || orig.name !== r.name) orig = origList.find((c) => c.name === r.name) || {};
        const effectiveAffiliation = r.contactEnrichment.affiliation || orig.affiliation || null;
        const [evaluated] = DeduplicationService.markInstitutionCOI(
          [{ affiliation: effectiveAffiliation }],
          coiInstitutions
        );
        r.contactEnrichment.coiRecomputed = true;
        r.contactEnrichment.hasInstitutionCOI = evaluated.hasInstitutionCOI;
        r.contactEnrichment.institutionCOIDetails = evaluated.institutionCOIDetails;
      });
    }

    // Send final results
    sendEvent({
      type: 'complete',
      results: results.enriched,
      stats: results.stats,
    });

  } catch (error) {
    console.error('Contact enrichment error:', error);
    if (deadlineController.signal.aborted) {
      const mins = Math.round(budgetSeconds / 60);
      sendEvent({
        type: 'error',
        message: `Enrichment stopped after exceeding the configured ${mins}-minute time budget. An admin can raise it (up to 13 minutes) under Settings at /admin.`,
        timeout: true,
      });
    } else {
      sendEvent({
        type: 'error',
        message: BASE_CONFIG.ERROR_MESSAGES.PROCESSING_FAILED,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  } finally {
    clearTimeout(deadlineTimer);
    res.end();
  }
}
