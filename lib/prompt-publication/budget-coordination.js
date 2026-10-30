/** Offline/shared budget validation and ORIGINAL-revision publication preparation.
 * No Dataverse client, env, provider discovery, retries, or fallback writes.
 * The future SDK adapter must atomically commit budget revision + control CAS;
 * prompt publication takes this SAME control before its head. Models/settings
 * read here are trusted server snapshots, never fields accepted from clients.
 */
const { inspectJson, isObject, owns, canonicalPreimage } = require('./json-contract');
const { POLICY_ARTIFACT, resolvePinnedModel } = require('./template-policy');
const { validateActor, incrementRevision } = require('./publication-contract');
const policy = POLICY_ARTIFACT.policy;
const prepared = new WeakSet();
const CONTROL_KEY = 'prompt-library.budget-coordination';
const fail = code => { const e = new Error(code); e.code = code; throw e; };
const exact = (v, keys) => isObject(v) && Object.keys(v).length === keys.length && keys.every(k => owns(v, k));
const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const etag = v => typeof v === 'string' && /^W\/"[1-9][0-9]{0,18}"$/.exec(v)?.[0] === v;
const revision = v => typeof v === 'string' && /^(?:0|[1-9][0-9]{0,18})$/.exec(v)?.[0] === v && incrementRevision(v) !== null;
function validateBudgets(budgets) {
  const errors = [];
  try { inspectJson(budgets); } catch { return { valid: false, errors: [{ path: 'budgets', code: 'invalid_budget_json' }] }; }
  const registry = policy.budgetRegistry;
  if (!exact(budgets, Object.keys(registry.defaults))) return { valid: false, errors: [{ path: 'budgets', code: 'budget_registry_mismatch' }] };
  for (const [name, defaults] of Object.entries(registry.defaults)) {
    const value = budgets[name], path = 'budgets.*';
    if (!exact(value, Object.keys(defaults)) || value.kind !== defaults.kind) { errors.push({ path, code: 'invalid_budget_shape' }); continue; }
    for (const [k, bounds] of Object.entries(registry.limits[name])) {
      if (!integer(value[k], bounds.min, bounds.max)) errors.push({ path, code: 'budget_out_of_bounds' });
    }
    if (defaults.kind === 'retry' && typeof value.floor === 'number' && typeof value.ceiling === 'number' && value.floor > value.ceiling) errors.push({ path, code: 'inverted_budget_range' });
  }
  return { valid: errors.length === 0, errors };
}
function requiresBudgetFence(name) {
  return typeof name === 'string' && owns(policy.budgetRegistry.defaults, name)
    && policy.budgetRegistry.defaults[name].kind !== 'timeout';
}
function validateControl(control) {
  // Stored policy identity is LAST-WRITER provenance, not live activation.
  // Fresh operations use the packaged artifact; never reset the CAS on upgrade.
  if (!exact(control, ['schemaVersion', 'revision', 'etag', 'policyRevision', 'policyArtifactHash'])
      || control.schemaVersion !== 1 || !revision(control.revision) || !etag(control.etag)
      || !integer(control.policyRevision, 1, 2147483647) || typeof control.policyArtifactHash !== 'string'
      || /^[0-9a-f]{64}$/.exec(control.policyArtifactHash)?.[0] !== control.policyArtifactHash) fail('invalid_budget_control');
}
function validateBudgetState(state) {
  inspectJson(state);
  if (!exact(state, ['schemaVersion', 'currentVersion', 'latestRevision', 'budgets', 'warnings']) || state.schemaVersion !== 1
      || !integer(state.currentVersion, 0, 999999) || !integer(state.latestRevision, state.currentVersion, 999999)
      || !Array.isArray(state.warnings)) fail('invalid_budget_state');
  for (const warning of state.warnings) {
    if (!exact(warning, ['code', 'version']) || !['invalid_executor_budget_revision', 'invalid_executor_budgets'].includes(warning.code)
        || (warning.version !== null && !integer(warning.version, 1, state.latestRevision))) fail('unsupported_budget_state');
  }
  if (!validateBudgets(state.budgets).valid) fail('invalid_budget_state');
  // First use of code defaults is allowed only on a confirmed empty strict read.
  if (state.currentVersion === 0 && canonicalPreimage(state.budgets) !== canonicalPreimage(policy.budgetRegistry.defaults)) fail('invalid_budget_fallback');
}
function assertCeiling(name, model, budgets) {
  const resolved = resolvePinnedModel(model, { name });
  if (!resolved.valid) fail(resolved.code);
  if (requiredTokens(name, budgets) > resolved.capabilities.maxOutputTokens) fail('budget_model_conflict');
  if (name === 'review-panel.seat' && requiredTokens(name, budgets) > policy.budgetRegistry.secondarySeatCeiling) fail('budget_secondary_model_conflict');
  return resolved;
}
function requiredTokens(name, budgets) {
  return budgets[name].kind === 'standing' ? budgets[name].maxTokensOverride : budgets[name].ceiling;
}
function validatePromptBudget(name, model, state, control) {
  // Enforce the exemption from the code-owned registry, never caller metadata.
  if (!requiresBudgetFence(name)) return { valid: true, errors: [], budgetFence: null };
  try {
    inspectJson(control); validateControl(control); validateBudgetState(state);
    assertCeiling(name, model, state.budgets);
    return { valid: true, errors: [], budgetFence: Object.freeze({ key: CONTROL_KEY, expectedRevision: control.revision, expectedEtag: control.etag, nextRevision: incrementRevision(control.revision), budgetVersion: state.currentVersion }) };
  } catch (e) { return { valid: false, errors: [{ path: 'budgetState', code: e.code || 'invalid_budget_state' }], budgetFence: null }; }
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function copy(value) { inspectJson(value); return JSON.parse(JSON.stringify(value)); }
/** Preparation only, called AFTER the existing budget request-ID replay check.
 * Transport is server-owned. Capture control before reading budgets/models and
 * NEVER refresh that control after validation. Returned plan is deeply frozen.
 * No commit method is invoked here: transactional SDK implementation is a gate.
 */
async function prepareBudgetPublication(request, trustedActor, transport) {
  if (!validateActor(trustedActor).valid) fail('invalid_budget_actor');
  const input = copy(request);
  if (!exact(input, ['budgets', 'expectedVersion', 'requestId'])) fail('invalid_budget_request');
  if (!integer(input.expectedVersion, 0, 999998) || typeof input.requestId !== 'string'
      || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.exec(input.requestId)?.[0] !== input.requestId
      || input.requestId === '00000000-0000-0000-0000-000000000000') fail('invalid_budget_request');
  if (!validateBudgets(input.budgets).valid) fail('invalid_budgets');
  const actor = copy(trustedActor);
  const control = freeze(copy(await transport.readControl(CONTROL_KEY)));
  validateControl(control);
  const state = freeze(copy(await transport.readBudgetState()));
  validateBudgetState(state);
  if (state.latestRevision !== input.expectedVersion) fail('budget_version_conflict');
  const models = {};
  for (const name of Object.keys(policy.budgetRegistry.defaults)) {
    if (!requiresBudgetFence(name)) continue;
    const row = copy(await transport.readCurrentPrompt(name));
    if (!exact(row, ['name', 'id', 'version', 'etag', 'status', 'isCurrent', 'model']) || row.name !== name
        || !validateActor({ organizationId: row.id, initiatingUserId: row.id, effectiveUserId: row.id }).valid
        || !integer(row.version, 1, 2147483647) || !etag(row.etag)
        || row.status !== 682090001 || row.isCurrent !== true) fail('invalid_budget_prompt_snapshot');
    const resolved = assertCeiling(name, row.model, input.budgets);
    models[name] = { ...row, resolvedId: resolved.resolvedId };
  }
  const publishedAt = await transport.now();
  if (typeof publishedAt !== 'string' || !Number.isFinite(Date.parse(publishedAt)) || new Date(publishedAt).toISOString() !== publishedAt) fail('invalid_budget_timestamp');
  const plan = freeze({
    schemaVersion: 1,
    actor,
    policyRevision: policy.policyVersion,
    policyArtifactHash: POLICY_ARTIFACT.hash,
    control: { key: CONTROL_KEY, expectedRevision: control.revision, expectedEtag: control.etag, nextRevision: incrementRevision(control.revision) },
    publication: { key: policy.budgetRegistry.settingPrefix + String(input.expectedVersion + 1).padStart(6, '0'), envelope: { schemaVersion: policy.budgetRegistry.schemaVersion, version: input.expectedVersion + 1, requestId: input.requestId, publishedAt, budgets: input.budgets } },
    modelSnapshot: models,
    writeOptions: { actingUserSystemId: actor.effectiveUserId, noFallback: true },
  });
  prepared.add(plan);
  return plan;
}
function isPreparedBudgetPlan(plan) { return prepared.has(plan); }
module.exports = { CONTROL_KEY, validateBudgets, requiresBudgetFence, validatePromptBudget, prepareBudgetPublication, isPreparedBudgetPlan, validateControl };
