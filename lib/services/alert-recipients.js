/**
 * AlertRecipientsService — resolves a category to the list of admin email
 * addresses that should receive an alert.
 *
 * Storage: a single row in `wmkf_appsystemsettings` keyed `alertRecipientsByCategory`
 * whose value is a JSON object of { [category]: string[] }. Admins edit this via
 * `/admin` → Alert Recipients section.
 *
 * Lookup rule for a category X:
 *   1. config[X] non-empty → those addresses
 *   2. config.default non-empty → those addresses
 *   3. active superuser roster from `dynamics_user_roles` (preserves pre-S181 behavior)
 *
 * Categories are free-form strings; `SEED_CATEGORIES` is just the set we surface
 * in the admin UI so they're discoverable. Calling code may pass any string.
 */

const { sql } = require('@vercel/postgres');
const DataverseSettings = require('./dataverse-settings-service');

const SETTING_KEY = 'alertRecipientsByCategory';

// Seed list shown in the admin UI. Order = display order. Free-form additions
// are permitted; this is just discoverability scaffolding.
const SEED_CATEGORIES = [
  { key: 'default',          description: 'Fallback for any alert without a more specific category' },
  { key: 'security',         description: 'EMERGENCY_AUTH_BYPASS active, future security events' },
  { key: 'spend',            description: 'AI credit balance low, usage warnings' },
  { key: 'intake',           description: 'Applicant submission drain failures, stuck jobs (reserved — no emitter yet; will be wired with Phase B drain alerts)' },
  { key: 'ops',              description: 'Health checks, maintenance, log anomalies, secret rotation' },
  { key: 'staff-onboarding', description: 'New WMKF staff first login — needs app-access grant' },
  { key: 'support',          description: 'Applicant help-form recipients (reserved — no emitter yet)' },
];

// RFC-pragmatic email shape. Not full RFC 5322 — we just want to reject obvious
// typos and protect against injection of header-like content.
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function isValidEmail(s) {
  return typeof s === 'string' && s.length <= 254 && EMAIL_REGEX.test(s.trim());
}

// Mirrors the UI input regex: lowercase ASCII, digits, hyphen, underscore.
// Bounded length closes weird-key inputs (control chars, `__proto__`,
// whitespace) that would otherwise pass the bare `typeof === 'string'` check.
const CATEGORY_REGEX = /^[a-z0-9_-]{1,64}$/;

function isValidCategory(s) {
  return typeof s === 'string' && CATEGORY_REGEX.test(s);
}

/**
 * Normalize a config object — trims/lowercases addresses, dedupes within each
 * category, drops empty arrays, drops invalid emails (silently — write-path
 * validates loudly; read-path is defensive).
 */
function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [cat, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue;
    const seen = new Set();
    const clean = [];
    for (const e of list) {
      if (!isValidEmail(e)) continue;
      const norm = e.trim().toLowerCase();
      if (seen.has(norm)) continue;
      seen.add(norm);
      clean.push(norm);
    }
    if (clean.length) out[cat] = clean;
  }
  return out;
}

async function readConfig() {
  try {
    const raw = await DataverseSettings.getSetting(SETTING_KEY);
    if (!raw) return {};
    return normalizeConfig(JSON.parse(raw));
  } catch (err) {
    // getSetting() catches its own errors and returns null, but defense in
    // depth: if the adapter ever throws (network, auth, etc.), we still want
    // resolution to fall through to the superuser-roster fallback rather than
    // bubble a 500 to the caller.
    console.error('[alert-recipients] readConfig failed:', err.message);
    return {};
  }
}

async function getSuperuserRoster() {
  try {
    const result = await sql`
      SELECT DISTINCT p.azure_email
      FROM user_profiles p
      JOIN dynamics_user_roles r ON r.user_profile_id = p.id
      WHERE r.role = 'superuser'
        AND p.is_active = true
        AND p.azure_email IS NOT NULL
    `;
    const seen = new Set();
    const out = [];
    for (const row of result.rows) {
      const norm = (row.azure_email || '').trim().toLowerCase();
      if (!isValidEmail(norm) || seen.has(norm)) continue;
      seen.add(norm);
      out.push(norm);
    }
    return out;
  } catch (err) {
    console.error('[alert-recipients] superuser roster lookup failed:', err.message);
    return [];
  }
}

/**
 * Resolve a category to its email recipient list. See module header for rules.
 *
 * @param {string} category - free-form category tag; falsy/'default' both
 *   target the `default` bucket.
 * @param {Object} [opts]
 * @param {Object} [opts.configOverride] - pre-fetched config (avoids second
 *   Dataverse round-trip when caller already has it, e.g. admin GET endpoint).
 * @returns {Promise<{ recipients: string[], source: 'category'|'default'|'roster'|'none', category: string }>}
 */
async function resolveRecipients(category, opts = {}) {
  const cat = (category && category !== 'default') ? category : 'default';
  const config = opts.configOverride ?? await readConfig();

  if (cat !== 'default' && Array.isArray(config[cat]) && config[cat].length) {
    return { recipients: config[cat], source: 'category', category: cat };
  }
  if (Array.isArray(config.default) && config.default.length) {
    return { recipients: config.default, source: 'default', category: cat };
  }
  const roster = await getSuperuserRoster();
  if (roster.length) {
    return { recipients: roster, source: 'roster', category: cat };
  }
  return { recipients: [], source: 'none', category: cat };
}

/**
 * Persist a new full-config replacement. Caller is responsible for being
 * superuser-gated. Validates every email, dedupes, drops empty buckets.
 *
 * @returns {Promise<{ ok: boolean, errors?: string[] }>}
 */
async function writeConfig(rawConfig, updatedByProfileId = null) {
  const errors = [];
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    return { ok: false, errors: ['config must be an object of { category: string[] }'] };
  }
  for (const [cat, list] of Object.entries(rawConfig)) {
    if (!isValidCategory(cat)) {
      errors.push(`invalid category name: ${JSON.stringify(cat)} (must match /^[a-z0-9_-]{1,64}$/)`);
      continue;
    }
    if (!Array.isArray(list)) {
      errors.push(`category "${cat}": value must be an array`);
      continue;
    }
    for (const e of list) {
      if (!isValidEmail(e)) {
        errors.push(`category "${cat}": invalid email "${e}"`);
      }
    }
  }
  if (errors.length) return { ok: false, errors };

  const normalized = normalizeConfig(rawConfig);
  const ok = await DataverseSettings.setSetting(
    SETTING_KEY,
    JSON.stringify(normalized),
    updatedByProfileId,
  );
  return ok ? { ok: true } : { ok: false, errors: ['Dataverse write failed'] };
}

module.exports = {
  SETTING_KEY,
  SEED_CATEGORIES,
  isValidEmail,
  isValidCategory,
  normalizeConfig,
  readConfig,
  resolveRecipients,
  writeConfig,
  getSuperuserRoster,
};
