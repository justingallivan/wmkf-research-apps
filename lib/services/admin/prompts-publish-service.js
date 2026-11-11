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
 *   - POST create (createPrompt): a brand-new name becomes v1 directly, with
 *     placeholders declared automatically; any existing row → 409 name_exists.
 *   - Publish and create both declare `{{placeholders}}` the variables JSON
 *     lacks (declareMissingPlaceholders); existing declarations never change.
 *   - POST action=retire (retirePrompt): clear the current row's iscurrent and
 *     stamp status Retired (If-Match); refused for "application" usage.
 *   - First publish: a name with no current row copies its latest (draft) row
 *     into a new current row at max version + 1; the draft row is untouched
 *     and nothing is flipped. prior_prompt_id records the draft row.
 *
 * Contract (plan Decision 3): plain argument objects; returns the exact
 * 200-envelope objects; throws ServiceHttpError with explicit `body` for the
 * non-`{ error }` status envelopes (400 invalid_*, 404 no_current_row (no rows at all),
 * 409 concurrency_conflict, 500 duplicate_current_rows/audit_unavailable/failed).
 * ASSUMES a trusted DAL context already exists — never establishes one.
 */

import { randomUUID, createHash } from 'crypto';
import { validateSharedTaskPublication } from './prompt-profiles-service';
import { sql } from '@vercel/postgres';
import * as aiPrompt from '../../dataverse/adapters/ai-prompt';
import { validatePromptForSave, validatePromptTemplatePair } from '../../utils/prompt-validators';
import { validateReviewedClaudeModelValue } from '../model-review-validation';
import { loadAvailableModels, resolveModelWithCapabilities } from '../model-resolver';
import { assertExecutorBudgetForPromptModel } from '../executor-budget-service';
import { ServiceHttpError } from '../service-http-error';
import { carryPromptCatalog, mapPromptCatalog, PROMPT_CATALOG_COLUMNS } from './prompt-catalog-fields';
import { normalizeCatalog } from './prompts-catalog-service';
import { getPromptGroups } from './prompt-groups-service';
import { resolveAdminPromptDescription } from '../../../shared/config/adminPromptCatalog';

const MAX_BODY_LEN = 64 * 1024;
const PUBLISH_FINGERPRINT_VERSION = 2;
// wmkf_ai_promptstatus "Published" (same value the seed scripts write).
const PROMPTSTATUS_PUBLISHED = 682090001;

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
 * @param {string} [args.outputSchema]
 * @param {string} [args.model] - reviewed tier/model value for the new version
 * @param {number} [args.maxTokens] - positive integer output budget for the new
 *   version (<= the resolved model's reviewed maxOutputTokens); omitted/null keeps the prior row's value
 * @param {number} [args.expectedVersion] - current version the editor loaded
 * @param {string} [args.requestId] - payload-bound idempotency token
 * @param {*} args.profileId
 * @returns {Promise<Object>} the historical 200 envelope (completed / partial /
 *   already_published replay / resumed)
 * @throws {ServiceHttpError} with explicit body for every historical non-200 envelope
 */
export async function publishPrompt({
  name,
  body,
  systemPrompt,
  variables,
  outputSchema,
  model,
  maxTokens,
  expectedVersion,
  requestId: requestIdArg,
  profileId,
}) {
  const requestId = requestIdArg || randomUUID();

  // 1. Reject malformed bodies before any Dataverse or audit work.
  if (typeof body !== 'string' || body.length === 0 || body.length > MAX_BODY_LEN) {
    throw new ServiceHttpError(`body must be 1..${MAX_BODY_LEN} chars`, {
      httpStatus: 400,
      body: { status: 'invalid_input', error: `body must be 1..${MAX_BODY_LEN} chars` },
    });
  }
  if (outputSchema !== undefined && typeof outputSchema !== 'string') {
    throwInvalidOutputSchema('Edited output schema must be a JSON string.');
  }
  if (maxTokens != null && (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens <= 0)) {
    throwInvalidMaxTokens('Prompt max tokens must be a positive integer.');
  }
  const bodyValidation = validatePromptForSave(name, body, { maxLength: MAX_BODY_LEN });
  if (!bodyValidation.valid) {
    throw new ServiceHttpError('Prompt body failed validation.', {
      httpStatus: 400,
      body: { status: 'invalid_body', error: 'Prompt body failed validation.', issues: bodyValidation.issues },
    });
  }
  // 2. Load current row(s). The current row supplies the unchanged metadata
  // needed to fingerprint the complete version that will be created.
  const cur = await aiPrompt.queryCurrentRows(name);
  const currentRows = cur.records || [];

  // Resolve prior row + detect the structural prerequisites for a resumable
  // torn state (exactly two consecutive current versions).
  let priorRow;
  let resumeTop = null;
  // First publish (owner decision 2026-11-02, option A): a name with only
  // non-current rows publishes a NEW current row copied from its latest
  // (draft) row, at max version + 1. The draft row is never modified, so later
  // direct Dataverse edits to it do not reach the live prompt.
  let firstPublish = false;
  if (currentRows.length === 0) {
    const all = await aiPrompt.listVersions(name);
    const latest = (all.records || [])[0]; // adapter orders by version desc
    if (!latest) {
      throw new ServiceHttpError(`No prompt rows exist for "${name}".`, {
        httpStatus: 404,
        body: { status: 'no_current_row', error: `No prompt rows exist for "${name}".` },
      });
    }
    priorRow = latest;
    firstPublish = true;
  } else if (currentRows.length === 1) {
    priorRow = currentRows[0];
  } else {
    const sorted = [...currentRows].sort((a, b) => (b.wmkf_promptversion || 0) - (a.wmkf_promptversion || 0));
    const top = sorted[0];
    const consecutive = currentRows.length === 2
      && (top.wmkf_promptversion || 0) === (sorted[1].wmkf_promptversion || 0) + 1;
    if (consecutive) {
      resumeTop = top;
      priorRow = sorted[1];
    } else {
      return failDuplicateCurrent(name, currentRows);
    }
  }

  const payload = buildPublishPayload(priorRow, {
    body,
    systemPrompt,
    variables,
    outputSchema,
    model,
    maxTokens,
  });
  // Tier ceilings resolve through the live model list; a cold instance would otherwise
  // validate against the static fallback model's (lower) limit.
  await loadAvailableModels();
  validatePublishPayload(name, payload);
  await validateSharedTaskPublication({ name, payload, priorRow, expectedVersion, requestId: requestIdArg });
  const payloadHash = hashPublishPayload(payload);
  const priorId = priorRow.wmkf_ai_promptid;
  const targetVersion = (priorRow.wmkf_promptversion || 0) + 1;

  // 3. Idempotency is bound to the complete effective publish payload, not
  // merely request_id. Reusing a token after editing is a conflict.
  const priorAudit = await loadPriorAudit(requestId);
  if (priorAudit.length > 0) {
    const storedHash = priorAudit.find((row) => row.body_hash)?.body_hash;
    if (!storedHash || storedHash !== payloadHash || priorAudit.some(row => row.prompt_name !== name)) {
      throw new ServiceHttpError('Idempotency key was already used for a different publish payload.', {
        httpStatus: 409,
        body: {
          status: 'idempotency_key_reuse',
          error: 'This publish request changed after its idempotency key was first used. Retry with a new request id.',
        },
      });
    }
    const priorFinal = priorAudit.find((row) => row.phase === 'final');
    if (priorFinal) {
      return {
        status: priorFinal.status === 'completed' ? 'already_published' : priorFinal.status,
        newPromptId: priorFinal.new_prompt_id,
        targetVersion: priorFinal.target_version,
        version: priorFinal.target_version,
        idempotentReplay: true,
      };
    }
  }

  const priorPending = priorAudit.find((row) => row.phase === 'pending');
  if (!resumeTop && priorPending
      && priorPending.target_version === priorRow.wmkf_promptversion
      && hashPublishPayload(rowPublishPayload(priorRow)) === payloadHash
      && (expectedVersion === undefined || expectedVersion === null
        || expectedVersion === priorRow.wmkf_promptversion - 1)) {
    const pendingDetails = priorPending.outcome_json || {};
    const outcome = {
      status: 'completed',
      newPromptId: priorRow.wmkf_ai_promptid,
      targetVersion: priorRow.wmkf_promptversion,
      warnings: [],
      resumed: true,
      fingerprintVersion: PUBLISH_FINGERPRINT_VERSION,
      priorModel: pendingDetails.priorModel ?? null,
      newModel: payload.model,
    };
    await finalizeAudit({
      requestId,
      name,
      profileId,
      outcome,
      priorId: priorPending.prior_prompt_id || null,
      payloadHash,
    });
    return outcome;
  }

  assertExpectedVersion(expectedVersion, priorRow.wmkf_promptversion);

  // A prior attempt may have created the new current row but failed before it
  // flipped the old row down. Resume only when every persisted content field
  // matches this payload, not just the body text.
  if (resumeTop) {
    if (hashPublishPayload(rowPublishPayload(resumeTop)) !== payloadHash) {
      return failDuplicateCurrent(name, currentRows);
    }
    await writePendingAudit({ requestId, name, targetVersion, priorId, payloadHash, profileId, priorModel: priorRow.wmkf_ai_model || null, newModel: payload.model });
    const flipResult = await flipPriorRows([priorRow]);
    const outcome = withAuditDetails({
      status: flipResult.allFlipped ? 'completed' : 'partial',
      newPromptId: resumeTop.wmkf_ai_promptid,
      targetVersion,
      warnings: flipResult.warnings,
      resumed: true,
    }, priorRow, payload);
    await finalizeAudit({ requestId, name, profileId, outcome, priorId, payloadHash });
    return outcome;
  }

  // Governed Executor budgets and prompt models form one safety contract. Run
  // this only for a fresh mutation: resumable torn-state repair must not be
  // blocked by an unrelated settings outage after its row already exists.
  await assertExecutorBudgetForPromptModel(name, payload.model);

  // 4. Pending audit (hard-abort on failure).
  try {
    await writePendingAudit({ requestId, name, targetVersion, priorId, payloadHash, profileId, priorModel: priorRow.wmkf_ai_model || null, newModel: payload.model });
  } catch (err) {
    console.error('[admin/prompts] pending audit write failed:', err);
    throw new ServiceHttpError('Audit table unavailable; refused to perform privileged mutation.', {
      httpStatus: 500,
      body: { status: 'audit_unavailable', error: 'Audit table unavailable; refused to perform privileged mutation.' },
    });
  }

  // Fresh ETag for the flip (don't trust a stale client copy). A first publish
  // has no current row to flip down.
  let priorEtag = null;
  if (!firstPublish) {
    const priorFresh = await aiPrompt.getIdOnly(priorId);
    priorEtag = priorFresh._etag || null;
  }

  // 5. Create the new version row — clone the prior row's Executor metadata,
  //    apply the edited body (+ optional systemPrompt/variables).
  let newId = null;
  let outcome;
  try {
    const created = await aiPrompt.create({
      wmkf_ai_promptname: name,
      wmkf_ai_promptbody: payload.body,
      wmkf_ai_systemprompt: payload.systemPrompt,
      wmkf_ai_promptvariables: payload.variables,
      wmkf_ai_promptoutputschema: payload.outputSchema,
      wmkf_ai_model: payload.model,
      wmkf_ai_temperature: payload.temperature,
      wmkf_ai_maxtokens: payload.maxTokens,
      // A draft's own status (if any) does not describe the live row. Runtime
      // readers select by iscurrent, so status is display-only.
      wmkf_ai_promptstatus: firstPublish ? PROMPTSTATUS_PUBLISHED : (priorRow.wmkf_ai_promptstatus ?? null),
      // Catalog labels describe the prompt, not this version: carry them forward.
      // Not part of the publish fingerprint, so idempotency/resume are unchanged.
      ...carryPromptCatalog(priorRow),
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

    // 6. Flip the prior row down with If-Match (concurrency guard). A first
    // publish has nothing to flip; two simultaneous first publishes are caught
    // only by the step-7 count (status 'partial', accepted gap).
    try {
      if (!firstPublish) await aiPrompt.setIsCurrent(priorId, false, { ifMatch: priorEtag });
    } catch (flipErr) {
      if (flipErr.status === 412) {
        // A concurrent publish flipped/changed the prior row. Our new row is now
        // an orphan (would create a 2-current state). Surface loudly.
        outcome = withAuditDetails({ status: 'concurrency_conflict', newPromptId: newId, targetVersion, orphan: { id: newId, reason: 'prior_etag_mismatch' }, warnings: ['prior_etag_mismatch'] }, priorRow, payload);
        await finalizeAudit({ requestId, name, profileId, outcome, priorId, payloadHash });
        throw new ServiceHttpError('prior_etag_mismatch', { httpStatus: 409, body: outcome });
      }
      throw flipErr;
    }

    // 7. Verify exactly one current remains.
    const after = await aiPrompt.queryCurrentIdVersions(name);
    const currentCount = (after.records || []).length;
    const warnings = currentCount === 1 ? [] : [`invariant_violation_current_count_${currentCount}`];
    outcome = withAuditDetails({ status: currentCount === 1 ? 'completed' : 'partial', newPromptId: newId, targetVersion, warnings }, priorRow, payload);
  } catch (err) {
    // Typed-error passthrough (P1m note 4): the 409 above already finalized
    // its audit; rethrow before the generic failed-outcome wrapper.
    if (err instanceof ServiceHttpError) throw err;
    console.error('[admin/prompts] publish failed:', err);
    outcome = withAuditDetails({ status: 'failed', newPromptId: newId, targetVersion, warnings: [`internal_error:${err.message}`] }, priorRow, payload);
  }

  await finalizeAudit({ requestId, name, profileId, outcome, priorId, payloadHash });
  if (outcome.status === 'failed') {
    throw new ServiceHttpError('publish failed', { httpStatus: 500, body: outcome });
  }
  return outcome;
}

// ───────────────────────── POST (create) ─────────────────────────

// Lowercase letters/digits, dot- or hyphen-separated (e.g. `grants.budget-check`).
const PROMPT_NAME_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
// [ASSUMED] The wmkf_ai_promptname column length is unverified; 64 is well
// above every existing name, so a longer column limit only makes this strict.
const MAX_NAME_LEN = 64;

/**
 * Create a brand-new prompt and publish it as v1 (owner decision 2026-11-02:
 * no draft step; a new name is not read by any app until code connects it).
 * Placeholders are declared automatically. Refuses any name that already has a
 * row (drafts included). Same validation, payload-bound idempotency, pending
 * audit hard-abort and exactly-one-current verification as publish.
 *
 * @param {Object} args
 * @param {string} args.name
 * @param {Object} args.catalog - title (required), description, group, section, usedBy, usage
 * @param {string} args.body
 * @param {string} [args.systemPrompt]
 * @param {string} [args.outputSchema]
 * @param {string} [args.model]
 * @param {number} [args.maxTokens]
 * @param {string} [args.requestId]
 * @param {*} args.profileId
 * @returns {Promise<Object>} completed / partial / already_published replay / resumed
 * @throws {ServiceHttpError} 400 invalid_*, 409 name_exists / idempotency_key_reuse, 500 audit_unavailable / failed
 */
export async function createPrompt({
  name,
  catalog,
  body,
  systemPrompt,
  variables,
  outputSchema,
  model,
  maxTokens,
  requestId: requestIdArg,
  profileId,
}) {
  const requestId = requestIdArg || randomUUID();
  if (typeof name !== 'string' || name.length > MAX_NAME_LEN || !PROMPT_NAME_RE.test(name)) {
    const error = `Name must be lowercase letters and digits separated by dots or hyphens (for example grants.budget-check), at most ${MAX_NAME_LEN} characters.`;
    throw new ServiceHttpError(error, { httpStatus: 400, body: { status: 'invalid_name', error } });
  }
  const cat = normalizeCatalog({ usage: 'unconnected', ...(catalog || {}) }, (await getPromptGroups()).groups);
  if (!cat.title) {
    throw new ServiceHttpError('Title is required.', { httpStatus: 400, body: { status: 'invalid_catalog', error: 'Title is required.' } });
  }
  if (typeof body !== 'string' || body.length === 0 || body.length > MAX_BODY_LEN) {
    throw new ServiceHttpError(`body must be 1..${MAX_BODY_LEN} chars`, {
      httpStatus: 400,
      body: { status: 'invalid_input', error: `body must be 1..${MAX_BODY_LEN} chars` },
    });
  }
  if (systemPrompt !== undefined && systemPrompt !== null && typeof systemPrompt !== 'string') {
    throw new ServiceHttpError('System prompt must be text.', { httpStatus: 400, body: { status: 'invalid_input', error: 'System prompt must be text.' } });
  }
  if (outputSchema !== undefined && outputSchema !== null && typeof outputSchema !== 'string') {
    throwInvalidOutputSchema('Output schema must be a JSON string.');
  }
  if (maxTokens != null && (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens <= 0)) {
    throwInvalidMaxTokens('Prompt max tokens must be a positive integer.');
  }

  const payload = {
    body,
    systemPrompt: systemPrompt || '',
    variables: declareMissingPlaceholders(variables ?? null, systemPrompt || '', body),
    outputSchema: outputSchema || null,
    model: model || null,
    temperature: null,
    maxTokens: maxTokens ?? null,
  };
  await loadAvailableModels();
  validatePublishPayload(name, payload);
  await validateSharedTaskPublication({ name, payload, requestId: requestIdArg, creating: true });
  const payloadHash = hashPublishPayload(payload);

  // Replay before the name check: after a successful create the name exists.
  const priorAudit = await loadPriorAudit(requestId);
  if (priorAudit.length > 0) {
    const storedHash = priorAudit.find((row) => row.body_hash)?.body_hash;
    if (!storedHash || storedHash !== payloadHash || priorAudit.some((row) => row.prompt_name !== name)) {
      throw new ServiceHttpError('Idempotency key was already used for a different request.', {
        httpStatus: 409,
        body: { status: 'idempotency_key_reuse', error: 'This request changed after it was first sent. Retry with a new request id.' },
      });
    }
    const priorFinal = priorAudit.find((row) => row.phase === 'final');
    if (priorFinal) {
      return {
        status: priorFinal.status === 'completed' ? 'already_published' : priorFinal.status,
        newPromptId: priorFinal.new_prompt_id,
        targetVersion: priorFinal.target_version,
        version: priorFinal.target_version,
        idempotentReplay: true,
      };
    }
  }

  const existing = (await aiPrompt.listVersions(name)).records || [];
  if (existing.length > 0) {
    // This request's pending audit plus a sole current v1 with the same content
    // means an earlier attempt created the row but lost its final audit.
    const only = existing.length === 1 ? existing[0] : null;
    if (only && only.wmkf_ai_iscurrent && only.wmkf_promptversion === 1
        && priorAudit.some((row) => row.phase === 'pending')
        && hashPublishPayload(rowPublishPayload(only)) === payloadHash) {
      const outcome = createOutcome('completed', only.wmkf_ai_promptid, [], payload);
      outcome.resumed = true;
      await finalizeAudit({ requestId, name, profileId, outcome, priorId: null, payloadHash });
      return outcome;
    }
    const error = `A prompt named "${name}" already exists. Use Edit & publish to change it.`;
    throw new ServiceHttpError(error, { httpStatus: 409, body: { status: 'name_exists', error } });
  }

  await assertExecutorBudgetForPromptModel(name, payload.model);

  try {
    await writePendingAudit({ requestId, name, targetVersion: 1, priorId: null, payloadHash, profileId, priorModel: null, newModel: payload.model });
  } catch (err) {
    console.error('[admin/prompts] pending audit write failed:', err);
    throw new ServiceHttpError('Audit table unavailable; refused to perform privileged mutation.', {
      httpStatus: 500,
      body: { status: 'audit_unavailable', error: 'Audit table unavailable; refused to perform privileged mutation.' },
    });
  }

  let newId = null;
  let outcome;
  try {
    const created = await aiPrompt.create({
      wmkf_ai_promptname: name,
      wmkf_ai_promptbody: payload.body,
      wmkf_ai_systemprompt: payload.systemPrompt,
      wmkf_ai_promptvariables: payload.variables,
      wmkf_ai_promptoutputschema: payload.outputSchema,
      wmkf_ai_model: payload.model,
      wmkf_ai_temperature: payload.temperature,
      wmkf_ai_maxtokens: payload.maxTokens,
      wmkf_ai_promptstatus: PROMPTSTATUS_PUBLISHED,
      ...Object.fromEntries(Object.entries(PROMPT_CATALOG_COLUMNS).map(([key, column]) => [column, cat[key]])),
      wmkf_ai_iscurrent: true,
      wmkf_promptversion: 1,
      wmkf_ai_publisheddatetime: new Date().toISOString(),
    });
    newId = created.wmkf_ai_promptid;
    // Two simultaneous creates of one name both pass the existence check; the
    // count reports that afterwards as 'partial' (accepted gap, superuser-only).
    const after = await aiPrompt.queryCurrentIdVersions(name);
    const currentCount = (after.records || []).length;
    outcome = createOutcome(
      currentCount === 1 ? 'completed' : 'partial',
      newId,
      currentCount === 1 ? [] : [`invariant_violation_current_count_${currentCount}`],
      payload,
    );
  } catch (err) {
    console.error('[admin/prompts] create failed:', err);
    outcome = createOutcome('failed', newId, [`internal_error:${err.message}`], payload);
  }

  await finalizeAudit({ requestId, name, profileId, outcome, priorId: null, payloadHash });
  if (outcome.status === 'failed') {
    throw new ServiceHttpError('create failed', { httpStatus: 500, body: outcome });
  }
  return outcome;
}

function createOutcome(status, newPromptId, warnings, payload) {
  return {
    status,
    kind: 'create',
    newPromptId,
    targetVersion: 1,
    warnings,
    fingerprintVersion: PUBLISH_FINGERPRINT_VERSION,
    priorModel: null,
    newModel: payload.model,
  };
}

// ───────────────────────── POST action=retire ─────────────────────────

/**
 * Retire a prompt (owner decision 2026-11-02): clear the current row's
 * `iscurrent` and stamp status Retired in one If-Match write. Nothing is
 * deleted; the prompt shows as retired in Admin and can be brought back with
 * first publish (Review & publish), which creates a new current version.
 * Refused for prompts whose resolved usage is "application" (owner decision:
 * block, not confirm). Same expected-version check, request-id idempotency
 * (lost-final-audit recovery) and pending-audit hard-abort as publish.
 *
 * @param {{ name: string, expectedVersion?: number, requestId?: string, profileId: * }} args
 * @returns {Promise<Object>} completed / already_published replay / resumed
 * @throws {ServiceHttpError} 404 no_current_row, 409 retire_blocked_application /
 *   concurrency_conflict / idempotency_key_reuse, 500 duplicate_current_rows /
 *   audit_unavailable / failed
 */
export async function retirePrompt({ name, expectedVersion, requestId: requestIdArg, profileId }) {
  const requestId = requestIdArg || randomUUID();
  const priorAudit = await loadPriorAudit(requestId);
  const priorFinal = priorAudit.find((row) => row.phase === 'final');
  if (priorAudit.length > 0 && priorAudit.some((row) => row.prompt_name !== name || row.outcome_json?.kind !== 'retire')) {
    throw new ServiceHttpError('Idempotency key was already used for a different request.', {
      httpStatus: 409,
      body: { status: 'idempotency_key_reuse', error: 'This request id was already used for something else. Retry with a new request id.' },
    });
  }
  if (priorFinal) {
    return { status: priorFinal.status === 'completed' ? 'already_published' : priorFinal.status, kind: 'retire', targetVersion: priorFinal.target_version, idempotentReplay: true };
  }

  const currentRows = (await aiPrompt.queryCurrentRows(name)).records || [];
  const priorPending = priorAudit.find((row) => row.phase === 'pending');
  if (currentRows.length === 0) {
    // This request's pending audit and no current row: an earlier attempt
    // retired the row but lost its final audit. Finish it.
    if (priorPending) {
      const outcome = retireOutcome('completed', priorPending.target_version, []);
      outcome.resumed = true;
      await finalizeAudit({ requestId, name, profileId, outcome, priorId: priorPending.prior_prompt_id, payloadHash: priorPending.body_hash });
      return outcome;
    }
    const error = `"${name}" has no published version to retire.`;
    throw new ServiceHttpError(error, { httpStatus: 404, body: { status: 'no_current_row', error } });
  }
  if (currentRows.length > 1) return failDuplicateCurrent(name, currentRows);
  const row = currentRows[0];
  assertExpectedVersion(expectedVersion, row.wmkf_promptversion);

  const usage = resolveAdminPromptDescription({ name, catalog: mapPromptCatalog(row) }).usage;
  if (usage === 'application') {
    const error = 'This prompt is marked "Application caller". An app may depend on it, so it can\'t be retired here.';
    throw new ServiceHttpError(error, { httpStatus: 409, body: { status: 'retire_blocked_application', error } });
  }

  const payloadHash = createHash('sha256').update(JSON.stringify({ kind: 'retire', name, rowId: row.wmkf_ai_promptid, version: row.wmkf_promptversion })).digest('hex');
  try {
    await sql`
      INSERT INTO prompt_publish_audit
        (request_id, prompt_name, target_version, prior_prompt_id, body_hash, profile_id, phase, status, outcome_json)
      VALUES
        (${requestId}, ${name}, ${row.wmkf_promptversion ?? null}, ${row.wmkf_ai_promptid}, ${payloadHash}, ${profileId || null}, 'pending', 'pending',
         ${JSON.stringify({ kind: 'retire' })}::jsonb)
      ON CONFLICT (request_id, phase) DO NOTHING`;
  } catch (err) {
    console.error('[admin/prompts] pending audit write failed:', err);
    throw new ServiceHttpError('Audit table unavailable; refused to perform privileged mutation.', {
      httpStatus: 500,
      body: { status: 'audit_unavailable', error: 'Audit table unavailable; refused to perform privileged mutation.' },
    });
  }

  let outcome;
  try {
    const fresh = await aiPrompt.getIdOnly(row.wmkf_ai_promptid);
    if (!fresh._etag) throw new Error('row ETag unavailable; refused an unconditional write');
    await aiPrompt.retire(row.wmkf_ai_promptid, { ifMatch: fresh._etag });
    const after = await aiPrompt.queryCurrentIdVersions(name);
    const currentCount = (after.records || []).length;
    outcome = retireOutcome(currentCount === 0 ? 'completed' : 'partial', row.wmkf_promptversion, currentCount === 0 ? [] : [`invariant_violation_current_count_${currentCount}`]);
  } catch (err) {
    if (err.status === 412) {
      outcome = retireOutcome('concurrency_conflict', row.wmkf_promptversion, ['prior_etag_mismatch']);
      await finalizeAudit({ requestId, name, profileId, outcome, priorId: row.wmkf_ai_promptid, payloadHash });
      throw new ServiceHttpError('prior_etag_mismatch', { httpStatus: 409, body: outcome });
    }
    console.error('[admin/prompts] retire failed:', err);
    outcome = retireOutcome('failed', row.wmkf_promptversion, [`internal_error:${err.message}`]);
  }
  await finalizeAudit({ requestId, name, profileId, outcome, priorId: row.wmkf_ai_promptid, payloadHash });
  if (outcome.status === 'failed') throw new ServiceHttpError('retire failed', { httpStatus: 500, body: outcome });
  return outcome;
}

function retireOutcome(status, targetVersion, warnings) {
  return { status, kind: 'retire', targetVersion: targetVersion ?? null, warnings };
}

// ───────────────────────── helpers ─────────────────────────

function buildPublishPayload(priorRow, {
  body,
  systemPrompt,
  variables,
  outputSchema,
  model,
  maxTokens,
}) {
  const effectiveSystemPrompt = typeof systemPrompt === 'string' ? systemPrompt : (priorRow.wmkf_ai_systemprompt || '');
  return {
    body,
    systemPrompt: effectiveSystemPrompt,
    // Owner decision 2026-11-02: placeholders added in an edit are declared
    // automatically; existing declarations are never changed or removed.
    variables: declareMissingPlaceholders(
      typeof variables === 'string' ? variables : (priorRow.wmkf_ai_promptvariables || null),
      effectiveSystemPrompt,
      body,
    ),
    outputSchema: typeof outputSchema === 'string'
      ? outputSchema
      : (priorRow.wmkf_ai_promptoutputschema || null),
    model: model !== undefined ? model : (priorRow.wmkf_ai_model || null),
    temperature: priorRow.wmkf_ai_temperature ?? null,
    maxTokens: maxTokens != null ? maxTokens : (priorRow.wmkf_ai_maxtokens ?? null),
  };
}

const PLACEHOLDER_RE = /\{\{\s*(\w+)\s*\}\}/g; // same pattern as lib/utils/prompt-validators.js

/**
 * Append a declaration for every `{{name}}` in the system prompt or body that
 * the variables JSON does not declare yet. A new declaration is
 * `{ name, source: { kind: 'override' }, required: true }`: the caller must
 * pass the value (the Executor throws on a variable with no source kind,
 * execute-prompt.js resolveOne). Returns the input string unchanged when
 * nothing is missing, or when it is not a parseable `{ variables: [...] }`
 * object (validation reports that), so fingerprints of unchanged rows stay
 * stable.
 */
export function declareMissingPlaceholders(variablesJson, systemPrompt, body) {
  const used = [...new Set([...`${systemPrompt || ''}\n${body || ''}`.matchAll(PLACEHOLDER_RE)].map((m) => m[1]))];
  if (used.length === 0) return variablesJson;
  let spec;
  if (variablesJson === null || variablesJson === undefined || variablesJson === '') {
    spec = { variables: [] };
  } else {
    try {
      spec = JSON.parse(variablesJson);
    } catch {
      return variablesJson;
    }
    if (!spec || typeof spec !== 'object' || Array.isArray(spec) || !Array.isArray(spec.variables)) return variablesJson;
  }
  // Shared tasks declare frozen inputs explicitly; never invent override sources.
  if (Object.hasOwn(spec, 'execution')) return variablesJson;
  const declared = new Set(spec.variables.map((item) => item?.name));
  const missing = used.filter((name) => !declared.has(name));
  if (missing.length === 0) return variablesJson;
  return JSON.stringify({
    ...spec,
    variables: [...spec.variables, ...missing.map((name) => ({ name, source: { kind: 'override' }, required: true }))],
  }, null, 2);
}

function rowPublishPayload(row) {
  return {
    body: row.wmkf_ai_promptbody || '',
    systemPrompt: row.wmkf_ai_systemprompt || '',
    variables: row.wmkf_ai_promptvariables || null,
    outputSchema: row.wmkf_ai_promptoutputschema || null,
    model: row.wmkf_ai_model || null,
    temperature: row.wmkf_ai_temperature ?? null,
    maxTokens: row.wmkf_ai_maxtokens ?? null,
  };
}

function hashPublishPayload(payload) {
  return createHash('sha256').update(JSON.stringify({
    fingerprintVersion: PUBLISH_FINGERPRINT_VERSION,
    body: payload.body,
    systemPrompt: payload.systemPrompt,
    variables: payload.variables,
    outputSchema: payload.outputSchema,
    model: payload.model,
    temperature: payload.temperature,
    maxTokens: payload.maxTokens,
  })).digest('hex');
}

function parseJsonField(value, label, { allowNull = false } = {}) {
  if ((value === null || value === '') && allowNull) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('must be an object');
    return parsed;
  } catch (err) {
    throw new ServiceHttpError(`${label} is invalid JSON: ${err.message}`, {
      httpStatus: 400,
      body: { status: `invalid_${label}`, error: `${label} is invalid JSON: ${err.message}` },
    });
  }
}

function validatePublishPayload(name, payload) {
  const variableSpec = parseJsonField(payload.variables, 'variables', { allowNull: true });
  if (variableSpec && !Array.isArray(variableSpec.variables)) {
    throwInvalidVariables('Prompt variables JSON must contain a variables array.');
  }
  const variableItems = variableSpec?.variables || [];
  if (variableItems.some((item) => !item || typeof item.name !== 'string' || !/^\w+$/.test(item.name))) {
    throwInvalidVariables('Every prompt variable must have a non-empty word-character name.');
  }
  const declaredVars = variableItems.map((item) => item.name);
  if (new Set(declaredVars).size !== declaredVars.length) {
    throwInvalidVariables('Prompt variable names must be unique.');
  }
  const validation = validatePromptTemplatePair(name, {
    systemPrompt: payload.systemPrompt,
    body: payload.body,
    // Prepared document context is composed before the task, never interpolated.
    // The complete marked schema is independently checked before any mutation.
    declaredVars: variableSpec?.execution
      ? variableItems.filter(item => item.source?.kind !== 'prepared_context').map(item => item.name)
      : declaredVars,
  }, { maxLength: MAX_BODY_LEN });
  if (!validation.valid) {
    throw new ServiceHttpError('Prompt template failed validation.', {
      httpStatus: 400,
      body: { status: 'invalid_body', error: 'Prompt template failed validation.', issues: validation.issues },
    });
  }

  const outputSchema = parseJsonField(payload.outputSchema, 'output_schema', { allowNull: true });
  if (outputSchema?.generationMode != null && outputSchema.generationMode !== 'native-json-schema') {
    throwInvalidOutputSchema(`Unsupported generationMode "${outputSchema.generationMode}".`);
  }
  const nativeStructured = outputSchema?.generationMode === 'native-json-schema';
  if (nativeStructured && (outputSchema.parseMode !== 'json'
      || !outputSchema.jsonSchema
      || typeof outputSchema.jsonSchema !== 'object'
      || Array.isArray(outputSchema.jsonSchema))) {
    throwInvalidOutputSchema('generationMode=native-json-schema requires parseMode=json and an object jsonSchema.');
  }
  if (outputSchema && (!Array.isArray(outputSchema.outputs) || outputSchema.outputs.length === 0)) {
    throwInvalidOutputSchema('Output schema must declare at least one output.');
  }
  if (payload.maxTokens != null && (!Number.isInteger(Number(payload.maxTokens)) || Number(payload.maxTokens) <= 0)) {
    throwInvalidMaxTokens('Prompt max tokens must be a positive integer.');
  }
  const modelValidation = validateReviewedClaudeModelValue(payload.model, { allowEmpty: !nativeStructured });
  if (!modelValidation.valid) throwInvalidModel(modelValidation);
  if (nativeStructured && modelValidation.kind !== 'claude') {
    throwInvalidModel({
      code: 'structured_output_requires_concrete_model',
      error: 'Native structured-output prompts require a reviewed concrete Claude model id; tiers and blank fallback are not allowed.',
    });
  }
  if (nativeStructured && modelValidation.capabilities.supportsStructuredOutput !== true) {
    throwInvalidModel({
      code: 'structured_output_unsupported',
      error: `Model "${modelValidation.value}" is reviewed but does not support native structured output.`,
    });
  }
  // Runtime (execute-prompt resolveMaxTokensForCall) throws when a row budget
  // exceeds the resolved model's reviewed ceiling, so refuse it at publish time
  // for every prompt: tiers resolve to their current concrete model, a blank
  // model (Executor fallback) has no knowable ceiling and is skipped.
  const ceilingModel = modelValidation.kind === 'tier'
    ? resolveModelWithCapabilities(modelValidation.value)
    : { resolvedId: modelValidation.value, capabilities: modelValidation.capabilities };
  const maxOutputTokens = ceilingModel.capabilities?.maxOutputTokens;
  if (payload.maxTokens != null && Number.isInteger(maxOutputTokens)
      && Number(payload.maxTokens) > maxOutputTokens) {
    throwInvalidModel({
      code: 'model_output_limit_exceeded',
      error: `Prompt max tokens (${payload.maxTokens}) exceed model "${ceilingModel.resolvedId}" output limit (${maxOutputTokens}).`,
    });
  }
  payload.model = modelValidation.value;
}

function throwInvalidVariables(error) {
  throw new ServiceHttpError(error, {
    httpStatus: 400,
    body: { status: 'invalid_variables', error },
  });
}

function throwInvalidOutputSchema(error) {
  throw new ServiceHttpError(error, {
    httpStatus: 400,
    body: { status: 'invalid_output_schema', error },
  });
}

function throwInvalidMaxTokens(error) {
  throw new ServiceHttpError(error, {
    httpStatus: 400,
    body: { status: 'invalid_max_tokens', error },
  });
}

function throwInvalidModel(validation) {
  throw new ServiceHttpError(validation.error, {
    httpStatus: 400,
    body: { status: 'invalid_model', code: validation.code, error: validation.error },
  });
}

function assertExpectedVersion(expectedVersion, actualVersion) {
  if (expectedVersion === undefined || expectedVersion === null) return;
  if (!Number.isInteger(expectedVersion) || expectedVersion !== actualVersion) {
    throw new ServiceHttpError('The current prompt version changed after this editor loaded.', {
      httpStatus: 409,
      body: {
        status: 'concurrency_conflict',
        error: 'The current prompt version changed after this editor loaded. Reload before publishing.',
        expectedVersion,
        actualVersion,
      },
    });
  }
}

async function loadPriorAudit(requestId) {
  const result = await sql`
    SELECT phase, status, prompt_name, new_prompt_id, prior_prompt_id, target_version, body_hash, outcome_json
    FROM prompt_publish_audit
    WHERE request_id = ${requestId}
    ORDER BY CASE WHEN phase = 'final' THEN 0 ELSE 1 END`;
  return result.rows || [];
}

async function failDuplicateCurrent(name, currentRows) {
  const ids = currentRows.map((row) => row.wmkf_ai_promptid);
  await alertDuplicateCurrent(name, ids);
  throw new ServiceHttpError(`Multiple current rows for "${name}" — prompt store corruption; resolve in Dynamics.`, {
    httpStatus: 500,
    body: { status: 'duplicate_current_rows', error: `Multiple current rows for "${name}" — prompt store corruption; resolve in Dynamics.`, ids },
  });
}

function withAuditDetails(outcome, priorRow, payload) {
  return {
    ...outcome,
    fingerprintVersion: PUBLISH_FINGERPRINT_VERSION,
    priorModel: priorRow.wmkf_ai_model || null,
    newModel: payload.model,
    // First publish: prior_prompt_id records the source draft row (lineage),
    // not a row that was flipped down.
    ...(priorRow.wmkf_ai_iscurrent ? {} : { firstPublish: true }),
  };
}

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

async function writePendingAudit({ requestId, name, targetVersion, priorId, payloadHash, profileId, priorModel, newModel }) {
  await sql`
    INSERT INTO prompt_publish_audit
      (request_id, prompt_name, target_version, prior_prompt_id, body_hash, profile_id, phase, status, outcome_json)
    VALUES
      (${requestId}, ${name}, ${targetVersion}, ${priorId || null}, ${payloadHash}, ${profileId || null}, 'pending', 'pending',
       ${JSON.stringify({ fingerprintVersion: PUBLISH_FINGERPRINT_VERSION, priorModel, newModel })}::jsonb)
    ON CONFLICT (request_id, phase) DO NOTHING`;
}

async function finalizeAudit({ requestId, name, profileId, outcome, priorId, payloadHash }) {
  try {
    await sql`
      INSERT INTO prompt_publish_audit
        (request_id, prompt_name, target_version, new_prompt_id, prior_prompt_id,
         body_hash, profile_id, phase, status, outcome_json, warnings_json)
      VALUES
        (${requestId}, ${name}, ${outcome.targetVersion || null}, ${outcome.newPromptId || null},
         ${priorId || null}, ${payloadHash}, ${profileId || null}, 'final', ${outcome.status},
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
    catalog: mapPromptCatalog(r),
  };
}
