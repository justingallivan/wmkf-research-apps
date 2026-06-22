/**
 * Per-user reviewer email templates — single source of truth.
 *
 * Templates live in Dataverse `wmkf_appuserpreferences` under
 * PREFERENCE_KEYS.EMAIL_TEMPLATES (a JSON object keyed by template type), via
 * /api/user-preferences. This replaces the old browser-localStorage template
 * store (Review Manager) and the hardcoded invitation constant (Workbench).
 *
 * Types: invitation, hold, finalize, materials, followup, thankyou — each { subject, body }.
 *
 * Placeholder note: bodies use server placeholders ({{greeting}}, {{proposalTitle}},
 * {{piInstitution}}, {{externalLink}}, {{reviewDueDate}}, {{signature}}, …) resolved
 * by /api/review-manager/render-emails. The invitation template ALSO uses the
 * client-side timing tokens {{respondBy}} / {{proposalDelivery}} / {{reviewDue}},
 * which InviteEmailModal substitutes locally (see that file) — render-emails
 * leaves them untouched.
 */

import { PREFERENCE_KEYS } from '../../config/reviewerFinderPreferences';

export const TEMPLATE_TYPES = ['invitation', 'hold', 'finalize', 'materials', 'followup', 'thankyou'];

export const TEMPLATE_TYPE_LABELS = {
  invitation: 'Invitation',
  hold: 'Hold (agree in principle)',
  finalize: 'Finalize (proposal ready)',
  materials: 'Materials (post-accept)',
  followup: 'Follow-up reminder',
  thankyou: 'Thank-you',
};

export const DEFAULT_TEMPLATES = {
  invitation: {
    subject: 'Invitation to review for the W. M. Keck Foundation — {{proposalTitle}}',
    body: `{{greeting}},

The W. M. Keck Foundation is assembling a review panel and would value your expertise. We're writing to ask whether you'd be willing to review the proposal below — the full materials will follow shortly. For now we simply need to know whether you can take it on, or whether we should look elsewhere.

{{proposalDetails}}

{{proposalAbstract}}

Please use your secure personal link to let us know you can review it — or to pass:
{{externalLink}}

Review timeline:
- Please respond by {{respondBy}}.
- We expect to send the full proposal and review form on {{proposalDelivery}}.
- Completed reviews would be due by {{reviewDue}}.

The details above should let you flag any conflict of interest now, before the materials go out. There's no further commitment today — the conflict-of-interest and AI-use acknowledgements and any honorarium details all come later, once the proposal is released. We would be grateful for your help.

{{signature}}`,
  },
  hold: {
    subject: 'Hold your spot: upcoming W. M. Keck Foundation review panel',
    body: `{{greeting}},

The W. M. Keck Foundation is lining up reviewers for an upcoming panel, and we'd be grateful for your expertise. The proposal isn't quite ready yet — so for now we're simply asking whether you'd be willing to hold your spot.

Please use your secure personal link to let us know:
{{externalLink}}

There's no commitment to specifics today — you won't see proposal materials yet, and the conflict-of-interest / AI-use acknowledgements and any honorarium details all come later. Once the proposal is released, we'll email you everything you need. Where a panel date has been set, a calendar hold is included with this message.

Thank you for considering it.

{{signature}}`,
  },
  finalize: {
    subject: 'Ready for your review: {{proposalTitle}}',
    body: `{{greeting}},

Thank you for holding your spot. The proposal "{{proposalTitle}}" from {{piInstitution}} is now ready for review.

Please use your secure personal link to confirm the final details — the conflict-of-interest and AI-use acknowledgements, and how you'd like any honorarium handled — and to access the proposal materials:
{{externalLink}}

We ask that you complete this step by {{reviewDueDate}}. Once you've confirmed, the secure link in this email gives you the materials and the review form.

We're grateful for your time and expertise.

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

Your secure reviewer link (use the one in this email — it supersedes any earlier link):
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
