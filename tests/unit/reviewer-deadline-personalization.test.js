/** @jest-environment node */
jest.mock('../../lib/services/settings-service.js', () => ({ getSettingStrict: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/user-preference.js', () => ({ findByOwnerAndKey: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() }));
jest.mock('../../lib/services/external-token.js', () => ({ mintScopedToken: jest.fn(), verifyToken: jest.fn() }));
import { validateDeadlineTemplate, sharedDeadlineTemplate, loadOwnerDeadlineTemplate, resolveSenderDeadlineTemplate, saveOwnDeadlineTemplate, clearOwnDeadlineTemplate, mintDeadlinePreviewProof, verifyDeadlinePreviewProof } from '../../lib/services/reviewer-deadline-personalization';
import { getSettingStrict } from '../../lib/services/settings-service';
import * as prefs from '../../lib/dataverse/adapters/user-preference';
import { mintScopedToken, verifyToken } from '../../lib/services/external-token';
const PD = '44444444-4444-4444-8444-444444444444';
const TEMPLATE = { subject: 'Update: {{proposalTitle}}', body: '' };
beforeEach(() => { jest.resetAllMocks(); getSettingStrict.mockImplementation(async (key) => ({ found: true, value: key.endsWith('subject') ? TEMPLATE.subject : '' })); prefs.findByOwnerAndKey.mockResolvedValue(null); });
test.each(['', ' \n '])('empty body %p is valid and persists as explicit override', async (body) => {
  const template = { ...TEMPLATE, body }; expect(validateDeadlineTemplate(template).valid).toBe(true);
  expect(await saveOwnDeadlineTemplate(PD, template)).toMatchObject({ ok: true });
  expect(prefs.create).toHaveBeenCalledWith(expect.objectContaining({ wmkf_preferencevalue: JSON.stringify(template), 'ownerid@odata.bind': `/systemusers(${PD})` }));
  prefs.findByOwnerAndKey.mockResolvedValue({ wmkf_preferencevalue: JSON.stringify(template) });
  expect(await loadOwnerDeadlineTemplate(PD)).toMatchObject({ configured: true, template });
});
test('shared empty body valid but absent body is misconfigured; invalid shared tokens block', async () => {
  expect(await sharedDeadlineTemplate()).toEqual({ ok: true, template: TEMPLATE });
  getSettingStrict.mockResolvedValue({ found: false }); expect(await sharedDeadlineTemplate()).toMatchObject({ reason: 'misconfigured' });
  getSettingStrict.mockImplementation(async (key) => ({ found: true, value: key.endsWith('subject') ? '{{bad}}' : '' }));
  expect(await sharedDeadlineTemplate()).toMatchObject({ reason: 'misconfigured' });
});
test('absence falls back normally; unavailable or damaged row falls back with notice', async () => {
  expect(await resolveSenderDeadlineTemplate(PD, TEMPLATE)).toMatchObject({ template: TEMPLATE, templateSource: 'shared' });
  prefs.findByOwnerAndKey.mockRejectedValue(new Error('unavailable'));
  expect(await resolveSenderDeadlineTemplate(PD, TEMPLATE)).toMatchObject({ templateSource: 'shared_fallback', templateNotice: 'preference_unavailable' });
  prefs.findByOwnerAndKey.mockResolvedValue({ wmkf_preferencevalue: '{broken' });
  expect(await resolveSenderDeadlineTemplate(PD, TEMPLATE)).toMatchObject({ templateSource: 'shared_fallback', templateNotice: 'preference_invalid' });
});
test('clear removes only exact actor row; empty override is not absence', async () => {
  prefs.findByOwnerAndKey.mockResolvedValue({ wmkf_appuserpreferenceid: 'own', wmkf_preferencevalue: JSON.stringify(TEMPLATE) });
  expect(await resolveSenderDeadlineTemplate(PD, { ...TEMPLATE, body: 'Admin' })).toMatchObject({ templateSource: 'personal', template: TEMPLATE });
  await clearOwnDeadlineTemplate(PD); expect(prefs.remove).toHaveBeenCalledWith('own'); expect(prefs.findByOwnerAndKey).toHaveBeenCalledWith(PD, 'reviewer_deadline_update_template');
});
test.each([{ subject: '', body: '' }, { subject: 'x\ny', body: '' }, { subject: '{{signature}}', body: '' }, { subject: 'Update', body: '{{bad}}' }, { subject: 'Update', body: '{{signature}' }, { subject: 'Update', body: 'x'.repeat(12001) }, { ...TEMPLATE, cc: [] }])('invalid template rejected %p', (template) => { expect(validateDeadlineTemplate(template).valid).toBe(false); });
test('links allowed, supported optional tokens valid, invalid identity performs no write', async () => {
  expect(validateDeadlineTemplate({ subject: 'Update', body: 'https://example.org {{signature}}' }).valid).toBe(true);
  expect(await saveOwnDeadlineTemplate(null, TEMPLATE)).toMatchObject({ reason: 'identity_unavailable' }); expect(prefs.create).not.toHaveBeenCalled();
});
test('proof is deadline audience only, exact digest, five-minute TTL', async () => {
  mintScopedToken.mockResolvedValue({ jwt: 'jwt' }); const before = Date.now(); await mintDeadlinePreviewProof('digest');
  const options = mintScopedToken.mock.calls[0][0]; expect(options.audience).toBe('reviewer-deadline-preview'); expect(options.expiresAt.getTime() - before).toBeGreaterThanOrEqual(299900);
  verifyToken.mockResolvedValue({ valid: true, payload: { subject: 'digest', aud: 'reviewer-deadline-preview', ops: ['send'] } }); expect(await verifyDeadlinePreviewProof('jwt', 'digest')).toBe(true);
  verifyToken.mockResolvedValue({ valid: true, payload: { subject: 'digest', aud: 'reviewer-reminder-preview', ops: ['send'] } }); expect(await verifyDeadlinePreviewProof('jwt', 'digest')).toBe(false);
});
