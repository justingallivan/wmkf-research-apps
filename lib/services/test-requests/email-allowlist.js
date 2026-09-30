/**
 * Test-Request email recipient allowlist (production plan *Owner decisions*,
 * S546; MVP build list item 4).
 *
 * Email regarding a marked test Request is allowed only when every recipient
 * is allowed: an address at the Foundation's own domain (a fixed rule here),
 * or an address on a superuser-edited list stored in `wmkf_appsystemsettings`
 * under TEST_REQUEST_EMAIL_ALLOWLIST_KEY. A plus-tag on a listed address
 * (`me+tag@x.org` for `me@x.org`) reaches the same inbox and is allowed.
 *
 * Callers fail closed: an unreadable or malformed setting allows only the
 * Foundation domain, and an empty or unreadable recipient list is refused.
 */

import { getSettingStrict, setSetting } from '../settings-service.js';

export const TEST_REQUEST_EMAIL_ALLOWLIST_KEY = 'testRequestEmailAllowlist';
export const FOUNDATION_EMAIL_DOMAIN = 'wmkeck.org';
export const MAX_ALLOWLIST_ADDRESSES = 200;

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/** Trimmed, lowercased address, or null when it is not a plain address. */
export function normalizeAddress(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  return value.length <= 254 && EMAIL.test(value) ? value : null;
}

function withoutPlusTag(address) {
  const [local, domain] = address.split('@');
  return `${local.split('+')[0]}@${domain}`;
}

export function isFoundationAddress(address) {
  const normalized = normalizeAddress(address);
  return Boolean(normalized) && normalized.split('@')[1] === FOUNDATION_EMAIL_DOMAIN;
}

/** The stored list as a Set of normalized addresses; throws on a malformed value. */
export function parseAllowlistValue(value) {
  if (value == null || value === '') return new Set();
  const parsed = JSON.parse(value);
  if (!parsed || !Array.isArray(parsed.addresses)) throw new Error('Test-Request email allowlist value is malformed.');
  const out = new Set();
  for (const entry of parsed.addresses) {
    const normalized = normalizeAddress(entry);
    if (!normalized) throw new Error('Test-Request email allowlist holds an invalid address.');
    out.add(withoutPlusTag(normalized));
  }
  return out;
}

/** The editable list. Throws on a read failure so enforcement can fail closed. */
export async function loadTestRequestEmailAllowlist({ getSetting = getSettingStrict } = {}) {
  const result = await getSetting(TEST_REQUEST_EMAIL_ALLOWLIST_KEY);
  return parseAllowlistValue(result?.found ? result.value : null);
}

/**
 * Pure decision: every recipient must be a Foundation address or on the list.
 * @returns {{ allowed: boolean, refused: string[] }}
 */
export function decideRecipients(recipients, allowlist) {
  const list = Array.isArray(recipients) ? recipients : [];
  if (list.length === 0) return { allowed: false, refused: ['(no recipients)'] };
  const refused = [];
  for (const raw of list) {
    const normalized = normalizeAddress(raw);
    if (!normalized) { refused.push(String(raw ?? '(empty)')); continue; }
    if (isFoundationAddress(normalized)) continue;
    if (allowlist?.has(withoutPlusTag(normalized))) continue;
    refused.push(normalized);
  }
  return { allowed: refused.length === 0, refused };
}

/**
 * Whether an email with these recipients may go out for a test Request. A
 * setting read failure falls back to the Foundation domain only.
 */
export async function testRequestRecipientsAllowed(recipients, { load = loadTestRequestEmailAllowlist } = {}) {
  let allowlist;
  try {
    allowlist = await load();
  } catch (error) {
    console.error('[test-request-email-allowlist] read failed; allowing the Foundation domain only:', error.message);
    allowlist = new Set();
  }
  return decideRecipients(recipients, allowlist);
}

/** Admin read: the list and whether it could be read. */
export async function readTestRequestEmailAllowlistForAdmin({ getSetting = getSettingStrict } = {}) {
  try {
    return { addresses: [...await loadTestRequestEmailAllowlist({ getSetting })].sort(), unavailable: false };
  } catch (error) {
    console.error('[test-request-email-allowlist] admin read failed:', error.message);
    return { addresses: [], unavailable: true };
  }
}

/**
 * Admin write: replaces the list. Foundation addresses are dropped (always
 * allowed); duplicates collapse; any invalid entry refuses the whole write.
 * @returns {{ ok: true, addresses: string[] } | { ok: false, errors: string[] }}
 */
export async function writeTestRequestEmailAllowlist(addresses, profileId, { save = setSetting } = {}) {
  if (!Array.isArray(addresses)) return { ok: false, errors: ['addresses must be a list.'] };
  const errors = [];
  const out = new Set();
  for (const entry of addresses) {
    const normalized = normalizeAddress(entry);
    if (!normalized) { errors.push(`Not a valid email address: ${String(entry).slice(0, 80)}`); continue; }
    if (isFoundationAddress(normalized)) continue;
    out.add(withoutPlusTag(normalized));
  }
  if (out.size > MAX_ALLOWLIST_ADDRESSES) errors.push(`At most ${MAX_ALLOWLIST_ADDRESSES} addresses.`);
  if (errors.length) return { ok: false, errors };
  const sorted = [...out].sort();
  const saved = await save(TEST_REQUEST_EMAIL_ALLOWLIST_KEY, JSON.stringify({ addresses: sorted }), profileId);
  if (saved === false) throw new Error('Saving the test-Request email allowlist failed.');
  return { ok: true, addresses: sorted };
}
