/**
 * Top-level chat failure copy and response auto-detection for the Dynamics
 * Explorer chat route.
 *
 * Tool failures never reach this path — they are classified by
 * classifyToolError and fed back into the agent loop. Everything that DOES
 * reach the outer catch is infrastructure: the Claude call, the role/
 * restriction load, or the taxonomy build. A single "Query failed" string told
 * the user nothing about which, and left nothing to quote when escalating.
 *
 * In production the raw error stays server-side (logged above with the same
 * requestId); in development it is ALSO returned as `details` for local
 * debugging — so "server-side only" holds for production, not for every mode.
 * Copy follows the house voice for transient failures: the system is the
 * subject, plain words, and a retry → administrator action ladder. It never
 * implies the user's own access is in doubt.
 *
 * Extracted verbatim from pages/api/dynamics-explorer/chat.js:415-498;
 * characterization tests are the safety net.
 */

// ─── Top-level failure copy ───
//
// Tool failures never reach this path — they are classified by
// classifyToolError and fed back into the agent loop. Everything that DOES
// reach the outer catch is infrastructure: the Claude call, the role/
// restriction load, or the taxonomy build. A single "Query failed" string told
// the user nothing about which, and left nothing to quote when escalating.
//
// In production the raw error stays server-side (logged above with the same
// requestId); in development it is ALSO returned as `details` for local
// debugging — so "server-side only" holds for production, not for every mode.
// Copy follows the house voice for transient failures: the system is the
// subject, plain words, and a retry → administrator action ladder. It never
// implies the user's own access is in doubt.

// "press retry" would name a button the Explorer does not have — an error
// message is a plain chat bubble, and the only recovery is asking again.
const RETRY_LADDER = 'Please try asking again, and if the problem doesn\'t resolve, contact an administrator.';

/**
 * Map a top-level chat failure to user-facing copy.
 * @param {Error & { status?: number }} error
 * @returns {string}
 */
export function describeChatFailure(error) {
  const status = typeof error?.status === 'number' ? error.status : null;
  const raw = String(error?.message || '');
  const isAbort = error?.name === 'AbortError' || /\baborted\b/i.test(raw);
  const isTimeout = /\btimeout\b/i.test(raw);

  if (isTimeout || isAbort) {
    return 'That question took too long to answer, so I stopped it. Narrowing it usually '
      + 'helps — name a single organization, or add a date range. '
      + 'No data was changed. ' + RETRY_LADDER;
  }

  if (status === 429) {
    return 'The AI service is handling too many requests at the moment, so it turned '
      + 'mine away. This is usually a temporary blip. ' + RETRY_LADDER;
  }

  if (status === 529 || status === 503) {
    return 'The AI service is temporarily overloaded and couldn\'t take my request. '
      + 'This is usually a temporary blip. ' + RETRY_LADDER;
  }

  if (status !== null) {
    return 'I\'m having trouble reaching the AI service, so I couldn\'t work through '
      + 'your question. This is usually a temporary blip. ' + RETRY_LADDER;
  }

  return 'Something went wrong on my side before I could finish your question. '
    + 'This is usually a temporary blip. ' + RETRY_LADDER;
}

// ─── Auto-detection ───

/**
 * Check if Claude's final response text suggests a failure to find or answer.
 * Returns true if the response contains patterns indicating no results or inability to answer.
 */
export function detectPossibleFailure(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const failurePatterns = [
    'i couldn\'t find',
    'i could not find',
    'i wasn\'t able to',
    'i was not able to',
    'no results',
    'no records found',
    'no matching',
    'unable to locate',
    'unable to find',
    'doesn\'t appear to',
    'does not appear to',
    'i don\'t have enough',
    'i do not have enough',
    'unfortunately',
    'i\'m not sure how to',
  ];
  return failurePatterns.some(pattern => lower.includes(pattern));
}

