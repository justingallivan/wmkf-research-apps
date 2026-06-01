/**
 * @jest-environment node
 *
 * Locks the S211 invitation duplicate-send guard (Codex blocker): an invitation
 * to an already-invited candidate is skipped unless an explicit re-invite, while
 * materials/followup/thankyou stay re-sendable.
 */
const { shouldSkipDuplicateInvitation, sendAllowsAttachments, recipientMayReceiveAttachments } = require('../../lib/utils/reviewer-invite');

describe('shouldSkipDuplicateInvitation', () => {
  test('skips an already-invited invitation by default', () => {
    expect(shouldSkipDuplicateInvitation({ templateType: 'invitation', allowResend: false, invited: true })).toBe(true);
  });
  test('does NOT skip a not-yet-invited candidate', () => {
    expect(shouldSkipDuplicateInvitation({ templateType: 'invitation', allowResend: false, invited: false })).toBe(false);
  });
  test('allowResend overrides the guard (deliberate re-invite)', () => {
    expect(shouldSkipDuplicateInvitation({ templateType: 'invitation', allowResend: true, invited: true })).toBe(false);
  });
  test('non-invitation types are never skipped (materials/followup are re-sendable)', () => {
    for (const templateType of ['materials', 'followup', 'thankyou']) {
      expect(shouldSkipDuplicateInvitation({ templateType, allowResend: false, invited: true })).toBe(false);
    }
  });
});

describe('sendAllowsAttachments — no materials on a pre-acceptance invitation', () => {
  test('invitation carries NO attachments', () => {
    expect(sendAllowsAttachments('invitation')).toBe(false);
  });
  test('post-acceptance types may carry attachments', () => {
    for (const t of ['materials', 'followup', 'thankyou']) {
      expect(sendAllowsAttachments(t)).toBe(true);
    }
  });
});

describe('recipientMayReceiveAttachments — server-authoritative (acceptance), not caller-controlled', () => {
  test('only an accepted recipient may receive attachments', () => {
    expect(recipientMayReceiveAttachments({ wmkf_accepted: true })).toBe(true);
  });
  test('not-yet-accepted / declined / missing → no attachments', () => {
    expect(recipientMayReceiveAttachments({ wmkf_accepted: false })).toBe(false);
    expect(recipientMayReceiveAttachments({ wmkf_accepted: null })).toBe(false);
    expect(recipientMayReceiveAttachments({})).toBe(false);
    expect(recipientMayReceiveAttachments(null)).toBe(false);
  });
});
