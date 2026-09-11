import {
  EDITABLE_TEXT_DEFAULTS,
  EDITABLE_TEXT_GROUPS,
} from '../../shared/config/editableTextDefaults';

describe('editableTextDefaults catalog grouping metadata', () => {
  const validGroupIds = new Set(EDITABLE_TEXT_GROUPS.map((g) => g.id));

  test('EDITABLE_TEXT_GROUPS has the expected ordered ids', () => {
    expect(EDITABLE_TEXT_GROUPS.map((g) => g.id)).toEqual(['reviewers', 'grantees', 'internal', 'labels']);
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
});
