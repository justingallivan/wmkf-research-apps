/**
 * @jest-environment node
 */

describe('seed-email-defaults script core', () => {
  test('dry-run is the default and reports create actions without writing', async () => {
    const { seedEmailDefaults } = await import('../../scripts/seed-email-defaults.mjs');
    const getSettingStrict = jest.fn(async () => ({ found: false, value: null }));
    const setSetting = jest.fn();
    const logger = { log: jest.fn() };

    const result = await seedEmailDefaults({ getSettingStrict, setSetting, logger });

    expect(result.map((r) => r.action)).toEqual(['dry-create', 'dry-create']);
    expect(setSetting).not.toHaveBeenCalled();
  });

  test('writes seed values when settings are unset and execute mode is requested', async () => {
    const {
      EMAIL_DEFAULT_SEED_TEXT,
      seedEmailDefaults,
    } = await import('../../scripts/seed-email-defaults.mjs');
    const getSettingStrict = jest.fn(async () => ({ found: false, value: null }));
    const setSetting = jest.fn(async () => true);
    const logger = { log: jest.fn() };

    const result = await seedEmailDefaults({
      getSettingStrict,
      setSetting,
      dryRun: false,
      logger,
    });

    expect(result.map((r) => r.action)).toEqual(['created', 'created']);
    expect(setSetting).toHaveBeenCalledWith(
      'email.grantee_invite.subject',
      EMAIL_DEFAULT_SEED_TEXT['email.grantee_invite.subject'],
      null,
    );
    expect(setSetting).toHaveBeenCalledWith(
      'email.grantee_invite.body',
      EMAIL_DEFAULT_SEED_TEXT['email.grantee_invite.body'],
      null,
    );
  });

  test('does not overwrite existing non-empty settings', async () => {
    const { seedEmailDefaults } = await import('../../scripts/seed-email-defaults.mjs');
    const getSettingStrict = jest.fn(async () => ({ found: true, value: 'Custom value' }));
    const setSetting = jest.fn();
    const logger = { log: jest.fn() };

    const result = await seedEmailDefaults({
      getSettingStrict,
      setSetting,
      dryRun: false,
      logger,
    });

    expect(result.map((r) => r.action)).toEqual(['skip-existing', 'skip-existing']);
    expect(setSetting).not.toHaveBeenCalled();
  });

  test('blank stored values are treated as unconfigured and seeded', async () => {
    const { seedEmailDefaults } = await import('../../scripts/seed-email-defaults.mjs');
    const getSettingStrict = jest.fn(async (key) => (
      key === 'email.grantee_invite.subject'
        ? { found: true, value: '   ' }
        : { found: true, value: 'Custom body' }
    ));
    const setSetting = jest.fn(async () => true);
    const logger = { log: jest.fn() };

    const result = await seedEmailDefaults({
      getSettingStrict,
      setSetting,
      dryRun: false,
      logger,
    });

    expect(result.map((r) => r.action)).toEqual(['created', 'skip-existing']);
    expect(setSetting).toHaveBeenCalledTimes(1);
    expect(setSetting.mock.calls[0][0]).toBe('email.grantee_invite.subject');
  });
});
