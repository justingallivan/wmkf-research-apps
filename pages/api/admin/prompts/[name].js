/**
 * API Route: /api/admin/prompts/[name]
 *
 * Superuser-only. Versioned publish for a `wmkf_ai_prompt` row, adapting the
 * `pages/api/admin/policies.js` protocol to the prompt store's "same-name rows
 * discriminated by `wmkf_ai_iscurrent` + integer `wmkf_promptversion`" model
 * (no parent/child, no activeVersion pointer).
 *
 * GET  — current row (full editable metadata) + recent version history.
 * PUT  — publish a new version. Body: { body, systemPrompt?, variables?, requestId? }.
 *
 * Publish flow (mirrors policies.js; Dataverse has no $batch transaction):
 *   1. Validate the body (generic + parse-contract validators).
 *   2. Load the current `iscurrent` row(s). 0 → no_current_row; ≥2 → either a
 *      resumable torn state (a prior attempt created v+1 but didn't flip v) or
 *      genuine corruption (duplicate_current_rows, block + alert).
 *   3. Pending audit row in `prompt_publish_audit` (hard-abort on failure —
 *      audit availability is a precondition for the privileged mutation).
 *   4. Idempotency: a prior `final`/`completed` audit row for this request_id →
 *      already_published. Else create the new row (iscurrent=true, version+1,
 *      rollbackfrom=prior, cloning the prior row's Executor metadata + the edited
 *      body) → flip the prior row iscurrent=false with If-Match (412 →
 *      concurrency_conflict, new row orphaned) → verify exactly one current.
 *   5. Final audit row (system_alerts on its failure).
 */
import { randomUUID, createHash } from 'crypto';
import { sql } from '@vercel/postgres';
import { requireSuperuser } from '../../../../lib/utils/auth';
import { DynamicsService } from '../../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../../lib/services/dynamics-context';
import { validatePromptForSave } from '../../../../lib/utils/prompt-validators';

const PROMPTS_ENTITY = 'wmkf_ai_prompts';
const ROW_SELECT = [
  'wmkf_ai_promptid', 'wmkf_ai_promptname', 'wmkf_promptversion', 'wmkf_ai_iscurrent',
  'wmkf_ai_promptstatus', 'wmkf_ai_systemprompt', 'wmkf_ai_promptbody',
  'wmkf_ai_promptvariables', 'wmkf_ai_promptoutputschema', 'wmkf_ai_model',
  'wmkf_ai_temperature', 'wmkf_ai_maxtokens',
  'createdon', 'modifiedon', '_modifiedby_value', 'wmkf_ai_publisheddatetime', // provenance (S269)
].join(',');
const MAX_BODY_LEN = 64 * 1024;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  const name = String(req.query.name || '');
  if (!name) return res.status(400).json({ error: 'prompt name required' });

  try {
    return await bypassDynamicsRestrictions('admin-prompts-publish', async () => {
      if (req.method === 'GET') return await handleGet(res, name);
      return await handlePut(req, res, name, gate.profileId);
    });
  } catch (err) {
    console.error('[admin/prompts/[name]] unexpected error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

// ───────────────────────── GET ─────────────────────────

async function handleGet(res, name) {
  const all = await DynamicsService.queryRecords(PROMPTS_ENTITY, {
    select: ROW_SELECT,
    filter: `wmkf_ai_promptname eq '${escapeOData(name)}'`,
    orderby: 'wmkf_promptversion desc',
    top: 50,
  });
  const rows = all.records || [];
  if (rows.length === 0) return res.status(404).json({ error: `No prompt named "${name}"` });
  const current = rows.find((r) => r.wmkf_ai_iscurrent) || null;
  return res.json({
    name,
    current: current ? mapRow(current) : null,
    invariantError: rows.filter((r) => r.wmkf_ai_iscurrent).length > 1 ? 'duplicate_current_rows' : null,
    history: rows.map(mapRow),
  });
}

// ───────────────────────── PUT (publish) ─────────────────────────

async function handlePut(req, res, name, profileId) {
  const { body, systemPrompt, variables } = req.body || {};
  const requestId = (req.body && req.body.requestId) || randomUUID();

  // 1. Validate the body.
  if (typeof body !== 'string' || body.length === 0 || body.length > MAX_BODY_LEN) {
    return res.status(400).json({ status: 'invalid_input', error: `body must be 1..${MAX_BODY_LEN} chars` });
  }
  const v = validatePromptForSave(name, body);
  if (!v.valid) {
    return res.status(400).json({ status: 'invalid_body', error: 'Prompt body failed validation.', issues: v.issues });
  }
  const bodyHash = createHash('sha256').update(body).digest('hex');

  // 2. Idempotent short-circuit: this request_id already completed.
  const priorFinal = await sql`
    SELECT status, new_prompt_id, target_version FROM prompt_publish_audit
    WHERE request_id = ${requestId} AND phase = 'final' LIMIT 1`;
  if (priorFinal.rows[0]) {
    const row = priorFinal.rows[0];
    return res.status(200).json({ status: row.status === 'completed' ? 'already_published' : row.status, newPromptId: row.new_prompt_id, version: row.target_version, idempotentReplay: true });
  }

  // 3. Load current row(s).
  const cur = await DynamicsService.queryRecords(PROMPTS_ENTITY, {
    select: ROW_SELECT,
    filter: `wmkf_ai_promptname eq '${escapeOData(name)}' and wmkf_ai_iscurrent eq true`,
    top: 3,
  });
  const currentRows = cur.records || [];

  if (currentRows.length === 0) {
    return res.status(404).json({ status: 'no_current_row', error: `No current row for "${name}" — seed it before versioned publish.` });
  }

  // Resolve prior row + detect a resumable torn state (≥2 current).
  let priorRow;
  let resumeFlipExtra = null; // additional older current rows to flip down
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
      // Resume: `top` is our intended new version; flip the rest down.
      await writePendingAudit({ requestId, name, targetVersion: top.wmkf_promptversion, priorId: sorted[1].wmkf_ai_promptid, bodyHash, profileId });
      const flipResult = await flipPriorRows(sorted.slice(1));
      const outcome = { status: flipResult.allFlipped ? 'completed' : 'partial', newPromptId: top.wmkf_ai_promptid, targetVersion: top.wmkf_promptversion, warnings: flipResult.warnings, resumed: true };
      await finalizeAudit({ requestId, name, profileId, outcome, priorId: sorted[1].wmkf_ai_promptid });
      return res.status(200).json(outcome);
    }
    await alertDuplicateCurrent(name, currentRows.map((r) => r.wmkf_ai_promptid));
    return res.status(500).json({ status: 'duplicate_current_rows', error: `Multiple current rows for "${name}" — prompt store corruption; resolve in Dynamics.`, ids: currentRows.map((r) => r.wmkf_ai_promptid) });
  }

  const priorId = priorRow.wmkf_ai_promptid;
  const targetVersion = (priorRow.wmkf_promptversion || 0) + 1;

  // 4. Pending audit (hard-abort on failure).
  try {
    await writePendingAudit({ requestId, name, targetVersion, priorId, bodyHash, profileId });
  } catch (err) {
    console.error('[admin/prompts] pending audit write failed:', err);
    return res.status(500).json({ status: 'audit_unavailable', error: 'Audit table unavailable; refused to perform privileged mutation.' });
  }

  // Fresh ETag for the flip (don't trust a stale client copy).
  const priorFresh = await DynamicsService.getRecord(PROMPTS_ENTITY, priorId, { select: 'wmkf_ai_promptid' });
  const priorEtag = priorFresh._etag || null;

  // 5. Create the new version row — clone the prior row's Executor metadata,
  //    apply the edited body (+ optional systemPrompt/variables).
  let newId = null;
  let outcome;
  try {
    const created = await DynamicsService.createRecord(PROMPTS_ENTITY, {
      wmkf_ai_promptname: name,
      wmkf_ai_promptbody: body,
      wmkf_ai_systemprompt: typeof systemPrompt === 'string' ? systemPrompt : (priorRow.wmkf_ai_systemprompt || ''),
      wmkf_ai_promptvariables: typeof variables === 'string' ? variables : (priorRow.wmkf_ai_promptvariables || null),
      wmkf_ai_promptoutputschema: priorRow.wmkf_ai_promptoutputschema || null,
      wmkf_ai_model: priorRow.wmkf_ai_model || null,
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
      await DynamicsService.updateRecord(PROMPTS_ENTITY, priorId, { wmkf_ai_iscurrent: false }, { ifMatch: priorEtag });
    } catch (flipErr) {
      if (flipErr.status === 412) {
        // A concurrent publish flipped/changed the prior row. Our new row is now
        // an orphan (would create a 2-current state). Surface loudly.
        outcome = { status: 'concurrency_conflict', newPromptId: newId, targetVersion, orphan: { id: newId, reason: 'prior_etag_mismatch' }, warnings: ['prior_etag_mismatch'] };
        await finalizeAudit({ requestId, name, profileId, outcome, priorId });
        return res.status(409).json(outcome);
      }
      throw flipErr;
    }

    // 7. Verify exactly one current remains.
    const after = await DynamicsService.queryRecords(PROMPTS_ENTITY, {
      select: 'wmkf_ai_promptid,wmkf_promptversion',
      filter: `wmkf_ai_promptname eq '${escapeOData(name)}' and wmkf_ai_iscurrent eq true`,
      top: 3,
    });
    const currentCount = (after.records || []).length;
    const warnings = currentCount === 1 ? [] : [`invariant_violation_current_count_${currentCount}`];
    outcome = { status: currentCount === 1 ? 'completed' : 'partial', newPromptId: newId, targetVersion, warnings };
  } catch (err) {
    console.error('[admin/prompts] publish failed:', err);
    outcome = { status: 'failed', newPromptId: newId, targetVersion, warnings: [`internal_error:${err.message}`] };
  }

  await finalizeAudit({ requestId, name, profileId, outcome, priorId });
  const httpStatus = outcome.status === 'completed' ? 200 : (outcome.status === 'failed' ? 500 : 200);
  return res.status(httpStatus).json(outcome);
}

// ───────────────────────── helpers ─────────────────────────

async function flipPriorRows(rows) {
  const warnings = [];
  let allFlipped = true;
  for (const r of rows) {
    try {
      const fresh = await DynamicsService.getRecord(PROMPTS_ENTITY, r.wmkf_ai_promptid, { select: 'wmkf_ai_promptid' });
      await DynamicsService.updateRecord(PROMPTS_ENTITY, r.wmkf_ai_promptid, { wmkf_ai_iscurrent: false }, { ifMatch: fresh._etag || undefined });
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

function escapeOData(s) {
  return String(s).replace(/'/g, "''");
}
