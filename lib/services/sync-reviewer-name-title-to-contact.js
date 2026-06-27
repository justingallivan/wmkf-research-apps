/**
 * Best-effort reviewer engagement → contact identity-field sync.
 *
 * Stage 2a stores reviewer-corrected name/title on the suggestion row. When the
 * reviewer is linked to a trusted potential-reviewer identity, copy non-empty
 * self-reported values onto the linked CRM contact. This is overwrite-only for
 * non-empty source values; blank reviewer fields never blank the contact.
 */

import * as contactAdapter from '../dataverse/adapters/contact.js';
import { mayPersistIdentity } from './reviewer-identity-resolver.js';

function nonBlank(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

/**
 * @param {object}  args
 * @param {object}  args.reviewer   - person row: { wmkf_identitystatus, _wmkf_contact_value }
 * @param {object}  args.suggestion - suggestion row carrying durable reviewer-corrected fields
 * @param {string} [args.contactId] - just-promoted contact id (takes precedence over the pointer)
 * @param {string} [args.actingUserSystemId]
 * @param {object} [deps]           - { contactsAdapter, warn } injectable for tests
 * @returns {Promise<
 *   | { skipped: 'ineligible' | 'no_contact' | 'no_fields' | 'sync_failed', error?: Error }
 *   | { updated: string[] }
 * >}
 */
export async function syncReviewerNameTitleToContact(
  { reviewer, suggestion, contactId, actingUserSystemId } = {},
  deps = {},
) {
  const { contactsAdapter = contactAdapter, warn = console.warn } = deps;

  if (!reviewer || !mayPersistIdentity(reviewer.wmkf_identitystatus)) {
    return { skipped: 'ineligible' };
  }

  const resolvedContactId = contactId || reviewer._wmkf_contact_value || null;
  if (!resolvedContactId) return { skipped: 'no_contact' };

  const patch = {};
  const firstName = nonBlank(suggestion?.wmkf_reviewerfirstname);
  const lastName = nonBlank(suggestion?.wmkf_reviewerlastname);
  const jobTitle = nonBlank(suggestion?.wmkf_reviewertitle);
  if (firstName) patch.firstName = firstName;
  if (lastName) patch.lastName = lastName;
  if (jobTitle) patch.jobTitle = jobTitle;
  if (Object.keys(patch).length === 0) return { skipped: 'no_fields' };

  try {
    return await contactsAdapter.updateIdentityFields(resolvedContactId, patch, { actingUserSystemId });
  } catch (err) {
    if (warn) {
      warn('[sync-reviewer-name-title-to-contact] contact identity sync failed (non-fatal):', err?.message || err);
    }
    return { skipped: 'sync_failed', error: err };
  }
}
