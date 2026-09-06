/**
 * Reviewer Lifecycle Stage 6D — guards that `send-emails-service.js` pushes
 * `skipped[].reason` ONLY through the named `SEND_SKIP_REASON` const
 * (shared/utils/reviewer-send-skip-reasons.js), never a bare string literal.
 * A bare literal would bypass scripts/check-status-enum-parity.js's producer
 * extraction (`extractObjectStringValues(src, 'SEND_SKIP_REASON')`), letting
 * a new unlabeled skip reason reach a modal silently.
 *
 * One EXEMPT usage remains by design: the send-time token verifier's internal
 * result object (`verified = { ok: false, reason: 'verifier_exception' }`) is
 * a different, unrelated vocabulary (verifier outcomes, never pushed to
 * `skipped[]`/`failed[]`) — see lib/utils/verify-suggestion-token.js's own
 * `reason` values (`hash_mismatch`, etc.) for the sibling cases. It is
 * recognized here only when it appears on a line that also contains `ok:
 * false`, so a genuine new bare skip-reason literal elsewhere still fails
 * this test.
 */

const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '../../lib/services/review-manager/send-emails-service.js');

test('every reason: / reason = string literal is either SEND_SKIP_REASON.x or the exempt verifier-result literal', () => {
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  const lines = src.split('\n');
  const offenders = [];

  const literalPattern = /reason\s*[:=]\s*['"][^'"]+['"]/;
  lines.forEach((line, idx) => {
    if (!literalPattern.test(line)) return;
    // The one exempt usage: the token verifier's internal result object,
    // never pushed as a skip reason.
    if (line.includes('ok: false')) return;
    offenders.push(`line ${idx + 1}: ${line.trim()}`);
  });

  expect(offenders).toEqual([]);
});

test('SEND_SKIP_REASON is imported and used at least once as `reason: SEND_SKIP_REASON.` or `reason = SEND_SKIP_REASON.`', () => {
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  expect(src).toContain("from '../../../shared/utils/reviewer-send-skip-reasons'");
  expect(/reason\s*[:=]\s*SEND_SKIP_REASON\./.test(src)).toBe(true);
});
