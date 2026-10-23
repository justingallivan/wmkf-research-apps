/**
 * Per-sender wording for the two reviewer release courtesy emails: the pending
 * withdrawal (`withdraw`) and the accepted-reviewer release (`release`). Only a
 * bounded subject/body pair is a preference, keyed to the exact Dataverse
 * systemuser owner. Explicit save/clear uses the session's systemuserid, so a
 * profile remap cannot redirect a write to another user.
 *
 * Previews start from the sending PD's saved wording. An absent row uses shared
 * Admin copy; a read failure or malformed row also falls back to Admin copy with
 * a notice (owner, 2026-10-22), because every send here is a staff-reviewed
 * manual send. Preview and send never persist per-recipient edits.
 */
import { readRequiredEmailDefaults } from './email-defaults.js';
import { findByOwnerAndKey, create, update, remove } from '../dataverse/adapters/user-preference.js';
import { isGuid } from '../utils/guid.js';
import { PREFERENCE_KEYS } from '../../shared/config/reviewerFinderPreferences.js';

export const RELEASE_TEMPLATE_KINDS = Object.freeze(['withdraw', 'release']);
const BODY_TOKENS = new Set(['greeting', 'reviewerName', 'proposalClause', 'signature']);
const CONFIG = Object.freeze({
  withdraw: {
    key: PREFERENCE_KEYS.REVIEWER_WITHDRAW_TEMPLATE,
    subjectKey: 'email.reviewer_withdraw.subject',
    bodyKey: 'email.reviewer_withdraw.body',
  },
  release: {
    key: PREFERENCE_KEYS.REVIEWER_RELEASE_TEMPLATE,
    subjectKey: 'email.reviewer_release.subject',
    bodyKey: 'email.reviewer_release.body',
  },
});

export function validateReleaseTemplate(kind, template) {
  const errors = [];
  if (!CONFIG[kind] || !template || typeof template !== 'object' || Array.isArray(template)
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
      if (field === 'subject' || !BODY_TOKENS.has(match[1])) errors.push(`unknown:${field}:${match[1]}`);
    }
  }
  if (/\b(?:https?:\/\/|www\.)\S+/i.test(`${subject || ''}\n${body || ''}`)) errors.push('link');
  return { valid: errors.length === 0, errors, value: { subject, body } };
}

export async function sharedReleaseTemplate(kind, source) {
  const config = CONFIG[kind];
  if (!config) return { ok: false, reason: 'invalid_kind' };
  const defaults = await readRequiredEmailDefaults([config.subjectKey, config.bodyKey], {
    source: source || `reviewer-release-${kind}-personal-default`,
  });
  if (!defaults.ok) return { ok: false, reason: 'misconfigured', errors: defaults.failures };
  return { ok: true, template: { subject: defaults.values[config.subjectKey], body: defaults.values[config.bodyKey] } };
}

/**
 * Exact-owner read. Absent → { ok, configured: false }. Read failure →
 * preference_unavailable; encrypted, unparseable or invalid → preference_invalid.
 */
export async function loadOwnerReleaseTemplate(systemId, kind) {
  const config = CONFIG[kind];
  if (!config || !isGuid(systemId)) return { ok: false, reason: 'preference_unavailable' };
  let row;
  try {
    row = await findByOwnerAndKey(systemId, config.key);
  } catch {
    return { ok: false, reason: 'preference_unavailable' };
  }
  if (!row) return { ok: true, configured: false, template: null };
  if (row.wmkf_isencrypted) return { ok: false, reason: 'preference_invalid' };
  let parsed;
  try { parsed = JSON.parse(row.wmkf_preferencevalue); } catch { return { ok: false, reason: 'preference_invalid' }; }
  const checked = validateReleaseTemplate(kind, parsed);
  if (!checked.valid) return { ok: false, reason: 'preference_invalid' };
  return { ok: true, configured: true, template: checked.value };
}

/**
 * The wording a preview starts from: the sender's saved copy, else Admin.
 * `shared` is the already-read Admin template. Never fails on the personal
 * layer; a bad personal read is reported as `shared_fallback` with a notice.
 */
export async function resolveSenderReleaseTemplate(senderSystemId, kind, shared) {
  const own = await loadOwnerReleaseTemplate(senderSystemId, kind);
  if (own.ok && own.configured) return { template: own.template, templateSource: 'personal' };
  if (own.ok) return { template: shared, templateSource: 'shared' };
  return { template: shared, templateSource: 'shared_fallback', templateNotice: own.reason };
}

export async function saveOwnReleaseTemplate(ownSystemId, kind, template) {
  const config = CONFIG[kind];
  const checked = validateReleaseTemplate(kind, template);
  if (!config || !checked.valid) return { ok: false, reason: 'validation', errors: checked.errors };
  if (!isGuid(ownSystemId)) return { ok: false, reason: 'identity_unavailable' };
  try {
    const existing = await findByOwnerAndKey(ownSystemId, config.key);
    const body = { wmkf_preferencevalue: JSON.stringify(checked.value), wmkf_isencrypted: false };
    if (existing) await update(existing.wmkf_appuserpreferenceid, body);
    else await create({ wmkf_preferencekey: config.key, ...body, 'ownerid@odata.bind': `/systemusers(${ownSystemId})` });
    return { ok: true, kind, template: checked.value };
  } catch {
    return { ok: false, reason: 'persistence' };
  }
}

export async function clearOwnReleaseTemplate(ownSystemId, kind) {
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
