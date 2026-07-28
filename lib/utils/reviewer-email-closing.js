const DEFAULT_REVIEWER_EMAIL_CLOSING = 'With appreciation,';
const VALEDICTION = /^(?:thank you(?: very much)?|thanks|with appreciation|with gratitude|sincerely|best|all the best|best regards|kind regards|warm regards|regards|warmly|respectfully|cordially)\s*[,!]?\s*$/i;

/**
 * Return the resolved signature with exactly one opening valediction.
 *
 * Saved signatures are free text: some begin with their own closing while the
 * resolver fallback guarantees only a name/Foundation block. Reviewer action
 * templates therefore omit a fixed closing and compose it here at render time.
 */
export function composeReviewerEmailSignature(signatureBlock) {
  const signature = String(
    signatureBlock?.signature || signatureBlock?.name || 'W. M. Keck Foundation',
  ).trim();
  const firstLine = signature.split(/\r?\n/).find((line) => line.trim()) || '';
  return VALEDICTION.test(firstLine.trim())
    ? signature
    : `${DEFAULT_REVIEWER_EMAIL_CLOSING}\n${signature}`;
}
