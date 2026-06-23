/**
 * Catalog of admin-editable text defaults, rendered by
 * `shared/components/admin/EmailDefaultsSection.js` (one entry → one panel card).
 *
 * FUTURE (readability): the panel currently shows ONE FLAT CARD per entry, so each
 * subject and each body is its own card (12+ and growing). Group them for scanning:
 *   - top-level GROUP by audience — "Reviewer emails" vs "Grantee emails"
 *   - within a group, ONE card per email pairing its subject + body together
 * The grouping is derivable from the key (`email.<audience>_<name>.<subject|body>`),
 * or add explicit `group` + `emailLabel` fields here and have the section render
 * grouped sections + paired subject/body inputs. Catalog-driven, so the change is
 * localized to this file + EmailDefaultsSection.
 */
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
    description: 'Default body copy for reviewer respond-by reminder emails. [proposal] renders as the proposal title in context, e.g. the proposal “X” (or a neutral phrase if untitled).',
    multiline: true,
    placeholders: ['[Reviewer Name]', '[proposal]', '[Program Director signature]'],
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
    description: 'Default body copy for reviewer review-due reminder emails. [proposal] renders as the proposal title in context, e.g. the proposal “X” (or a neutral phrase if untitled).',
    multiline: true,
    placeholders: ['[Reviewer Name]', '[proposal]', '[review due date]', '[Program Director signature]'],
  },
  {
    key: 'email.reviewer_acceptance.subject',
    label: 'Reviewer acceptance confirmation subject',
    description: 'Default subject line for reviewer acceptance confirmation emails.',
    multiline: false,
    placeholders: [],
  },
  {
    key: 'email.reviewer_acceptance.body',
    label: 'Reviewer acceptance confirmation body',
    description: 'Default body copy for reviewer acceptance confirmation emails.',
    multiline: true,
    placeholders: ['[reviewerName]', '[title]', '[reviewDueDate]'],
  },
  {
    key: 'email.reviewer_withdraw.subject',
    label: 'Reviewer withdraw-sufficient subject',
    description: 'Default subject line for reviewer no-longer-needed withdrawal emails.',
    multiline: false,
    placeholders: [],
  },
  {
    key: 'email.reviewer_withdraw.body',
    label: 'Reviewer withdraw-sufficient body',
    description: 'Default body copy for reviewer no-longer-needed withdrawal emails. [proposal] renders as the proposal title in context, e.g. the proposal “X” (or a neutral phrase if untitled).',
    multiline: true,
    placeholders: ['[Reviewer Name]', '[proposal]', '[Program Director signature]'],
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
