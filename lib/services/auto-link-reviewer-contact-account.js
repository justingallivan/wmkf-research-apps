/**
 * Acceptance-only, conservative Contact parent-Account enrichment.
 *
 * After the acceptance worker has re-verified the engagement is accepted and
 * resolved its CRM Contact, this service may fill an empty
 * contact.parentcustomerid. It scans the complete active Account population
 * and writes only when the reviewer's accepted self-reported affiliation is
 * an exact normalized match to exactly one Account across name, AKA, legal
 * name, and DC AKA. It never overwrites an existing parent, never creates an
 * Account, and never treats fuzzy/provider similarity as authority.
 *
 * Operational failures throw so the durable acceptance job retries. Expected
 * data states (unmatched, ambiguous, existing parent) return an abstention and
 * leave the existing staff mismatch alert to handle the case. A capped Account
 * scan is also an abstention: incomplete cardinality can never authorize a
 * write, but it must not strand acceptance follow-up or suppress that alert.
 */

import { withDalContext } from '../dataverse/core/context.js';
import * as accountAdapter from '../dataverse/adapters/account.js';
import * as contactAdapter from '../dataverse/adapters/contact.js';
import {
  accountStillMatchesReviewerAffiliation,
  classifyReviewerAffiliationAccount,
  nonBlankInstitution,
} from '../utils/reviewer-institution-account-match.js';

const ACTIVE_ACCOUNT_SELECT = 'accountid,name,akoya_aka,wmkf_legalname,wmkf_dc_aka,statecode';

const defaultAccountsAdapter = {
  queryAllAccounts: (options) => accountAdapter.queryAllAccounts(options),
  getById: (accountId, options) => accountAdapter.getById(accountId, options),
};

const defaultContactsAdapter = {
  getInstitutionById: (contactId) => contactAdapter.getInstitutionById(contactId),
  setParentAccountIfEmpty: (contactId, accountId, options) =>
    contactAdapter.setParentAccountIfEmpty(contactId, accountId, options),
};

/**
 * @returns {Promise<object>} A linked/noop/abstention result. Operational
 * failures throw and are retryable by the acceptance drain.
 */
export async function autoLinkReviewerContactAccount(
  {
    reviewer,
    contactId,
    reviewerAffiliation,
    trustedAcceptance = false,
    actingUserSystemId,
  } = {},
  deps = {},
) {
  if (trustedAcceptance !== true) {
    const error = new Error('autoLinkReviewerContactAccount requires trustedAcceptance=true');
    error.code = 'reviewer_contact_account_untrusted_caller';
    error.retryable = false;
    throw error;
  }

  const resolvedContactId = contactId || reviewer?._wmkf_contact_value || null;
  if (!resolvedContactId) return { skipped: 'no_contact' };

  const affiliation = nonBlankInstitution(reviewerAffiliation);
  if (!affiliation) return { skipped: 'no_affiliation' };

  const {
    accountsAdapter = defaultAccountsAdapter,
    contactsAdapter = defaultContactsAdapter,
  } = deps;
  const runWithDalContext = deps.withDalContext || withDalContext;

  return runWithDalContext('accepted-reviewer-contact-account-auto-link', async () => {
    const contact = await contactsAdapter.getInstitutionById(resolvedContactId);
    if (contact?._parentcustomerid_value) {
      const parentEntity = String(contact._parentcustomerid_value_entity || '').toLowerCase();
      if (parentEntity && parentEntity !== 'account') {
        return {
          skipped: 'parent_already_populated',
          parentAccountId: contact._parentcustomerid_value,
        };
      }

      let currentParent;
      try {
        currentParent = await accountsAdapter.getById(contact._parentcustomerid_value, {
          select: ACTIVE_ACCOUNT_SELECT,
        });
      } catch (error) {
        // parentcustomerid is polymorphic. Older rows may lack the lookup-type
        // annotation, so a 404 here can mean the parent is a Contact rather
        // than an Account. Preserve every existing parent and let the residual
        // staff warning surface the mismatch instead of retrying indefinitely.
        if (error?.status !== 404) throw error;
      }
      if (accountStillMatchesReviewerAffiliation(currentParent, affiliation)) {
        return {
          linked: false,
          alreadyLinked: true,
          contactId: resolvedContactId,
          accountId: contact._parentcustomerid_value,
          accountName: currentParent?.name || null,
        };
      }
      return {
        skipped: 'parent_already_populated',
        parentAccountId: contact._parentcustomerid_value,
      };
    }

    const accountResult = await accountsAdapter.queryAllAccounts({
      select: ACTIVE_ACCOUNT_SELECT,
      filter: 'statecode eq 0',
      orderby: 'name asc',
    });
    if (accountResult?.capped) {
      return {
        skipped: 'account_scan_capped',
        scannedCount: accountResult?.records?.length || 0,
        totalCount: accountResult?.totalCount || null,
      };
    }

    const classification = classifyReviewerAffiliationAccount(
      affiliation,
      accountResult?.records || [],
    );
    if (classification.status !== 'unique_exact_target') {
      return {
        skipped: classification.status,
        targetCount: classification.targets.length,
        targets: classification.targets.map((target) => ({
          accountId: target.accountId,
          accountName: target.accountName,
        })),
      };
    }

    const target = classification.targets[0];
    const currentAccount = await accountsAdapter.getById(target.accountId, {
      select: ACTIVE_ACCOUNT_SELECT,
    });
    if (!accountStillMatchesReviewerAffiliation(currentAccount, affiliation)) {
      return { skipped: 'target_changed_before_write', accountId: target.accountId };
    }

    const writeResult = await contactsAdapter.setParentAccountIfEmpty(
      resolvedContactId,
      target.accountId,
      { actingUserSystemId },
    );
    if (writeResult.action === 'conflict') {
      return {
        skipped: 'parent_already_populated',
        parentAccountId: writeResult.existingParentId,
      };
    }
    return {
      linked: writeResult.action === 'write',
      alreadyLinked: writeResult.action === 'noop',
      contactId: resolvedContactId,
      accountId: target.accountId,
      accountName: currentAccount?.name || target.accountName,
      matchedLabels: target.matchedLabels,
    };
  });
}
