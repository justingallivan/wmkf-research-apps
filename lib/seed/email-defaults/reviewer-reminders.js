export const REVIEWER_REMINDER_RESPOND_BY_SEED_SUBJECT =
  'Reminder: your W. M. Keck Foundation review invitation';

export const REVIEWER_REMINDER_RESPOND_BY_SEED_BODY =
  '{{greeting}},\n\n' +
  'I’m following up on my recent invitation to review {{proposalClause}} for the W. M. Keck Foundation. ' +
  'We have not yet heard back from you and would be grateful to know whether you are able to serve.\n\n' +
  'Please use your secure link below to accept or decline. If you accept, you can confirm a few details now ' +
  'and the full proposal will follow once it is released. If your circumstances have changed, a quick decline ' +
  'is just as helpful.\n\n' +
  // Closing composition is conditional in reviewer-email-closing: profiles
  // explicitly marked as including a closing keep it; identity/fallback blocks
  // get a default. The preference reader supports legacy pre-flag valedictions.
  '{{signature}}';

export const REVIEWER_REMINDER_REVIEW_DUE_SEED_SUBJECT =
  'Reminder: your W. M. Keck Foundation review';

export const REVIEWER_REMINDER_REVIEW_DUE_SEED_BODY =
  '{{greeting}},\n\n' +
  'This is a friendly reminder about your review of {{proposalClause}} for the W. M. Keck Foundation. ' +
  'Your review is due by {{reviewDueDate}}.\n\n' +
  'Your secure link below opens the proposal materials and the review form. If you have already submitted, ' +
  'thank you — no further action is needed.\n\n' +
  // No fixed closing line; reviewer-email-closing composes one when required.
  '{{signature}}';
