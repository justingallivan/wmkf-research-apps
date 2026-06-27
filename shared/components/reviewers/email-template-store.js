/**
 * Per-PD reviewer email templates — resolution + persistence.
 *
 * Two layers (S297):
 *   1. Admin org default — the shipped copy, edited in the admin "Email Defaults"
 *      panel, stored in Dataverse `wmkf_appsystemsetting` under keys
 *      email.reviewer_<type>.{subject,body}. Read here via
 *      /api/email-defaults/reviewer-templates. Seeded from
 *      lib/seed/email-defaults/reviewer-templates.js (init data, NOT a runtime
 *      code fallback — a blank admin value renders blank in the PD's
 *      preview-before-send, by design).
 *   2. Per-PD override — optional, stored per-PD in `wmkf_appuserpreferences`
 *      under PREFERENCE_KEYS.EMAIL_TEMPLATES via /api/user-preferences. Only the
 *      fields a PD actually changed from the admin default are persisted, so
 *      later admin edits flow through to non-overridden fields.
 *
 * Types: invitation, materials, followup, thankyou — each { subject, body }.
 *
 * Placeholder note: bodies use server placeholders ({{greeting}}, {{proposalTitle}},
 * {{piInstitution}}, {{externalLink}}, {{reviewDueDate}}, {{customField:honorarium}},
 * {{signature}}, …) resolved by /api/review-manager/render-emails. The invitation
 * template ALSO uses the client-side timing tokens {{respondBy}} /
 * {{proposalDelivery}} / {{reviewDue}}, which InviteEmailModal substitutes locally.
 */

import { PREFERENCE_KEYS } from '../../config/reviewerFinderPreferences';

export const TEMPLATE_TYPES = ['invitation', 'materials', 'followup', 'thankyou'];

export const TEMPLATE_TYPE_LABELS = {
  invitation: 'Invitation',
  materials: 'Materials (post-accept)',
  followup: 'Follow-up reminder',
  thankyou: 'Thank-you',
};

/** Blank skeleton so callers always get the full {type:{subject,body}} shape. */
export const EMPTY_TEMPLATES = Object.freeze(
  Object.fromEntries(TEMPLATE_TYPES.map((type) => [type, Object.freeze({ subject: '', body: '' })])),
);

/** Coerce an arbitrary object into the full template shape (missing → ''). */
function toShape(obj) {
  const out = {};
  for (const type of TEMPLATE_TYPES) {
    out[type] = {
      subject: obj?.[type]?.subject ?? '',
      body: obj?.[type]?.body ?? '',
    };
  }
  return out;
}

/**
 * Layer per-PD overrides over the admin org defaults. A missing override
 * field falls through to the admin default (which itself may be blank).
 */
export function mergeTemplates(stored, adminDefaults) {
  const base = toShape(adminDefaults);
  const out = {};
  for (const type of TEMPLATE_TYPES) {
    out[type] = {
      subject: stored?.[type]?.subject ?? base[type].subject,
      body: stored?.[type]?.body ?? base[type].body,
    };
  }
  return out;
}

/**
 * Reduce a full template set to ONLY the fields that differ from the admin
 * default, so we persist genuine per-PD deviations and let admin edits flow
 * through to everything else.
 */
export function toOverrides(templates, adminDefaults) {
  const base = toShape(adminDefaults);
  const out = {};
  for (const type of TEMPLATE_TYPES) {
    const diff = {};
    if ((templates?.[type]?.subject ?? '') !== base[type].subject) diff.subject = templates[type].subject;
    if ((templates?.[type]?.body ?? '') !== base[type].body) diff.body = templates[type].body;
    if (Object.keys(diff).length > 0) out[type] = diff;
  }
  return out;
}

/**
 * Fetch the admin org defaults (the base layer). Best-effort: any failure
 * returns the blank skeleton so a transient outage degrades to blank previews
 * (which the PD sees and won't send) rather than throwing.
 */
export async function loadAdminTemplateDefaults() {
  try {
    const res = await fetch('/api/email-defaults/reviewer-templates');
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.templates) return toShape(data.templates);
  } catch { /* fall through to blank skeleton */ }
  return toShape(null);
}

/**
 * Load the current PD's resolved templates: per-PD override layered over the
 * admin org default. Best-effort — never throws; missing layers degrade to blank.
 */
export async function loadEmailTemplates() {
  const adminDefaults = await loadAdminTemplateDefaults();
  try {
    const res = await fetch(`/api/user-preferences?key=${encodeURIComponent(PREFERENCE_KEYS.EMAIL_TEMPLATES)}`);
    const data = await res.json().catch(() => ({}));
    if (data?.value) {
      const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
      return mergeTemplates(parsed, adminDefaults);
    }
  } catch { /* fall through to admin defaults */ }
  return mergeTemplates(null, adminDefaults);
}

/**
 * Persist the PD's templates as override-only (fields differing from the admin
 * default). Re-reads the admin default to diff against. Returns true on success.
 */
export async function saveEmailTemplates(templates) {
  try {
    const adminDefaults = await loadAdminTemplateDefaults();
    const overrides = toOverrides(templates, adminDefaults);
    const res = await fetch('/api/user-preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: PREFERENCE_KEYS.EMAIL_TEMPLATES, value: JSON.stringify(overrides) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
