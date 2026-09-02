/**
 * Review Manager - Send Emails (Dataverse-backed)
 *
 * POST /api/review-manager/send-emails
 *
 * Thin streaming route shell (Route→Service Consolidation Plan, stage 2b —
 * Decision 1a, following the ratified 2s streaming template): method
 * dispatch → auth guard → sender-identity check → rate limit → SSE framing
 * (headers, `event:`/`data:` serialization, `res.end()`) → one
 * `withDalContext('review-manager-send', …)` → one service call. All
 * business logic — recipient resolution, attachment fetching, the
 * per-recipient send loop with its server-authoritative gates, lifecycle
 * updates and campaign-config persistence — lives in
 * lib/services/review-manager/send-emails-service.js, which emits events
 * through an `onEvent` callback and never touches `res`.
 *
 * The single `withDalContext('review-manager-send', …)` around the service
 * call replaces the legacy `bypassDynamicsRestrictions('review-manager-send',
 * …)` that also enclosed the SSE framing (Decision 4). SSE framing is not
 * Dataverse-touching, so the narrower boundary still encloses every
 * Dataverse-touching statement the old one enclosed; the label is kept.
 *
 * SSE events (full vocabulary pinned by
 * tests/integration/send-emails-route.test.js):
 *   - progress { stage, message, current?, total? }
 *   - email_sent { suggestionId, candidateName, candidateEmail, emailId, contactPromoted?, inviteRecorded? }
 *   - email_failed { suggestionId, candidateName, candidateEmail, error }
 *   - email_unconfirmed { suggestionId, candidateName, candidateEmail, error } — invitation "possibly sent, verify"
 *   - result { sent, failed, skipped, unconfirmed, stats }
 *   - complete { message, sent, failed, skipped, unconfirmed }
 *   - error { message } — terminal; no result/complete follows
 *
 * Data boundary: draft rendering remains staff-shared, but sending is limited
 * to the lead PD for every targeted request or a superuser. The full draft
 * batch is authorized before SSE starts or any email/lifecycle side effect.
 * Sender attribution is the caller's session identity. Contact promotion
 * occurs later in the token-authenticated acceptance drain.
 */

import { BASE_CONFIG } from '../../../shared/config/baseConfig';
import { requireAppAccess } from '../../../lib/utils/auth';
import { actorRefFromSession } from '../../../lib/utils/actor-ref';
import { isGuid } from '../../../lib/utils/guid';
import { nextRateLimiter } from '../../../shared/api/middleware/rateLimiter';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { sendEmails } from '../../../lib/services/review-manager/send-emails-service';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { authorizeReviewerRequestMutation } from '../../../lib/services/reviewer-request-authorization';

const limiter = nextRateLimiter({ max: 10 });

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
  maxDuration: 300,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const fromEmail = access.session?.user?.azureEmail;
  const actingUserSystemId = actorRefFromSession(access.session);
  if (!fromEmail) {
    return res.status(400).json({
      error: 'Could not determine sender email from your session. Please sign out and back in.',
    });
  }

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  // The service owns the historical streaming validation contract. Only run
  // the authorization read when every draft already has the valid identifier
  // needed to resolve ownership; otherwise the service emits its existing
  // terminal validation event without any write or send.
  const drafts = req.body?.drafts;
  const suggestionIds = Array.isArray(drafts)
    ? drafts.map((draft) => draft?.suggestionId)
    : [];
  if (suggestionIds.length > 0 && suggestionIds.every((id) => isGuid(id))) {
    try {
      await withDalContext('review-manager-send-authorize', () =>
        authorizeReviewerRequestMutation({
          profileId: access.profileId,
          callerSystemId: actingUserSystemId,
          suggestionIds,
        }));
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('Review Manager send-emails authorization error:', error);
      return res.status(500).json({ error: 'Could not verify request ownership' });
    }
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // One trusted DAL context enclosing the whole service run. The service
    // emits every SSE event through onEvent and never throws for flow
    // errors — terminal failures (input guards, mid-batch exceptions) emit
    // one `error` event inside the service and resolve.
    await withDalContext('review-manager-send', () =>
      sendEmails({
        requestBody: req.body,
        fromEmail,
        actingUserSystemId,
      }, ({ event, data }) => sendEvent(event, data))
    );
  } catch (error) {
    // Shell-level failures only (e.g. unreadable body) — the service catches
    // its own flow errors and has already emitted a terminal error event
    // before returning, so this cannot double-emit.
    console.error('Review Manager send-emails error:', error);
    sendEvent('error', {
      message: BASE_CONFIG.ERROR_MESSAGES?.EMAIL_GENERATION_FAILED || 'Failed to send emails',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }

  res.end();
}
