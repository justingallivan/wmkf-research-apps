/**
 * API Route: /api/reviewer-finder/web-suggestions
 *
 * Track C v1 — READ-ONLY web-grounded reviewer suggestions (Perplexity Search).
 *
 * Runs Perplexity Search → A7-wrapped Claude name-extraction → `WebLead[]` and
 * returns them for a SEPARATE, display-only panel. It is called INDEPENDENTLY of
 * `/discover` (not on its SSE/deadline-abort boundary) so a web outage can never
 * surface as a discovery error — it just yields an empty panel. It does NOT touch
 * the candidate pipeline, ranking, COI, roster, or save. Spec:
 * docs/REVIEWER_WEB_DISCOVERY_PLAN.md (v7 scope banner).
 *
 * Cost cap, A7-wrapping, the Perplexity/Claude key separation, and fail-soft all
 * live in WebDiscoveryService; this route only derives the queries + context from
 * the held analysisResult and passes the caller's profile id for usage logging.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { nextRateLimiter } from '../../../shared/api/middleware/rateLimiter';
import { WebDiscoveryService } from '../../../lib/services/web-discovery-service';

const limiter = nextRateLimiter({ max: 10 });

export const config = {
  api: {
    // analysisResult (proposalInfo + suggestions + searchQueries) rides along, as
    // it does to /discover. Match that route's cap.
    bodyParser: { sizeLimit: '2mb' },
  },
  // Bounded well under the platform wall: WebDiscoveryService caps itself at a
  // 30s search + 60s extraction, run sequentially.
  maxDuration: 120,
};

/**
 * Up to MAX_QUERIES topical web-search strings derived from the proposal's
 * research areas (server-side, so the cost cap can't be bypassed by the client).
 * Web search wants people/lab pages, so the topical terms carry light
 * person-oriented steering; the recency window + extraction prompt do the rest
 * (de-prioritize founders/laureates — see WebDiscoveryService + createWebExtractionPrompt).
 * Falls back to the analyze-derived literature queries when proposalInfo is sparse.
 */
export function deriveWebQueries(analysisResult) {
  const info = analysisResult?.proposalInfo || {};
  const primary = String(info.primaryResearchArea || '').trim();
  const secondary = String(info.secondaryAreas || '').trim();
  const methods = String(info.keyMethodologies || '').trim();
  const keywords = String(info.keywords || '').trim();

  const queries = [];
  if (primary) queries.push(`${primary} research lab faculty`);
  const tech = [methods, keywords].filter(Boolean).join(', ');
  if (tech) queries.push(`${tech} researchers`);
  if (secondary && secondary.toLowerCase() !== primary.toLowerCase()) {
    queries.push(`${secondary} research group`);
  }

  if (queries.length === 0) {
    const sq = analysisResult?.searchQueries || {};
    for (const k of ['pubmed', 'arxiv', 'biorxiv', 'chemrxiv']) {
      for (const q of Array.isArray(sq[k]) ? sq[k] : []) {
        const s = typeof q === 'string' ? q.trim() : '';
        if (s) queries.push(s);
      }
    }
  }
  return queries.slice(0, 3);
}

/** A short, untrusted-as-far-as-the-model-is-concerned relevance blurb. */
export function deriveProposalContext(analysisResult) {
  const info = analysisResult?.proposalInfo || {};
  return [info.primaryResearchArea, info.secondaryAreas, info.title]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' — ');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  // Key-gated: with no Perplexity key the feature is off — return an empty panel
  // (the client also hides the toggle via /api/api-capabilities.reviewerWebSearch).
  if (!WebDiscoveryService.isConfigured()) {
    return res.status(200).json({ success: true, webLeads: [], skipped: 'no_key' });
  }

  const { analysisResult } = req.body || {};
  if (!analysisResult || typeof analysisResult !== 'object') {
    return res.status(400).json({ error: 'analysisResult is required' });
  }

  const queries = deriveWebQueries(analysisResult);
  if (queries.length === 0) {
    return res.status(200).json({ success: true, webLeads: [], skipped: 'no_queries' });
  }

  // WebDiscoveryService is fail-soft by contract — it never throws; on any error
  // it returns { webLeads: [], error }. So this handler always responds 200 with a
  // (possibly empty) panel and never breaks the caller's normal search.
  const result = await WebDiscoveryService.search({
    queries,
    proposalContext: deriveProposalContext(analysisResult),
    userProfileId: access.profileId ?? null,
  });

  return res.status(200).json({ success: true, ...result });
}
