/**
 * @jest-environment node
 */

describe('seed-email-defaults script core', () => {
  test('dry-run is the default and reports create actions without writing', async () => {
    const { EDITABLE_TEXT_DEFAULTS } = await import('../../shared/config/editableTextDefaults.js');
    const { seedEmailDefaults } = await import('../../scripts/seed-email-defaults.mjs');
    const getSettingStrict = jest.fn(async () => ({ found: false, value: null }));
    const setSetting = jest.fn();
    const logger = { log: jest.fn() };

    const result = await seedEmailDefaults({ getSettingStrict, setSetting, logger });

    const seedableKeys = EDITABLE_TEXT_DEFAULTS.filter((entry) => !entry.key.startsWith('stage.'));
    const stageKeys = EDITABLE_TEXT_DEFAULTS.filter((entry) => entry.key.startsWith('stage.'));
    expect(result.filter((r) => !r.key.startsWith('stage.')).map((r) => r.action))
      .toEqual(seedableKeys.map(() => 'dry-create'));
    expect(result.filter((r) => r.key.startsWith('stage.')).map((r) => r.action))
      .toEqual(stageKeys.map(() => 'skip-no-seed'));
    expect(setSetting).not.toHaveBeenCalled();
  });

  test('skips stage.deliberations.* entries — display labels have code defaults, not seeds', async () => {
    const { EDITABLE_TEXT_DEFAULTS } = await import('../../shared/config/editableTextDefaults.js');
    const { seedEmailDefaults } = await import('../../scripts/seed-email-defaults.mjs');
    const getSettingStrict = jest.fn(async () => ({ found: false, value: null }));
    const setSetting = jest.fn(async () => true);
    const logger = { log: jest.fn() };

    const result = await seedEmailDefaults({ getSettingStrict, setSetting, dryRun: false, logger });

    const stageKeys = EDITABLE_TEXT_DEFAULTS
      .map((entry) => entry.key)
      .filter((key) => key.startsWith('stage.'));
    expect(stageKeys.length).toBeGreaterThan(0);
    const stageResults = result.filter((r) => stageKeys.includes(r.key));
    expect(stageResults).toHaveLength(stageKeys.length);
    expect(stageResults.every((r) => r.action === 'skip-no-seed')).toBe(true);
    for (const key of stageKeys) {
      expect(getSettingStrict).not.toHaveBeenCalledWith(key);
      expect(setSetting).not.toHaveBeenCalledWith(key, expect.anything(), expect.anything());
    }
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

    expect(result.filter((r) => !r.key.startsWith('stage.')).every((r) => r.action === 'created')).toBe(true);
    expect(result.filter((r) => r.key.startsWith('stage.')).every((r) => r.action === 'skip-no-seed')).toBe(true);
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
    expect(setSetting).toHaveBeenCalledWith(
      'email.deliberation_agenda.subject',
      EMAIL_DEFAULT_SEED_TEXT['email.deliberation_agenda.subject'],
      null,
    );
    expect(setSetting).toHaveBeenCalledWith(
      'email.deliberation_agenda.body',
      EMAIL_DEFAULT_SEED_TEXT['email.deliberation_agenda.body'],
      null,
    );
  });

  test('registers seed text for both deliberation agenda keys', async () => {
    const { EMAIL_DEFAULT_SEED_TEXT } = await import('../../scripts/seed-email-defaults.mjs');
    const {
      DELIBERATION_AGENDA_SEED_SUBJECT,
      DELIBERATION_AGENDA_SEED_BODY,
    } = await import('../../lib/seed/email-defaults/deliberation-agenda.js');

    expect(EMAIL_DEFAULT_SEED_TEXT['email.deliberation_agenda.subject']).toBe(DELIBERATION_AGENDA_SEED_SUBJECT);
    expect(EMAIL_DEFAULT_SEED_TEXT['email.deliberation_agenda.body']).toBe(DELIBERATION_AGENDA_SEED_BODY);
    expect(DELIBERATION_AGENDA_SEED_SUBJECT).toContain('{{sessionDate}}');
  });

  test('does not overwrite existing non-empty settings', async () => {
    const { EDITABLE_TEXT_DEFAULTS } = await import('../../shared/config/editableTextDefaults.js');
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

    const seedableKeys = EDITABLE_TEXT_DEFAULTS.filter((entry) => !entry.key.startsWith('stage.'));
    expect(result.filter((r) => !r.key.startsWith('stage.')).map((r) => r.action))
      .toEqual(seedableKeys.map(() => 'skip-existing'));
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

    expect(result[0].action).toBe('created');
    expect(result.slice(1).every((r) => r.action === 'skip-existing' || r.action === 'skip-no-seed')).toBe(true);
    expect(setSetting).toHaveBeenCalledTimes(1);
    expect(setSetting.mock.calls[0][0]).toBe('email.grantee_invite.subject');
  });
});
