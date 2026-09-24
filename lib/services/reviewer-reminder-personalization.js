/**
 * Per-sender reviewer reminder copy. Only bounded subject/body pairs are preferences.
 * The exact Dataverse systemuser owner is resolved server-side. An absent row uses
 * shared Admin copy; read failure or malformed persisted copy fails closed before
 * an automatic reminder claim. Explicit save/reset uses the same exact owner-keyed
 * preference adapter with the session's systemuserid, so a profile remap cannot
 * redirect a write to another user.
 * Preview and send never persist one-off edits. The five-minute
 * proof binds the exact manual copy to a fresh, server-owned send context.
 */
import crypto from 'node:crypto';
import { readRequiredEmailDefaults } from './email-defaults.js';
import { findByOwnerAndKey, create, update, remove } from '../dataverse/adapters/user-preference.js';
import { mintScopedToken, verifyToken } from './external-token.js';
import { isGuid } from '../utils/guid.js';
import { PREFERENCE_KEYS } from '../../shared/config/reviewerFinderPreferences.js';

export const REMINDER_KINDS = Object.freeze(['respond', 'reviewdue']);
const CONFIG = Object.freeze({
  respond: {
    key: PREFERENCE_KEYS.REVIEWER_RESPOND_REMINDER_TEMPLATE,
    subjectKey: 'email.reviewer_reminder_respond_by.subject',
    bodyKey: 'email.reviewer_reminder_respond_by.body',
    tokens: new Set(['greeting', 'reviewerName', 'proposalClause', 'signature']),
  },
  reviewdue: {
    key: PREFERENCE_KEYS.REVIEWER_REVIEW_DUE_REMINDER_TEMPLATE,
    subjectKey: 'email.reviewer_reminder_review_due.subject',
    bodyKey: 'email.reviewer_reminder_review_due.body',
    tokens: new Set(['greeting', 'reviewerName', 'proposalClause', 'reviewDueDate', 'signature']),
  },
});
const PREVIEW_AUDIENCE = 'reviewer-reminder-preview';

export function validateReminderTemplate(kind, template) {
  const config = CONFIG[kind];
  const errors = [];
  if (!config || !template || typeof template !== 'object' || Array.isArray(template)
      || Object.keys(template).some((key) => !['subject', 'body'].includes(key))) {
    return { valid: false, errors: ['template'] };
  }
  const { subject, body } = template;
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 500 || /[\r\n]/.test(subject)) errors.push('subject');
  if (typeof body !== 'string' || !body.trim() || body.length > 12000) errors.push('body');
  for (const [field, value] of [['subject', subject], ['body', body]]) {
    if (typeof value !== 'string') continue;
    const clean = value.replace(/\{\{([A-Za-z]+)\}\}/g, '');
    if (clean.includes('{{') || clean.includes('}}')) errors.push(`malformed:${field}`);
    for (const match of value.matchAll(/\{\{([A-Za-z]+)\}\}/g)) {
      if (field === 'subject' || !config.tokens.has(match[1])) errors.push(`unknown:${field}:${match[1]}`);
    }
  }
  if (kind === 'reviewdue') {
    if (typeof body === 'string' && !body.includes('{{reviewDueDate}}') && !body.includes('[review due date]')) errors.push('required:reviewDueDate');
    if (/\{\{externalLink\}\}|\/external\/review\//i.test(`${subject || ''}\n${body || ''}`)) errors.push('reviewer_link');
  }
  if (/\b(?:https?:\/\/|www\.)\S+/i.test(`${subject || ''}\n${body || ''}`)) errors.push('link');
  return { valid: errors.length === 0, errors, value: { subject, body } };
}

export async function sharedReminderTemplate(kind) {
  const config = CONFIG[kind];
  if (!config) return { ok: false, reason: 'invalid_kind' };
  const defaults = await readRequiredEmailDefaults([config.subjectKey, config.bodyKey], {
    source: `reviewer-reminders-${kind}-personal-default`,
  });
  if (!defaults.ok) return { ok: false, reason: 'misconfigured', errors: defaults.failures };
  return { ok: true, template: { subject: defaults.values[config.subjectKey], body: defaults.values[config.bodyKey] } };
}

/** An absent row is a valid Admin fallback. Read failures and corrupt rows are not. */
export async function loadSenderReminderTemplate(senderSystemId, kind, shared) {
  const config = CONFIG[kind];
  if (!config || !senderSystemId) return { ok: false, reason: 'misconfigured' };
  let row;
  try {
    row = await findByOwnerAndKey(senderSystemId, config.key);
  } catch {
    return { ok: false, reason: 'preference_unavailable' };
  }
  if (!row) return { ok: true, configured: false, template: shared };
  if (row.wmkf_isencrypted) return { ok: false, reason: 'preference_invalid' };
  let parsed;
  try { parsed = JSON.parse(row.wmkf_preferencevalue); } catch { return { ok: false, reason: 'preference_invalid' }; }
  const checked = validateReminderTemplate(kind, parsed);
  if (!checked.valid) return { ok: false, reason: 'preference_invalid' };
  return { ok: true, configured: true, template: checked.value };
}

export async function saveOwnReminderTemplate(ownSystemId, kind, template) {
  const config = CONFIG[kind];
  const checked = validateReminderTemplate(kind, template);
  if (!config || !checked.valid) return { ok: false, reason: 'validation', errors: checked.errors };
  if (!isGuid(ownSystemId)) return { ok: false, reason: 'identity_unavailable' };
  try {
    const existing = await findByOwnerAndKey(ownSystemId, config.key);
    const body = { wmkf_preferencevalue: JSON.stringify(checked.value), wmkf_isencrypted: false };
    if (existing) await update(existing.wmkf_appuserpreferenceid, body);
    else await create({ wmkf_preferencekey: config.key, ...body, 'ownerid@odata.bind': `/systemusers(${ownSystemId})` });
    return { ok: true, template: checked.value };
  } catch {
    return { ok: false, reason: 'persistence' };
  }
}

export async function clearOwnReminderTemplate(ownSystemId, kind) {
  const config = CONFIG[kind];
  if (!config) return { ok: false, reason: 'validation' };
  if (!isGuid(ownSystemId)) return { ok: false, reason: 'identity_unavailable' };
  try {
    const existing = await findByOwnerAndKey(ownSystemId, config.key);
    if (existing) await remove(existing.wmkf_appuserpreferenceid);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'persistence' };
  }
}

export function reminderPreviewDigest(input) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export async function mintReminderPreviewProof(digest) {
  const { jwt } = await mintScopedToken({
    subject: digest,
    audience: PREVIEW_AUDIENCE,
    ops: ['send'],
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });
  return jwt;
}

export async function verifyReminderPreviewProof(proof, digest) {
  if (typeof proof !== 'string' || !proof || typeof digest !== 'string') return false;
  const result = await verifyToken(proof);
  const payload = result?.payload || {};
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  return result.valid === true && payload.subject === digest
    && aud.length === 1 && aud[0] === PREVIEW_AUDIENCE
    && Array.isArray(payload.ops) && payload.ops.length === 1 && payload.ops[0] === 'send';
}
