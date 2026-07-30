/**
 * Grantee submit notification — tells staff a deliverables package arrived.
 *
 * Extracted from pages/api/external/grantee/[token]/submit.js: the route may not
 * import lib/dataverse/adapters/* (route-service-boundary law, Stage 7 — see
 * docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md), and the PD/PI lookup needs two
 * adapter reads. The route calls notifyGranteeSubmission() and nothing else.
 *
 * Contract: fires only AFTER the atomic write committed and NEVER throws. A
 * submission the grantee completed must not fail because a notification did, so
 * every internal failure — recipient resolution, the notify() call itself — is
 * caught and logged here rather than propagating to the route.
 *
 * Lifecycle: the route responds BEFORE calling this and registers the returned
 * promise with the runtime via lib/utils/keep-alive.js (`waitUntil`), so the
 * grantee's 200 never waits on a notification AND the notification still completes.
 * NOTIFY_BUDGET_MS is only a leak stop for a wedged send — see its comment.
 *
 * Recipients: the assigned Program Director via `explicitRecipients`, unioned
 * with the 'grantee-deliverables' category recipients and deduped by notify()
 * (lib/services/notification-service.js). Precedent: review-upload.js,
 * reviewer-quota.js, reviewer-withdrawal.js.
 *
 * Establishes its own trusted DAL context: it reads Dataverse and sends email,
 * and DynamicsService.sendEmail asserts a trusted context first (CLAUDE.md
 * Universal Safety Invariants, closed S330).
 */

import { withDalContext } from '../dataverse/core/context';
import NotificationService from './notification-service';
import { resolveProgramDirectorEmailForRequest } from './program-director-resolver';
import * as grantRequestAdapter from '../dataverse/adapters/grant-request.js';

// The PI name. NOT available on the request object the grantee-token verifier
// returns — lib/external/verify-grantee-token.js selects request identity plus
// abstract text only, so reading it from there yields undefined.
const REQUEST_SELECT = '_wmkf_projectleader_value';

// Leak stop, NOT a delivery deadline. The route responds before this runs and hands
// the promise to the runtime via keepAlive, so this no longer protects the response —
// its only job is to stop a wedged send from holding the invocation open until the
// platform limit. Keep it comfortably longer than a healthy Dataverse read + M365
// send, or it would abandon deliveries that were about to succeed.
export const NOTIFY_BUDGET_MS = 10000;

/**
 * Absolute Awardee-tab deep link for an email body.
 *
 * NEXTAUTH_URL is the STAFF app origin. Deliberately not getGranteePortalBaseUrl():
 * that prefers GRANTEE_PORTAL_BASE_URL, the public grantee domain, which would point
 * staff at the wrong host. With no origin configured, return the relative path rather
 * than emitting a malformed `https:///workbench/...`.
 */
export function awardeeTabUrl(requestId) {
  const path = `/workbench/${requestId}?tab=awardee`;
  const origin = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
  return origin ? `${origin}${path}` : path;
}

/**
 * Resolve the assigned PD's email + the PI name. Never throws; nulls on failure.
 *
 * PD email comes from the shared resolveProgramDirectorEmailForRequest rather than a
 * hand-rolled systemuser read: it already skips disabled users, caches per request,
 * and — load-bearing — TRIMS AND LOWERCASES the address. AlertRecipients normalizes
 * category recipients the same way, and NotificationService.sendAdminEmail dedupes
 * the union with a case-SENSITIVE Set, so an un-normalized `PD@wmkf.org` alongside a
 * configured `pd@wmkf.org` would survive as two entries and email the PD twice.
 *
 * The two lookups degrade INDEPENDENTLY: a failed PD resolution must not discard a PI
 * name the request read already produced, or the notification would say "The grantee"
 * and record pi: null for a request whose PI is known.
 */
async function resolveRecipients(requestId) {
  let piName = null;
  try {
    const row = await grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT });
    piName = row?._wmkf_projectleader_value_formatted || null;
  } catch (err) {
    // Advisory: category recipients still receive the notification.
    console.error('[grantee-submit-notification] request read failed (non-fatal):', err?.message || err);
  }

  // Already swallows its own failures and returns null for the category fallback.
  // skipCache: this picks a RECIPIENT at the moment of a durable event, so a warm
  // 10-minute cache entry could route the notification to a PD who was reassigned
  // off the request (or disabled) between the invite and the grantee's submit.
  const pdEmail = await resolveProgramDirectorEmailForRequest(requestId, { skipCache: true });
  return { pdEmail: pdEmail || null, piName };
}

/**
 * @param {Object} args
 * @param {string} args.requestId
 * @param {string|null} [args.requestNum]
 * @param {string|null} [args.title]
 * @param {boolean} args.hasImage - the package has an image AFTER this submit
 *        (a new upload, or one retained from a previous submit).
 * @param {boolean} args.captionPresent
 * @param {number} [args.budgetMs] - how long to wait before abandoning. Defaults to
 *        NOTIFY_BUDGET_MS; overridden only by tests, so a hang can be exercised
 *        without fake timers (which deadlock the route's multipart stream).
 * @returns {Promise<void>} always resolves
 */
export async function notifyGranteeSubmission({
  requestId, requestNum, title, hasImage, captionPresent, budgetMs = NOTIFY_BUDGET_MS,
}) {
  let timer;
  try {
    const work = withDalContext('grantee-submit-notify', async () => {
      const { pdEmail, piName } = await resolveRecipients(requestId);
      const label = requestNum || requestId;
      const url = awardeeTabUrl(requestId);
      await NotificationService.notify({
        type: 'grantee_deliverable_submitted',
        severity: 'info',
        emailAdmins: true, // an 'info' event only emails when this is set
        title: `Grantee deliverables submitted (${label})`,
        message:
          `${piName || 'The grantee'} submitted deliverables for ${title || label}. `
          + `Review them on the Awardee tab: ${url}`,
        metadata: {
          requestId,
          requestNumber: requestNum || null,
          title: title || null,
          pi: piName,
          hasImage,
          // The caption is grantee-controlled text; presence is all a PD needs to
          // know to go look, so the raw value stays out of the email body.
          captionPresent,
          awardeeTabUrl: url,
        },
        source: 'grantee-portal',
        category: 'grantee-deliverables',
        explicitRecipients: pdEmail ? [pdEmail] : [],
      });
    });

    // Attach a rejection handler now so abandoning the race can't surface as an
    // unhandled rejection after we have already returned.
    work.catch((err) => {
      console.error('[grantee-submit-notification] notify failed (non-fatal):', err?.message || err);
    });

    const expired = Symbol('notify-budget-expired');
    const budget = new Promise((resolve) => {
      timer = setTimeout(() => resolve(expired), budgetMs);
    });
    const outcome = await Promise.race([work.then(() => null, () => null), budget]);
    if (outcome === expired) {
      console.warn(
        `[grantee-submit-notification] abandoned after ${budgetMs}ms; submit already committed for ${requestId}`,
      );
    }
  } catch (err) {
    console.error('[grantee-submit-notification] notify failed (non-fatal):', err?.message || err);
  } finally {
    clearTimeout(timer);
  }
}
