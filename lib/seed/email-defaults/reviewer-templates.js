/**
 * Seed copy for the four PD-composed reviewer email templates
 * (invitation, materials, follow-up, thank-you), migrated into the admin
 * "Email Defaults" panel so all reviewer email copy is managed in one place.
 *
 * This file is the SINGLE source of the shipped default text. It is written into
 * Dataverse `wmkf_appsystemsetting` once by `scripts/seed-email-defaults.mjs`
 * (and re-baselined by `scripts/rebaseline-email-defaults.mjs`) — it is init
 * data, NOT a runtime fallback. At send time the copy is read from Dataverse
 * (admin org default), with an optional per-PD override layered on top by
 * `shared/components/reviewers/email-template-store.js`. A blank/unavailable
 * admin value renders blank in the PD's preview-before-send, by design.
 *
 * Placeholders are mustache tokens ({{...}}) resolved by
 * /api/review-manager/render-emails (server) plus the client-side timing tokens
 * {{respondBy}}/{{proposalDelivery}}/{{reviewDue}} substituted by
 * InviteEmailModal. The invitation honorarium amount is injected server-side as
 * {{customField:honorarium}} from the single Dataverse ground-truth
 * (honorarium.default_amount); the leading "$" is escaped (\$) so the template
 * literal does not interpolate it.
 */

// Secure-link button labels, keyed by template type. The button is generated at
// send time by /api/review-manager/send-emails when a body contains {{externalLink}}
// (invitation, materials, followup — thank-you has no link). These seed the admin
// `email.reviewer_<type>.button_label` settings; send-emails falls back to a
// stage-appropriate default if the setting is blank (a button must never render empty).
export const REVIEWER_INVITATION_SEED_BUTTON_LABEL = 'Respond to Invitation';
export const REVIEWER_MATERIALS_SEED_BUTTON_LABEL = 'Start Review';
export const REVIEWER_FOLLOWUP_SEED_BUTTON_LABEL = 'Go to Review';

export const REVIEWER_INVITATION_SEED_SUBJECT =
  'Invitation to review for the W. M. Keck Foundation — {{proposalTitle}}';

export const REVIEWER_INVITATION_SEED_BODY = `{{greeting}},

The W. M. Keck Foundation is assembling a review panel and would value your expertise. We’re writing to ask whether you’d be willing to review the proposal below. The summary here is enough to decide — and to flag any conflict of interest — before the full materials go out.

{{proposalDetails}}

{{proposalAbstract}}

Please use your secure personal link to accept or decline:
{{externalLink}}

Review timeline:
- Please respond by {{respondBy}}.
- We expect to send the full proposal and review form on {{proposalDelivery}}.
- Completed reviews would be due by {{reviewDue}}.

In recognition of the time and effort involved, we offer an honorarium of \${{customField:honorarium}}, paid through Bill.com after we receive your completed review. When you accept, you’ll confirm a few details — the conflict-of-interest and AI-use acknowledgements, and how you’d like the honorarium handled. The full proposal and review form then follow once it’s released for review. If the summary already surfaces a conflict, a quick decline is just as helpful. We would be grateful for your help.

{{signature}}`;

export const REVIEWER_MATERIALS_SEED_SUBJECT = 'Review Materials: {{proposalTitle}}';

export const REVIEWER_MATERIALS_SEED_BODY = `{{greeting}},

Thank you for agreeing to review the proposal “{{proposalTitle}}” from {{piInstitution}}.

Please use your secure reviewer link to download the proposal materials and submit your completed review:
{{externalLink}}

This link is unique to you. We ask that you submit your review by {{reviewDueDate}}.

If you have any questions about the review process, please don’t hesitate to reach out.

Thank you for your time and expertise.

{{signature}}`;

export const REVIEWER_FOLLOWUP_SEED_SUBJECT = 'Reminder: Review Due — {{proposalTitle}}';

export const REVIEWER_FOLLOWUP_SEED_BODY = `{{greeting}},

This is a friendly reminder that your review of “{{proposalTitle}}” is due by {{reviewDueDate}}.

Your secure reviewer link (use the one in this email — it supersedes any earlier link):
{{externalLink}}

Please let us know if you need additional time or have any questions.

Thank you,

{{signature}}`;

export const REVIEWER_THANKYOU_SEED_SUBJECT = 'Thank You for Your Review — {{proposalTitle}}';

export const REVIEWER_THANKYOU_SEED_BODY = `{{greeting}},

Thank you very much for completing your review of “{{proposalTitle}}”. Your expertise and thoughtful evaluation are greatly appreciated and will be invaluable to the Foundation’s decision-making process.

We will be in touch regarding the processing of your honorarium.

With gratitude,

{{signature}}`;
