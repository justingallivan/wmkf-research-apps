/** @jest-environment node */

jest.mock('../../lib/services/database-service', () => ({
  DatabaseService: {
    getUserPreferences: jest.fn(async () => ({})),
    setUserPreference: jest.fn(async () => true),
    deleteUserPreference: jest.fn(async () => true),
  },
}));
jest.mock('../../lib/services/email-defaults', () => ({
  readRequiredEmailDefaults: jest.fn(async () => ({ ok: true, values: {
    'email.site_visit_materials_invite.subject': 'Materials for {{proposalTitle}}',
    'email.site_visit_materials_invite.body': 'Hello {{institution}}\n{{checklist}}\n{{signature}}',
    'email.site_visit_materials_reminder.subject': 'Reminder {{proposalTitle}}',
    'email.site_visit_materials_reminder.body': 'Please provide {{missingItems}} {{signature}}',
  } })),
}));

import { SignJWT } from 'jose';
import {
  MATERIALS_EMAIL_KINDS,
  MATERIALS_EMAIL_PREVIEW_AUDIENCE,
  MATERIALS_EMAIL_PREFERENCE_KEYS,
  validateMaterialsEmailTemplate,
  validatePartialMaterialsEmailTemplate,
  loadPersonalMaterialsTemplate,
  savePersonalMaterialsTemplate,
  sharedMaterialsEmailDefaults,
  mintMaterialsPreviewProof,
  verifyMaterialsPreviewProof,
} from '../../lib/services/site-visit-materials/email-personalization';
import { DatabaseService } from '../../lib/services/database-service';

const INVITE = { subject: 'Materials for {{proposalTitle}}', body: 'Hello {{institution}}\n{{checklist}}\n{{signature}}' };
const REMINDER = { subject: 'Reminder {{proposalTitle}}', body: 'Please provide {{missingItems}} {{signature}}' };

beforeAll(() => {
  process.env.EXTERNAL_LINK_SECRET = 'materials-email-test-secret-0123456789012345';
});

afterAll(() => {
  delete process.env.EXTERNAL_LINK_SECRET;
});

test('enforces renderer token grammar, shapes, kinds, and required per-kind tokens', () => {
  expect(validateMaterialsEmailTemplate('invitation', INVITE).valid).toBe(true);
  expect(validateMaterialsEmailTemplate('invitation', { ...INVITE, subject: 'Hi {{ proposalTitle }}' }).valid).toBe(false);
  expect(validateMaterialsEmailTemplate('invitation', { ...INVITE, body: 'Hello {{missingItems}}' }).valid).toBe(false);
  expect(validateMaterialsEmailTemplate('reminder', REMINDER).valid).toBe(true);
  expect(validateMaterialsEmailTemplate('unknown', INVITE).valid).toBe(false);
  expect(validateMaterialsEmailTemplate('invitation', { ...INVITE, extra: 'x' }).valid).toBe(false);
  expect(validateMaterialsEmailTemplate('invitation', [INVITE]).valid).toBe(false);
  expect(validatePartialMaterialsEmailTemplate(MATERIALS_EMAIL_KINDS.invitation, { subject: 'Hi {{proposalTitle}}' }).valid).toBe(true);
  expect(validatePartialMaterialsEmailTemplate(MATERIALS_EMAIL_KINDS.invitation, { body: '' }).valid).toBe(false);
  expect(validatePartialMaterialsEmailTemplate(MATERIALS_EMAIL_KINDS.invitation, { body: '{{unknown}}' }).valid).toBe(false);
  expect(validatePartialMaterialsEmailTemplate('unknown', { subject: 'x' }).valid).toBe(false);
});

test('partial overrides load safely and save only validated fields', async () => {
  DatabaseService.getUserPreferences.mockResolvedValueOnce({
    [MATERIALS_EMAIL_PREFERENCE_KEYS.invitation]: JSON.stringify({ subject: 'Mine {{proposalTitle}}' }),
  });
  expect(await loadPersonalMaterialsTemplate(7, 'invitation')).toEqual({ subject: 'Mine {{proposalTitle}}' });
  expect(await savePersonalMaterialsTemplate(7, 'invitation', { subject: 'Mine {{unknown}}' })).toEqual(expect.objectContaining({ ok: false }));
  expect(await savePersonalMaterialsTemplate(7, 'invitation', { subject: 'Mine {{proposalTitle}}' })).toEqual(expect.objectContaining({ ok: true, value: { subject: 'Mine {{proposalTitle}}' } }));
  expect(DatabaseService.setUserPreference).toHaveBeenCalledWith(7, MATERIALS_EMAIL_PREFERENCE_KEYS.invitation, JSON.stringify({ subject: 'Mine {{proposalTitle}}' }));
});

test('unknown shared-default kind is rejected', async () => {
  expect(await sharedMaterialsEmailDefaults('other')).toEqual({ ok: false, template: null });
});

test('real signed proof round trip exposes subject and audience, and rejects bindings', async () => {
  const digest = 'a'.repeat(64);
  const expiresAt = new Date(Date.now() + 300000);
  const proof = await mintMaterialsPreviewProof({ digest, action: 'invite', expiresAt });
  const verified = await verifyMaterialsPreviewProof(proof, { digest, action: 'invite' });
  expect(verified).toEqual({ valid: true, payload: {
    subject: digest,
    aud: MATERIALS_EMAIL_PREVIEW_AUDIENCE,
    ops: ['invite'],
  } });
  expect((await verifyMaterialsPreviewProof(proof, { digest: 'b'.repeat(64), action: 'invite' })).valid).toBe(false);
  expect((await verifyMaterialsPreviewProof(proof, { digest, action: 'remind' })).valid).toBe(false);

  const expired = await new SignJWT({ sub: digest, ops: ['invite'] })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setAudience(MATERIALS_EMAIL_PREVIEW_AUDIENCE)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
    .sign(new TextEncoder().encode(process.env.EXTERNAL_LINK_SECRET));
  expect((await verifyMaterialsPreviewProof(expired, { digest, action: 'invite' })).valid).toBe(false);

  const wrongAudience = await new SignJWT({ sub: digest, ops: ['invite'] })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setAudience('materials')
    .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
    .sign(new TextEncoder().encode(process.env.EXTERNAL_LINK_SECRET));
  expect((await verifyMaterialsPreviewProof(wrongAudience, { digest, action: 'invite' })).valid).toBe(false);
});
