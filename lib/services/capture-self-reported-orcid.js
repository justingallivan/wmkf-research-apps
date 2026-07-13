/**
 * Capture a reviewer's SELF-REPORTED ORCID (the reviewer-side twin of PR3 in
 * docs/REVIEWER_ORCID_BACKPROPAGATION_DESIGN.md).
 *
 * At Stage 2a the reviewer confirms/corrects their own ORCID on the
 * authenticated magic-link accept/decline form (`Stage2aView` → `respond.js` →
 * `wmkf_reviewerorcid` on the engagement row). That self-confirmation is the
 * highest-trust ORCID source we have — the person themselves attested it, having
 * received the token at their own email — yet until now it never reached the
 * person record or the contact join key. This captures it onto both so it joins
 * the de-fragmentation flow.
 *
 * Trust model: a reviewer self-attestation is treated as `confirmed`. The
 * adapter receives the server-only `self_report` origin; automated decisions
 * (including resolver decisions labeled `confirmed`) are capped at `probable`
 * before persistence and cannot downgrade or clear a stored attestation.
 *
 *   person  (wmkf_potentialreviewers): OVERWRITE wmkf_orcid + wmkf_orcidurl
 *           (human self-report wins over a prior resolver guess) + mark confirmed.
 *   contact (wmkf_orcid): fill-only via setOrcidIfAbsent — never clobbers a
 *           different valid iD (the §4 conflict policy still applies; a genuine
 *           two-different-iDs-for-one-email case is surfaced, not overwritten).
 *
 * Caller treats any throw as NON-FATAL — the accept/decline already committed.
 */

import { normalizeOrcid } from '../utils/orcid-normalize.js';
import * as researcherAdapter from '../dataverse/adapters/researcher.js';
import * as contactAdapter from '../dataverse/adapters/contact.js';

const SELF_REPORT_RESOLVER_VERSION = 'self-report@accept';

function buildSelfReportDecision(orcidId, now) {
  return {
    status: 'confirmed',
    confidenceBand: 'high',
    resolverVersion: SELF_REPORT_RESOLVER_VERSION,
    resolvedAt: now,
    evidenceSummary: 'Reviewer self-confirmed this ORCID on the authenticated invitation form (magic-link).',
    anchors: [{
      type: 'self_reported_orcid',
      canonicalKey: `orcid:${orcidId}`,
      sourceUrl: `https://orcid.org/${orcidId}`,
      verifier: `reviewerSelfReport@${SELF_REPORT_RESOLVER_VERSION}`,
    }],
  };
}

/**
 * @param {object}  args
 * @param {string} [args.potentialReviewerId] - the person row id
 * @param {string} [args.rawOrcid]            - the reviewer-typed ORCID (any form)
 * @param {string} [args.contactId]           - the promoted contact, when one exists
 * @param {string} [args.actingUserSystemId]
 * @param {string} [args.now]                 - injectable ISO timestamp (tests)
 * @param {object} [deps]                     - { researcher, contacts } for tests
 * @returns {Promise<
 *   | { skipped: 'invalid_orcid', state: string }
 *   | { skipped: 'no_person' }
 *   | { persisted: true, orcid: string, contact: object|null }
 * >}
 */
export async function captureSelfReportedReviewerOrcid(
  { potentialReviewerId, rawOrcid, contactId, actingUserSystemId, now } = {},
  deps = {},
) {
  const { researcher = researcherAdapter, contacts = contactAdapter } = deps;

  const self = normalizeOrcid(rawOrcid);
  if (self.state !== 'valid') return { skipped: 'invalid_orcid', state: self.state };
  if (!potentialReviewerId) return { skipped: 'no_person' };

  const ts = now || new Date().toISOString();

  // Person: overwrite the iD (self-report beats a resolver guess) + mark confirmed.
  await researcher.updateById(potentialReviewerId, {
    orcid: self.id,
    orcidUrl: `https://orcid.org/${self.id}`,
  }, { actingUserSystemId });
  await researcher.writeIdentityDecision(potentialReviewerId, buildSelfReportDecision(self.id, ts), {
    actingUserSystemId,
    identityOrigin: 'self_report',
  });

  // Contact: fill-only join-key write (no-op/conflict-safe).
  let contact = null;
  if (contactId) {
    contact = await contacts.setOrcidIfAbsent(contactId, self.id, { actingUserSystemId });
  }

  return { persisted: true, orcid: self.id, contact };
}
