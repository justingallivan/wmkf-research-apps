/**
 * reviewer-vetted-email — pure contact/promotion projection shared by
 * automated receipts, save-candidates, applicant B1, and the legacy reconciler.
 *
 * A candidate can remain useful in the Find roster without being ready for the
 * Invite pool. `projectReviewerContact` makes that distinction explicit:
 *   ready | needs_identity_confirmation | missing_email.
 *
 * Automated contact authority is fail-closed: the exact address/source pair
 * must be coherent, the resolver decision must be confirmed/probable, and
 * emailPersistAllowed must be explicitly true. Staff-confirmed contact is a
 * separate exact-value path and never blesses automated identity metrics.
 * Returns { email, source } (source = the vetted enrichment provenance, e.g.
 * 'affiliation'/'pubmed'/'claude_search') or null when the row is not persistable.
 * Pure — no I/O.
 */

import { ContactParser } from './contact-parser';

// Anti-scrape "munged" addresses that faculty pages publish to defeat scrapers
// (e.g. `pollina@nospam.wustl.edu` for the real `pollina@wustl.edu`). A paid web
// search can capture these verbatim and enrichment may bless them
// (emailPersistAllowed=true), but they are undeliverable and cannot be reliably
// de-munged automatically. Reject them so neither B1 nor the reconciler persists a
// broken address; a human can still add the real one on the Invite tab.
const ANTISCRAPE_MUNGE = /no-?\.?spam|spam-?free|remove-?(this|me)|delete-?(this|me)|no-?email|yourname/i;

/**
 * True when an email looks like an anti-scrape munge (undeliverable). Exported so
 * the interactive save path (save-candidates) rejects the same class the shared
 * gate does, not just the automated A/B1 paths.
 */
export function isAntiScrapeMunge(email) {
  return typeof email === 'string' && ANTISCRAPE_MUNGE.test(email);
}

/**
 * The (address, source) pair a roster candidate blob actually asserts TOGETHER, or null
 * when the blob cannot vouch for a pairing.
 *
 * WHY THIS IS NOT JUST "read both fields" (S387, second adversarial review). A generic
 * pruned roster row is NOT internally coherent: `pruneCandidateForRoster` stores
 * `email: c.email || e.email` but normally stores `emailSource: e.emailSource` — the
 * top-level address can therefore come from somewhere other than enrichment (a manual
 * correction, for example). Applicant rows now preserve their server-derived top-level
 * pair, but this shared helper still has to reject incoherent generic rows. A promoted
 * lead or merge can otherwise carry a top-level source that describes the ENRICHMENT
 * address instead. Reading "both top-level fields" would then pair an address with
 * provenance that was never evidence for it — exactly what a provenance writer must
 * never do.
 *
 * The only safe rule: the two addresses in the blob must agree (or only one may exist).
 * Then whichever source is present describes that single address. When they disagree the
 * blob is ambiguous and this returns null — deliberately skipping rows rather than
 * guessing, since the caller writes provenance to a shared person record.
 *
 * Callers that merely need SOMETHING sendable should use `pickVettedEmail`; this is for
 * callers deciding what a source means.
 */
export function pickAssertedEmailPair(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const enr = (candidate.contactEnrichment && typeof candidate.contactEnrichment === 'object')
    ? candidate.contactEnrichment
    : {};
  const topEmail = String(candidate.email ?? '').trim();
  const enrEmail = String(enr.email ?? '').trim();
  if (topEmail && enrEmail && topEmail.toLowerCase() !== enrEmail.toLowerCase()) return null;

  const email = topEmail || enrEmail;
  if (!email) return null;
  const source = String(candidate.emailSource ?? '').trim() || String(enr.emailSource ?? '').trim();
  if (!source) return null;
  return { email, source };
}

function persistFlag(candidate, enrichment, name) {
  if (candidate?.[name] === false || enrichment?.[name] === false) return false;
  if (candidate?.[name] === true || enrichment?.[name] === true) return true;
  return null;
}

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Compute the exact contact bundle a promotion may persist.
 *
 * Nested resolver status is authoritative when present. This is intentional:
 * a top-level discovery `verified` label cannot override a nested resolver
 * `unresolved` decision (the request-1002912 regression shape).
 */
export function projectReviewerContact(candidate, {
  staffConfirmed = false,
  identityConfirmed = false,
} = {}) {
  if (!candidate || typeof candidate !== 'object') return null;
  const enr = (candidate.contactEnrichment && typeof candidate.contactEnrichment === 'object')
    ? candidate.contactEnrichment
    : {};
  const identityStatus = cleanString(enr.identity?.status) || cleanString(candidate.identityStatus);
  const emailPersistAllowed = staffConfirmed ? true : persistFlag(candidate, enr, 'emailPersistAllowed');
  const websitePersistAllowed = staffConfirmed ? true : persistFlag(candidate, enr, 'websitePersistAllowed');
  const affiliationPersistAllowed = staffConfirmed ? true : persistFlag(candidate, enr, 'affiliationPersistAllowed');
  const affiliation = cleanString(staffConfirmed ? candidate.affiliation : (enr.affiliation || candidate.affiliation));
  const website = cleanString(staffConfirmed ? candidate.website : (enr.website || candidate.website));

  if (!staffConfirmed) {
    const identityResolved = identityConfirmed
      || identityStatus === 'confirmed'
      || identityStatus === 'probable';
    const needsIdentity = candidate.needsIdentification === true
      || candidate.institutionMismatch === true
      || candidate.verificationStatus === 'unresolved'
      || candidate.verificationStatus === 'ambiguous'
      || enr.contactStatus === 'unresolved'
      || candidate.contactStatus === 'unresolved'
      || !identityResolved;
    if (needsIdentity) {
      return {
        decision: 'needs_identity_confirmation',
        reason: 'identity_not_resolved',
        email: null,
        emailSource: null,
        affiliation,
        website,
        identityStatus,
        emailPersistAllowed,
        websitePersistAllowed,
        affiliationPersistAllowed,
      };
    }
  }

  let asserted = staffConfirmed
    ? {
      email: cleanString(candidate.email),
      source: cleanString(candidate.email) ? 'manual' : null,
    }
    : pickAssertedEmailPair(candidate);

  if (!staffConfirmed) {
    const topEmail = cleanString(candidate.email);
    const enrichmentEmail = cleanString(enr.email);
    if (topEmail && enrichmentEmail && topEmail.toLowerCase() !== enrichmentEmail.toLowerCase()) {
      return {
        decision: 'needs_identity_confirmation',
        reason: 'contact_claim_mismatch',
        email: null,
        emailSource: null,
        affiliation,
        website,
        identityStatus,
        emailPersistAllowed,
        websitePersistAllowed,
        affiliationPersistAllowed,
      };
    }
  }

  if ((!asserted || !asserted.email) && affiliationPersistAllowed === true && affiliation) {
    const rescued = ContactParser.extractPrimaryEmail(affiliation);
    if (rescued) asserted = { email: rescued, source: 'affiliation' };
  }

  const email = cleanString(asserted?.email)?.toLowerCase() || null;
  const emailSource = cleanString(asserted?.source);
  if (!email || isAntiScrapeMunge(email)) {
    return {
      decision: 'missing_email',
      reason: email ? 'anti_scrape_email' : 'email_missing',
      email: null,
      emailSource: null,
      affiliation,
      website,
      identityStatus,
      emailPersistAllowed,
      websitePersistAllowed,
      affiliationPersistAllowed,
    };
  }
  if (!staffConfirmed && (emailPersistAllowed !== true || !emailSource)) {
    return {
      decision: 'needs_identity_confirmation',
      reason: emailPersistAllowed !== true ? 'email_not_authoritative' : 'email_source_missing',
      email: null,
      emailSource: null,
      affiliation,
      website,
      identityStatus,
      emailPersistAllowed,
      websitePersistAllowed,
      affiliationPersistAllowed,
    };
  }

  return {
    decision: 'ready',
    reason: null,
    email,
    emailSource,
    affiliation,
    website,
    identityStatus,
    emailPersistAllowed,
    websitePersistAllowed,
    affiliationPersistAllowed,
  };
}

export function pickVettedEmail(candidate) {
  const projection = projectReviewerContact(candidate);
  return projection?.decision === 'ready'
    ? { email: projection.email, source: projection.emailSource }
    : null;
}
