/**
 * Reviewer Lifecycle Stage 6D — shared/utils/reviewer-send-skip-reasons.js.
 */

const { SEND_SKIP_REASON, SEND_SKIP_REASON_LABEL } = require('../../shared/utils/reviewer-send-skip-reasons');
const { INVALID_SECURE_LINK_SKIP_REASON } = require('../../lib/utils/invitation-link-validator');

test('SEND_SKIP_REASON.invalid_secure_link is a literal (not an imported-identifier alias, for the parity gate extractor) whose VALUE still matches INVALID_SECURE_LINK_SKIP_REASON', () => {
  expect(SEND_SKIP_REASON.invalid_secure_link).toBe(INVALID_SECURE_LINK_SKIP_REASON);
});

test('every SEND_SKIP_REASON value has a SEND_SKIP_REASON_LABEL entry', () => {
  for (const value of Object.values(SEND_SKIP_REASON)) {
    expect(typeof SEND_SKIP_REASON_LABEL[value]).toBe('string');
    expect(SEND_SKIP_REASON_LABEL[value].length).toBeGreaterThan(0);
  }
});

test('the two Stage 6D reasons carry the plan-specified verbatim copy', () => {
  expect(SEND_SKIP_REASON_LABEL.draft_stale).toBe(
    'The reviewer or proposal details changed after this preview was rendered. '
    + 'Nothing was sent to this reviewer — reopen the preview to render a fresh draft.',
  );
  expect(SEND_SKIP_REASON_LABEL.draft_fingerprint_missing).toBe(
    'This draft was rendered before the current version of the app. '
    + 'Nothing was sent — reopen the preview to render it again.',
  );
});
