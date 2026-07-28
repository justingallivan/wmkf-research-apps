const DEFAULT_REVIEWER_EMAIL_CLOSING = 'With appreciation,';

/**
 * Return the resolved signature without guessing at free-text semantics.
 *
 * A saved custom signature is authoritative and used verbatim: trying to infer
 * whether arbitrary prose such as "Best wishes," is a valediction recreates the
 * double-closing bug for every phrase outside a finite allowlist. Generated
 * fallback blocks are provenance-labeled by email-signature.js and receive the
 * default closing here.
 */
export function composeReviewerEmailSignature(signatureBlock) {
  const signature = String(
    signatureBlock?.signature || signatureBlock?.name || 'W. M. Keck Foundation',
  ).trim();
  return signatureBlock?.isCustomSignature === true
    ? signature
    : `${DEFAULT_REVIEWER_EMAIL_CLOSING}\n${signature}`;
}
