/**
 * Admin — edit a prompt's catalog fields (wave36 columns) in place.
 *
 * Owner decision 2026-11-02: Admin edits title, description, group, section,
 * used-by and usage on the prompt's current row (or, when the name has no current
 * row, its highest-version row). It never touches prompt content, the current
 * flag, status or version, and creates no new version.
 *
 * Protocol (mirrors versioned publish's audit discipline):
 *   validate → load rows → target must be the row the editor loaded and still
 *   hold the values it loaded (else 409 catalog_conflict) → pending audit
 *   (HARD-ABORT on failure) → PATCH the six columns with If-Match on a fresh
 *   ETag (412 → 409 catalog_conflict) → re-check the current row; a publish
 *   that superseded the target mid-edit returns `catalog_superseded` → final audit.
 *
 * Audit rows use their own server-minted request_id, so publish idempotency
 * (keyed by request_id) never reads them. Requires migration 093.
 * ASSUMES a trusted DAL context already exists — never establishes one.
 */

import { randomUUID } from 'crypto';
import { sql } from '@vercel/postgres';
import * as aiPrompt from '../../dataverse/adapters/ai-prompt';
import { ServiceHttpError } from '../service-http-error';
import { isGuid } from '../../utils/guid';
import { PROMPT_CATALOG_COLUMNS, mapPromptCatalog } from './prompt-catalog-fields';
import { ADMIN_PROMPT_GROUPS, ADMIN_PROMPT_USAGES } from '../../../shared/config/adminPromptCatalog';
import { getPromptGroups } from './prompt-groups-service';

const LIMITS = { title: 200, description: 4000, group: 80, section: 80, usedBy: 4000, usage: 40 };
const KEYS = Object.keys(PROMPT_CATALOG_COLUMNS);

function invalid(error) {
  return new ServiceHttpError(error, { httpStatus: 400, body: { status: 'invalid_catalog', error } });
}

function conflict(error, extra = {}) {
  return new ServiceHttpError(error, { httpStatus: 409, body: { status: 'catalog_conflict', error, ...extra } });
}

/** Trim strings, blank → null; reject unknown keys, non-strings, over-length, unknown placement/usage. */
export function normalizeCatalog(input, groups = ADMIN_PROMPT_GROUPS) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('catalog must be an object.');
  const unknown = Object.keys(input).filter((key) => !KEYS.includes(key));
  if (unknown.length) throw invalid(`Unknown catalog field(s): ${unknown.join(', ')}.`);
  const out = {};
  for (const key of KEYS) {
    const value = input[key];
    if (value === undefined || value === null) { out[key] = null; continue; }
    if (typeof value !== 'string') throw invalid(`${key} must be text.`);
    const trimmed = value.trim();
    if (trimmed.length > LIMITS[key]) throw invalid(`${key} must be at most ${LIMITS[key]} characters.`);
    out[key] = trimmed || null;
  }
  const group = out.group ? groups.find((candidate) => candidate.id === out.group) : null;
  if (out.group && !group) throw invalid(`Unknown group "${out.group}".`);
  if (group?.sections) {
    if (!group.sections.some((section) => section.id === out.section)) throw invalid(`Group "${group.id}" needs one of its sections.`);
  } else if (out.section) {
    throw invalid(out.group ? `Group "${group.id}" has no sections.` : 'A section needs a group.');
  }
  if (out.usage && !ADMIN_PROMPT_USAGES.includes(out.usage)) throw invalid(`Unknown usage "${out.usage}".`);
  return out;
}

/** The catalog exactly as the editor loaded it (only the six keys; missing → null). */
function loadedCatalog(expected) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) throw invalid('expected catalog is required.');
  return Object.fromEntries(KEYS.map((key) => [key, expected[key] ?? null]));
}

const toColumns = (catalog) => Object.fromEntries(KEYS.map((key) => [PROMPT_CATALOG_COLUMNS[key], catalog[key]]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * @param {Object} args
 * @param {string} args.name prompt name
 * @param {string} args.rowId GUID of the row the editor loaded
 * @param {Object} args.expected catalog values the editor loaded (`prompt.catalog`)
 * @param {Object} args.catalog new values
 * @param {*} args.profileId
 * @returns {Promise<Object>} `{ status: 'catalog_updated'|'catalog_superseded', rowId, catalog, unchanged?, warnings }`
 * @throws {ServiceHttpError} 400 invalid_catalog, 404, 409 catalog_conflict,
 *   500 duplicate_current_rows / audit_unavailable / failed
 */
export async function updatePromptCatalog({ name, rowId, expected, catalog, profileId }) {
  if (!isGuid(rowId)) throw invalid('rowId must be a GUID.');
  const after = normalizeCatalog(catalog, (await getPromptGroups()).groups);
  const loaded = loadedCatalog(expected);

  const rows = (await aiPrompt.listVersions(name)).records || [];
  if (rows.length === 0) throw new ServiceHttpError(`No prompt named "${name}"`, { httpStatus: 404 });
  const current = rows.filter((row) => row.wmkf_ai_iscurrent);
  if (current.length > 1) {
    const error = `Multiple current rows for "${name}" — resolve in Dynamics before editing details.`;
    throw new ServiceHttpError(error, { httpStatus: 500, body: { status: 'duplicate_current_rows', error } });
  }
  const target = current[0]
    || [...rows].sort((a, b) => (b.wmkf_promptversion || 0) - (a.wmkf_promptversion || 0))[0];
  if (target.wmkf_ai_promptid !== rowId) {
    throw conflict('This prompt changed since you opened it (a new version was published). Reload and re-apply your edits.');
  }
  const before = mapPromptCatalog(target);
  if (!same(before, loaded)) {
    throw conflict('These details were changed by someone else since you opened them. Reload and re-apply your edits.');
  }
  if (same(before, after)) {
    return { status: 'catalog_updated', rowId, catalog: before, unchanged: true, warnings: [] };
  }

  const requestId = randomUUID();
  const version = target.wmkf_promptversion || 0;
  const audit = { kind: 'catalog', rowId, version, before, after };
  try {
    await sql`
      INSERT INTO prompt_publish_audit
        (request_id, prompt_name, target_version, prior_prompt_id, profile_id, phase, status, outcome_json)
      VALUES
        (${requestId}, ${name}, ${version}, ${rowId}, ${profileId || null}, 'pending', 'pending', ${JSON.stringify(audit)}::jsonb)`;
  } catch (err) {
    console.error('[admin/prompts] catalog pending audit write failed:', err);
    const error = 'Audit table unavailable; refused to change prompt details.';
    throw new ServiceHttpError(error, { httpStatus: 500, body: { status: 'audit_unavailable', error } });
  }

  let outcome;
  try {
    const fresh = await aiPrompt.getIdOnly(rowId);
    if (!fresh?._etag) throw new Error('missing_etag');
    try {
      await aiPrompt.updateCatalog(rowId, toColumns(after), { ifMatch: fresh._etag });
    } catch (err) {
      if (err.status === 412) {
        outcome = { status: 'catalog_conflict', rowId, warnings: ['row_etag_mismatch'] };
        await finalizeCatalogAudit({ requestId, name, version, rowId, profileId, audit, outcome });
        throw conflict('These details changed while saving. Reload and re-apply your edits.');
      }
      throw err;
    }
    const nowCurrent = (await aiPrompt.queryCurrentIdVersions(name)).records || [];
    const stillTarget = target.wmkf_ai_iscurrent
      ? nowCurrent.length === 1 && nowCurrent[0].wmkf_ai_promptid === rowId
      : nowCurrent.length === 0;
    outcome = stillTarget
      ? { status: 'catalog_updated', rowId, catalog: after, warnings: [] }
      : { status: 'catalog_superseded', rowId, catalog: after, warnings: ['superseded_by_publish'] };
  } catch (err) {
    if (err instanceof ServiceHttpError) throw err;
    console.error('[admin/prompts] catalog update failed:', err);
    outcome = { status: 'failed', rowId, warnings: [`internal_error:${err.message}`] };
    await finalizeCatalogAudit({ requestId, name, version, rowId, profileId, audit, outcome });
    throw new ServiceHttpError('catalog update failed', { httpStatus: 500, body: { status: 'failed', error: 'Saving prompt details failed.' } });
  }

  await finalizeCatalogAudit({ requestId, name, version, rowId, profileId, audit, outcome });
  return outcome;
}

async function finalizeCatalogAudit({ requestId, name, version, rowId, profileId, audit, outcome }) {
  try {
    await sql`
      INSERT INTO prompt_publish_audit
        (request_id, prompt_name, target_version, new_prompt_id, prior_prompt_id, profile_id, phase, status, outcome_json, warnings_json)
      VALUES
        (${requestId}, ${name}, ${version}, ${rowId}, ${rowId}, ${profileId || null}, 'final', ${outcome.status},
         ${JSON.stringify({ ...audit, ...outcome })}::jsonb, ${JSON.stringify(outcome.warnings || [])}::jsonb)
      ON CONFLICT (request_id, phase) DO NOTHING`;
  } catch (err) {
    console.error('[admin/prompts] catalog final audit write failed:', err);
  }
}
