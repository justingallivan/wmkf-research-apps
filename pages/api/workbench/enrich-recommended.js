/**
 * API: /api/workbench/enrich-recommended
 *
 * POST { requestId, blobUrl, analysisResult? }  (SSE)
 *
 * Runs this request's APPLICANT-RECOMMENDED reviewers through the SAME full
 * pipeline discovered candidates get, on an explicit PD click (Workbench Find
 * tab → "Enrich recommended reviewers"). The recommended people were
 * materialized as `disposition=recommended` junction rows by
 * /api/workbench/applicant-reviewers; this endpoint only ENRICHES them.
 * Per-request scoped; org-open like the other reviewer surfaces.
 *
 * Thin streaming route shell (Route→Service Consolidation Plan, Stage 4
 * series B — Decision 1a, ratified 2s template): method dispatch → auth
 * guard → rate limit → model warm → input validation (pre-SSE JSON 400) →
 * SSE framing (headers, `event:`/`data:` serialization, `res.end()`) → one
 * `withDalContext` → one service call. The whole enrichment pipeline
 * (proposalInfo/COI/verification/enrichment/writeback/roster + the
 * time-budget deadline and terminal error mapping) lives in
 * lib/services/workbench/enrich-recommended-service.js, which emits events
 * through an `onEvent` callback, never touches `res`, and RESOLVES after
 * emitting a terminal `error` event on failure.
 *
 * The single `withDalContext('workbench-enrich-recommended', …)` keeps the
 * legacy bypass label and widens slightly over it (the old scope excluded
 * the budget setup + terminal error mapping, now inside the service inside
 * the context — Decision 4 same-or-wider).
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { nextRateLimiter } from '../../../shared/api/middleware/rateLimiter';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';
import { enrichRecommended } from '../../../lib/services/workbench/enrich-recommended-service';

const limiter = nextRateLimiter({ max: 10 });
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROPOSAL_KEY_MAX = 512;

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
  // Pinned at the Vercel Pro/Enterprise Fluid-Compute cap (800s). Live budget is
  // `reviewer.time_budget_seconds` (default 600), enforced via an AbortSignal
  // deadline in the service. See docs/REVIEWER_TIMEOUT_BUDGET_PLAN.md.
  maxDuration: 800,
};

function sanitizeProposalKey(value) {
  if (value == null) return null;
  const cleaned = String(value)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, PROPOSAL_KEY_MAX);
  return cleaned || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  // Resolve per-app model overrides + register the tier→id resolver BEFORE any
  // Claude call (analyzeProposal / claudeWebSearch via enrichCandidates). Without
  // this, getModelForApp returns the unresolved 'sonnet' tier alias and Anthropic
  // 404s ("model: sonnet"). Mirrors analyze.js / discover.js.
  await loadModelOverrides();

  const { requestId, blobUrl, analysisResult } = req.body || {};
  const proposalKey = sanitizeProposalKey(req.body?.proposalKey);
  if (!requestId || !GUID_RE.test(String(requestId))) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // One trusted DAL context enclosing the whole service run. The service
  // emits every SSE event through onEvent and never throws for flow errors —
  // terminal error events (timeout / generic) are emitted inside the service,
  // so nothing here can double-emit. res.write failures are transport
  // failures and surface here, not as service-domain errors.
  await withDalContext('workbench-enrich-recommended', () =>
    enrichRecommended({
      requestId,
      blobUrl,
      analysisResult,
      proposalKey,
      apiKey: process.env.CLAUDE_API_KEY,
      actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
      userProfileId: access.profileId,
    }, ({ event, data }) => sendEvent(event, data))
  );

  res.end();
}
