/**
 * Per-profile materials email templates and short-lived preview proofs.
 * Personal preferences are raw subject/body overrides keyed by kind; preview
 * proofs bind the rendered request context, digest, audience, and send action.
 * This module never accepts profile or actor identity from client input.
 */
import crypto from 'node:crypto';
import { mintScopedToken, verifyToken } from '../external-token.js';
import { DatabaseService } from '../database-service.js';
import { readRequiredEmailDefaults } from '../email-defaults.js';
import { PREFERENCE_KEYS } from '../../../shared/config/reviewerFinderPreferences.js';

export const MATERIALS_EMAIL_KINDS = Object.freeze({
  invitation: 'invitation',
  reminder: 'reminder',
});

export const MATERIALS_EMAIL_PREFERENCE_KEYS = Object.freeze({
  invitation: PREFERENCE_KEYS.SITE_VISIT_MATERIALS_INVITATION_TEMPLATE,
  reminder: PREFERENCE_KEYS.SITE_VISIT_MATERIALS_REMINDER_TEMPLATE,
});

export const MATERIALS_EMAIL_PREVIEW_AUDIENCE = 'materials-email-preview';
export const MATERIALS_EMAIL_ACTIONS = Object.freeze(['create', 'invite', 'remind']);

const FIELD_TOKENS = Object.freeze({
  invitation: {
    subject: new Set(['proposalTitle']),
    body: new Set(['proposalTitle', 'institution', 'visitDate', 'dueDate', 'checklist', 'uploadLink', 'signature']),
  },
  reminder: {
    subject: new Set(['proposalTitle']),
    body: new Set(['proposalTitle', 'institution', 'visitDate', 'dueDate', 'missingItemsGrammar', 'missingItems', 'uploadLink', 'signature']),
  },
});
const MAX_SUBJECT = 500;
const MAX_BODY = 12000;

export function normalizeTemplate(template) {
  return { subject: String(template?.subject ?? ''), body: String(template?.body ?? '') };
}

export function validateMaterialsEmailTemplate(kind, template) {
  if (!Object.values(MATERIALS_EMAIL_KINDS).includes(kind)) {
    return { valid: false, errors: ['kind'], value: normalizeTemplate(template) };
  }
  if (!template || typeof template !== 'object' || Array.isArray(template)
      || Object.keys(template).some((field) => !['subject', 'body'].includes(field))) {
    return { valid: false, errors: ['template'], value: normalizeTemplate(template) };
  }
  const value = normalizeTemplate(template);
  const required = kind === MATERIALS_EMAIL_KINDS.invitation ? 'checklist' : 'missingItems';
  const errors = [];
  if (typeof template?.subject !== 'string' || !value.subject.trim() || value.subject.length > MAX_SUBJECT) errors.push('subject');
  if (typeof template?.body !== 'string' || !value.body.trim() || value.body.length > MAX_BODY) errors.push('body');
  const tokens = (text, field) => {
    const matches = [...text.matchAll(/\{\{([A-Za-z]+)\}\}/g)];
    const stripped = text.replace(/\{\{([A-Za-z]+)\}\}/g, '');
    if (stripped.includes('{{') || stripped.includes('}}')) errors.push(`malformed:${field}`);
    for (const match of matches) if (!FIELD_TOKENS[kind]?.[field]?.has(match[1])) errors.push(`unknown:${field}:${match[1]}`);
  };
  tokens(value.subject, 'subject');
  tokens(value.body, 'body');
  if (!value.body.includes(`{{${required}}}`)) errors.push(`required:${required}`);
  return { valid: errors.length === 0, errors, value };
}

export function validatePartialMaterialsEmailTemplate(kind, template) {
  if (!Object.values(MATERIALS_EMAIL_KINDS).includes(kind)
      || !template || typeof template !== 'object' || Array.isArray(template)
      || Object.keys(template).length === 0) return { valid: false, errors: ['template'], value: template };
  const errors = [];
  for (const field of Object.keys(template)) {
    if (!['subject', 'body'].includes(field) || typeof template[field] !== 'string') { errors.push(`field:${field}`); continue; }
    if (!template[field].trim()) errors.push(field);
    if (field === 'subject' && template[field].length > MAX_SUBJECT) errors.push('subject');
    if (field === 'body' && template[field].length > MAX_BODY) errors.push('body');
    const allowed = FIELD_TOKENS[kind]?.[field] || new Set();
    const stripped = template[field].replace(/\{\{([A-Za-z]+)\}\}/g, '');
    if (stripped.includes('{{') || stripped.includes('}}')) errors.push(`malformed:${field}`);
    for (const match of String(template[field]).matchAll(/\{\{([A-Za-z]+)\}\}/g)) {
      if (!allowed.has(match[1])) errors.push(`unknown:${field}:${match[1]}`);
    }
    if (field === 'body') {
      const required = kind === MATERIALS_EMAIL_KINDS.invitation ? 'checklist' : 'missingItems';
      if (!template[field].includes(`{{${required}}}`)) errors.push(`required:${required}`);
    }
  }
  return { valid: errors.length === 0, errors, value: template };
}

export async function loadPersonalMaterialsTemplate(profileId, kind) {
  const key = MATERIALS_EMAIL_PREFERENCE_KEYS[kind];
  if (!key || !profileId) return null;
  const prefs = await DatabaseService.getUserPreferences(profileId, false);
  const raw = prefs?.[key];
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const checked = validatePartialMaterialsEmailTemplate(kind, parsed);
    return checked.valid ? parsed : null;
  } catch { return null; }
}

export async function savePersonalMaterialsTemplate(profileId, kind, template) {
  const key = MATERIALS_EMAIL_PREFERENCE_KEYS[kind];
  const isPartial = template && typeof template === 'object'
    && Object.keys(template).every((field) => field === 'subject' || field === 'body')
    && (template.subject === undefined || template.body === undefined);
  const checked = isPartial
    ? validatePartialMaterialsEmailTemplate(kind, template)
    : validateMaterialsEmailTemplate(kind, template);
  if (!key || !profileId || !checked.valid) return { ok: false, errors: checked.errors };
  const ok = await DatabaseService.setUserPreference(profileId, key, JSON.stringify(checked.value));
  return { ok, value: checked.value, errors: ok ? [] : ['persistence'] };
}

export function mergeMaterialsEmailTemplate(shared, override) {
  return {
    subject: override?.subject ?? shared?.subject ?? '',
    body: override?.body ?? shared?.body ?? '',
  };
}

export function materialsEmailOverrides(template, shared) {
  const out = {};
  if (template.subject !== shared.subject) out.subject = template.subject;
  if (template.body !== shared.body) out.body = template.body;
  return out;
}

export async function sharedMaterialsEmailDefaults(kind) {
  if (!Object.values(MATERIALS_EMAIL_KINDS).includes(kind)) return { ok: false, template: null };
  const prefix = kind === MATERIALS_EMAIL_KINDS.invitation ? 'email.site_visit_materials_invite' : 'email.site_visit_materials_reminder';
  const result = await readRequiredEmailDefaults([`${prefix}.subject`, `${prefix}.body`], { source: `site-visit-materials:${kind}-personal-default` });
  if (!result.ok) return { ok: false, template: null };
  const checked = validateMaterialsEmailTemplate(kind, { subject: result.values[`${prefix}.subject`], body: result.values[`${prefix}.body`] });
  return { ok: checked.valid, template: checked.valid ? checked.value : null };
}

export async function clearPersonalMaterialsTemplate(profileId, kind) {
  const key = MATERIALS_EMAIL_PREFERENCE_KEYS[kind];
  if (!key || !profileId) return false;
  return DatabaseService.deleteUserPreference(profileId, key);
}

export function materialsPreviewDigest(input) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export async function mintMaterialsPreviewProof({ digest, action, expiresAt }) {
  if (!digest || typeof digest !== 'string' || !MATERIALS_EMAIL_ACTIONS.includes(action)) {
    throw new Error('mintMaterialsPreviewProof: digest and valid action required');
  }
  const result = await mintScopedToken({
    subject: digest,
    audience: MATERIALS_EMAIL_PREVIEW_AUDIENCE,
    ops: [action],
    expiresAt,
  });
  return result.jwt;
}

export async function verifyMaterialsPreviewProof(proof, { digest, action }) {
  if (!digest || typeof digest !== 'string' || !MATERIALS_EMAIL_ACTIONS.includes(action)) {
    return { valid: false, reason: 'binding_mismatch' };
  }
  const result = await verifyToken(proof);
  if (!result?.valid) return { valid: false, reason: result?.reason || 'invalid' };
  const payload = result.payload || {};
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const ops = Array.isArray(payload.ops) ? payload.ops : [];
  if (payload.subject !== digest || aud.length !== 1 || aud[0] !== MATERIALS_EMAIL_PREVIEW_AUDIENCE
      || ops.length !== 1 || ops[0] !== action) {
    return { valid: false, reason: 'binding_mismatch' };
  }
  return { valid: true, payload: { subject: payload.subject, aud: payload.aud, ops: payload.ops } };
}
