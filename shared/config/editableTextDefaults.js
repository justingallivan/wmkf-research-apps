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
    description: 'Default subject line for grantee deliverables invitation emails. Mustache {{tokens}}, not [brackets].',
    multiline: false,
    placeholders: ['{{proposalTitle}}'],
  },
  {
    key: 'email.grantee_invite.body',
    label: 'Grantee invite body',
    description: 'Default body copy for grantee deliverables invitation emails. Mustache {{tokens}}, not [brackets].',
    multiline: true,
    placeholders: ['{{granteeName}}', '{{proposalTitle}}', 'COB {{dueDate}}'],
  },
  {
    key: 'email.reviewer_reminder_respond_by.subject',
    label: 'Reviewer respond-by reminder subject',
    description: 'Default subject line for reviewer respond-by reminder emails. Mustache {{tokens}}, not [brackets].',
    multiline: false,
    placeholders: [],
  },
  {
    key: 'email.reviewer_reminder_respond_by.body',
    label: 'Reviewer respond-by reminder body',
    description: 'Default body copy for reviewer respond-by reminder emails. {{proposalClause}} renders as a proposal phrase in context, e.g. the proposal “X” (or a neutral phrase if untitled).',
    multiline: true,
    placeholders: ['{{greeting}}', '{{reviewerName}}', '{{proposalClause}}', '{{signature}}'],
  },
  {
    key: 'email.reviewer_reminder_review_due.subject',
    label: 'Reviewer review-due reminder subject',
    description: 'Default subject line for reviewer review-due reminder emails. Mustache {{tokens}}, not [brackets].',
    multiline: false,
    placeholders: [],
  },
  {
    key: 'email.reviewer_reminder_review_due.body',
    label: 'Reviewer review-due reminder body',
    description: 'Default body copy for reviewer review-due reminder emails. These reminders preserve the original review link and do not include a new one. {{proposalClause}} renders as a proposal phrase in context, e.g. the proposal “X” (or a neutral phrase if untitled).',
    multiline: true,
    placeholders: ['{{greeting}}', '{{reviewerName}}', '{{proposalClause}}', '{{reviewDueDate}}', '{{signature}}'],
  },
  {
    key: 'email.reviewer_acceptance.subject',
    label: 'Reviewer acceptance confirmation subject',
    description: 'Default subject line for reviewer acceptance confirmation emails. Mustache {{tokens}}, not [brackets].',
    multiline: false,
    placeholders: [],
  },
  {
    key: 'email.reviewer_acceptance.body',
    label: 'Reviewer acceptance confirmation body',
    description: 'Default body copy for reviewer acceptance confirmation emails. Mustache {{tokens}}, not [brackets].',
    multiline: true,
    placeholders: ['{{greeting}}', '{{reviewerName}}', '{{proposalTitle}}', '{{reviewDueDate}}', '{{signature}}'],
  },
  {
    key: 'email.reviewer_extension.body',
    label: 'Reviewer deadline update body',
    description: 'Default body sent automatically when a PD grants, changes, or restores a reviewer deadline. The subject is fixed by the application.',
    multiline: true,
    placeholders: ['{{greeting}}', '{{reviewerName}}', '{{proposalTitle}}', '{{reviewDueDate}}', '{{signature}}'],
    requiredPlaceholders: ['{{greeting}}', '{{reviewDueDate}}', '{{signature}}'],
  },
  {
    key: 'email.reviewer_withdraw.subject',
    label: 'Reviewer withdraw-sufficient subject',
    description: 'Default subject line for reviewer no-longer-needed withdrawal emails. Mustache {{tokens}}, not [brackets].',
    multiline: false,
    placeholders: [],
  },
  {
    key: 'email.reviewer_withdraw.body',
    label: 'Reviewer withdraw-sufficient body',
    description: 'Default body copy for reviewer no-longer-needed withdrawal emails. {{proposalClause}} renders as a proposal phrase in context, e.g. the proposal “X” (or a neutral phrase if untitled).',
    multiline: true,
    placeholders: ['{{greeting}}', '{{reviewerName}}', '{{proposalClause}}', '{{signature}}'],
  },
  {
    key: 'email.reviewer_invitation.subject',
    label: 'Reviewer invitation subject',
    description: 'Default subject line for the reviewer invitation email (per-PD editable; this is the org default). Mustache {{tokens}}, not [brackets].',
    multiline: false,
    placeholders: ['{{respondBy}}', '{{proposalTitle}}'],
  },
  {
    key: 'email.reviewer_invitation.body',
    label: 'Reviewer invitation body',
    description: 'Default body for the reviewer invitation email. The honorarium amount is injected server-side from the admin honorarium setting via {{customField:honorarium}}; the timeline tokens are filled in when the PD sends.',
    multiline: true,
    placeholders: ['{{greeting}}', '{{proposalTitle}}', '{{piName}}', '{{piInstitution}}', '{{proposalDetails}}', '{{proposalAbstract}}', '{{externalLink}}', '{{respondBy}}', '{{proposalDelivery}}', '{{reviewDue}}', '{{customField:honorarium}}', '{{signature}}'],
  },
  {
    key: 'email.reviewer_materials.subject',
    label: 'Reviewer materials subject',
    description: 'Default subject line for the post-accept review-materials email. Mustache {{tokens}}.',
    multiline: false,
    placeholders: ['{{proposalTitle}}'],
  },
  {
    key: 'email.reviewer_materials.body',
    label: 'Reviewer materials body',
    description: 'Default body for the post-accept review-materials email.',
    multiline: true,
    placeholders: ['{{greeting}}', '{{proposalTitle}}', '{{piInstitution}}', '{{externalLink}}', '{{reviewDueDate}}', '{{signature}}'],
  },
  {
    key: 'email.reviewer_materials.button_label',
    label: 'Reviewer materials button label',
    description: 'Text on the secure-link button in the post-accept materials email (the reviewer starts the review here). Blank falls back to a stage default.',
    multiline: false,
    placeholders: [],
  },
  {
    key: 'email.reviewer_followup.subject',
    label: 'Reviewer follow-up subject',
    description: 'Default subject line for the reviewer follow-up reminder email. Mustache {{tokens}}.',
    multiline: false,
    placeholders: ['{{proposalTitle}}'],
  },
  {
    key: 'email.reviewer_followup.body',
    label: 'Reviewer follow-up body',
    description: 'Default body for the reviewer follow-up reminder email.',
    multiline: true,
    placeholders: ['{{greeting}}', '{{proposalTitle}}', '{{externalLink}}', '{{reviewDueDate}}', '{{signature}}'],
  },
  {
    key: 'email.reviewer_followup.button_label',
    label: 'Reviewer follow-up button label',
    description: 'Text on the secure-link button in the follow-up reminder email (reviewer has accepted and received materials). Blank falls back to a stage default.',
    multiline: false,
    placeholders: [],
  },
  {
    key: 'email.reviewer_thankyou.subject',
    label: 'Reviewer thank-you subject',
    description: 'Default subject line for the reviewer thank-you email. Mustache {{tokens}}.',
    multiline: false,
    placeholders: ['{{proposalTitle}}'],
  },
  {
    key: 'email.reviewer_thankyou.body',
    label: 'Reviewer thank-you body',
    description: 'Default body for the reviewer thank-you email.',
    multiline: true,
    placeholders: ['{{greeting}}', '{{proposalTitle}}', '{{signature}}'],
  },
  {
    key: 'email.grantee_reminder.subject',
    label: 'Grantee reminder subject',
    description: 'Default subject line for grantee deliverables reminder emails. Mustache {{tokens}}, not [brackets].',
    multiline: false,
    placeholders: [],
  },
  {
    key: 'email.grantee_reminder.body',
    label: 'Grantee reminder body',
    description: 'Default body copy for grantee deliverables reminder emails. Mustache {{tokens}}, not [brackets].',
    multiline: true,
    placeholders: ['{{granteeName}}', '{{proposalTitle}}', 'COB {{dueDate}}', '{{signature}}'],
  },
];

export const EDITABLE_TEXT_DEFAULTS_BY_KEY = Object.freeze(
  Object.fromEntries(EDITABLE_TEXT_DEFAULTS.map((entry) => [entry.key, entry])),
);
