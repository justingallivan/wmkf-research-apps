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

// Secure-link button labels, keyed by template type. Materials/follow-up still
// use the admin-editable single-button setting. Invitation sends now render fixed
// paired response actions ("Yes, I Can Review" / "No, Not This Time") around the
// editable body; the invitation seed value remains for existing Dataverse
// baselines but is no longer exposed as editable runtime copy.
export const REVIEWER_INVITATION_SEED_BUTTON_LABEL = 'Yes, I Can Review';
export const REVIEWER_MATERIALS_SEED_BUTTON_LABEL = 'Start Review';
export const REVIEWER_FOLLOWUP_SEED_BUTTON_LABEL = 'Go to Review';

export const REVIEWER_INVITATION_SEED_SUBJECT =
  'Action needed by {{respondBy}}: Review invitation from W. M. Keck Foundation';

export const REVIEWER_INVITATION_SEED_BODY = `{{greeting}},

The W. M. Keck Foundation is considering a proposal for funding, titled "{{proposalTitle}}," from Principal Investigator {{piName}} ({{piInstitution}}), and we would be grateful if you could serve as a peer reviewer.

Honorarium: \${{customField:honorarium}}
Response needed by: {{respondBy}}

Please let us know using one of the buttons below by {{respondBy}}:

{{externalLink}}

If we don’t hear from you by {{respondBy}}, we’ll assume you’re not able to take this one on — but we would still love to invite you again in the future.

Proposal details
{{proposalDetails}}

Abstract
{{proposalAbstract}}

Here’s the timeline if you’re able to help:
1. You respond — by {{respondBy}}
2. We send the full proposal — around {{proposalDelivery}}
3. Your completed review is due — by {{reviewDue}}

We would be grateful for your help.

{{signature}}`;

export const REVIEWER_MATERIALS_SEED_SUBJECT = 'Review Materials: {{proposalTitle}}';

export const REVIEWER_MATERIALS_SEED_BODY = `{{greeting}},

Please use the link to access the proposal materials and submit your completed review by {{reviewDueDate}}.

{{externalLink}}

{{signature}}`;

export const REVIEWER_FOLLOWUP_SEED_SUBJECT = 'Reminder: Review Due — {{proposalTitle}}';

export const REVIEWER_FOLLOWUP_SEED_BODY = `{{greeting}},

This is a friendly reminder that your review of “{{proposalTitle}}” is due by {{reviewDueDate}}.

Please continue using the secure link in your original review materials email. If you no longer have that email, contact the Foundation for a replacement link.

Please let us know if you need additional time or have any questions.

Thank you,

{{signature}}`;

export const REVIEWER_THANKYOU_SEED_SUBJECT = 'Thank You for Your Review — {{proposalTitle}}';

export const REVIEWER_THANKYOU_SEED_BODY = `{{greeting}},

Thank you very much for completing your review of “{{proposalTitle}}”. Your expertise and thoughtful evaluation are greatly appreciated and will be invaluable to the Foundation’s decision-making process.

With gratitude,

{{signature}}`;
