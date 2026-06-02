/**
 * Per-user reviewer email templates — single source of truth.
 *
 * Templates live in Dataverse `wmkf_appuserpreferences` under
 * PREFERENCE_KEYS.EMAIL_TEMPLATES (a JSON object keyed by template type), via
 * /api/user-preferences. This replaces the old browser-localStorage template
 * store (Review Manager) and the hardcoded invitation constant (Workbench).
 *
 * Types: invitation, materials, followup, thankyou — each { subject, body }.
 *
 * Placeholder note: bodies use server placeholders ({{greeting}}, {{proposalTitle}},
 * {{piInstitution}}, {{externalLink}}, {{reviewDueDate}}, {{signature}}, …) resolved
 * by /api/review-manager/render-emails. The invitation template ALSO uses the
 * client-side timing tokens {{respondBy}} / {{proposalDelivery}} / {{reviewDue}},
 * which InviteEmailModal substitutes locally (see that file) — render-emails
 * leaves them untouched.
 */

import { PREFERENCE_KEYS } from '../../config/reviewerFinderPreferences';

export const TEMPLATE_TYPES = ['invitation', 'materials', 'followup', 'thankyou'];

export const TEMPLATE_TYPE_LABELS = {
  invitation: 'Invitation',
  materials: 'Materials (post-accept)',
  followup: 'Follow-up reminder',
  thankyou: 'Thank-you',
};

export const DEFAULT_TEMPLATES = {
  invitation: {
    subject: 'Invitation to review a grant proposal: {{proposalTitle}}',
    body: `{{greeting}},

The W. M. Keck Foundation invites you to serve as a peer reviewer for the proposal "{{proposalTitle}}" from {{piInstitution}}.

Please use your secure personal link to accept or decline this invitation:
{{externalLink}}

Review timeline:
- Please respond to this invitation by {{respondBy}}.
- If you accept, we will send the full proposal and review form on {{proposalDelivery}}.
- Completed reviews are due by {{reviewDue}}.

If you accept, the same link gives you access to the proposal materials and the review form. We would be grateful for your expertise.

{{signature}}`,
  },
  materials: {
    subject: 'Review Materials: {{proposalTitle}}',
    body: `{{greeting}},

Thank you for agreeing to review the proposal "{{proposalTitle}}" from {{piInstitution}}.

Please use your secure reviewer link to download the proposal materials and submit your completed review:
{{externalLink}}

This link is unique to you. We ask that you submit your review by {{reviewDueDate}}.

If you have any questions about the review process, please don't hesitate to reach out.

Thank you for your time and expertise.

{{signature}}`,
  },
  followup: {
    subject: 'Reminder: Review Due — {{proposalTitle}}',
    body: `{{greeting}},

This is a friendly reminder that your review of "{{proposalTitle}}" is due by {{reviewDueDate}}.

Your secure reviewer link (also in the original invitation):
{{externalLink}}

Please let us know if you need additional time or have any questions.

Thank you,

{{signature}}`,
  },
  thankyou: {
    subject: 'Thank You for Your Review — {{proposalTitle}}',
    body: `{{greeting}},

Thank you very much for completing your review of "{{proposalTitle}}". Your expertise and thoughtful evaluation are greatly appreciated and will be invaluable to the Foundation's decision-making process.

We will be in touch regarding the processing of your honorarium.

With gratitude,

{{signature}}`,
  },
};

/** Deep-ish merge: stored templates override defaults per type/field. */
export function mergeTemplates(stored) {
  const out = {};
  for (const type of TEMPLATE_TYPES) {
    out[type] = {
      subject: stored?.[type]?.subject ?? DEFAULT_TEMPLATES[type].subject,
      body: stored?.[type]?.body ?? DEFAULT_TEMPLATES[type].body,
    };
  }
  return out;
}

/**
 * Load the current user's templates merged over defaults. Best-effort: any
 * failure (not signed in, network) falls back to defaults so the email flow
 * never breaks.
 */
export async function loadEmailTemplates() {
  try {
    const res = await fetch(`/api/user-preferences?key=${encodeURIComponent(PREFERENCE_KEYS.EMAIL_TEMPLATES)}`);
    const data = await res.json().catch(() => ({}));
    if (data?.value) {
      const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
      return mergeTemplates(parsed);
    }
  } catch { /* fall through to defaults */ }
  return mergeTemplates(null);
}

/** Persist the user's templates. Returns true on success. */
export async function saveEmailTemplates(templates) {
  try {
    const res = await fetch('/api/user-preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: PREFERENCE_KEYS.EMAIL_TEMPLATES, value: JSON.stringify(templates) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
