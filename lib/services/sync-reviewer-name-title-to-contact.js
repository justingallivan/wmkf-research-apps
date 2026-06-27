/**
 * Best-effort reviewer engagement → contact identity-field sync.
 *
 * Stage 2a stores reviewer-corrected name/title/nickname on the suggestion row.
 * On the token-authenticated ACCEPT path, copy non-empty self-reported values
 * onto the linked CRM contact. This is overwrite-only for non-empty source
 * values; blank reviewer fields never blank the contact.
 *
 * Trust boundary: this helper deliberately does not evaluate
 * reviewer.wmkf_identitystatus. Callers MUST already have authenticated and
 * bound the reviewer to the suggestion row (for example via the external magic
 * link verifier) and must pass trusted: true.
 */

import * as contactAdapter from '../dataverse/adapters/contact.js';

function nonBlank(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

/**
 * @param {object}  args
 * @param {object}  args.reviewer   - person row: { _wmkf_contact_value }
 * @param {object}  args.suggestion - suggestion row carrying durable reviewer-corrected fields
 * @param {string} [args.contactId] - just-promoted contact id (takes precedence over the pointer)
 * @param {string} [args.actingUserSystemId]
 * @param {boolean} args.trusted    - required; caller has authenticated/bound reviewer to suggestion
 * @param {object} [deps]           - { contactsAdapter, warn } injectable for tests
 * @returns {Promise<
 *   | { skipped: 'untrusted' | 'no_contact' | 'no_fields' | 'sync_failed', error?: Error }
 *   | { updated: string[] }
 * >}
 */
export async function syncReviewerNameTitleToContact(
  { reviewer, suggestion, contactId, actingUserSystemId, trusted } = {},
  deps = {},
) {
  const { contactsAdapter = contactAdapter, warn = console.warn } = deps;

  if (trusted !== true) return { skipped: 'untrusted' };

  const resolvedContactId = contactId || reviewer?._wmkf_contact_value || null;
  if (!resolvedContactId) return { skipped: 'no_contact' };

  const patch = {};
  const firstName = nonBlank(suggestion?.wmkf_reviewerfirstname);
  const lastName = nonBlank(suggestion?.wmkf_reviewerlastname);
  const nickname = nonBlank(suggestion?.wmkf_reviewernickname);
  const jobTitle = nonBlank(suggestion?.wmkf_reviewertitle);
  if (firstName) patch.firstName = firstName;
  if (lastName) patch.lastName = lastName;
  if (nickname) patch.nickname = nickname;
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
