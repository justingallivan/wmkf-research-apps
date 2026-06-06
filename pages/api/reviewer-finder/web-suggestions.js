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
import { loadModelOverrides } from '../../../lib/services/model-override-loader';

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
  // Target INDIVIDUAL researchers and their recent output, NOT department roster
  // pages. The old "<area> research lab faculty" / "<area> research group"
  // templates returned faculty directories, which the extractor scraped into
  // noise (S230 quality pass). Orient toward "recent publications / papers /
  // authors" so Perplexity surfaces people, not member lists.
  if (primary) queries.push(`${primary} researchers recent publications${keywords ? ` ${keywords}` : ''}`);
  const tech = [methods, keywords].filter(Boolean).join(', ');
  if (tech) queries.push(`scientists publishing recent research on ${tech}`);
  if (secondary && secondary.toLowerCase() !== primary.toLowerCase()) {
    queries.push(`recent ${secondary} research papers and their authors`);
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

  // COI/exclude set the web leads must respect: the proposal's own people (PI +
  // Co-Investigators, from the analysis) plus any names the caller already
  // excludes. Read-only leads must NEVER surface a conflict — S230 found a Co-PI
  // (Anthony Leung) surfaced as a suggested reviewer because the web path filtered
  // nothing.
  const clientExcluded = Array.isArray(req.body?.excludeNames) ? req.body.excludeNames : [];
  const excludeNames = collectExcludeNames(analysisResult, clientExcluded);

  // Warm the model-override cache BEFORE the service resolves a model. The
  // service calls getModelForApp() synchronously; without this the tier key
  // ('sonnet') is returned unresolved and Anthropic 404s on `model: sonnet`,
  // which the service swallows fail-soft as an empty panel. Every other
  // LLM-calling reviewer-finder route (analyze/discover/enrich/generate-emails)
  // does the same near the top of its handler.
  await loadModelOverrides();

  // WebDiscoveryService is fail-soft by contract — it never throws; on any error
  // it returns { webLeads: [], error }. So this handler always responds 200 with a
  // (possibly empty) panel and never breaks the caller's normal search.
  const result = await WebDiscoveryService.search({
    queries,
    proposalContext: deriveProposalContext(analysisResult),
    excludeNames,
    userProfileId: access.profileId ?? null,
  });

  return res.status(200).json({ success: true, ...result });
}

/**
 * Collect the names a web lead must never be: the proposal's own PI +
 * Co-Investigators (from the analysis) plus any caller-supplied exclusions.
 * Splits comma-separated fields and drops null-equivalent sentinels. Exported
 * for testing.
 */
export function collectExcludeNames(analysisResult, clientExcluded = []) {
  const info = analysisResult?.proposalInfo || {};
  const out = [];
  const push = (v) => {
    String(v || '').split(',').forEach((s) => {
      const t = s.trim();
      if (t && !/^(none|not specified|n\/a|na)$/i.test(t)) out.push(t);
    });
  };
  push(info.principalInvestigator);
  push(info.proposalAuthors); // backward-compat alias of the PI field
  push(info.coInvestigators);
  if (Array.isArray(clientExcluded)) for (const n of clientExcluded) push(n);
  return out;
}
