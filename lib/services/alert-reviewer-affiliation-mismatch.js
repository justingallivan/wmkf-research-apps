/**
 * Best-effort staff alert for accepted reviewers whose self-reported
 * affiliation differs from, or is absent on, the linked CRM contact's
 * institution/account display.
 *
 * This intentionally does NOT update contact.parentcustomerid,
 * contact.adx_organizationname, or any account/contact field. Staff reconcile
 * institution/account links because free-text affiliation names have variants,
 * acronyms, and AKAs that are not safe to auto-resolve.
 */

import { withDalContext } from '../dataverse/core/context.js';
import NotificationService from './notification-service.js';
import * as contactAdapter from '../dataverse/adapters/contact.js';
import { createInstitutionConsistencyChecker } from './institution-affiliation-consistency.js';

const PARENTCUSTOMERID_FORMATTED = '_parentcustomerid_value_formatted';
const PARENTCUSTOMERID_FORMATTED_ANNOTATION = '_parentcustomerid_value@OData.Community.Display.V1.FormattedValue';

const defaultContactsAdapter = {
  getInstitutionById: (contactId) => contactAdapter.getInstitutionById(contactId),
};

function nonBlank(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function reviewerDisplayName(reviewer) {
  return nonBlank(reviewer?.wmkf_name)
    || [nonBlank(reviewer?.wmkf_firstname), nonBlank(reviewer?.wmkf_lastname)].filter(Boolean).join(' ')
    || 'Unknown reviewer';
}

function contactInstitutionOf(contact) {
  return nonBlank(contact?.[PARENTCUSTOMERID_FORMATTED])
    || nonBlank(contact?.[PARENTCUSTOMERID_FORMATTED_ANNOTATION])
    || nonBlank(contact?.adx_organizationname)
    || null;
}

export function normalizeAffiliationForCompare(value) {
  return nonBlank(value)
    .toLowerCase()
    .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '');
}

/**
 * @param {object} args
 * @param {object} [args.reviewer] - potential reviewer row
 * @param {string} [args.contactId] - resolved CRM contact id
 * @param {string} [args.reviewerAffiliation] - reviewer self-reported/corrected affiliation
 * @param {string} [args.suggestionId] - reviewer suggestion row id
 * @param {object} [deps] - { contactsAdapter, institutionConsistency, notify, withDynamicsBypass, warn }
 * @returns {Promise<
 *   | { skipped: 'no_contact'|'no_affiliation'|'match'|'alert_failed' }
 *   | { alerted: true }
 * >}
 */
export async function alertReviewerAffiliationMismatch(
  { reviewer, contactId, reviewerAffiliation, suggestionId } = {},
  deps = {},
) {
  const {
    contactsAdapter = defaultContactsAdapter,
    institutionConsistency = createInstitutionConsistencyChecker(),
    notify = (opts) => NotificationService.notify(opts),
    withDynamicsBypass = withDalContext,
    warn = console.warn,
  } = deps;

  const resolvedContactId = contactId || reviewer?._wmkf_contact_value || null;
  if (!resolvedContactId) return { skipped: 'no_contact' };

  const cleanReviewerAffiliation = nonBlank(reviewerAffiliation);
  if (!cleanReviewerAffiliation) return { skipped: 'no_affiliation' };

  try {
    const contact = await withDynamicsBypass('external-reviewer-affiliation-mismatch-contact-read', () =>
      contactsAdapter.getInstitutionById(resolvedContactId),
    );
    const contactInstitution = contactInstitutionOf(contact);

    const sameNormalizedAffiliation = contactInstitution
      && normalizeAffiliationForCompare(cleanReviewerAffiliation) === normalizeAffiliationForCompare(contactInstitution);
    const consistentAffiliation = contactInstitution
      && (sameNormalizedAffiliation || await institutionConsistency.areConsistent(
        cleanReviewerAffiliation,
        contactInstitution,
      ));
    if (consistentAffiliation) {
      return { skipped: 'match' };
    }

    const potentialReviewerId = reviewer?.wmkf_potentialreviewersid || null;
    await notify({
      type: 'reviewer_contact_affiliation_mismatch',
      severity: 'warning',
      title: 'Reviewer reported a different affiliation than their CRM contact',
      message:
        `Reviewer "${reviewerDisplayName(reviewer)}" accepted reporting affiliation "${cleanReviewerAffiliation}", ` +
        `which differs from (or is absent on) their linked CRM contact's institution "${contactInstitution || '(none)'}". ` +
        'The contact/account was NOT modified; staff may set/confirm the account link. ' +
        'NOTE: this may simply be a name variant (e.g. acronym vs full name) - confirm before changing.',
      metadata: {
        potentialReviewerId,
        contactId: resolvedContactId,
        reviewerAffiliation: cleanReviewerAffiliation,
        contactInstitution: contactInstitution || null,
        suggestionId: suggestionId || null,
      },
      source: 'external-review-respond',
      category: 'reviewers',
      autoResolveKey: `reviewer-affiliation-mismatch:${potentialReviewerId || resolvedContactId}`,
    });

    return { alerted: true };
  } catch (err) {
    if (warn) {
      warn('[alert-reviewer-affiliation-mismatch] alert failed (non-fatal):', err?.message || err);
    }
    return { skipped: 'alert_failed' };
  }
}
