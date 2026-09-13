import {
  EDITABLE_TEXT_DEFAULTS,
  EDITABLE_TEXT_GROUPS,
} from '../../shared/config/editableTextDefaults';

describe('editableTextDefaults catalog grouping metadata', () => {
  const validGroupIds = new Set(EDITABLE_TEXT_GROUPS.map((g) => g.id));

  test('EDITABLE_TEXT_GROUPS has the expected ordered ids', () => {
    expect(EDITABLE_TEXT_GROUPS.map((g) => g.id)).toEqual(['reviewers', 'grantees', 'applicants', 'internal', 'labels']);
    EDITABLE_TEXT_GROUPS.forEach((g) => {
      expect(typeof g.title).toBe('string');
      expect(g.title.length).toBeGreaterThan(0);
      expect(typeof g.description).toBe('string');
      expect(g.description.length).toBeGreaterThan(0);
    });
  });

  test.each(EDITABLE_TEXT_DEFAULTS.map((entry) => [entry.key, entry]))(
    '%s has a valid group, emailKey, and emailLabel',
    (key, entry) => {
      expect(validGroupIds.has(entry.group)).toBe(true);
      expect(typeof entry.emailKey).toBe('string');
      expect(entry.emailKey.length).toBeGreaterThan(0);
      expect(typeof entry.emailLabel).toBe('string');
      expect(entry.emailLabel.length).toBeGreaterThan(0);
      expect(entry.key.startsWith(`${entry.emailKey}.`)).toBe(true);
    },
  );

  test('site-visit invitation and reminder keys are grouped with applicant-facing mail and advertise mustache tokens only', () => {
    const keys = [
      'email.site_visit_materials_invite.subject',
      'email.site_visit_materials_invite.body',
      'email.site_visit_materials_reminder.subject',
      'email.site_visit_materials_reminder.body',
    ];
    const entries = keys.map((key) => EDITABLE_TEXT_DEFAULTS.find((entry) => entry.key === key));
    expect(entries.every(Boolean)).toBe(true);
    expect(entries.map((entry) => entry.group)).toEqual(['applicants', 'applicants', 'applicants', 'applicants']);
    expect(entries.map((entry) => entry.emailKey)).toEqual([
      'email.site_visit_materials_invite', 'email.site_visit_materials_invite',
      'email.site_visit_materials_reminder', 'email.site_visit_materials_reminder',
    ]);
    expect(entries[1].placeholders).toEqual(expect.arrayContaining([
      '{{proposalTitle}}', '{{institution}}', '{{visitDate}}', '{{dueDate}}',
      '{{checklist}}', '{{uploadLink}}', '{{signature}}',
    ]));
    expect(entries[3].placeholders).toEqual(expect.arrayContaining([
      '{{missingItemsGrammar}}', '{{missingItems}}', '{{uploadLink}}', '{{signature}}',
    ]));
    expect(entries[1].requiredPlaceholders).toEqual(['{{checklist}}']);
    expect(entries[3].requiredPlaceholders).toEqual(['{{missingItems}}']);
    for (const entry of entries) {
      expect(entry.placeholders.every((placeholder) => /^\{\{[A-Za-z]+\}\}$/.test(placeholder))).toBe(true);
    }
  });
});
