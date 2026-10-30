/** @jest-environment node */
const { POLICY_ARTIFACT } = require('../../lib/prompt-publication/template-policy');
const { validateDefinition } = require('../../lib/prompt-publication/definition-schema');
const { validateFreshPublication, hashSnapshot } = require('../../lib/prompt-publication/fingerprint');
const { validateBudgets, validatePromptBudget, requiresBudgetFence, prepareBudgetPublication, CONTROL_KEY } = require('../../lib/prompt-publication/budget-coordination');
const { extractConsumerContracts, extractBudgetRegistry } = require('../../scripts/prompt-publication-source-contracts.cjs');
const policy = POLICY_ARTIFACT.policy;
const clone = v => JSON.parse(JSON.stringify(v));
const id = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const actor = { organizationId: id(1), initiatingUserId: id(2), effectiveUserId: id(3) };
const control = () => ({ schemaVersion: 1, revision: '0', etag: 'W/"1"', policyRevision: policy.policyVersion, policyArtifactHash: POLICY_ARTIFACT.hash });
const state = () => ({ schemaVersion: 1, currentVersion: 1, latestRevision: 1, budgets: clone(policy.budgetRegistry.defaults), warnings: [] });
const codes = r => r.errors.map(e => e.code);
function definition(name) {
  const c = policy.consumerContracts[name], spec = JSON.parse(c.outputJson);
  return { name, systemPrompt: c.systemIncludes.join('\n'), body: c.body || JSON.parse(c.variablesJson).variables.map(v => '{{'+v.name+'}}').join('\n'), variables: c.variablesJson, outputSchema: c.outputJson, model: spec.generationMode === 'native-json-schema' ? 'claude-sonnet-5' : 'sonnet', temperature: null, maxTokens: 8000 };
}
const modify = (d, field, change) => { const value = JSON.parse(d[field]); change(value); return { ...d, [field]: JSON.stringify(value) }; };
function transport(currentControl = control(), currentState = state(), models = {}) {
  const events = [];
  return {
    events,
    readControl: jest.fn(async key => { events.push('control'); expect(key).toBe(CONTROL_KEY); return currentControl; }),
    readBudgetState: jest.fn(async () => { events.push('budgets'); return currentState; }),
    readCurrentPrompt: jest.fn(async name => { events.push(name); return { name, id: id(9), etag: 'W/"5"', version: 1, isCurrent: true, status: 682090001, model: models[name] || 'sonnet' }; }),
    now: jest.fn(async () => '2026-10-30T00:00:00.000Z'),
  };
}
function requestFor(d) {
  const catalog = { title: 'Title', description: '', groupKey: 'reviews', sectionKey: null, usedBy: '', usageCategory: 'application' };
  const snapshot = { definitionFormatVersion: 1, definition: d, catalog };
  const current = { id: id(10), etag: 'W/"2"', version: 1 };
  return { snapshot, request: { contractVersion: 1, definitionFormatVersion: 1, policyRevision: policy.policyVersion, policyArtifactHash: POLICY_ARTIFACT.hash, requestId: id(4), operation: 'publish', promptKey: d.name, draftId: id(11), draftEtag: 'W/"3"', expectedHeadRevision: '0', expectedCurrent: current, metadataBaseline: { schemaVersion: 1, current: { id: current.id, etag: current.etag }, catalog, headRevision: '0' }, snapshotHash: hashSnapshot(snapshot).hash } };
}

describe('source-derived named consumer checks', () => {
  test('artifact exactly matches audited source requirements and registry', () => {
    expect(policy.consumerContracts).toEqual(extractConsumerContracts());
    const registry = extractBudgetRegistry();
    expect(policy.budgetRegistry.defaults).toEqual(registry.defaults);
    expect(policy.budgetRegistry.limits).toEqual(registry.limits);
    expect(policy.budgetRegistry.secondarySeatCeiling).toBeGreaterThanOrEqual(policy.budgetRegistry.limits['review-panel.seat'].maxTokensOverride.max);
  });
  test.each(Object.keys(policy.consumerContracts))('%s accepts only the reviewed shape or its explicit hold', name => {
    const c = policy.consumerContracts[name], result = validateDefinition(definition(name));
    if (c.blockedReason) expect(codes(result)).toContain(c.blockedReason);
    else expect(result).toEqual({ valid: true, errors: [] });
  });
  test.each(Object.keys(policy.consumerContracts))('%s cannot drop A7/input/output contracts', name => {
    const d = definition(name);
    expect(codes(validateDefinition(modify(d, 'variables', s => { s.variables[0].untrusted = false; })))).toContain('consumer_memo_mismatch');
    expect(codes(validateDefinition(modify(d, 'variables', s => { s.variables[0].source = { kind: 'dynamics', field: 'name' }; })))).toContain('consumer_memo_mismatch');
    expect(codes(validateDefinition(modify(d, 'outputSchema', s => { s.outputs[0].target = { kind: 'akoya_request', field: 'name' }; })))).toContain('consumer_memo_mismatch');
    expect(codes(validateDefinition({ ...d, outputSchema: null }))).toContain('consumer_memo_mismatch');
  });
  test('source property order preserved where current Pre-Site reader requires it', () => {
    const d = definition('pre-site-visit.proposal-core.generate');
    const parsed = JSON.parse(d.variables);
    const vars = parsed.variables.map(v => Object.fromEntries(Object.entries(v).reverse()));
    expect(codes(validateDefinition({ ...d, variables: JSON.stringify({ variables: vars }) }))).toContain('consumer_memo_mismatch');
    expect(codes(validateDefinition({ ...d, body: '{{request_context_json}} {{proposal_text}}' }))).toContain('consumer_body_mismatch');
    expect(codes(validateDefinition({ ...d, systemPrompt: '' }))).toContain('consumer_system_assertion_missing');
  });
  test('structural consumer memos ignore harmless key order while preserving exact values', () => {
    const d = definition('review-panel.seat');
    const spec = JSON.parse(d.variables);
    expect(validateDefinition({ ...d, variables: JSON.stringify({ variables: spec.variables.map(v => Object.fromEntries(Object.entries(v).reverse())) }) }).valid).toBe(true);
    expect(codes(validateDefinition({ ...d, maxTokens: 16001 }))).toContain('consumer_row_token_limit');
  });
  test('whole-root pass-through output labels are preserved without requiring a wrapper', () => {
    for (const name of ['review-panel.chair','cycle-dossier.entry','cycle-dossier.research-plan']) expect(validateDefinition(definition(name)).valid).toBe(true);
    const generic = { ...definition('cycle-dossier.entry'), name: 'pa.new-root' };
    expect(codes(validateDefinition(generic))).toContain('output_schema_name_mismatch');
  });
  test('reviewed empty array defaults safe; nonempty aggregate defaults remain rejected', () => {
    const d = definition('review-synthesis.generate');
    expect(validateDefinition(d).valid).toBe(true);
    expect(codes(validateDefinition(modify(d, 'outputSchema', s => { s.validationSchema.fields.synthesis.fields.consensus.default = ['unchecked']; })))).toContain('invalid_schema_default');
  });
  test('publication cannot bypass the known holds by editorial classification', () => {
    const d = definition('initial-assessment.generate'), r = requestFor(d);
    expect(codes(validateFreshPublication(r.request, r.snapshot, { state: state(), control: control() }))).toContain('consumer_version_pinned');
    expect(codes(validateDefinition(definition('pre-site-visit.proposal-core.generate')))).toContain('consumer_native_schema_unverified');
  });
});
describe('pinned budget validation and ORIGINAL control preparation', () => {
  test('all registry kinds and bounds are preserved', () => {
    expect(validateBudgets(state().budgets).valid).toBe(true);
    const changed = state().budgets; delete changed['initial-assessment.generate']; expect(validateBudgets(changed).valid).toBe(false);
    const inverted = state().budgets; inverted['review-synthesis.generate'].floor = 40000; expect(codes(validateBudgets(inverted))).toContain('inverted_budget_range');
    const bad = state().budgets; bad['review-panel.seat'].maxTokensOverride = '16000'; expect(codes(validateBudgets(bad))).toContain('budget_out_of_bounds');
  });
  test('generic and timeout exemptions derive only from registry keys', () => {
    for (const name of ['pa.new', 'field-primer.generate', 'cycle-dossier.entry']) {
      expect(requiresBudgetFence(name)).toBe(false);
      expect(validatePromptBudget(name, null, undefined, undefined)).toEqual({ valid: true, errors: [], budgetFence: null });
    }
    expect(requiresBudgetFence('review-synthesis.generate')).toBe(true);
    expect(validatePromptBudget('review-synthesis.generate', 'sonnet').valid).toBe(false);
  });
  test('current governed ceiling and strict policy snapshots are mandatory', () => {
    const s = state(); s.budgets['review-synthesis.generate'].ceiling = 100000;
    expect(codes(validatePromptBudget('review-synthesis.generate', 'haiku', s, control()))).toContain('budget_model_conflict');
    expect(validatePromptBudget('review-synthesis.generate', 'sonnet', s, control()).valid).toBe(true);
    expect(validatePromptBudget('review-synthesis.generate', 'sonnet', s, { ...control(), policyArtifactHash: 'stale' }).valid).toBe(false);
    expect(validatePromptBudget('review-synthesis.generate', null, s, control()).valid).toBe(false);
  });
  test('fresh publication consumes mandatory server budget state; receipt wire does not accept it from caller', () => {
    const { request, snapshot } = requestFor(definition('review-synthesis.generate'));
    expect(validateFreshPublication(request, snapshot).valid).toBe(false);
    const result = validateFreshPublication(request, snapshot, { state: state(), control: control() });
    expect(result.valid).toBe(true); expect(result.budgetFence.expectedEtag).toBe('W/"1"');
    expect(validateFreshPublication({ ...request, budgetState: {} }, snapshot, { state: state(), control: control() }).valid).toBe(false);
  });
  test('capture control before ALL reads, never refresh it after validation, return frozen strict write plan', async () => {
    const c = control(), s = state(), t = transport(c, s);
    const originalRead = t.readCurrentPrompt;
    t.readCurrentPrompt = jest.fn(async name => { c.etag = 'W/"999"'; c.revision = '99'; return originalRead(name); });
    const input = { budgets: clone(s.budgets), expectedVersion: 1, requestId: id(4) };
    const plan = await prepareBudgetPublication(input, actor, t);
    expect(t.events.slice(0,2)).toEqual(['control','budgets']); expect(t.readControl).toHaveBeenCalledTimes(1);
    expect(t.readCurrentPrompt.mock.calls.map(c => c[0])).not.toContain('field-primer.generate');
    expect(t.readCurrentPrompt.mock.calls.map(c => c[0])).not.toContain('cycle-dossier.entry');
    expect(plan.control.expectedEtag).toBe('W/"1"'); expect(plan.control.expectedRevision).toBe('0');
    expect(plan.writeOptions).toEqual({ actingUserSystemId: actor.effectiveUserId, noFallback: true });
    expect(Object.isFrozen(plan.publication.envelope.budgets)).toBe(true);
    expect(plan.publication.envelope.schemaVersion).toBe(1); expect(plan.publication.envelope.version).toBe(2);
    input.budgets['review-panel.seat'].maxTokensOverride = 4000;
    expect(plan.publication.envelope.budgets['review-panel.seat'].maxTokensOverride).toBe(16000);
  });
  test('zero-revision defaults, malformed reserved slots and future schema behavior', async () => {
    const s = state(); s.currentVersion = 0; s.latestRevision = 3; s.warnings = [{ code: 'invalid_executor_budget_revision', version: 3 }];
    const input = { budgets: clone(s.budgets), expectedVersion: 3, requestId: id(4) };
    const plan = await prepareBudgetPublication(input, actor, transport(control(), s));
    expect(plan.publication.envelope.version).toBe(4);
    s.warnings = [{ code: 'unsupported_executor_budget_schema', version: 3 }];
    await expect(prepareBudgetPublication(input, actor, transport(control(), s))).rejects.toMatchObject({ code: 'unsupported_budget_state' });
  });
  test('malformed caller/context/state never gains a fallback or a refreshed CAS', async () => {
    const input = { budgets: state().budgets, expectedVersion: 1, requestId: id(4) };
    for (const request of [null, { ...input, force: true }, { ...input, requestId: id(4)+'\n' }, { ...input, expectedVersion: '1' }]) await expect(prepareBudgetPublication(request, actor, transport())).rejects.toBeDefined();
    const t = transport(); t.readBudgetState.mockRejectedValue(new Error('offline'));
    await expect(prepareBudgetPublication(input, actor, t)).rejects.toThrow('offline'); expect(t.readControl).toHaveBeenCalledTimes(1); expect(t.readCurrentPrompt).not.toHaveBeenCalled();
    const bad = transport(); bad.readCurrentPrompt.mockImplementation(async name => ({ name, id:id(1), version:1, etag:'W/"2"',model:'sonnet',isCurrent:true,status:682090000 }));
    await expect(prepareBudgetPublication(input, actor, bad)).rejects.toMatchObject({ code: 'invalid_budget_prompt_snapshot' });
  });
  test.each(['budget-first','model-first'])('modeled shared CAS rejects conflicting stale %s commit', async first => {
    const c = control(), s = state(), t = transport(c, s);
    const proposed = clone(s.budgets); proposed['review-synthesis.generate'].ceiling = 100000;
    const budget = await prepareBudgetPublication({ budgets:proposed, expectedVersion:1, requestId:id(4) }, actor, t);
    const d = { ...definition('review-synthesis.generate'), model:'claude-haiku-4-5-20251001' };
    const r = requestFor(d); const model = validateFreshPublication(r.request,r.snapshot,{state:s,control:c}); expect(model.valid).toBe(true);
    const db = { revision:'0',etag:'W/"1"',ceiling:128000,budget:s.budgets['review-synthesis.generate'].ceiling };
    const commit = (fence, change) => { if (fence.expectedRevision !== db.revision || fence.expectedEtag !== db.etag) return false; change(); db.revision='1'; db.etag='W/"2"'; return true; };
    if (first === 'budget-first') { expect(commit(budget.control,()=>{db.budget=100000;})).toBe(true); expect(commit(model.budgetFence,()=>{db.ceiling=64000;})).toBe(false); }
    else { expect(commit(model.budgetFence,()=>{db.ceiling=64000;})).toBe(true); expect(commit(budget.control,()=>{db.budget=100000;})).toBe(false); }
    expect(db.budget).toBeLessThanOrEqual(db.ceiling);
  });
});

test('extracted memos match actual transpiled source exports, not only the extractor', () => {
  const sources = [
    ['pre-site-visit.proposal-core.generate',require('../../shared/config/prompts/pre-site-visit-proposal-core'), 'PROMPT_VARIABLES','PROMPT_OUTPUT_SCHEMA'],
    ['review-synthesis.generate',require('../../shared/config/prompts/review-synthesis'),'PROMPT_VARIABLES','PROMPT_OUTPUT_SCHEMA'],
    ['initial-assessment.generate',require('../../shared/config/prompts/initial-assessment'),'INITIAL_ASSESSMENT_PROMPT_VARIABLES','INITIAL_ASSESSMENT_PROMPT_OUTPUT_SCHEMA'],
    ['cycle-dossier.entry',require('../../shared/config/prompts/cycle-dossier-entry'),'VARIABLES','OUTPUT_SCHEMA'],
    ['cycle-dossier.research-plan',require('../../shared/config/prompts/cycle-dossier-research-plan'),'VARIABLES','OUTPUT_SCHEMA'],
    ['review-panel.seat',require('../../shared/config/prompts/review-panel-seat'),'VARIABLES','OUTPUT_SCHEMA'],
    ['review-panel.chair',require('../../shared/config/prompts/review-panel-chair'),'VARIABLES','OUTPUT_SCHEMA'],
    ['meeting-transcript.presentation-summary',require('../../shared/config/prompts/meeting-presentation-summary'),'PROMPT_VARIABLES','PROMPT_OUTPUT_SCHEMA'],
    ['meeting-transcript.staff-discussion-summary',require('../../shared/config/prompts/meeting-staff-discussion-summary'),'PROMPT_VARIABLES','PROMPT_OUTPUT_SCHEMA'],
    ['meeting-transcript.staff-discussion-sentiment',require('../../shared/config/prompts/meeting-staff-discussion-sentiment'),'PROMPT_VARIABLES','PROMPT_OUTPUT_SCHEMA'],
  ];
  for(const [name,module,vars,outputs] of sources) {
    expect(policy.consumerContracts[name].variablesJson).toBe(JSON.stringify(module[vars]));
    expect(policy.consumerContracts[name].outputJson).toBe(JSON.stringify(module[outputs]));
  }
});

test('older control provenance does not force reseed; new plans still stamp current policy and original CAS', async () => {
  const prior = { ...control(), policyRevision: 2, policyArtifactHash: 'a'.repeat(64), revision: '17', etag: 'W/"44"' };
  const plan = await prepareBudgetPublication({budgets:state().budgets,expectedVersion:1,requestId:id(4)},actor,transport(prior));
  expect(plan.policyRevision).toBe(policy.policyVersion); expect(plan.policyArtifactHash).toBe(POLICY_ARTIFACT.hash);
  expect(plan.control).toMatchObject({expectedRevision:'17',expectedEtag:'W/"44"',nextRevision:'18'});
  const d=definition('review-synthesis.generate'), r=requestFor(d);
  expect(validateFreshPublication(r.request,r.snapshot,{state:state(),control:prior}).valid).toBe(true);
  expect(codes(validateFreshPublication({...r.request,policyRevision:2,policyArtifactHash:'a'.repeat(64)},r.snapshot,{state:state(),control:prior}))).toContain('policy_changed');
});
