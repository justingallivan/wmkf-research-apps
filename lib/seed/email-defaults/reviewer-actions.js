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

// D49: the one email a reviewer gets on acceptance when the materials go out
// with it (alignment log D46, D49). Draft wording for owner review in the PR.
// {{reviewUrl}} is the reviewer's new secure link; a body without it gets a
// standard link paragraph appended (reviewer-acceptance-email.js).
export const REVIEWER_MATERIALS_ACCEPTANCE_SEED_SUBJECT =
  'Review materials: {{proposalTitle}}';

export const REVIEWER_MATERIALS_ACCEPTANCE_SEED_BODY =
  '{{greeting}},\n\n' +
  'Thank you for agreeing to review “{{proposalTitle}}” for the W. M. Keck Foundation.\n\n' +
  'The proposal and the review form are ready at your secure link below. Please submit your completed review there.\n\n' +
  '{{reviewUrl}}\n\n' +
  '{{reviewDueDate}} {{attachmentsNote}}\n\n' +
  'This link replaces the one in your invitation. Please keep this email; you will need the link to return to your review.\n\n' +
  'If something changes and you can no longer complete the review, or you have questions, please contact ' +
  '{{programDirectorName}} ({{programDirectorEmail}}).\n\n' +
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

export const REVIEWER_RELEASE_SEED_SUBJECT =
  'Thank you — W. M. Keck Foundation review';

export const REVIEWER_RELEASE_SEED_BODY =
  '{{greeting}},\n\n' +
  'Thank you again for agreeing to review {{proposalClause}} for the W. M. Keck Foundation. ' +
  'We have now received enough reviews to complete our process, so we are releasing you from this assignment and will not need a review from you.\n\n' +
  'We appreciate the time you set aside and your willingness to assist the Foundation. ' +
  'We hope to have the opportunity to work with you on a future review.\n\n' +
  '{{signature}}';

export const REVIEWER_EXTENSION_SEED_BODY =
  '{{greeting}},\n\n' +
  'We are happy to receive your review of “{{proposalTitle}}” by {{reviewDueDate}}.\n\n' +
  '{{signature}}';

export const REVIEWER_EXTENSION_SEED_SUBJECT = 'Updated review deadline: {{proposalTitle}}';
