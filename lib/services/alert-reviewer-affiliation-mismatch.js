/**
 * Best-effort staff alert for accepted reviewers whose self-reported
 * affiliation differs from, or is absent on, the linked CRM contact's
 * institution/account display.
 *
 * The acceptance drain first attempts a separate conservative auto-link: an
 * empty parentcustomerid is filled only for one unique exact active Account
 * match across established CRM labels. This helper remains alert-only and
 * handles every abstention (existing parent mismatch, ambiguity, incomplete
 * scan, or no exact target). This module also owns the alert's stable
 * auto-resolve key so a later successful link can clear stale warnings. It
 * never updates an Account or Contact itself.
 */

import { withDalContext } from '../dataverse/core/context.js';
import AlertService from './alert-service.js';
import NotificationService from './notification-service.js';
import * as contactAdapter from '../dataverse/adapters/contact.js';
import { createInstitutionConsistencyChecker } from './institution-affiliation-consistency.js';
import { createInstitutionStage2Evaluator } from './institution-affiliation-stage2.js';
import { isInstitutionStage2PresentationEnabled } from '../../shared/utils/institution-stage2-presentation.js';

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

export function reviewerAffiliationMismatchAutoResolveKey({ reviewer, contactId } = {}) {
  const resolvedContactId = contactId || reviewer?._wmkf_contact_value || null;
  if (!resolvedContactId) return null;
  const potentialReviewerId = reviewer?.wmkf_potentialreviewersid || null;
  return `reviewer-affiliation-mismatch:${potentialReviewerId || resolvedContactId}`;
}

/** Best-effort cleanup after automation proves the Contact parent is correct. */
export async function resolveReviewerAffiliationMismatch(
  { reviewer, contactId } = {},
  deps = {},
) {
  const autoResolveKey = reviewerAffiliationMismatchAutoResolveKey({ reviewer, contactId });
  if (!autoResolveKey) return { skipped: 'no_contact' };

  const autoResolve = deps.autoResolve || ((key) => AlertService.autoResolve(key));
  const warn = deps.warn || console.warn;
  try {
    const resolvedCount = await autoResolve(autoResolveKey);
    return { resolvedCount, autoResolveKey };
  } catch (error) {
    if (warn) {
      warn('[alert-reviewer-affiliation-mismatch] auto-resolve failed (non-fatal):', error?.message || error);
    }
    return { skipped: 'auto_resolve_failed', autoResolveKey };
  }
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
    institutionConsistency = createInstitutionConsistencyChecker({ segmentComparison: true }),
    notify = (opts) => NotificationService.notify(opts),
    withDynamicsBypass = withDalContext,
    warn = console.warn,
    stage2Enabled = isInstitutionStage2PresentationEnabled(),
    stage2Evaluator = null,
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

    if (stage2Enabled) {
      try {
        const evaluator = stage2Evaluator || createInstitutionStage2Evaluator();
        const stage2 = await evaluator.evaluate({
          evidenceAssertion: {
            rawText: cleanReviewerAffiliation,
            sourceType: 'reviewer_self_report',
            sourceReference: suggestionId || null,
            observedAt: new Date().toISOString(),
            currentness: 'current',
            authorSpecific: true,
          },
          recordedAssertion: {
            rawText: contactInstitution || '',
            sourceType: 'staff_record',
            sourceReference: resolvedContactId,
            observedAt: null,
            currentness: 'current',
            authorSpecific: true,
          },
          consumer: 'staff_notification',
          independentIdentity: null,
        });
        const presentation = stage2.presentation;
        if (!presentation?.notify) return { skipped: 'match', comparison: 'stage2' };

        const potentialReviewerId = reviewer?.wmkf_potentialreviewersid || null;
        await notify({
          type: presentation.kind === 'current_conflict'
            ? 'reviewer_contact_affiliation_mismatch'
            : 'reviewer_contact_affiliation_context',
          severity: presentation.severity,
          title: presentation.title,
          message: `Reviewer "${reviewerDisplayName(reviewer)}": ${presentation.detail} The contact/account was not changed automatically.`,
          metadata: {
            potentialReviewerId,
            contactId: resolvedContactId,
            reviewerAffiliation: cleanReviewerAffiliation,
            contactInstitution: contactInstitution || null,
            suggestionId: suggestionId || null,
            presentationVersion: presentation.version,
            relationship: presentation.relationship,
            evidenceContext: presentation.evidenceContext,
            stage2Kind: presentation.kind,
          },
          source: 'external-review-respond',
          category: 'reviewers',
          autoResolveKey: reviewerAffiliationMismatchAutoResolveKey({ reviewer, contactId: resolvedContactId }),
        });
        return { alerted: true, comparison: 'stage2', kind: presentation.kind };
      } catch (error) {
        if (warn) {
          warn('[alert-reviewer-affiliation-mismatch] Stage 2 comparison failed; using legacy presentation:', error?.message || error);
        }
      }
    }

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
        'The contact/account was not changed automatically; staff may set/confirm the account link. ' +
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
      autoResolveKey: reviewerAffiliationMismatchAutoResolveKey({ reviewer, contactId: resolvedContactId }),
    });

    return { alerted: true };
  } catch (err) {
    if (warn) {
      warn('[alert-reviewer-affiliation-mismatch] alert failed (non-fatal):', err?.message || err);
    }
    return { skipped: 'alert_failed' };
  }
}
