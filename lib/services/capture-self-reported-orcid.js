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
 *   person  (wmkf_potentialreviewers): acceptance jobs with a stable event
 *           timestamp use the versioned binding writer; older/decline callers
 *           retain the transitional overwrite + confirmed-decision path.
 *   contact (wmkf_orcid): fill-only via setOrcidIfAbsent — never clobbers a
 *           different valid iD (the §4 conflict policy still applies; a genuine
 *           two-different-iDs-for-one-email case is surfaced, not overwritten).
 *
 * The durable path falls back to the transitional person writes only for the
 * writer's typed `legacy_classification_required` result. Every other writer
 * failure is rethrown before the contact write. The acceptance drain treats that
 * as retryable and starts no downstream work; the decline caller remains
 * best-effort after its response has already committed.
 */

import { normalizeOrcid } from '../utils/orcid-normalize.js';
import * as researcherAdapter from '../dataverse/adapters/researcher.js';
import * as contactAdapter from '../dataverse/adapters/contact.js';
import {
  IdentityBindingWriteError,
  writeReviewerIdentityBinding,
} from './reviewer-identity-binding-writer.js';

const SELF_REPORT_RESOLVER_VERSION = 'self-report@accept';
const COMMITTED_BINDING_OUTCOMES = new Set(['init', 'refresh', 'rebind', 'noop']);

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

function buildSelfReportBindingEvent(orcidId, boundAt) {
  return {
    source: 'self_reported',
    anchor: `orcid:${orcidId}`,
    boundAt,
    fieldMode: 'partial',
    fields: {
      wmkf_orcid: orcidId,
      wmkf_orcidurl: `https://orcid.org/${orcidId}`,
    },
    decision: buildSelfReportDecision(orcidId, boundAt),
  };
}

async function writeLegacySelfReport({
  researcher,
  potentialReviewerId,
  orcidId,
  actingUserSystemId,
  resolvedAt,
}) {
  await researcher.updateById(potentialReviewerId, {
    orcid: orcidId,
    orcidUrl: `https://orcid.org/${orcidId}`,
  }, { actingUserSystemId });
  await researcher.writeIdentityDecision(potentialReviewerId, buildSelfReportDecision(orcidId, resolvedAt), {
    actingUserSystemId,
    identityOrigin: 'self_report',
  });
}

/**
 * @param {object}  args
 * @param {string} [args.potentialReviewerId] - the person row id
 * @param {string} [args.rawOrcid]            - the reviewer-typed ORCID (any form)
 * @param {string} [args.contactId]           - the promoted contact, when one exists
 * @param {string} [args.actingUserSystemId]
 * @param {string} [args.now]                 - injectable ISO timestamp (tests)
 * @param {string} [args.bindingEventAt]      - stable acceptance timestamp; enables the durable writer
 * @param {object} [deps]                     - { researcher, contacts, writeBinding } for tests
 * @returns {Promise<
 *   | { skipped: 'invalid_orcid', state: string }
 *   | { skipped: 'no_person' }
 *   | { persisted: true, orcid: string, contact: object|null }
 * >}
 */
export async function captureSelfReportedReviewerOrcid(
  { potentialReviewerId, rawOrcid, contactId, actingUserSystemId, now, bindingEventAt } = {},
  deps = {},
) {
  const {
    researcher = researcherAdapter,
    contacts = contactAdapter,
    writeBinding = writeReviewerIdentityBinding,
  } = deps;

  const self = normalizeOrcid(rawOrcid);
  if (self.state !== 'valid') return { skipped: 'invalid_orcid', state: self.state };
  if (!potentialReviewerId) return { skipped: 'no_person' };

  const ts = now || new Date().toISOString();

  if (bindingEventAt) {
    try {
      const binding = await writeBinding({
        potentialReviewerId,
        event: buildSelfReportBindingEvent(self.id, bindingEventAt),
        actingUserSystemId,
      });
      if (!COMMITTED_BINDING_OUTCOMES.has(binding?.outcome)) {
        throw new IdentityBindingWriteError(
          'binding_transition_blocked',
          `self-reported ORCID binding did not commit: ${binding?.reason || binding?.outcome || 'unknown'}`,
          { outcome: binding?.outcome || null, reason: binding?.reason || null },
        );
      }
    } catch (error) {
      if (!(error instanceof IdentityBindingWriteError) || error.code !== 'legacy_classification_required') {
        throw error;
      }
      await writeLegacySelfReport({
        researcher,
        potentialReviewerId,
        orcidId: self.id,
        actingUserSystemId,
        resolvedAt: bindingEventAt,
      });
    }
  } else {
    // Compatibility path for decline capture and acceptance jobs that predate
    // a durable event timestamp. It does not manufacture a binding identity.
    await writeLegacySelfReport({
      researcher,
      potentialReviewerId,
      orcidId: self.id,
      actingUserSystemId,
      resolvedAt: ts,
    });
  }

  // Contact: fill-only join-key write (no-op/conflict-safe).
  let contact = null;
  if (contactId) {
    contact = await contacts.setOrcidIfAbsent(contactId, self.id, { actingUserSystemId });
  }

  return { persisted: true, orcid: self.id, contact };
}
