import {
  EDITABLE_TEXT_DEFAULTS,
  EDITABLE_TEXT_GROUPS,
} from '../../shared/config/editableTextDefaults';
import {
  DELIBERATION_SHARE_SEED_SUBJECT,
  renderDeliberationShareSubject,
} from '../../shared/config/deliberationShareEmail';

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

  test('Share for deliberation subject and body are paired beside the agenda defaults', () => {
    const subject = EDITABLE_TEXT_DEFAULTS.find((entry) => entry.key === 'email.deliberation_share.subject');
    const body = EDITABLE_TEXT_DEFAULTS.find((entry) => entry.key === 'email.deliberation_share.body');
    expect(subject).toMatchObject({
      group: 'internal',
      emailKey: 'email.deliberation_share',
      emailLabel: 'Share for deliberation',
      placeholders: ['{{requestNumber}}'],
      multiline: false,
    });
    expect(body).toMatchObject({
      group: 'internal',
      emailKey: 'email.deliberation_share',
      emailLabel: 'Share for deliberation',
      placeholders: [],
      multiline: true,
    });
  });

  test('Share subject replaces the request token and removes fallback punctuation when no number exists', () => {
    expect(renderDeliberationShareSubject(DELIBERATION_SHARE_SEED_SUBJECT, '1002912'))
      .toBe('Site Visit materials — 1002912');
    expect(renderDeliberationShareSubject(DELIBERATION_SHARE_SEED_SUBJECT, null))
      .toBe('Site Visit materials');
  });
});
