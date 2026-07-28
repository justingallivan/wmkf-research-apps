const DEFAULT_REVIEWER_EMAIL_CLOSING = 'With appreciation,';

/**
 * Return the resolved signature using its persisted closing metadata.
 *
 * New preferences explicitly record whether the saved block already includes
 * its own closing. The preference reader provides bounded compatibility for
 * legacy pre-flag values; identity-only blocks and generated fallbacks receive
 * the shared default closing.
 */
export function composeReviewerEmailSignature(signatureBlock) {
  const signature = String(
    signatureBlock?.signature || signatureBlock?.name || 'W. M. Keck Foundation',
  ).trim();
  return signatureBlock?.customClosing === true
    ? signature
    : `${DEFAULT_REVIEWER_EMAIL_CLOSING}\n${signature}`;
}
