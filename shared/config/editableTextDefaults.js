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
  {
    key: 'email.reviewer_reminder_respond_by.subject',
    label: 'Reviewer respond-by reminder subject',
    description: 'Default subject line for reviewer respond-by reminder emails.',
    multiline: false,
    placeholders: [],
  },
  {
    key: 'email.reviewer_reminder_respond_by.body',
    label: 'Reviewer respond-by reminder body',
    description: 'Default body copy for reviewer respond-by reminder emails.',
    multiline: true,
    placeholders: ['[Reviewer Name]', '[proposal title clause]', '[Program Director signature]'],
  },
  {
    key: 'email.reviewer_reminder_review_due.subject',
    label: 'Reviewer review-due reminder subject',
    description: 'Default subject line for reviewer review-due reminder emails.',
    multiline: false,
    placeholders: [],
  },
  {
    key: 'email.reviewer_reminder_review_due.body',
    label: 'Reviewer review-due reminder body',
    description: 'Default body copy for reviewer review-due reminder emails.',
    multiline: true,
    placeholders: ['[Reviewer Name]', '[proposal title clause]', '[review due date]', '[Program Director signature]'],
  },
  {
    key: 'email.grantee_reminder.subject',
    label: 'Grantee reminder subject',
    description: 'Default subject line for grantee deliverables reminder emails.',
    multiline: false,
    placeholders: [],
  },
  {
    key: 'email.grantee_reminder.body',
    label: 'Grantee reminder body',
    description: 'Default body copy for grantee deliverables reminder emails.',
    multiline: true,
    placeholders: ['[Name]', '[title]', 'COB [date]', '[Program Director signature]'],
  },
];

export const EDITABLE_TEXT_DEFAULTS_BY_KEY = Object.freeze(
  Object.fromEntries(EDITABLE_TEXT_DEFAULTS.map((entry) => [entry.key, entry])),
);
