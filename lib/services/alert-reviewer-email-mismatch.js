/**
 * Best-effort staff alert for accepted reviewers whose self-reported email
 * differs from the linked CRM contact's email of record.
 *
 * This intentionally does NOT update contact.emailaddress1. A reviewer may use
 * a legitimate alternate/payment email; staff reconcile the contact record.
 */

import * as contactAdapter from '../dataverse/adapters/contact.js';
import { normalizeEmail } from '../dataverse/adapters/contact.js';
import { withDalContext } from '../dataverse/core/context.js';
import NotificationService from './notification-service.js';

function nonBlank(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function reviewerDisplayName(reviewer) {
  return nonBlank(reviewer?.wmkf_name)
    || [nonBlank(reviewer?.wmkf_firstname), nonBlank(reviewer?.wmkf_lastname)].filter(Boolean).join(' ')
    || 'Unknown reviewer';
}

/**
 * @param {object} args
 * @param {object} [args.reviewer] - potential reviewer row
 * @param {string} [args.contactId] - resolved CRM contact id
 * @param {string} [args.reviewerEmail] - reviewer self-reported/corrected email
 * @param {string} [args.suggestionId] - reviewer suggestion row id
 * @param {object} [deps] - { contactsAdapter, notify, withDynamicsBypass, warn }
 * @returns {Promise<
 *   | { skipped: 'no_contact'|'no_email'|'no_contact_email'|'match'|'alert_failed' }
 *   | { alerted: true }
 * >}
 */
export async function alertReviewerEmailMismatch(
  { reviewer, contactId, reviewerEmail, suggestionId } = {},
  deps = {},
) {
  const {
    contactsAdapter = contactAdapter,
    notify = (opts) => NotificationService.notify(opts),
    withDynamicsBypass = withDalContext,
    warn = console.warn,
  } = deps;

  const resolvedContactId = contactId || reviewer?._wmkf_contact_value || null;
  if (!resolvedContactId) return { skipped: 'no_contact' };

  const cleanReviewerEmail = nonBlank(reviewerEmail);
  if (!cleanReviewerEmail) return { skipped: 'no_email' };

  try {
    const contact = await withDynamicsBypass('external-reviewer-email-mismatch-contact-read', () =>
      contactsAdapter.getById(resolvedContactId),
    );
    const cleanContactEmail = nonBlank(contact?.emailaddress1);
    if (!cleanContactEmail) return { skipped: 'no_contact_email' };

    if (normalizeEmail(cleanReviewerEmail) === normalizeEmail(cleanContactEmail)) {
      return { skipped: 'match' };
    }

    const potentialReviewerId = reviewer?.wmkf_potentialreviewersid || null;
    await notify({
      type: 'reviewer_contact_email_mismatch',
      severity: 'warning',
      title: 'Reviewer used a different email than their CRM contact',
      message:
        `Reviewer "${reviewerDisplayName(reviewer)}" accepted with email ${cleanReviewerEmail}, ` +
        `which differs from their linked CRM contact's email of record ${cleanContactEmail}. ` +
        'The contact was NOT modified; staff may reconcile (e.g. record the alternate email).',
      metadata: {
        potentialReviewerId,
        contactId: resolvedContactId,
        reviewerEmail: cleanReviewerEmail,
        contactEmail: cleanContactEmail,
        suggestionId: suggestionId || null,
      },
      source: 'external-review-respond',
      category: 'reviewers',
      autoResolveKey: `reviewer-email-mismatch:${potentialReviewerId || resolvedContactId}`,
    });

    return { alerted: true };
  } catch (err) {
    if (warn) {
      warn('[alert-reviewer-email-mismatch] alert failed (non-fatal):', err?.message || err);
    }
    return { skipped: 'alert_failed' };
  }
}
