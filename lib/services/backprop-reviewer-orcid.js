/**
 * Shared reviewer→contact ORCID back-propagation helper (design §5,
 * docs/REVIEWER_ORCID_BACKPROPAGATION_DESIGN.md).
 *
 * Every site that links a reviewer (`wmkf_potentialreviewers`) to a CRM
 * `contact` is a back-prop trigger; this is the ONE place the flow lives so the
 * current call sites (accepted-reviewer promotion and workbench
 * enrich-recommended) stay consistent. Invitation send deliberately does not
 * invoke this helper. It pushes the resolver-gated
 * reviewer ORCID onto the matched contact's empty `wmkf_orcid` so that field
 * becomes a durable cross-store join key over time — WITHOUT creating contacts
 * or asserting the reviewer↔contact identity link (that pointer stays
 * load-bearing and is set only by genuine promotion; §8.1).
 *
 * Eligibility (design §2): the reviewer must carry a valid `wmkf_orcid` AND a
 * persisted identity status of confirmed/probable. We read `wmkf_identitystatus`
 * rather than trusting field-presence so any pre-gate legacy value can't leak
 * through. Crucially the helper runs against `contactId (just promoted) ?? the
 * existing pointer` — NOT gated behind "only if newly linked" — so an
 * already-linked reviewer with an empty-ORCID contact is still filled (Codex #8).
 *
 * CALLER HYDRATION CONTRACT (design §5, confirmation pass HIGH): the reviewer
 * object MUST carry `wmkf_orcid`, `wmkf_identitystatus`, and (when relied on for
 * the pointer fallback) `_wmkf_contact_value`. If a caller's $select omits them
 * the helper silently no-ops — each call site loads all three first.
 */

import * as contactAdapter from '../dataverse/adapters/contact.js';
import { normalizeOrcid } from '../utils/orcid-normalize.js';
import { mayPersistIdentity } from './reviewer-identity-resolver.js';

/**
 * @param {object}  args
 * @param {object}  args.reviewer   - person row: { wmkf_orcid, wmkf_identitystatus, _wmkf_contact_value }
 * @param {string} [args.contactId] - just-promoted contact id (takes precedence over the pointer)
 * @param {string} [args.actingUserSystemId]
 * @param {object} [deps]           - { contacts } injectable for tests
 * @returns {Promise<
 *   | { skipped: 'ineligible' | 'no_contact' }
 *   | { action: 'write'|'noop'|'conflict'|'malformed', ... }   // from setOrcidIfAbsent
 * >}
 */
export async function backPropReviewerOrcidToContact(
  { reviewer, contactId, actingUserSystemId } = {},
  deps = {},
) {
  const { contacts = contactAdapter } = deps;

  if (!reviewer) return { skipped: 'ineligible' };

  const src = normalizeOrcid(reviewer.wmkf_orcid);
  if (src.state !== 'valid' || !mayPersistIdentity(reviewer.wmkf_identitystatus)) {
    return { skipped: 'ineligible' };
  }

  const cid = contactId || reviewer._wmkf_contact_value || null;
  if (!cid) return { skipped: 'no_contact' };

  return contacts.setOrcidIfAbsent(cid, src.id, { actingUserSystemId });
}
