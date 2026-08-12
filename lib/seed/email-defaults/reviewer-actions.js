export const REVIEWER_ACCEPTANCE_SEED_SUBJECT =
  'Review accepted';

export const REVIEWER_ACCEPTANCE_SEED_BODY =
  '{{greeting}},\n\n' +
  'Thank you for agreeing to review “{{proposalTitle}}”.\n\n' +
  '{{reviewDueDate}} A calendar reminder is attached when a review due date is available.\n\n' +
  'Proposal materials will be sent separately when they are ready.\n\n' +
  'If something changes before materials are released — a calendar conflict, a conflict of interest, or anything else — ' +
  'please use the secure link below to withdraw. You will also have an opportunity to suggest alternate reviewers.\n\n' +
  '{{withdrawUrl}}\n\n' +
  'If you have questions, please contact {{programDirectorName}} ({{programDirectorEmail}}).\n\n' +
  // Closing composition is conditional in reviewer-email-closing: profiles
  // explicitly marked as including a closing keep it; identity/fallback blocks
  // get a default. The preference reader supports legacy pre-flag valedictions.
  '{{signature}}';

export const REVIEWER_WITHDRAW_SEED_SUBJECT =
  'Thank you — W. M. Keck Foundation review';

export const REVIEWER_WITHDRAW_SEED_BODY =
  '{{greeting}},\n\n' +
  // This email only ever reaches reviewers who never responded — the release
  // action filters to still-pending rows (withdraw-sufficient-service.js
  // isStillPending). So the copy thanks them for CONSIDERING the request, not
  // for a willingness they never expressed.
  'Thank you for considering our request to review {{proposalClause}} for the W. M. Keck Foundation. ' +
  'We have now assembled a full slate of reviewers for this proposal, so we will not need to call on you this time.\n\n' +
  'We are very grateful for your time and hope to have the opportunity to work with you on a future review.\n\n' +
  // No fixed closing line — see the acceptance body above.
  '{{signature}}';

export const REVIEWER_EXTENSION_SEED_BODY =
  '{{greeting}},\n\n' +
  'We are happy to receive your review of “{{proposalTitle}}” by {{reviewDueDate}}.\n\n' +
  '{{signature}}';
