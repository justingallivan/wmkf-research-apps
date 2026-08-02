/**
 * Structured reviewer-decline referrals.
 *
 * New portal submissions use up to four { name, institution, email } rows.
 * Dataverse still exposes one 2,000-character memo, so rows are stored as a
 * versioned compact JSON envelope. The decoder deliberately preserves older
 * free-text values as legacy display-only referrals.
 */

export const MAX_DECLINE_REFERRALS = 4;
export const DECLINE_REFERRAL_LIMITS = Object.freeze({
  name: 150,
  institution: 250,
  email: 254,
});

const STORED_PREFIX = 'wmkf-referrals:v1:';
const MAX_STORED_LENGTH = 2000;
const EMAIL_RE = /^[^@\s]+@[^@\s]+$/;
const FIELDS = ['name', 'institution', 'email'];

function cleanField(value) {
  return typeof value === 'string' ? value.trim() : value;
}

export function normalizeDeclineReferrals(value) {
  if (value === undefined || value === null) {
    return { ok: true, referrals: [], storedValue: null };
  }
  if (!Array.isArray(value)) {
    return { ok: false, reason: 'invalid_decline_referrals' };
  }
  if (value.length > MAX_DECLINE_REFERRALS) {
    return { ok: false, reason: 'too_many_decline_referrals' };
  }

  const referrals = [];
  for (let index = 0; index < value.length; index += 1) {
    const row = value[index];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return { ok: false, reason: 'invalid_decline_referral', index };
    }
    const unknown = Object.keys(row).find((key) => !FIELDS.includes(key));
    if (unknown) {
      return { ok: false, reason: 'unknown_decline_referral_field', field: unknown, index };
    }

    const next = {};
    for (const field of FIELDS) {
      const raw = cleanField(row[field] ?? '');
      if (typeof raw !== 'string') {
        return { ok: false, reason: 'invalid_decline_referral_field', field, index };
      }
      if (raw.length > DECLINE_REFERRAL_LIMITS[field]) {
        return { ok: false, reason: 'decline_referral_field_too_long', field, index };
      }
      next[field] = raw;
    }

    if (!next.name && !next.institution && !next.email) continue;
    if (!next.name) {
      return { ok: false, reason: 'decline_referral_name_required', field: 'name', index };
    }
    if (next.email && !EMAIL_RE.test(next.email)) {
      return { ok: false, reason: 'invalid_decline_referral_email', field: 'email', index };
    }
    referrals.push(next);
  }

  const storedValue = referrals.length
    ? `${STORED_PREFIX}${JSON.stringify(referrals.map((row) => ({
      n: row.name,
      ...(row.institution ? { i: row.institution } : {}),
      ...(row.email ? { e: row.email } : {}),
    })))}`
    : null;
  if (storedValue && storedValue.length > MAX_STORED_LENGTH) {
    return { ok: false, reason: 'decline_referrals_too_long' };
  }

  return { ok: true, referrals, storedValue };
}

export function parseStoredDeclineReferral(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return [];

  if (text.startsWith(STORED_PREFIX)) {
    try {
      const compact = JSON.parse(text.slice(STORED_PREFIX.length));
      if (!Array.isArray(compact)) throw new Error('not an array');
      const expanded = compact.map((row) => ({
        name: row?.n ?? '',
        institution: row?.i ?? '',
        email: row?.e ?? '',
      }));
      const normalized = normalizeDeclineReferrals(expanded);
      if (!normalized.ok || normalized.referrals.length !== compact.length) {
        throw new Error('invalid structured referral');
      }
      return normalized.referrals.map((row) => ({ ...row, structured: true }));
    } catch {
      // A corrupt or future envelope remains visible rather than disappearing.
    }
  }

  return [{
    name: null,
    institution: null,
    email: null,
    legacyText: text,
    structured: false,
  }];
}

export function referralDisplayText(referral) {
  if (!referral?.structured) return referral?.legacyText || '';
  return [referral.name, referral.institution, referral.email].filter(Boolean).join(' · ');
}
