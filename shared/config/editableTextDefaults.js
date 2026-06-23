export const EDITABLE_TEXT_DEFAULTS = [
  {
    key: 'email.grantee_invite.subject',
    label: 'Grantee invite subject',
    description: 'Default subject line for grantee deliverables invitation emails.',
    multiline: false,
    placeholders: ['[title]'],
  },
  {
    key: 'email.grantee_invite.body',
    label: 'Grantee invite body',
    description: 'Default body copy for grantee deliverables invitation emails.',
    multiline: true,
    placeholders: ['[Name]', '[title]', 'COB [date]'],
  },
];

export const EDITABLE_TEXT_DEFAULTS_BY_KEY = Object.freeze(
  Object.fromEntries(EDITABLE_TEXT_DEFAULTS.map((entry) => [entry.key, entry])),
);
