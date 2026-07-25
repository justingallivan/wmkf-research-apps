export const REVIEWER_ACCEPTANCE_SEED_SUBJECT =
  'Review accepted';

export const REVIEWER_ACCEPTANCE_SEED_BODY =
  'Dear {{reviewerName}},\n\n' +
  'Thank you for agreeing to review “{{proposalTitle}}”.\n\n' +
  '{{reviewDueDate}} A calendar reminder is attached when a review due date is available.\n\n' +
  'Proposal materials will be sent separately when they are ready.\n\n' +
  'If something changes before materials are released — a calendar conflict, a conflict of interest, or anything else — ' +
  'please use the secure link below to withdraw. You will also have an opportunity to suggest alternate reviewers.\n\n' +
  '{{withdrawUrl}}\n\n' +
  'If you have questions, please contact {{programDirectorName}} ({{programDirectorEmail}}).\n\n' +
  'Thank you,\n\n' +
  '{{signature}}';

export const REVIEWER_WITHDRAW_SEED_SUBJECT =
  'Thank you — W. M. Keck Foundation review';

export const REVIEWER_WITHDRAW_SEED_BODY =
  'Dear {{reviewerName}},\n\n' +
  'Thank you so much for your willingness to review {{proposalClause}} for the W. M. Keck Foundation. ' +
  'We have now assembled a full panel for this proposal, so we will not need to call on you this time.\n\n' +
  'We are very grateful for your time and hope to have the opportunity to work with you on a future review.\n\n' +
  'With appreciation,\n\n' +
  '{{signature}}';
