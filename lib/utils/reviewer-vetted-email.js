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
export function pickVettedEmail(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const enr = (candidate.contactEnrichment && typeof candidate.contactEnrichment === 'object')
    ? candidate.contactEnrichment
    : {};

  const email = (typeof candidate.email === 'string' && candidate.email.trim())
    || (typeof enr.email === 'string' && enr.email.trim())
    || '';
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
