/**
 * API Route: /api/reviewer-finder/generate-emails
 *
 * Generates .eml files for reviewer invitation emails.
 * Supports optional Claude personalization and file attachments via SSE streaming.
 *
 * Thin streaming route shell (Route→Service Consolidation Plan, micro-stage
 * 2s — Decision 1a streaming pilot): method dispatch → auth guard → rate
 * limit → SSE framing (headers, `event:`/`data:` serialization, `res.end()`)
 * → input validation (incl. GUID checks, emitted as SSE `error` events per
 * the pre-extraction contract) → one `withDalContext` → one service call.
 * All business logic (proposal lookup, attachment fetching, per-candidate
 * generation loop, time-budget abort, mark-as-sent) lives in
 * lib/services/reviewer-finder/generate-emails-service.js, which emits
 * events through an `onEvent` callback and never touches `res`.
 *
 * The single `withDalContext('reviewer-finder-generate-emails', …)` scope
 * replaces (widens over) the two legacy bypass scopes
 * 'generate-emails-lookup' and 'generate-emails-mark-sent' (Decision 4).
 *
 * POST body:
 * - candidates: Array of candidates with name, email, affiliation, suggestionId (required for multi-proposal)
 * - template: { subject, body } with placeholders
 * - settings: { senderName, senderEmail, signature, grantCycle }
 * - proposalInfo: { title, abstract, authors, institution } - fallback if no suggestionId
 * - options: { useClaudePersonalization, claudeApiKey, markAsSent }
 * - attachments: { summaryBlobUrl, reviewTemplateBlobUrl } - URLs to fetch and attach (fallback)
 *
 * Multi-proposal support:
 * When candidates have suggestionId, their proposal info is looked up from the database,
 * allowing each email to have the correct proposal title, PI, and summary attachment.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { nextRateLimiter } from '../../../shared/api/middleware/rateLimiter';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';
import { BASE_CONFIG } from '../../../shared/config/baseConfig';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { generateEmails } from '../../../lib/services/reviewer-finder/generate-emails-service';

const limiter = nextRateLimiter({ max: 10 });

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // Increased for attachments
    },
  },
  // Pinned at the Vercel Pro/Enterprise Fluid-Compute cap (800s). The live
  // search budget (`reviewer.time_budget_seconds`, default 600) is enforced
  // in the service via an AbortSignal deadline. See docs/REVIEWER_TIMEOUT_BUDGET_PLAN.md.
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

  const userProfileId = access.profileId;

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
      candidates,
      template,
      settings,
      proposalInfo,
      options = {},
      attachments: attachmentConfig = {}
    } = req.body;

    // Validate inputs (SSE error events — headers are already set, matching
    // the pre-extraction contract pinned by the characterization tests)
    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
      sendEvent('error', { message: 'No candidates provided' });
      return res.end();
    }

    if (!template || !template.subject || !template.body) {
      sendEvent('error', { message: 'Email template is required' });
      return res.end();
    }

    if (!settings || !settings.senderEmail) {
      sendEvent('error', { message: 'Sender email is required' });
      return res.end();
    }

    // Filter candidates with email addresses
    const validCandidates = candidates.filter(c => c.email);
    const skippedCount = candidates.length - validCandidates.length;

    if (validCandidates.length === 0) {
      sendEvent('error', { message: 'No candidates have email addresses' });
      return res.end();
    }

    // Look up proposal info for candidates with suggestionIds (multi-proposal support)
    const suggestionIds = validCandidates
      .map(c => c.suggestionId)
      .filter(id => id != null);

    // GUID-validate every supplied suggestionId before any of them reaches a
    // Dataverse selector (findById/getRecord in the service lookup, patchFields
    // in the mark-as-sent pass). suggestionId is optional per candidate, but a
    // present-but-malformed one is rejected (fail closed) — these ids interpolate
    // raw into the request URL. Candidates without a suggestionId use the
    // proposalInfo fallback and are unaffected.
    if (!suggestionIds.every(isGuid)) {
      sendEvent('error', { message: 'Each candidate suggestionId must be a valid GUID' });
      return res.end();
    }

    // One trusted DAL context enclosing the whole service run (lookup +
    // generation loop + mark-as-sent). The service emits every SSE event
    // through onEvent and never throws for flow errors — terminal error
    // events (timeout / generic) are emitted inside the service.
    await withDalContext('reviewer-finder-generate-emails', () =>
      generateEmails({
        candidates,
        validCandidates,
        skippedCount,
        suggestionIds,
        template,
        settings,
        proposalInfo,
        attachmentConfig,
        options,
        userProfileId,
      }, ({ event, data }) => sendEvent(event, data))
    );
  } catch (error) {
    // Shell-level failures only (e.g. missing/unreadable body) — the service
    // catches its own flow errors and has already emitted a terminal error
    // event before returning, so this cannot double-emit.
    console.error('Generate emails error:', error);
    sendEvent('error', {
      message: BASE_CONFIG.ERROR_MESSAGES.EMAIL_GENERATION_FAILED,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }

  res.end();
}
