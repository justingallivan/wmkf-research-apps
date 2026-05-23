/**
 * alert-recipients.test.js
 *
 * Resolver behavior: category hit, default fallback, superuser-roster fallback,
 * dedupe + normalization, and write-path validation.
 *
 * Both Dataverse settings and Postgres are mocked. The point of these tests is
 * the resolver logic — not the IO adapters underneath.
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/services/dataverse-settings-service', () => ({
  getSetting: jest.fn(),
  setSetting: jest.fn(),
}));

const DataverseSettings = require('../../lib/services/dataverse-settings-service');
const { sql } = require('@vercel/postgres');

const AlertRecipients = require('../../lib/services/alert-recipients');

beforeEach(() => {
  jest.clearAllMocks();
});

function mockConfig(obj) {
  DataverseSettings.getSetting.mockResolvedValue(JSON.stringify(obj));
}
function mockRoster(emails) {
  sql.mockResolvedValue({ rows: emails.map((e) => ({ azure_email: e })) });
}

describe('isValidEmail', () => {
  test.each([
    'a@b.co', 'first.last@example.com', 'a+b@c.io',
  ])('accepts %s', (e) => expect(AlertRecipients.isValidEmail(e)).toBe(true));

  test.each([
    '', 'no-at-sign', 'a@', '@b.co', 'a@b', 'a b@c.co', null, undefined, 42,
  ])('rejects %s', (e) => expect(AlertRecipients.isValidEmail(e)).toBe(false));

  test('rejects emails over 254 chars', () => {
    const long = 'a'.repeat(250) + '@b.co';
    expect(AlertRecipients.isValidEmail(long)).toBe(false);
  });
});

describe('normalizeConfig', () => {
  test('trims, lowercases, dedupes', () => {
    const out = AlertRecipients.normalizeConfig({
      spend: [' A@B.CO ', 'a@b.co', 'c@d.io'],
    });
    expect(out).toEqual({ spend: ['a@b.co', 'c@d.io'] });
  });

  test('drops invalid emails silently (read-path defense)', () => {
    const out = AlertRecipients.normalizeConfig({
      ops: ['valid@x.co', 'not-an-email', 'also@y.io'],
    });
    expect(out).toEqual({ ops: ['valid@x.co', 'also@y.io'] });
  });

  test('drops empty categories', () => {
    const out = AlertRecipients.normalizeConfig({
      spend: ['a@b.co'],
      ops: [],
      bad: ['not-an-email'],
    });
    expect(out).toEqual({ spend: ['a@b.co'] });
  });

  test('returns {} for null/non-object', () => {
    expect(AlertRecipients.normalizeConfig(null)).toEqual({});
    expect(AlertRecipients.normalizeConfig('x')).toEqual({});
    expect(AlertRecipients.normalizeConfig([])).toEqual({});
  });
});

describe('resolveRecipients — lookup rule', () => {
  test('category hit returns that bucket', async () => {
    mockConfig({ spend: ['finance@wmkeck.org'], default: ['ops@wmkeck.org'] });
    const r = await AlertRecipients.resolveRecipients('spend');
    expect(r.recipients).toEqual(['finance@wmkeck.org']);
    expect(r.source).toBe('category');
    expect(r.category).toBe('spend');
  });

  test('unknown category falls back to default', async () => {
    mockConfig({ default: ['ops@wmkeck.org'] });
    const r = await AlertRecipients.resolveRecipients('does-not-exist');
    expect(r.recipients).toEqual(['ops@wmkeck.org']);
    expect(r.source).toBe('default');
  });

  test('empty category list falls back to default', async () => {
    mockConfig({ default: ['ops@wmkeck.org'] });
    // empty arrays are normalized away, so this exercises the same path
    const r = await AlertRecipients.resolveRecipients('spend');
    expect(r.recipients).toEqual(['ops@wmkeck.org']);
    expect(r.source).toBe('default');
  });

  test('no config, no default → superuser roster', async () => {
    mockConfig({});
    mockRoster(['admin@wmkeck.org']);
    const r = await AlertRecipients.resolveRecipients('intake');
    expect(r.recipients).toEqual(['admin@wmkeck.org']);
    expect(r.source).toBe('roster');
  });

  test('null category targets default bucket', async () => {
    mockConfig({ default: ['ops@wmkeck.org'] });
    const r = await AlertRecipients.resolveRecipients(null);
    expect(r.source).toBe('default');
    expect(r.recipients).toEqual(['ops@wmkeck.org']);
  });

  test('returns empty + source=none when nothing resolves', async () => {
    DataverseSettings.getSetting.mockResolvedValue(null);
    mockRoster([]);
    const r = await AlertRecipients.resolveRecipients('spend');
    expect(r.recipients).toEqual([]);
    expect(r.source).toBe('none');
  });

  test('roster filters invalid + bad-shape emails', async () => {
    DataverseSettings.getSetting.mockResolvedValue(null);
    mockRoster(['good@wmkeck.org', null, 'broken', '  another@wmkeck.org  ']);
    const r = await AlertRecipients.resolveRecipients('spend');
    expect(r.source).toBe('roster');
    expect(r.recipients).toEqual(['good@wmkeck.org', 'another@wmkeck.org']);
  });

  test('configOverride skips Dataverse read', async () => {
    const r = await AlertRecipients.resolveRecipients('spend', {
      configOverride: { spend: ['x@y.co'] },
    });
    expect(DataverseSettings.getSetting).not.toHaveBeenCalled();
    expect(r.recipients).toEqual(['x@y.co']);
  });

  test('corrupt JSON in setting → falls through to roster', async () => {
    DataverseSettings.getSetting.mockResolvedValue('not-json{');
    mockRoster(['admin@wmkeck.org']);
    const r = await AlertRecipients.resolveRecipients('spend');
    expect(r.source).toBe('roster');
    expect(r.recipients).toEqual(['admin@wmkeck.org']);
  });
});

describe('writeConfig — validation', () => {
  test('rejects non-object', async () => {
    const r = await AlertRecipients.writeConfig('nope');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/must be an object/);
  });

  test('rejects arrays at top level', async () => {
    const r = await AlertRecipients.writeConfig([]);
    expect(r.ok).toBe(false);
  });

  test('rejects bad email — loud (write-path)', async () => {
    const r = await AlertRecipients.writeConfig({ spend: ['ok@x.co', 'broken'] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('broken'))).toBe(true);
  });

  test('aggregates multiple errors instead of short-circuiting on first', async () => {
    const r = await AlertRecipients.writeConfig({
      spend: ['not-an-email'],
      ops: ['also-bad'],
      'BAD CATEGORY': ['ok@x.co'],
      bad_shape: 'not-an-array',
    });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(4);
    expect(r.errors.some((e) => e.includes('not-an-email'))).toBe(true);
    expect(r.errors.some((e) => e.includes('also-bad'))).toBe(true);
    expect(r.errors.some((e) => e.includes('BAD CATEGORY'))).toBe(true);
    expect(r.errors.some((e) => e.includes('must be an array'))).toBe(true);
  });

  test('rejects category names with weird characters', async () => {
    for (const bad of ['has space', 'UPPER', 'has.dot', '__proto__', 'with/slash', '']) {
      const r = await AlertRecipients.writeConfig({ [bad]: ['ok@x.co'] });
      expect(r.ok).toBe(false);
    }
  });

  test('accepts lowercase + digits + hyphen + underscore category names', async () => {
    DataverseSettings.setSetting.mockResolvedValue(true);
    const r = await AlertRecipients.writeConfig({
      'staff-onboarding': ['a@b.co'],
      'cat_1': ['c@d.io'],
    });
    expect(r.ok).toBe(true);
  });

  test('rejects non-array value', async () => {
    const r = await AlertRecipients.writeConfig({ spend: 'a@b.co' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/must be an array/);
  });

  test('writes normalized config on success', async () => {
    DataverseSettings.setSetting.mockResolvedValue(true);
    const r = await AlertRecipients.writeConfig({
      spend: [' A@B.CO ', 'a@b.co'],
      ops: [],
    });
    expect(r.ok).toBe(true);
    const [, value] = DataverseSettings.setSetting.mock.calls[0];
    expect(JSON.parse(value)).toEqual({ spend: ['a@b.co'] });
  });

  test('passes profileId through', async () => {
    DataverseSettings.setSetting.mockResolvedValue(true);
    await AlertRecipients.writeConfig({ spend: ['a@b.co'] }, 42);
    expect(DataverseSettings.setSetting.mock.calls[0][2]).toBe(42);
  });

  test('returns failure when Dataverse write fails', async () => {
    DataverseSettings.setSetting.mockResolvedValue(false);
    const r = await AlertRecipients.writeConfig({ spend: ['a@b.co'] });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('Dataverse write failed');
  });
});

describe('SEED_CATEGORIES', () => {
  test('includes the categories we tagged at call sites', () => {
    const keys = AlertRecipients.SEED_CATEGORIES.map((c) => c.key);
    for (const expected of ['default', 'security', 'spend', 'intake', 'ops', 'staff-onboarding', 'support']) {
      expect(keys).toContain(expected);
    }
  });
});
