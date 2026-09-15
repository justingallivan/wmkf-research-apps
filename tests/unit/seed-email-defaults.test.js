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
    expect(setSetting).toHaveBeenCalledWith(
      'email.deliberation_share.subject',
      EMAIL_DEFAULT_SEED_TEXT['email.deliberation_share.subject'],
      null,
    );
    expect(setSetting).toHaveBeenCalledWith(
      'email.deliberation_share.body',
      EMAIL_DEFAULT_SEED_TEXT['email.deliberation_share.body'],
      null,
    );
    for (const key of [
      'email.deliberation_share.briefing_heading',
      'email.deliberation_share.briefing_link_text',
      'email.deliberation_share.briefing_description',
      'email.deliberation_share.briefing_expiry_lead_in',
    ]) {
      expect(setSetting).toHaveBeenCalledWith(key, EMAIL_DEFAULT_SEED_TEXT[key], null);
    }
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

  test('registers the prior Workbench Share compose and briefing-section wording', async () => {
    const { EMAIL_DEFAULT_SEED_TEXT } = await import('../../scripts/seed-email-defaults.mjs');
    const {
      DELIBERATION_SHARE_SEED_BRIEFING_COPY,
      DELIBERATION_SHARE_SEED_SUBJECT,
      DELIBERATION_SHARE_SEED_BODY,
    } = await import('../../shared/config/deliberationShareEmail.js');

    expect(EMAIL_DEFAULT_SEED_TEXT['email.deliberation_share.subject']).toBe(DELIBERATION_SHARE_SEED_SUBJECT);
    expect(EMAIL_DEFAULT_SEED_TEXT['email.deliberation_share.body']).toBe(DELIBERATION_SHARE_SEED_BODY);
    expect(DELIBERATION_SHARE_SEED_SUBJECT).toContain('{{requestNumber}}');
    expect(DELIBERATION_SHARE_SEED_BODY).toContain('deliberation briefing page');
    expect(EMAIL_DEFAULT_SEED_TEXT['email.deliberation_share.briefing_heading'])
      .toBe(DELIBERATION_SHARE_SEED_BRIEFING_COPY.heading);
    expect(EMAIL_DEFAULT_SEED_TEXT['email.deliberation_share.briefing_link_text'])
      .toBe(DELIBERATION_SHARE_SEED_BRIEFING_COPY.linkText);
    expect(EMAIL_DEFAULT_SEED_TEXT['email.deliberation_share.briefing_description'])
      .toBe(DELIBERATION_SHARE_SEED_BRIEFING_COPY.description);
    expect(EMAIL_DEFAULT_SEED_TEXT['email.deliberation_share.briefing_expiry_lead_in'])
      .toBe(DELIBERATION_SHARE_SEED_BRIEFING_COPY.expiryLeadIn);
  });

  test('registers both site-visit email families with the previous default wording', async () => {
    const { EMAIL_DEFAULT_SEED_TEXT } = await import('../../scripts/seed-email-defaults.mjs');
    const {
      SITE_VISIT_MATERIALS_INVITE_SEED_BODY,
      SITE_VISIT_MATERIALS_INVITE_SEED_SUBJECT,
      SITE_VISIT_MATERIALS_REMINDER_SEED_BODY,
      SITE_VISIT_MATERIALS_REMINDER_SEED_SUBJECT,
    } = await import('../../lib/seed/email-defaults/site-visit-materials.js');
    expect(EMAIL_DEFAULT_SEED_TEXT['email.site_visit_materials_invite.subject']).toBe(SITE_VISIT_MATERIALS_INVITE_SEED_SUBJECT);
    expect(EMAIL_DEFAULT_SEED_TEXT['email.site_visit_materials_invite.body']).toBe(SITE_VISIT_MATERIALS_INVITE_SEED_BODY);
    expect(EMAIL_DEFAULT_SEED_TEXT['email.site_visit_materials_reminder.subject']).toBe(SITE_VISIT_MATERIALS_REMINDER_SEED_SUBJECT);
    expect(EMAIL_DEFAULT_SEED_TEXT['email.site_visit_materials_reminder.body']).toBe(SITE_VISIT_MATERIALS_REMINDER_SEED_BODY);
    expect(SITE_VISIT_MATERIALS_INVITE_SEED_BODY).toContain('No login is needed. You may forward the link below');
    expect(SITE_VISIT_MATERIALS_REMINDER_SEED_BODY).toContain('The following {{missingItemsGrammar}} still needed');
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
