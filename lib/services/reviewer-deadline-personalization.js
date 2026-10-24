/** Own-systemuser deadline wording; empty bodies are valid. Manual previews
 * fall back to shared wording with an explicit notice on personal read failure.
 * Only explicit Save/Clear writes preferences. Proofs use a distinct audience. */
import crypto from 'node:crypto';
import { getSettingStrict } from './settings-service.js';
import { findByOwnerAndKey, create, update, remove } from '../dataverse/adapters/user-preference.js';
import { isGuid } from '../utils/guid.js';
import { PREFERENCE_KEYS } from '../../shared/config/reviewerFinderPreferences.js';
import { validateDeadlineTemplate } from '../../shared/config/reviewerDeadlineEmail.js';
import { mintScopedToken, verifyToken } from './external-token.js';
export { validateDeadlineTemplate } from '../../shared/config/reviewerDeadlineEmail.js';
export const DEADLINE_SUBJECT_KEY = 'email.reviewer_extension.subject';
export const DEADLINE_BODY_KEY = 'email.reviewer_extension.body';
const KEY = PREFERENCE_KEYS.REVIEWER_DEADLINE_UPDATE_TEMPLATE;
const AUDIENCE = 'reviewer-deadline-preview';

export async function sharedDeadlineTemplate() {
  try {
    const [subject, body] = await Promise.all([getSettingStrict(DEADLINE_SUBJECT_KEY), getSettingStrict(DEADLINE_BODY_KEY)]);
    if (!subject?.found || !body?.found || typeof subject.value !== 'string' || (body.value != null && typeof body.value !== 'string')) return { ok: false, reason: 'misconfigured' };
    const checked = validateDeadlineTemplate({ subject: subject.value, body: body.value ?? '' });
    return checked.valid ? { ok: true, template: checked.value } : { ok: false, reason: 'misconfigured' };
  } catch { return { ok: false, reason: 'misconfigured' }; }
}
export function deadlinePreviewDigest(input) {
  const stable = JSON.stringify(input, (_key, value) => {
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
    }
    return value;
  });
  return crypto.createHash('sha256').update(stable).digest('hex');
}
export async function mintDeadlinePreviewProof(digest) {
  const { jwt } = await mintScopedToken({ subject: digest, audience: AUDIENCE, ops: ['send'], expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
  return jwt;
}
export async function verifyDeadlinePreviewProof(proof, digest) {
  if (typeof proof !== 'string' || !proof || proof.length > 8192) return false;
  const result = await verifyToken(proof);
  const p = result?.payload || {};
  const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
  return result.valid === true && p.subject === digest && aud.length === 1 && aud[0] === AUDIENCE
    && Array.isArray(p.ops) && p.ops.length === 1 && p.ops[0] === 'send';
}

/**
 * Exact-owner read. Absent → { ok, configured: false }. Read failure →
 * preference_unavailable; encrypted, unparseable or invalid → preference_invalid.
 */
export async function loadOwnerDeadlineTemplate(systemId) {
  if (!isGuid(systemId)) return { ok: false, reason: 'preference_unavailable' };
  let row;
  try {
    row = await findByOwnerAndKey(systemId, KEY);
  } catch {
    return { ok: false, reason: 'preference_unavailable' };
  }
  if (!row) return { ok: true, configured: false, template: null };
  if (row.wmkf_isencrypted) return { ok: false, reason: 'preference_invalid' };
  let parsed;
  try { parsed = JSON.parse(row.wmkf_preferencevalue); } catch { return { ok: false, reason: 'preference_invalid' }; }
  const checked = validateDeadlineTemplate(parsed);
  if (!checked.valid) return { ok: false, reason: 'preference_invalid' };
  return { ok: true, configured: true, template: checked.value };
}

/**
 * The wording a preview starts from: the sender's saved copy, else Admin.
 * `shared` is the already-read Admin template. Never fails on the personal
 * layer; a bad personal read is reported as `shared_fallback` with a notice.
 */
export async function resolveSenderDeadlineTemplate(senderSystemId, shared) {
  const own = await loadOwnerDeadlineTemplate(senderSystemId);
  if (own.ok && own.configured) return { template: own.template, templateSource: 'personal' };
  if (own.ok) return { template: shared, templateSource: 'shared' };
  return { template: shared, templateSource: 'shared_fallback', templateNotice: own.reason };
}

export async function saveOwnDeadlineTemplate(ownSystemId, template) {
  const checked = validateDeadlineTemplate(template);
  if (!checked.valid) return { ok: false, reason: 'validation', errors: checked.errors };
  if (!isGuid(ownSystemId)) return { ok: false, reason: 'identity_unavailable' };
  try {
    const existing = await findByOwnerAndKey(ownSystemId, KEY);
    const body = { wmkf_preferencevalue: JSON.stringify(checked.value), wmkf_isencrypted: false };
    if (existing) await update(existing.wmkf_appuserpreferenceid, body);
    else await create({ wmkf_preferencekey: KEY, ...body, 'ownerid@odata.bind': `/systemusers(${ownSystemId})` });
    return { ok: true, template: checked.value };
  } catch {
    return { ok: false, reason: 'persistence' };
  }
}

export async function clearOwnDeadlineTemplate(ownSystemId) {
  if (!isGuid(ownSystemId)) return { ok: false, reason: 'identity_unavailable' };
  try {
    const existing = await findByOwnerAndKey(ownSystemId, KEY);
    if (existing) await remove(existing.wmkf_appuserpreferenceid);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'persistence' };
  }
}
