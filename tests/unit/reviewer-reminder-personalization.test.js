import { DatabaseService } from '../../lib/services/database-service';
import { findByOwnerAndKey } from '../../lib/dataverse/adapters/user-preference';
import { readRequiredEmailDefaults } from '../../lib/services/email-defaults';
import {
  loadSenderReminderTemplate,
  saveOwnReminderTemplate,
  clearOwnReminderTemplate,
  sharedReminderTemplate,
  validateReminderTemplate,
  reminderPreviewDigest,
  mintReminderPreviewProof,
  verifyReminderPreviewProof,
} from '../../lib/services/reviewer-reminder-personalization';

jest.mock('../../lib/services/database-service', () => ({ DatabaseService: {
  setUserPreference: jest.fn(), deleteUserPreference: jest.fn(),
} }));
jest.mock('../../lib/dataverse/adapters/user-preference', () => ({ findByOwnerAndKey: jest.fn() }));
jest.mock('../../lib/services/email-defaults', () => ({ readRequiredEmailDefaults: jest.fn() }));
jest.mock('../../lib/services/external-token', () => ({
  mintScopedToken: jest.fn(async ({ subject, audience, ops }) => ({ jwt: `${subject}:${audience}:${ops[0]}` })),
  verifyToken: jest.fn(async (proof) => {
    const [subject, aud, op] = proof.split(':');
    return { valid: true, payload: { subject, aud, ops: [op] } };
  }),
}));

const shared = { subject: 'Admin subject', body: '{{greeting}}\n\n{{signature}}' };
const own = { subject: 'PD subject', body: '{{greeting}}\n\nMy wording\n\n{{signature}}' };
beforeEach(() => {
  jest.clearAllMocks();
  findByOwnerAndKey.mockResolvedValue(null);
  DatabaseService.setUserPreference.mockResolvedValue(true);
  DatabaseService.deleteUserPreference.mockResolvedValue(true);
  readRequiredEmailDefaults.mockResolvedValue({ ok: true, values: {
    'email.reviewer_reminder_respond_by.subject': shared.subject,
    'email.reviewer_reminder_respond_by.body': shared.body,
  } });
});

test('Admin fallback and exact PD ownership isolate defaults across users', async () => {
  findByOwnerAndKey.mockImplementation(async (owner) => owner === 'pd-a'
    ? { wmkf_preferencevalue: JSON.stringify(own), wmkf_isencrypted: false }
    : null);
  const a = await loadSenderReminderTemplate('pd-a', 'respond', shared);
  const b = await loadSenderReminderTemplate('pd-b', 'respond', shared);
  expect(a).toEqual({ ok: true, configured: true, template: own });
  expect(b).toEqual({ ok: true, configured: false, template: shared });
  expect(findByOwnerAndKey).toHaveBeenNthCalledWith(1, 'pd-a', 'reviewer_respond_reminder_template');
  expect(findByOwnerAndKey).toHaveBeenNthCalledWith(2, 'pd-b', 'reviewer_respond_reminder_template');
});

test('unavailable or malformed PD preference does not silently become Admin copy', async () => {
  findByOwnerAndKey.mockRejectedValueOnce(new Error('Dataverse down'));
  expect(await loadSenderReminderTemplate('pd-a', 'respond', shared)).toEqual({ ok: false, reason: 'preference_unavailable' });
  findByOwnerAndKey.mockResolvedValueOnce({ wmkf_preferencevalue: '{bad json', wmkf_isencrypted: false });
  expect(await loadSenderReminderTemplate('pd-a', 'respond', shared)).toEqual({ ok: false, reason: 'preference_invalid' });
});

test('explicit save and reset use only the authenticated profile and kind key', async () => {
  expect(await saveOwnReminderTemplate(17, 'respond', own)).toEqual({ ok: true, template: own });
  expect(DatabaseService.setUserPreference).toHaveBeenCalledWith(17, 'reviewer_respond_reminder_template', JSON.stringify(own));
  expect(await clearOwnReminderTemplate(17, 'respond')).toBe(true);
  expect(DatabaseService.deleteUserPreference).toHaveBeenCalledWith(17, 'reviewer_respond_reminder_template');
  expect(DatabaseService.setUserPreference).toHaveBeenCalledTimes(1);
});

test('invalid review-due copy cannot save a missing date or reviewer link', async () => {
  expect(validateReminderTemplate('reviewdue', { subject: 'Soon', body: '{{greeting}}' }).errors).toContain('required:reviewDueDate');
  expect(validateReminderTemplate('reviewdue', { subject: 'Soon', body: '{{reviewDueDate}} /external/review/secret' }).errors).toContain('reviewer_link');
  expect(validateReminderTemplate('respond', { subject: 'Soon', body: 'Go to https://example.org instead.' }).errors).toContain('link');
  await saveOwnReminderTemplate(17, 'reviewdue', { subject: 'Soon', body: '{{greeting}}' });
  expect(DatabaseService.setUserPreference).not.toHaveBeenCalled();
});

test('shared template uses the existing Admin registry keys', async () => {
  expect(await sharedReminderTemplate('respond')).toEqual({ ok: true, template: shared });
  expect(readRequiredEmailDefaults).toHaveBeenCalledWith([
    'email.reviewer_reminder_respond_by.subject', 'email.reviewer_reminder_respond_by.body',
  ], expect.any(Object));
});

test('preview proof is scoped to the exact context digest', async () => {
  const digest = reminderPreviewDigest({ actor: 'pd-a', subject: own.subject });
  const proof = await mintReminderPreviewProof(digest);
  expect(await verifyReminderPreviewProof(proof, digest)).toBe(true);
  expect(await verifyReminderPreviewProof(proof, reminderPreviewDigest({ actor: 'pd-b', subject: own.subject }))).toBe(false);
});
