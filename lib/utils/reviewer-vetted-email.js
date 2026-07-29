/**
 * reviewer-vetted-email — the single gate deciding whether a reviewer email held in
 * a roster candidate blob may be persisted to Dataverse. Shared by
 * promote-applicant-reviewer (B1) and reviewer-email-reconciler (A) so the two
 * paths cannot drift. Mirrors save-candidates' persist envelope:
 *   - the email must exist (top-level or in contactEnrichment),
 *   - enrichment must have marked it persistable (emailPersistAllowed===true —
 *     enrichment sets this false on any identity/domain abstain), and
 *   - identity must NOT be unresolved / needs-review (never a namesake's address).
 * Returns { email, source } (source = the vetted enrichment provenance, e.g.
 * 'affiliation'/'pubmed'/'claude_search') or null when the row is not persistable.
 * Pure — no I/O.
 */

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
 * WHY THIS IS NOT JUST "read both fields" (S387, second adversarial review). A pruned
 * roster row is NOT internally coherent: `pruneCandidateForRoster` stores
 * `email: c.email || e.email` but `emailSource: e.emailSource` — the top-level source is
 * ALWAYS enrichment-derived, while the top-level address prefers the client's value. So a
 * row whose top-level address came from somewhere other than enrichment (a manual
 * correction, a promoted lead, a merge) carries a top-level source that describes the
 * ENRICHMENT address instead. Reading "both top-level fields" therefore pairs an address
 * with provenance that was never evidence for it — which is exactly what a provenance
 * writer must never do.
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

export function pickVettedEmail(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const enr = (candidate.contactEnrichment && typeof candidate.contactEnrichment === 'object')
    ? candidate.contactEnrichment
    : {};

  const email = (typeof candidate.email === 'string' && candidate.email.trim())
    || (typeof enr.email === 'string' && enr.email.trim())
    || '';
  if (email && isAntiScrapeMunge(email)) return null;
  const persistOk = candidate.emailPersistAllowed === true || enr.emailPersistAllowed === true;
  const identityUnresolved = candidate.needsIdentification === true
    || candidate.identityStatus === 'unresolved'
    || candidate.verificationStatus === 'unresolved';
  if (!email || !persistOk || identityUnresolved) return null;

  const source = (typeof candidate.emailSource === 'string' && candidate.emailSource)
    || (typeof enr.emailSource === 'string' && enr.emailSource)
    || null;
  return { email, source };
}
