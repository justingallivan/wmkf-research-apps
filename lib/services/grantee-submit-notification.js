/**
 * Grantee submit notification — tells staff a deliverables package arrived.
 *
 * Extracted from pages/api/external/grantee/[token]/submit.js: the route may not
 * import lib/dataverse/adapters/* (route-service-boundary law, Stage 7 — see
 * docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md), and the PD/PI lookup needs two
 * adapter reads. The route calls notifyGranteeSubmission() and nothing else.
 *
 * Contract: fires only AFTER the atomic write committed, and NEVER throws. A
 * submission the grantee completed must not fail because a notification did, so
 * every internal failure — PD resolution, the notify() call itself — is caught
 * and logged here rather than propagating to the route.
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
import * as grantRequestAdapter from '../dataverse/adapters/grant-request.js';
import * as systemUserAdapter from '../dataverse/adapters/system-user.js';

// The PD/PI lookup values. NOT available on the request object the grantee-token
// verifier returns — lib/external/verify-grantee-token.js selects request identity
// plus abstract text only, so reading them from there yields undefined and the PD
// silently never gets the email.
const REQUEST_SELECT = '_wmkf_programdirector_value,_wmkf_projectleader_value';
const PD_SELECT = 'systemuserid,internalemailaddress,isdisabled';

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

/** Resolve the assigned PD's email + the PI name. Never throws; nulls on failure. */
async function resolveRecipients(requestId) {
  try {
    const row = await grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT });
    const piName = row?._wmkf_projectleader_value_formatted || null;
    const pdId = row?._wmkf_programdirector_value || null;
    if (!pdId) return { pdEmail: null, piName };
    const pd = await systemUserAdapter.getByIdWithSelect(pdId, PD_SELECT);
    // A disabled PD is not a recipient (mirrors the reminder cron's readPd).
    const pdEmail = pd && pd.isdisabled !== true ? (pd.internalemailaddress || null) : null;
    return { pdEmail, piName };
  } catch (err) {
    // Advisory: category recipients still receive the notification.
    console.error('[grantee-submit-notification] recipient resolution failed (non-fatal):', err?.message || err);
    return { pdEmail: null, piName: null };
  }
}

/**
 * @param {Object} args
 * @param {string} args.requestId
 * @param {string|null} [args.requestNum]
 * @param {string|null} [args.title]
 * @param {boolean} args.hasImage - the package has an image AFTER this submit
 *        (a new upload, or one retained from a previous submit).
 * @param {boolean} args.captionPresent
 * @returns {Promise<void>} always resolves
 */
export async function notifyGranteeSubmission({ requestId, requestNum, title, hasImage, captionPresent }) {
  try {
    await withDalContext('grantee-submit-notify', async () => {
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
  } catch (err) {
    console.error('[grantee-submit-notification] notify failed (non-fatal):', err?.message || err);
  }
}
