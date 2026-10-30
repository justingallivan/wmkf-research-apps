/** @jest-environment node */
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { POLICY_ARTIFACT, validateTemplate, resolvePinnedModel, validateModelBudget, matchesPolicy } = require('../../lib/prompt-publication/template-policy');
const modelVectors = require('../fixtures/prompt-publication/models-v1.json');
const vectors = require('../fixtures/prompt-publication/templates-v1.json');
const { REVIEWER_PARSE_CONTRACTS, PROMPT_TEMPLATE_CONTRACTS } = require('../../lib/utils/prompt-validators');
const { ANALYZE_USER_PROMPT_TEMPLATE, SCORE_CANDIDATES_USER_PROMPT_TEMPLATE } = require('../../shared/config/prompts/reviewer-finder-dynamics');
const { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE } = require('../../shared/config/prompts/pre-site-visit-proposal-core');
const base = { name: 'pa.summary', body: 'Hello', systemPrompt: '', declaredVariables: [] };
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sorted(value[k])]));
  return value;
}
describe('portable template golden vectors', () => {
  test.each(vectors)('$id', ({ input, codes }) => {
    const before = JSON.stringify(input);
    const result = validateTemplate(input);
    expect(result.errors.map(e => e.code)).toEqual(codes);
    expect(result.valid).toBe(codes.length === 0);
    expect(JSON.stringify(input)).toBe(before);
  });
  test.each([null, undefined, [], 'x', 1])('malformed DTO %p', input => {
    expect(validateTemplate(input)).toEqual({ valid: false, errors: [{ path: '$', code: 'object_required' }] });
  });
  test.each(['body', 'systemPrompt'])('%s UTF16 exact cap including astral text', field => {
    expect(validateTemplate({ ...base, [field]: '😀'.repeat(32768) }).valid).toBe(true);
    expect(validateTemplate({ ...base, [field]: '😀'.repeat(32768) + 'a' }).errors).toContainEqual({ path: field, code: 'template_too_long' });
  });
  test.each(['constructor', '__proto__', 'toString'])('object inherited key %s gets generic rules', name => {
    expect(validateTemplate({ ...base, name }).valid).toBe(true);
    expect(resolvePinnedModel(name).valid).toBe(false);
  });
  test.each([null, 'x', {}, ['x\n'], ['é'], [3]])('invalid declarations %p', declaredVariables => {
    expect(validateTemplate({ ...base, declaredVariables }).valid).toBe(false);
  });
  test('shipped reviewer templates preserve actual parser requirements', () => {
    for (const [name, body] of [['reviewer-finder.analyze', ANALYZE_USER_PROMPT_TEMPLATE], ['reviewer-finder.score-candidates', SCORE_CANDIDATES_USER_PROMPT_TEMPLATE]]) {
      const declaredVariables = [...new Set([...body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m => m[1]))];
      expect(validateTemplate({ name, body, systemPrompt: '', declaredVariables }).valid).toBe(true);
      for (const label of REVIEWER_PARSE_CONTRACTS[name].requiredLabels) {
        expect(validateTemplate({ name, body: body.split(label).join('REMOVED'), systemPrompt: '', declaredVariables }).errors).toContainEqual({ path: 'body', code: 'required_label_missing' });
      }
    }
  });
  test('reviewer placeholders must remain in body, while pre-site allows combined templates', () => {
    expect(validateTemplate({ name: 'reviewer-finder.score-candidates', body: 'RELEVANT: REASONING: SENIORITY:', systemPrompt: '{{proposal_summary}} {{candidates_list}}', declaredVariables: ['proposal_summary', 'candidates_list'] }).errors.filter(e => e.code === 'required_placeholder_missing')).toHaveLength(2);
    const name = 'pre-site-visit.proposal-core.generate';
    const declaredVariables = ['request_context_json', 'proposal_text'];
    expect(validateTemplate({ name, body: USER_PROMPT_TEMPLATE, systemPrompt: SYSTEM_PROMPT, declaredVariables }).valid).toBe(true);
    for (const variable of declaredVariables) {
      const remove = text => text.replace(new RegExp(`\\{\\{\\s*${variable}\\s*\\}\\}`, 'g'), 'REMOVED');
      expect(validateTemplate({ name, body: remove(USER_PROMPT_TEMPLATE), systemPrompt: remove(SYSTEM_PROMPT), declaredVariables }).errors).toContainEqual({ path: 'body', code: 'required_placeholder_missing' });
    }
  });
  test.each(['reviewer-finder.analyze', 'pre-site-visit.proposal-core.generate'])('case-insensitive reader identity cannot bypass %s rules', name => {
    const lower = validateTemplate({ ...base, name });
    expect(lower.valid).toBe(false);
    expect(validateTemplate({ ...base, name: name.toUpperCase() })).toEqual(lower);
  });
  test('errors are content-free and CRLF contents are preserved', () => {
    const input = { ...base, body: '{{sensitive_applicant_name}}\r\nSECRET' };
    expect(JSON.stringify(validateTemplate(input))).not.toMatch(/SECRET|sensitive_applicant/);
    expect(input.body).toBe('{{sensitive_applicant_name}}\r\nSECRET');
  });
});
describe('frozen reviewed model policy', () => {
  test.each(modelVectors)('portable model $id', vector => {
    const actual = vector.op === 'resolve' ? resolvePinnedModel(vector.model, vector.options)
      : vector.op === 'budget' ? validateModelBudget(vector.input) : matchesPolicy(vector.input);
    if (typeof vector.expected === 'boolean') expect(actual).toBe(vector.expected);
    else expect(actual).toMatchObject(vector.expected);
  });
  test('exact hash/version only', () => {
    expect(matchesPolicy({ policyVersion: 1, policyArtifactHash: POLICY_ARTIFACT.hash })).toBe(true);
    expect(matchesPolicy({ policyVersion: '1', policyArtifactHash: POLICY_ARTIFACT.hash })).toBe(false);
    expect(matchesPolicy({ policyVersion: 1, policyArtifactHash: 'stale' })).toBe(false);
  });
  test.each(Object.entries(POLICY_ARTIFACT.policy.tiers))('tier %s is frozen at %s', (tier, concrete) => {
    expect(resolvePinnedModel(tier.toUpperCase()).resolvedId).toBe(concrete);
    expect(resolvePinnedModel(tier, { native: true }).valid).toBe(false);
  });
  test.each([null, undefined, '', 3, {}, 'claude-sonnet-5-future', 'gpt-5.6-sol', 'sonnet '])('no unknown/default/coercion fallback %p', model => {
    expect(resolvePinnedModel(model).valid).toBe(false);
  });
  test('native capability and token ceiling', () => {
    expect(resolvePinnedModel('claude-sonnet-4', { native: true }).code).toBe('native_unsupported');
    expect(resolvePinnedModel('claude-sonnet-5', { native: true }).valid).toBe(true);
    for (const maxTokens of [null, '100', 0, -1, 1.5, Infinity]) expect(validateModelBudget({ model: 'sonnet', maxTokens }).valid).toBe(false);
    const maxTokens = resolvePinnedModel('sonnet').capabilities.maxOutputTokens;
    expect(validateModelBudget({ model: 'sonnet', maxTokens }).valid).toBe(true);
    expect(validateModelBudget({ model: 'sonnet', maxTokens: maxTokens + 1 }).code).toBe('model_output_limit_exceeded');
  });
  test('artifact deep freeze, full rule extraction and reproducible hash', () => {
    expect(Object.isFrozen(POLICY_ARTIFACT.policy.tiers)).toBe(true);
    expect(POLICY_ARTIFACT.policy.reviewerContracts).toEqual(REVIEWER_PARSE_CONTRACTS);
    expect(POLICY_ARTIFACT.policy.templateContracts).toEqual(PROMPT_TEMPLATE_CONTRACTS);
    expect(crypto.createHash('sha256').update(JSON.stringify(sorted(POLICY_ARTIFACT.policy))).digest('hex')).toBe(POLICY_ARTIFACT.hash);
    expect(execFileSync(process.execPath, ['scripts/build-prompt-publication-policy.cjs', '--check'], { cwd: process.cwd(), encoding: 'utf8' })).toContain('matches reviewed source');
  });
});
