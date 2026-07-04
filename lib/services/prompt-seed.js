/**
 * Tier-1 system-prompt seeding helper (Dataverse `wmkf_ai_prompts` = source of truth).
 *
 * Governance model (S269, owner-confirmed; Codex pre-impl review folded):
 *  - **Create-only by default.** A seed refuses if ANY row for the prompt name already
 *    exists (current OR non-current/draft) — admin's versioned edits + version history
 *    must never be clobbered by a re-seed. After bootstrap, the GOVERNED edit path is
 *    `/admin` versioned publish; the file is a bootstrap artifact, not the live state.
 *  - **`--force` is version-preserving recovery, NOT an in-place overwrite.** It
 *    publishes `max(version)+1` as a new current row and flips prior current row(s) down
 *    with an ETag — the same versioning invariant as the admin publish path
 *    (`pages/api/admin/prompts/[name].js`). It NEVER resets version to 1 in place.
 *  - **Duplicate-current is corruption** → force refuses (resolve in Dynamics); no silent
 *    auto-repair.
 *
 * No alternate key exists on the prompt name (probed S269), so the read→create path adds
 * post-create verification (exactly one current row) and fails loud on a race.
 *
 * `recordData` is the CONTENT field set only — `wmkf_ai_iscurrent`, `wmkf_promptversion`,
 * and `wmkf_ai_publisheddatetime` are set HERE so every seeded/recovered version carries a
 * fresh publish time.
 *
 * Reads/writes are delegated to the wmkf_ai_prompts adapter
 * (`lib/dataverse/adapters/ai-prompt.js`), which mirrors this leaf's call shape
 * verbatim (Stage-3 conversion, S329 plan).
 */

import * as aiPrompt from '../dataverse/adapters/ai-prompt.js';

/** Refusal to overwrite (create-only guard / duplicate-current). Carries the plan. */
export class SeedRefused extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'SeedRefused';
    this.details = details;
  }
}

async function loadRows(promptName) {
  const res = await aiPrompt.listSeedRows(promptName);
  return res.records || [];
}

async function assertSingleCurrent(promptName) {
  const rows = await loadRows(promptName);
  const current = rows.filter((r) => r.wmkf_ai_iscurrent);
  if (current.length !== 1) {
    throw new Error(`prompt-seed: post-write verification failed for "${promptName}" — expected exactly 1 current row, found ${current.length}.`);
  }
  return current[0];
}

/**
 * Decide the action WITHOUT writing (drives --dry-run and the live guard).
 * @returns {{action:'create'|'republish'|'recover'|'refuse'|'refuse-duplicate', rows:Array, current:Array, targetVersion?:number}}
 */
export async function planSeed({ promptName, force = false }) {
  const rows = await loadRows(promptName);
  const current = rows.filter((r) => r.wmkf_ai_iscurrent);
  if (rows.length === 0) return { action: 'create', rows, current, targetVersion: 1 };
  if (current.length > 1) return { action: 'refuse-duplicate', rows, current };
  if (!force) return { action: 'refuse', rows, current };
  const maxVersion = Math.max(0, ...rows.map((r) => r.wmkf_promptversion || 0));
  return { action: current.length === 1 ? 'republish' : 'recover', rows, current, targetVersion: maxVersion + 1 };
}

/**
 * Seed / bootstrap / force-recover a system prompt row.
 * @param {Object} args
 * @param {string} args.promptName
 * @param {Object} args.recordData - content fields only (no iscurrent/version/published).
 * @param {boolean} [args.force=false]
 * @param {string} [args.now] - ISO publish time (injectable for tests).
 * @returns {Promise<{action:string, version:number, id:(string|null)}>}
 */
export async function seedPromptRow({ promptName, recordData, force = false, now } = {}) {
  const plan = await planSeed({ promptName, force });

  if (plan.action === 'refuse') {
    const kind = plan.current.length === 1 ? 'a current version' : 'only non-current/draft rows';
    throw new SeedRefused(
      `Prompt "${promptName}" already exists (${plan.rows.length} row(s); ${kind}). Refusing to overwrite — ` +
      'edit via /admin (versioned publish), or re-run with --force to publish a recovery version.',
      plan,
    );
  }
  if (plan.action === 'refuse-duplicate') {
    throw new SeedRefused(
      `Prompt "${promptName}" has ${plan.current.length} CURRENT rows (duplicate-current corruption). ` +
      'Resolve in Dynamics; --force will not auto-repair.',
      plan,
    );
  }

  const publishedAt = now || new Date().toISOString();
  const created = await aiPrompt.create({
    ...recordData,
    wmkf_ai_iscurrent: true,
    wmkf_promptversion: plan.targetVersion,
    wmkf_ai_publisheddatetime: publishedAt,
  });
  const newId = created?.wmkf_ai_promptid || created?.id || null;

  // Flip prior current row(s) down (0 for create/recover, 1 for republish) with an ETag.
  for (const r of plan.current) {
    const fresh = await aiPrompt.getIdOnly(r.wmkf_ai_promptid);
    await aiPrompt.setIsCurrent(r.wmkf_ai_promptid, false, { ifMatch: fresh._etag });
  }

  await assertSingleCurrent(promptName);
  return { action: plan.action, version: plan.targetVersion, id: newId };
}
