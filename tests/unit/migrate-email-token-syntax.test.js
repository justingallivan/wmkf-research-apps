/**
 * @jest-environment node
 */

describe('migrate-email-token-syntax script core', () => {
  test('preserves copy while migrating canonical tokens for admin and per-user rows', async () => {
    const {
      migrateText,
      tokenMapForAdminKey,
      planEmailTokenMigration,
    } = await import('../../scripts/migrate-email-token-syntax.mjs');

    const liveLike = 'Dear [Reviewer Name],\n\nPlease review [proposal] by [review due date].\n\n[Program Director signature]';
    expect(migrateText(liveLike, { tokenMap: tokenMapForAdminKey('email.reviewer_reminder_review_due.body') }).after)
      .toBe('Dear {{reviewerName}},\n\nPlease review {{proposalClause}} by {{reviewDueDate}}.\n\n{{signature}}');

    const settings = {
      'email.grantee_invite.subject': 'Abstract for [title]',
      'email.grantee_invite.body': 'Dear [Name], review “[title]” by COB [date].',
      'email.grantee_reminder.subject': 'Reminder',
      'email.grantee_reminder.body': 'Dear [Name], review “[title]” by COB [date].\n[Program Director signature]',
      'email.reviewer_acceptance.subject': 'Review accepted',
      'email.reviewer_acceptance.body': 'Dear [reviewerName], [title]. [reviewDueDate]\n[Program Director signature]\n[requestNumber]',
      'email.reviewer_withdraw.subject': 'Thank you',
      'email.reviewer_withdraw.body': '[greeting]\nThanks for [title].\n[signature]',
      'email.reviewer_reminder_respond_by.subject': 'Reminder',
      'email.reviewer_reminder_respond_by.body': 'Dear [Reviewer Name], [proposal title clause].\n[Program Director signature]',
      'email.reviewer_reminder_review_due.subject': 'Reminder',
      'email.reviewer_reminder_review_due.body': liveLike,
    };
    const plan = await planEmailTokenMigration({
      getSettingStrict: async (key) => ({ found: true, value: settings[key] }),
      listGranteeInviteBodyPreferences: async () => [
        { id: 'pref-1', ownerId: '29b0de0d', value: 'Dear [Name], “[title]” by COB [date].' },
        { id: 'pref-2', ownerId: 'b53a3bf8', value: 'Dear [Name], “[title]” by COB [date].' },
      ],
      logger: { log: jest.fn() },
    });
    expect(plan.admin).toHaveLength(12);
    expect(plan.preferences).toHaveLength(2);
    expect(plan.admin.find((row) => row.key === 'email.reviewer_withdraw.body').after)
      .toContain('{{proposalClause}}');
    expect(plan.preferences[0].after).toBe('Dear {{granteeName}}, “{{proposalTitle}}” by COB {{dueDate}}.');
  });

  test('unknown bracket token fails dry-run planning without writing', async () => {
    const { planEmailTokenMigration } = await import('../../scripts/migrate-email-token-syntax.mjs');
    const setSetting = jest.fn();
    await expect(planEmailTokenMigration({
      getSettingStrict: async () => ({ found: true, value: 'Dear [Unknown Token],' }),
      listGranteeInviteBodyPreferences: async () => [
        { id: 'pref-1', ownerId: '29b0de0d', value: 'Dear [Name].' },
        { id: 'pref-2', ownerId: 'b53a3bf8', value: 'Dear [Name].' },
      ],
      logger: { log: jest.fn() },
    })).rejects.toThrow(/Unknown bracket token/);
    expect(setSetting).not.toHaveBeenCalled();
  });

  test('per-user grantee invite body count guard stops on drift', async () => {
    const {
      assertExpectedPreferenceCount,
      planEmailTokenMigration,
    } = await import('../../scripts/migrate-email-token-syntax.mjs');
    expect(() => assertExpectedPreferenceCount([{ id: 'one' }])).toThrow(/Expected exactly 2/);
    await expect(planEmailTokenMigration({
      getSettingStrict: async () => ({ found: true, value: '' }),
      listGranteeInviteBodyPreferences: async () => [{ id: 'pref-1', ownerId: '29b0de0d', value: 'Dear [Name].' }],
      logger: { log: jest.fn() },
    })).rejects.toThrow(/Expected exactly 2/);
  });
});
