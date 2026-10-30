/**
 * PR553 local foundation. Browser-safe, synchronous, no persistence or provider calls.
 * Consumes a pinned portable artifact. NOT a complete definition/publication validator:
 * call definition-schema for complete structural checks. Per-consumer defaults,
 * budgets, auth and transaction guards remain mandatory before writer enablement.
 * Errors contain fixed codes/paths only, never editable prompt content.
 */
const artifact = require('./policy-v1.json');
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const POLICY_ARTIFACT = freeze(artifact);
const policy = POLICY_ARTIFACT.policy;
const owns = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const asciiLower = value => value.replace(/[A-Z]/g, letter => letter.toLowerCase());
const fullMatch = (pattern, value) => {
  const match = new RegExp(pattern).exec(value);
  return match && match.index === 0 && match[0].length === value.length ? match : null;
};
const error = (errors, path, code) => errors.push({ path, code });

/** Complete template DTO required; omitted systemPrompt is not silently normalized. */
function validateTemplate(input) {
  if (!object(input)) return { valid: false, errors: [{ path: '$', code: 'object_required' }] };
  const { name, body, systemPrompt, declaredVariables } = input;
  const errors = [];
  if (typeof name !== 'string' || !name.trim() || name !== name.trim() || name.length > policy.limits.nameUtf16) error(errors, 'name', 'invalid_name');
  const used = new Set();
  const bodyUsed = new Set();
  for (const [field, text] of [['systemPrompt', systemPrompt], ['body', body]]) {
    if (typeof text !== 'string') { error(errors, field, 'text_required'); continue; }
    if (field === 'body' && !text.trim()) error(errors, field, 'body_blank');
    if (text.length > policy.limits.templateUtf16) error(errors, field, 'template_too_long');
    for (const pattern of policy.forbiddenPatterns) {
      if (new RegExp(pattern.source, pattern.flags).test(text)) { error(errors, field, 'a7_marker'); break; }
    }
    // Scan every paired double brace token: unsupported identifiers/whitespace
    // cannot disappear from the declaration check. Single braces remain literal.
    for (const match of text.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
      const valid = fullMatch(policy.placeholder.token, match[0]);
      if (!valid) { error(errors, field, 'unsupported_placeholder'); continue; }
      used.add(valid[1]);
      if (field === 'body') bodyUsed.add(valid[1]);
    }
  }
  const declared = new Set();
  if (!Array.isArray(declaredVariables)) error(errors, 'declaredVariables', 'array_required');
  else for (const value of declaredVariables) {
    if (typeof value !== 'string' || !fullMatch(policy.placeholder.name, value)) error(errors, 'declaredVariables', 'invalid_variable_name');
    else if (declared.has(value)) error(errors, 'declaredVariables', 'duplicate_variable');
    else declared.add(value);
  }
  for (const value of used) if (!declared.has(value)) error(errors, 'declaredVariables', 'undeclared_variable');
  for (const value of declared) if (!used.has(value) && !(typeof name === 'string' && owns(policy.consumerContracts, name) && policy.consumerContracts[name].unusedDeclarations?.includes(value))) error(errors, 'declaredVariables', 'unused_variable');
  // Reader identity is case-insensitive; casing must not bypass parser rules.
  const contractName = typeof name === 'string' ? asciiLower(name) : '';
  const reviewer = owns(policy.reviewerContracts, contractName) ? policy.reviewerContracts[contractName] : null;
  for (const value of reviewer?.requiredPlaceholders || []) if (!bodyUsed.has(value)) error(errors, 'body', 'required_placeholder_missing');
  for (const label of reviewer?.requiredLabels || []) if (typeof body === 'string' && !body.includes(label)) error(errors, 'body', 'required_label_missing');
  const template = owns(policy.templateContracts, contractName) ? policy.templateContracts[contractName] : null;
  for (const value of template?.requiredPlaceholders || []) if (!used.has(value)) error(errors, 'body', 'required_placeholder_missing');
  return { valid: errors.length === 0, errors };
}

/** Exact pinned identities only; no prefix matching, live discovery or coercion. */
function resolvePinnedModel(value, { name, native = false } = {}) {
  if (typeof native !== 'boolean') return { valid: false, code: 'invalid_native_mode' };
  let normalized = value;
  let kind = 'concrete';
  if (value === null) {
    if (native || typeof name !== 'string' || !owns(policy.defaultsByName, name)) return { valid: false, code: 'model_default_not_registered' };
    normalized = policy.defaultsByName[name]; kind = 'default';
  } else if (typeof value !== 'string' || !value) return { valid: false, code: 'model_required' };
  if (typeof normalized === 'string' && fullMatch('[A-Za-z]+', normalized) && owns(policy.tiers, asciiLower(normalized))) {
    if (native) return { valid: false, code: 'native_requires_concrete_model' };
    normalized = asciiLower(normalized); kind = 'tier';
  }
  const resolvedId = kind === 'tier' ? policy.tiers[normalized] : normalized;
  if (!owns(policy.models, resolvedId)) return { valid: false, code: 'unreviewed_model' };
  const capabilities = policy.models[resolvedId];
  if (native && capabilities.supportsStructuredOutput !== true) return { valid: false, code: 'native_unsupported' };
  return { valid: true, value: value === null ? null : normalized, resolvedId, kind, capabilities };
}

function validateModelBudget({ model, maxTokens, name, native = false } = {}) {
  const resolved = resolvePinnedModel(model, { name, native });
  if (!resolved.valid) return resolved;
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) return { valid: false, code: 'invalid_max_tokens' };
  if (!Number.isSafeInteger(resolved.capabilities.maxOutputTokens) || resolved.capabilities.maxOutputTokens <= 0) return { valid: false, code: 'model_limit_unavailable' };
  if (maxTokens > resolved.capabilities.maxOutputTokens) return { valid: false, code: 'model_output_limit_exceeded' };
  return { ...resolved, maxTokens };
}
function matchesPolicy({ policyVersion, policyArtifactHash } = {}) {
  return policyVersion === policy.policyVersion && policyArtifactHash === POLICY_ARTIFACT.hash;
}
module.exports = { POLICY_ARTIFACT, validateTemplate, resolvePinnedModel, validateModelBudget, matchesPolicy };
