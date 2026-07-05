/**
 * Admin — prompt versioned-publish service (Route→Service Consolidation Plan,
 * Stage 5).
 *
 * Holds the business logic for /api/admin/prompts/[name]; the route is a thin
 * shell (method dispatch, superuser gate, name validation, DAL context, HTTP
 * mapping). Protocol documentation lives in the route header; semantics are
 * moved verbatim:
 *   - GET: current row + version history (+ duplicate_current_rows invariant flag).
 *   - PUT publish: validate → idempotency replay → load current row(s) →
 *     resumable-torn-state detection → pending audit (HARD-ABORT on failure) →
 *     create v+1 (cloning Executor metadata) → flip prior with If-Match
 *     (412 → concurrency_conflict, orphaned new row) → verify exactly one
 *     current → final audit.
 *
 * Contract (plan Decision 3): plain argument objects; returns the exact
 * 200-envelope objects; throws ServiceHttpError with explicit `body` for the
 * non-`{ error }` status envelopes (400 invalid_*, 404 no_current_row,
 * 409 concurrency_conflict, 500 duplicate_current_rows/audit_unavailable/failed).
 * ASSUMES a trusted DAL context already exists — never establishes one.
 */

import { randomUUID, createHash } from 'crypto';
import { sql } from '@vercel/postgres';
import * as aiPrompt from '../../dataverse/adapters/ai-prompt';
import { validatePromptForSave } from '../../utils/prompt-validators';
import { validateReviewedClaudeModelValue } from '../model-review-validation';
import { ServiceHttpError } from '../service-http-error';

const MAX_BODY_LEN = 64 * 1024;

// ───────────────────────── GET ─────────────────────────

/**
 * Current row (full editable metadata) + recent version history.
 *
 * @param {string} name
 * @returns {Promise<{ name, current, invariantError, history }>}
 * @throws {ServiceHttpError} 404 when no prompt rows exist for the name
 */
export async function getPrompt(name) {
  const all = await aiPrompt.listVersions(name);
  const rows = all.records || [];
  if (rows.length === 0) {
    throw new ServiceHttpError(`No prompt named "${name}"`, { httpStatus: 404 });
  }
  const current = rows.find((r) => r.wmkf_ai_iscurrent) || null;
  return {
    name,
    current: current ? mapRow(current) : null,
    invariantError: rows.filter((r) => r.wmkf_ai_iscurrent).length > 1 ? 'duplicate_current_rows' : null,
    history: rows.map(mapRow),
  };
}

// ───────────────────────── PUT (publish) ─────────────────────────

/**
 * Publish a new version of a prompt (policies.js-style protocol adapted to the
 * prompt store's iscurrent+version model).
 *
 * @param {Object} args
 * @param {string} args.name
 * @param {string} args.body - the edited prompt body
 * @param {string} [args.systemPrompt]
 * @param {string} [args.variables]
 * @param {string} [args.requestId] - idempotency token (defaults to a fresh UUID)
 * @param {*} args.profileId
 * @returns {Promise<Object>} the historical 200 envelope (completed / partial /
 *   already_published replay / resumed)
 * @throws {ServiceHttpError} with explicit body for every historical non-200 envelope
 */
export async function publishPrompt({ name, body, systemPrompt, variables, requestId: requestIdArg, profileId }) {
  const requestId = requestIdArg || randomUUID();

  // 1. Validate the body.
  if (typeof body !== 'string' || body.length === 0 || body.length > MAX_BODY_LEN) {
    throw new ServiceHttpError(`body must be 1..${MAX_BODY_LEN} chars`, {
      httpStatus: 400,
      body: { status: 'invalid_input', error: `body must be 1..${MAX_BODY_LEN} chars` },
    });
  }
  const v = validatePromptForSave(name, body);
  if (!v.valid) {
    throw new ServiceHttpError('Prompt body failed validation.', {
      httpStatus: 400,
      body: { status: 'invalid_body', error: 'Prompt body failed validation.', issues: v.issues },
    });
  }
  const bodyHash = createHash('sha256').update(body).digest('hex');

  // 2. Idempotent short-circuit: this request_id already completed.
  const priorFinal = await sql`
    SELECT status, new_prompt_id, target_version FROM prompt_publish_audit
    WHERE request_id = ${requestId} AND phase = 'final' LIMIT 1`;
  if (priorFinal.rows[0]) {
    const row = priorFinal.rows[0];
    return { status: row.status === 'completed' ? 'already_published' : row.status, newPromptId: row.new_prompt_id, version: row.target_version, idempotentReplay: true };
  }

  // 3. Load current row(s).
  const cur = await aiPrompt.queryCurrentRows(name);
  const currentRows = cur.records || [];

  if (currentRows.length === 0) {
    throw new ServiceHttpError(`No current row for "${name}" — seed it before versioned publish.`, {
      httpStatus: 404,
      body: { status: 'no_current_row', error: `No current row for "${name}" — seed it before versioned publish.` },
    });
  }

  // Resolve prior row + detect a resumable torn state (≥2 current).
  let priorRow;
  if (currentRows.length === 1) {
    priorRow = currentRows[0];
  } else {
    // ≥2 current. If exactly one of them already matches THIS publish (target
    // version + body hash), a prior attempt created it but didn't flip the old
    // one — resume by flipping the others down. Otherwise: genuine corruption.
    const sorted = [...currentRows].sort((a, b) => (b.wmkf_promptversion || 0) - (a.wmkf_promptversion || 0));
    const top = sorted[0];
    const topHash = createHash('sha256').update(top.wmkf_ai_promptbody || '').digest('hex');
    const consecutive = (top.wmkf_promptversion || 0) === (sorted[1].wmkf_promptversion || 0) + 1;
    if (topHash === bodyHash && consecutive) {
      const topModelValidation = validateReviewedPromptModel(top.wmkf_ai_model);
      if (!topModelValidation.valid) {
        throw new ServiceHttpError(topModelValidation.response.error, {
          httpStatus: 400,
          body: topModelValidation.response,
        });
      }
      // Resume: `top` is our intended new version; flip the rest down.
      await writePendingAudit({ requestId, name, targetVersion: top.wmkf_promptversion, priorId: sorted[1].wmkf_ai_promptid, bodyHash, profileId });
      const flipResult = await flipPriorRows(sorted.slice(1));
      const outcome = { status: flipResult.allFlipped ? 'completed' : 'partial', newPromptId: top.wmkf_ai_promptid, targetVersion: top.wmkf_promptversion, warnings: flipResult.warnings, resumed: true };
      await finalizeAudit({ requestId, name, profileId, outcome, priorId: sorted[1].wmkf_ai_promptid });
      return outcome;
    }
    await alertDuplicateCurrent(name, currentRows.map((r) => r.wmkf_ai_promptid));
    throw new ServiceHttpError(`Multiple current rows for "${name}" — prompt store corruption; resolve in Dynamics.`, {
      httpStatus: 500,
      body: { status: 'duplicate_current_rows', error: `Multiple current rows for "${name}" — prompt store corruption; resolve in Dynamics.`, ids: currentRows.map((r) => r.wmkf_ai_promptid) },
    });
  }

  const priorId = priorRow.wmkf_ai_promptid;
  const targetVersion = (priorRow.wmkf_promptversion || 0) + 1;
  const priorModelValidation = validateReviewedPromptModel(priorRow.wmkf_ai_model);
  if (!priorModelValidation.valid) {
    throw new ServiceHttpError(priorModelValidation.response.error, {
      httpStatus: 400,
      body: priorModelValidation.response,
    });
  }
  const clonedModelValue = priorModelValidation.value;

  // 4. Pending audit (hard-abort on failure).
  try {
    await writePendingAudit({ requestId, name, targetVersion, priorId, bodyHash, profileId });
  } catch (err) {
    console.error('[admin/prompts] pending audit write failed:', err);
    throw new ServiceHttpError('Audit table unavailable; refused to perform privileged mutation.', {
      httpStatus: 500,
      body: { status: 'audit_unavailable', error: 'Audit table unavailable; refused to perform privileged mutation.' },
    });
  }

  // Fresh ETag for the flip (don't trust a stale client copy).
  const priorFresh = await aiPrompt.getIdOnly(priorId);
  const priorEtag = priorFresh._etag || null;

  // 5. Create the new version row — clone the prior row's Executor metadata,
  //    apply the edited body (+ optional systemPrompt/variables).
  let newId = null;
  let outcome;
  try {
    const created = await aiPrompt.create({
      wmkf_ai_promptname: name,
      wmkf_ai_promptbody: body,
      wmkf_ai_systemprompt: typeof systemPrompt === 'string' ? systemPrompt : (priorRow.wmkf_ai_systemprompt || ''),
      wmkf_ai_promptvariables: typeof variables === 'string' ? variables : (priorRow.wmkf_ai_promptvariables || null),
      wmkf_ai_promptoutputschema: priorRow.wmkf_ai_promptoutputschema || null,
      wmkf_ai_model: clonedModelValue,
      wmkf_ai_temperature: priorRow.wmkf_ai_temperature ?? null,
      wmkf_ai_maxtokens: priorRow.wmkf_ai_maxtokens ?? null,
      wmkf_ai_promptstatus: priorRow.wmkf_ai_promptstatus ?? null,
      wmkf_ai_iscurrent: true,
      wmkf_promptversion: targetVersion,
      // Domain publish time on every admin-published version (parity with the seed,
      // which stamps it too) — so publishedAt is meaningful across both write paths (S269).
      wmkf_ai_publisheddatetime: new Date().toISOString(),
      // NOTE: `wmkf_ai_rollbackfrom` (prior-row lineage) is intentionally NOT
      // written here — its field type (Lookup vs text) is unverified and a wrong
      // write shape would fail the whole create. Lineage is already captured by
      // prompt_publish_audit.prior_prompt_id. Wire this once the type is probed.
    });
    newId = created.wmkf_ai_promptid;

    // 6. Flip the prior row down with If-Match (concurrency guard).
    try {
      await aiPrompt.setIsCurrent(priorId, false, { ifMatch: priorEtag });
    } catch (flipErr) {
      if (flipErr.status === 412) {
        // A concurrent publish flipped/changed the prior row. Our new row is now
        // an orphan (would create a 2-current state). Surface loudly.
        outcome = { status: 'concurrency_conflict', newPromptId: newId, targetVersion, orphan: { id: newId, reason: 'prior_etag_mismatch' }, warnings: ['prior_etag_mismatch'] };
        await finalizeAudit({ requestId, name, profileId, outcome, priorId });
        throw new ServiceHttpError('prior_etag_mismatch', { httpStatus: 409, body: outcome });
      }
      throw flipErr;
    }

    // 7. Verify exactly one current remains.
    const after = await aiPrompt.queryCurrentIdVersions(name);
    const currentCount = (after.records || []).length;
    const warnings = currentCount === 1 ? [] : [`invariant_violation_current_count_${currentCount}`];
    outcome = { status: currentCount === 1 ? 'completed' : 'partial', newPromptId: newId, targetVersion, warnings };
  } catch (err) {
    // Typed-error passthrough (P1m note 4): the 409 above already finalized
    // its audit; rethrow before the generic failed-outcome wrapper.
    if (err instanceof ServiceHttpError) throw err;
    console.error('[admin/prompts] publish failed:', err);
    outcome = { status: 'failed', newPromptId: newId, targetVersion, warnings: [`internal_error:${err.message}`] };
  }

  await finalizeAudit({ requestId, name, profileId, outcome, priorId });
  if (outcome.status === 'failed') {
    throw new ServiceHttpError('publish failed', { httpStatus: 500, body: outcome });
  }
  return outcome;
}

// ───────────────────────── helpers ─────────────────────────

async function flipPriorRows(rows) {
  const warnings = [];
  let allFlipped = true;
  for (const r of rows) {
    try {
      const fresh = await aiPrompt.getIdOnly(r.wmkf_ai_promptid);
      await aiPrompt.setIsCurrent(r.wmkf_ai_promptid, false, { ifMatch: fresh._etag || undefined });
    } catch (err) {
      allFlipped = false;
      warnings.push(`flip_failed:${r.wmkf_ai_promptid}`);
      console.error('[admin/prompts] resume flip failed:', err.message);
    }
  }
  return { allFlipped, warnings };
}

async function writePendingAudit({ requestId, name, targetVersion, priorId, bodyHash, profileId }) {
  await sql`
    INSERT INTO prompt_publish_audit
      (request_id, prompt_name, target_version, prior_prompt_id, body_hash, profile_id, phase, status)
    VALUES
      (${requestId}, ${name}, ${targetVersion}, ${priorId || null}, ${bodyHash}, ${profileId || null}, 'pending', 'pending')
    ON CONFLICT (request_id, phase) DO NOTHING`;
}

async function finalizeAudit({ requestId, name, profileId, outcome, priorId }) {
  try {
    await sql`
      INSERT INTO prompt_publish_audit
        (request_id, prompt_name, target_version, new_prompt_id, prior_prompt_id,
         profile_id, phase, status, outcome_json, warnings_json)
      VALUES
        (${requestId}, ${name}, ${outcome.targetVersion || null}, ${outcome.newPromptId || null},
         ${priorId || null}, ${profileId || null}, 'final', ${outcome.status},
         ${JSON.stringify(outcome)}::jsonb, ${JSON.stringify(outcome.warnings || [])}::jsonb)
      ON CONFLICT (request_id, phase) DO NOTHING`;
    return true;
  } catch (err) {
    console.error('[admin/prompts] final audit write failed:', err);
    try {
      await sql`
        INSERT INTO system_alerts (alert_type, severity, title, message, source, metadata)
        VALUES ('prompt_audit_finalize_failed', 'error', 'Prompt publish audit finalize failed',
          ${`Final audit write failed for request ${requestId} (prompt ${name}). Reconcile manually.`},
          'admin/prompts', ${JSON.stringify({ requestId, name, status: outcome.status, error: err.message })}::jsonb)`;
    } catch (alertErr) {
      console.error('[admin/prompts] system_alerts insert also failed:', alertErr.message);
    }
    return false;
  }
}

async function alertDuplicateCurrent(name, ids) {
  try {
    await sql`
      INSERT INTO system_alerts (alert_type, severity, title, message, source, metadata)
      VALUES ('prompt_duplicate_current_rows', 'error', 'Prompt store has multiple current rows',
        ${`Prompt "${name}" has ${ids.length} rows with iscurrent=true — resolve in Dynamics.`},
        'admin/prompts', ${JSON.stringify({ name, ids })}::jsonb)`;
  } catch (err) {
    console.error('[admin/prompts] duplicate-current alert failed:', err.message);
  }
}

function mapRow(r) {
  return {
    id: r.wmkf_ai_promptid,
    name: r.wmkf_ai_promptname,
    version: r.wmkf_promptversion ?? null,
    isCurrent: !!r.wmkf_ai_iscurrent,
    status: r.wmkf_ai_promptstatus ?? null,
    systemPrompt: r.wmkf_ai_systemprompt || '',
    body: r.wmkf_ai_promptbody || '',
    variables: r.wmkf_ai_promptvariables || null,
    outputSchema: r.wmkf_ai_promptoutputschema || null,
    model: r.wmkf_ai_model || null,
    temperature: r.wmkf_ai_temperature ?? null,
    maxTokens: r.wmkf_ai_maxtokens ?? null,
    // Provenance (S269). For HISTORY rows, createdOn/publishedAt mark when the
    // version was published; modifiedOn is "last touched" — a version-flip rewrites
    // it, so it can read as the retire time, not authorship.
    createdOn: r.createdon ?? null,
    publishedAt: r.wmkf_ai_publisheddatetime ?? null,
    modifiedOn: r.modifiedon ?? null,
    modifiedById: r._modifiedby_value ?? null,
    modifiedByName: r._modifiedby_value_formatted ?? null,
  };
}

function validateReviewedPromptModel(modelId) {
  const validation = validateReviewedClaudeModelValue(modelId, { allowEmpty: true });
  if (validation.valid) {
    return { valid: true, value: validation.value };
  }
  return {
    valid: false,
    response: {
      status: 'invalid_model',
      code: validation.code,
      error: validation.error,
    },
  };
}
