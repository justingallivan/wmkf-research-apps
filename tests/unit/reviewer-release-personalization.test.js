/**
 * @jest-environment node
 */
const findByOwnerAndKey = jest.fn();
const create = jest.fn(async () => ({}));
const update = jest.fn(async () => ({}));
const remove = jest.fn(async () => ({}));
jest.mock('../../lib/dataverse/adapters/user-preference.js', () => ({
  findByOwnerAndKey: (...a) => findByOwnerAndKey(...a),
  create: (...a) => create(...a),
  update: (...a) => update(...a),
  remove: (...a) => remove(...a),
}));
jest.mock('../../lib/services/email-defaults.js', () => ({ readRequiredEmailDefaults: jest.fn() }));

const {
  validateReleaseTemplate,
  loadOwnerReleaseTemplate,
  resolveSenderReleaseTemplate,
  saveOwnReleaseTemplate,
  clearOwnReleaseTemplate,
} = require('../../lib/services/reviewer-release-personalization');

const OWNER = '33333333-3333-4333-8333-333333333333';
const shared = { subject: 'Admin', body: '{{greeting}} admin {{signature}}' };
const mine = { subject: 'Thank you', body: '{{greeting}},\nThanks for {{proposalClause}}.\n{{signature}}' };
const row = (value, over = {}) => ({ wmkf_appuserpreferenceid: 'pref-1', wmkf_preferencevalue: JSON.stringify(value), wmkf_isencrypted: false, ...over });

beforeEach(() => jest.clearAllMocks());

describe('validateReleaseTemplate', () => {
  test('accepts the four body placeholders', () => {
    expect(validateReleaseTemplate('withdraw', { subject: 'S', body: '{{greeting}} {{reviewerName}} {{proposalClause}} {{signature}}' }).valid).toBe(true);
  });
  test.each([
    [{ subject: 'S {{reviewerName}}', body: 'b' }, 'unknown:subject:reviewerName'],
    [{ subject: 'S', body: '{{externalLink}}' }, 'unknown:body:externalLink'],
    [{ subject: 'S', body: 'see https://example.org' }, 'link'],
    [{ subject: 'S', body: 'broken {{greeting' }, 'malformed:body'],
    [{ subject: 'two\nlines', body: 'b' }, 'subject'],
    [{ subject: 'S', body: '   ' }, 'body'],
  ])('rejects %p', (template, error) => {
    const result = validateReleaseTemplate('release', template);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(error);
  });
  test('rejects extra fields and unknown kinds', () => {
    expect(validateReleaseTemplate('withdraw', { ...mine, to: 'x@example.org' }).valid).toBe(false);
    expect(validateReleaseTemplate('respond', mine).valid).toBe(false);
  });
});

describe('resolveSenderReleaseTemplate', () => {
  test('uses the sender saved wording when present', async () => {
    findByOwnerAndKey.mockResolvedValueOnce(row(mine));
    await expect(resolveSenderReleaseTemplate(OWNER, 'withdraw', shared)).resolves.toEqual({ template: mine, templateSource: 'personal' });
    expect(findByOwnerAndKey).toHaveBeenCalledWith(OWNER, 'reviewer_withdraw_template');
  });
  test('uses Admin wording when the sender has none', async () => {
    findByOwnerAndKey.mockResolvedValueOnce(null);
    await expect(resolveSenderReleaseTemplate(OWNER, 'release', shared)).resolves.toEqual({ template: shared, templateSource: 'shared' });
    expect(findByOwnerAndKey).toHaveBeenCalledWith(OWNER, 'reviewer_release_template');
  });
  test('falls back to Admin wording with a notice when the read fails', async () => {
    findByOwnerAndKey.mockRejectedValueOnce(new Error('dataverse down'));
    await expect(resolveSenderReleaseTemplate(OWNER, 'withdraw', shared)).resolves.toEqual({
      template: shared, templateSource: 'shared_fallback', templateNotice: 'preference_unavailable',
    });
  });
  test.each([
    ['unparseable', { wmkf_appuserpreferenceid: 'p', wmkf_preferencevalue: '{', wmkf_isencrypted: false }],
    ['encrypted', row(mine, { wmkf_isencrypted: true })],
    ['invalid copy', row({ subject: 'S', body: '{{externalLink}}' })],
  ])('falls back to Admin wording with a notice when the row is %s', async (_label, stored) => {
    findByOwnerAndKey.mockResolvedValueOnce(stored);
    await expect(resolveSenderReleaseTemplate(OWNER, 'withdraw', shared)).resolves.toEqual({
      template: shared, templateSource: 'shared_fallback', templateNotice: 'preference_invalid',
    });
  });
  test('a non-GUID sender never queries and falls back', async () => {
    const result = await resolveSenderReleaseTemplate('not-a-guid', 'withdraw', shared);
    expect(result.templateSource).toBe('shared_fallback');
    expect(findByOwnerAndKey).not.toHaveBeenCalled();
  });
});

describe('save and clear', () => {
  test('creates an owner-bound row when none exists', async () => {
    findByOwnerAndKey.mockResolvedValueOnce(null);
    await expect(saveOwnReleaseTemplate(OWNER, 'release', mine)).resolves.toEqual({ ok: true, kind: 'release', template: mine });
    expect(create).toHaveBeenCalledWith({
      wmkf_preferencekey: 'reviewer_release_template',
      wmkf_preferencevalue: JSON.stringify(mine),
      wmkf_isencrypted: false,
      'ownerid@odata.bind': `/systemusers(${OWNER})`,
    });
  });
  test('updates the existing row in place', async () => {
    findByOwnerAndKey.mockResolvedValueOnce(row(shared));
    await saveOwnReleaseTemplate(OWNER, 'withdraw', mine);
    expect(update).toHaveBeenCalledWith('pref-1', { wmkf_preferencevalue: JSON.stringify(mine), wmkf_isencrypted: false });
    expect(create).not.toHaveBeenCalled();
  });
  test('invalid copy is never written', async () => {
    await expect(saveOwnReleaseTemplate(OWNER, 'withdraw', { subject: 'S', body: 'http://x.org' })).resolves.toMatchObject({ ok: false, reason: 'validation' });
    expect(findByOwnerAndKey).not.toHaveBeenCalled();
  });
  test('persistence failure is reported, not thrown', async () => {
    findByOwnerAndKey.mockRejectedValueOnce(new Error('boom'));
    await expect(saveOwnReleaseTemplate(OWNER, 'withdraw', mine)).resolves.toEqual({ ok: false, reason: 'persistence' });
  });
  test('clear removes only an existing row and tolerates none', async () => {
    findByOwnerAndKey.mockResolvedValueOnce(row(mine));
    await expect(clearOwnReleaseTemplate(OWNER, 'withdraw')).resolves.toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith('pref-1');
    findByOwnerAndKey.mockResolvedValueOnce(null);
    await expect(clearOwnReleaseTemplate(OWNER, 'release')).resolves.toEqual({ ok: true });
    expect(remove).toHaveBeenCalledTimes(1);
  });
  test('loadOwnerReleaseTemplate reports configured state', async () => {
    findByOwnerAndKey.mockResolvedValueOnce(row(mine));
    await expect(loadOwnerReleaseTemplate(OWNER, 'withdraw')).resolves.toEqual({ ok: true, configured: true, template: mine });
  });
});
