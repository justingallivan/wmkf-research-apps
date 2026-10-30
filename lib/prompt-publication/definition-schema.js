/** Complete structural v1 definition schema, pure/offline. Not authorization.
 * Existing app consumer contracts remain a fail-closed rollout gate in policy.
 * DTO JSON memo strings are validated but preserved byte-for-byte for hashing.
 */
const { LIMITS, owns, isObject, inspectJson, parseJson, utf8Length } = require('./json-contract');
const { POLICY_ARTIFACT, validateTemplate, validateModelBudget } = require('./template-policy');
const { getConsumerContract, validateConsumerDefinition } = require('./consumer-contract');
const policy = POLICY_ARTIFACT.policy;
const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const nonnegative = n => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647;
const text = (v, cap, blank = false) => typeof v === 'string' && v.length <= cap && (blank || v.trim().length > 0);
const word = v => typeof v === 'string' && /^[A-Za-z0-9_]+$/.exec(v)?.[0] === v;
const field = v => typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.exec(v)?.[0] === v;
const key = v => typeof v === 'string' && /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.exec(v)?.[0] === v && v.length <= 850;
const error = (errors, path, code) => errors.push({ path, code });
function shape(value, required, optional, errors, path) {
  if (!isObject(value)) { error(errors, path, 'object_required'); return false; }
  if (required.some(k => !owns(value, k))) error(errors, path, 'missing_field');
  if (Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) error(errors, path, 'unknown_field');
  return true;
}
function optionalBool(o, fields, errors, path) {
  for (const k of fields) if (owns(o, k) && typeof o[k] !== 'boolean') error(errors, path + '.' + k, 'boolean_required');
}
function memo(value, path, errors) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') { error(errors, path, 'json_text_required'); return null; }
  if (value.length > LIMITS.memoUtf16) { error(errors, path, 'memo_too_long'); return null; }
  try {
    const result = parseJson(value);
    if (!isObject(result)) { error(errors, path, 'object_required'); return null; }
    return result;
  } catch (e) { error(errors, path, e.code || 'invalid_json'); return null; }
}
function source(value, errors, path, audited = false) {
  if (!isObject(value)) { error(errors, path, 'source_required'); return; }
  const allowed = { override: ['default'], dynamics: ['table', 'field'], sharepoint: ['pattern', 'preprocess', 'maxChars'] };
  if (typeof value.kind !== 'string' || !owns(allowed, value.kind)) { error(errors, path, 'unsupported_source'); return; }
  shape(value, ['kind'], allowed[value.kind], errors, path);
  if (value.kind === 'override' && owns(value, 'default') && !(typeof value.default === 'string' || (audited && (typeof value.default === 'boolean' || (typeof value.default === 'number' && Number.isFinite(value.default)))))) error(errors, path, 'invalid_default');
  if (value.kind === 'dynamics') {
    if (owns(value, 'table') && value.table !== 'akoya_request') error(errors, path, 'unsupported_table');
    if (!field(value.field)) error(errors, path, 'invalid_field');
  }
  if (value.kind === 'sharepoint') {
    if (!text(value.pattern, 1000)) error(errors, path, 'invalid_pattern');
    if (owns(value, 'preprocess') && value.preprocess !== 'pdf_to_text') error(errors, path, 'unsupported_preprocess');
    if (owns(value, 'maxChars') && !positive(value.maxChars)) error(errors, path, 'invalid_max_chars');
  }
}
function variables(spec, errors, templateOnly, audited) {
  if (spec === null) return [];
  if (!shape(spec, ['variables'], [], errors, 'variables') || !Array.isArray(spec.variables)) {
    error(errors, 'variables', 'variables_array_required'); return [];
  }
  const names = [];
  for (const item of spec.variables) {
    const p = 'variables.variables[]';
    if (!shape(item, ['name'], ['source', 'required', 'cacheable', 'untrusted', 'placement', 'dataClass', 'maxChars'], errors, p)) continue;
    names.push(item.name);
    if (['__proto__', 'constructor', 'prototype'].includes(item.name)) error(errors, p, 'forbidden_property_name');
    if (owns(item, 'source')) source(item.source, errors, p + '.source', audited);
    else if (!templateOnly) error(errors, p, 'source_required');
    optionalBool(item, ['required', 'cacheable', 'untrusted'], errors, p);
    if (owns(item, 'placement') && !['user', 'system'].includes(item.placement)) error(errors, p, 'unsupported_placement');
    if (owns(item, 'dataClass') && !text(item.dataClass, 100)) error(errors, p, 'invalid_data_class');
    if (owns(item, 'maxChars') && !positive(item.maxChars)) error(errors, p, 'invalid_max_chars');
    if (owns(item, 'dataClass') !== owns(item, 'maxChars') || (item.untrusted === true && (!owns(item, 'dataClass') || !owns(item, 'maxChars')))) error(errors, p, 'incomplete_boundary');
  }
  return names;
}
/** Existing declarative validator grammar; no new author-provided regex runtime. */
function validationNode(node, errors, path = 'outputSchema.validationSchema') {
  const extras = {
    string: ['maxLength', 'forbidPattern', 'enum', 'coerceEnum'], integer: ['min', 'max'], number: ['min', 'max'],
    boolean: [], array: ['of', 'maxItems'], object: ['fields', 'allowExtra'], record: ['of', 'keys', 'maxEntries'],
  };
  if (!isObject(node) || typeof node.type !== 'string' || !owns(extras, node.type)) { error(errors, path, 'unsupported_validation_node'); return; }
  shape(node, ['type'], ['required', 'nullable', 'default', ...extras[node.type]], errors, path);
  optionalBool(node, ['required', 'nullable', 'coerceEnum'], errors, path);
  for (const k of ['maxLength', 'maxItems', 'maxEntries']) if (owns(node, k) && !nonnegative(node[k])) error(errors, path + '.' + k, 'invalid_bound');
  for (const k of ['min', 'max']) if (owns(node, k) && (typeof node[k] !== 'number' || !Number.isFinite(node[k]) || (node.type === 'integer' && !Number.isSafeInteger(node[k])))) error(errors, path + '.' + k, 'invalid_bound');
  if (typeof node.min === 'number' && typeof node.max === 'number' && node.min > node.max) error(errors, path, 'inverted_bounds');
  if (owns(node, 'enum') && (!Array.isArray(node.enum) || !node.enum.length || node.enum.some(v => typeof v !== 'string') || new Set(node.enum).size !== node.enum.length)) error(errors, path, 'invalid_enum');
  if (node.coerceEnum === true && (!owns(node, 'default') || !(Array.isArray(node.enum) && node.enum.includes(node.default)))) error(errors, path, 'invalid_enum_default');
  if (owns(node, 'forbidPattern')) error(errors, path, 'pattern_requires_consumer_review');
  if (node.type === 'object') {
    if (!isObject(node.fields)) error(errors, path, 'fields_required');
    else for (const [k, child] of Object.entries(node.fields)) {
      if (['__proto__', 'constructor', 'prototype'].includes(k)) error(errors, path, 'forbidden_property_name');
      validationNode(child, errors, path + '.fields.*');
    }
    if (owns(node, 'allowExtra') && node.allowExtra !== 'error') error(errors, path, 'unsupported_allow_extra');
  }
  if (node.type === 'array' || node.type === 'record') validationNode(node.of, errors, path + '.of');
  if (node.type === 'record' && owns(node, 'keys')) {
    if (shape(node.keys, [], ['maxLength', 'pattern', 'enum'], errors, path + '.keys')) {
      if (owns(node.keys, 'maxLength') && !positive(node.keys.maxLength)) error(errors, path, 'invalid_bound');
      if (owns(node.keys, 'pattern')) error(errors, path, 'pattern_requires_consumer_review');
      if (owns(node.keys, 'enum') && (!Array.isArray(node.keys.enum) || !node.keys.enum.length || node.keys.enum.some(k => !text(k, 1000)))) error(errors, path, 'invalid_enum');
    }
  }
  // Defaults bypass runtime validation; verify them against the same node shape.
  if (owns(node, 'default')) validateDefault(node.default, node, errors, path);
}
function validateDefault(value, node, errors, path) {
  if (value === null && node.nullable === true) return;
  let ok = false;
  switch (node.type) {
    case 'string': ok = typeof value === 'string' && (!owns(node, 'maxLength') || (nonnegative(node.maxLength) && value.length <= node.maxLength)) && (!owns(node, 'enum') || (Array.isArray(node.enum) && node.enum.includes(value))); break;
    case 'integer': case 'number': ok = typeof value === 'number' && Number.isFinite(value) && (node.type !== 'integer' || Number.isSafeInteger(value)) && (!owns(node, 'min') || (typeof node.min === 'number' && value >= node.min)) && (!owns(node, 'max') || (typeof node.max === 'number' && value <= node.max)); break;
    case 'boolean': ok = typeof value === 'boolean'; break;
    case 'array': ok = Array.isArray(value) && value.length === 0; break;
    // Only empty arrays have no child values that can bypass runtime validation.
    default: ok = false;
  }
  if (!ok) error(errors, path, 'invalid_schema_default');
}
/** Reviewed conservative JSON Schema subset; unsupported constructs stay intact
 * in storage but cannot be republished until explicitly supported/reviewed.
 */
function jsonSchema(node, native, errors, path = 'outputSchema.jsonSchema') {
  if (!shape(node, [], ['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'description', 'title', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems'], errors, path)) return;
  if (owns(node, 'type') && !(Array.isArray(node.type) && !native && node.type.length > 0 && new Set(node.type).size === node.type.length && node.type.every(t => ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(t))) && !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(node.type)) error(errors, path, 'unsupported_json_schema_type');
  if (native && Object.keys(node).some(k => ['minimum', 'maximum', 'minLength', 'maxLength', 'maxItems'].includes(k))) error(errors, path, 'unsupported_native_constraint');
  if (native && owns(node, 'minItems') && ![0, 1].includes(node.minItems)) error(errors, path, 'unsupported_native_constraint');
  if (native && !owns(node, 'type')) error(errors, path, 'json_schema_type_required');
  for (const k of ['description', 'title']) if (owns(node, k) && !text(node[k], 4000, true)) error(errors, path, 'invalid_schema_text');
  for (const k of ['minLength', 'maxLength', 'minItems', 'maxItems']) if (owns(node, k) && !nonnegative(node[k])) error(errors, path, 'invalid_bound');
  for (const k of ['minimum', 'maximum']) if (owns(node, k) && (typeof node[k] !== 'number' || !Number.isFinite(node[k]))) error(errors, path, 'invalid_bound');
  for (const [a, b] of [['minimum', 'maximum'], ['minLength', 'maxLength'], ['minItems', 'maxItems']]) if (typeof node[a] === 'number' && typeof node[b] === 'number' && node[a] > node[b]) error(errors, path, 'inverted_bounds');
  if (owns(node, 'enum') && (!Array.isArray(node.enum) || !node.enum.length || node.enum.some(v => v !== null && !['string', 'number', 'boolean'].includes(typeof v)))) error(errors, path, 'invalid_enum');
  if (owns(node, 'type')) {
    if (node.type !== 'object' && ['properties', 'required', 'additionalProperties'].some(k => owns(node, k))) error(errors, path, 'schema_keyword_type_mismatch');
    if (node.type !== 'array' && ['items', 'minItems', 'maxItems'].some(k => owns(node, k))) error(errors, path, 'schema_keyword_type_mismatch');
  }
  if (owns(node, 'additionalProperties') && typeof node.additionalProperties !== 'boolean') {
    if (!native && isObject(node.additionalProperties)) jsonSchema(node.additionalProperties, false, errors, path + '.additionalProperties');
    else error(errors, path, 'unsupported_additional_properties');
  }
  if (native && node.type === 'object' && node.additionalProperties !== false) error(errors, path, 'native_closed_object_required');
  if (owns(node, 'properties')) {
    if (!isObject(node.properties)) error(errors, path, 'properties_required');
    else for (const [k, child] of Object.entries(node.properties)) {
      if (['__proto__', 'constructor', 'prototype'].includes(k)) error(errors, path, 'forbidden_property_name');
      jsonSchema(child, native, errors, path + '.properties.*');
    }
  } else if (native && node.type === 'object') error(errors, path, 'properties_required');
  if (owns(node, 'required')) {
    if (!Array.isArray(node.required) || node.required.some(v => !text(v, 1000)) || new Set(node.required).size !== node.required.length) error(errors, path, 'invalid_required');
    else if (isObject(node.properties) && node.required.some(k => !owns(node.properties, k))) error(errors, path, 'required_property_missing');
  }
  if (owns(node, 'items')) jsonSchema(node.items, native, errors, path + '.items');
  else if (node.type === 'array') error(errors, path, 'items_required');
}
function outputs(spec, errors, rootPassThrough = false) {
  if (!shape(spec, ['outputs'], ['parseMode', 'generationMode', 'jsonSchema', 'validationSchema', 'rawOutputRetention'], errors, 'outputSchema')) return;
  const parse = owns(spec, 'parseMode') ? spec.parseMode : 'json';
  if (!['raw', 'json'].includes(parse)) error(errors, 'outputSchema', 'unsupported_parse_mode');
  if (owns(spec, 'generationMode') && ![null, 'native-json-schema'].includes(spec.generationMode)) error(errors, 'outputSchema', 'unsupported_generation_mode');
  if (owns(spec, 'rawOutputRetention') && !['full', 'hash', 'none'].includes(spec.rawOutputRetention)) error(errors, 'outputSchema', 'unsupported_retention');
  if (!Array.isArray(spec.outputs) || !spec.outputs.length) { error(errors, 'outputSchema', 'outputs_required'); return; }
  if (parse === 'raw' && spec.outputs.length !== 1) error(errors, 'outputSchema', 'raw_single_output_required');
  const names = new Set();
  const destinations = new Map();
  for (const out of spec.outputs) {
    const p = 'outputSchema.outputs[]';
    if (!shape(out, ['name', 'target'], ['type', 'guard'], errors, p)) continue;
    if (!word(out.name) || names.has(out.name) || ['__proto__', 'constructor', 'prototype'].includes(out.name)) error(errors, p, 'invalid_or_duplicate_output_name');
    names.add(out.name);
    if (owns(out, 'type') && !['string', 'text', 'object', 'array', 'number', 'integer', 'boolean', 'json'].includes(out.type)) error(errors, p, 'unsupported_output_type');
    if (owns(out, 'guard') && !['skip-if-populated', 'always-overwrite'].includes(out.guard)) error(errors, p, 'unsupported_guard');
    if (!isObject(out.target) || !['none', 'akoya_request'].includes(out.target.kind)) { error(errors, p, 'unsupported_target'); continue; }
    shape(out.target, ['kind'], out.target.kind === 'none' ? [] : ['field', 'jsonPath'], errors, p + '.target');
    if (out.target.kind === 'akoya_request') {
      const destination = out.target.field;
      const path = owns(out.target, 'jsonPath') ? out.target.jsonPath : null;
      const prior = destinations.get(destination) || new Set();
      if (prior.has(path) || (path === null && prior.size) || prior.has(null)) error(errors, p, 'duplicate_output_target');
      prior.add(path); destinations.set(destination, prior);
      if (!field(out.target.field)) error(errors, p, 'invalid_field');
      if (['$.__proto__', '$.constructor', '$.prototype'].includes(out.target.jsonPath)) error(errors, p, 'forbidden_property_name');
      if (owns(out.target, 'jsonPath') && (typeof out.target.jsonPath !== 'string' || /^\$\.[A-Za-z0-9_]+$/.exec(out.target.jsonPath)?.[0] !== out.target.jsonPath)) error(errors, p, 'invalid_json_path');
    }
  }
  if (parse === 'raw' && (owns(spec, 'jsonSchema') || owns(spec, 'validationSchema'))) error(errors, 'outputSchema', 'raw_schema_ignored');
  const native = spec.generationMode === 'native-json-schema';
  if (native && (spec.parseMode !== 'json' || !isObject(spec.jsonSchema))) error(errors, 'outputSchema', 'native_json_schema_required');
  if (isObject(spec.jsonSchema)) {
    if (owns(spec.jsonSchema, 'type') && spec.jsonSchema.type !== 'object') error(errors, 'outputSchema', 'output_root_object_required');
    if (native && !rootPassThrough && spec.outputs.some(o => !isObject(o) || !isObject(spec.jsonSchema.properties) || !owns(spec.jsonSchema.properties, o.name) || !Array.isArray(spec.jsonSchema.required) || !spec.jsonSchema.required.includes(o.name))) error(errors, 'outputSchema', 'output_schema_name_mismatch');
  }
  if (!rootPassThrough && isObject(spec.validationSchema) && (spec.validationSchema.type !== 'object' || !isObject(spec.validationSchema.fields) || spec.outputs.some(o => !isObject(o) || !owns(spec.validationSchema.fields, o.name)))) error(errors, 'outputSchema', 'output_schema_name_mismatch');
  if (owns(spec, 'jsonSchema')) jsonSchema(spec.jsonSchema, native, errors);
  if (owns(spec, 'validationSchema')) validationNode(spec.validationSchema, errors);
}
function validateDefinition(definition) {
  const errors = [];
  try { inspectJson(definition); } catch (e) { return { valid: false, errors: [{ path: '$', code: e.code || 'invalid_json_value' }] }; }
  if (!shape(definition, ['name', 'systemPrompt', 'body', 'variables', 'outputSchema', 'model', 'temperature', 'maxTokens'], [], errors, '$')) return { valid: false, errors };
  if (!key(definition.name)) error(errors, 'name', 'invalid_canonical_key');
  // Known existing keys stay blocked until all consumer restrictions are audited.
  if (policy.pendingConsumerNames.includes(definition.name)) error(errors, 'name', 'consumer_contract_pending');
  const templateOnly = typeof definition.name === 'string' && owns(policy.templateOnlyByName, definition.name);
  const variableSpec = memo(definition.variables, 'variables', errors);
  const outputSpec = memo(definition.outputSchema, 'outputSchema', errors);
  if (outputSpec === null && !templateOnly) error(errors, 'outputSchema', 'output_schema_required');
  const declaredVariables = variables(variableSpec, errors, templateOnly, getConsumerContract(definition.name) !== null);
  const templates = validateTemplate({ name: definition.name, systemPrompt: definition.systemPrompt, body: definition.body, declaredVariables });
  errors.push(...templates.errors);
  const consumer = getConsumerContract(definition.name);
  errors.push(...validateConsumerDefinition(definition, variableSpec, outputSpec));
  if (outputSpec) outputs(outputSpec, errors, consumer?.rootPassThrough === true);
  const native = outputSpec?.generationMode === 'native-json-schema';
  const model = validateModelBudget({ model: definition.model, maxTokens: definition.maxTokens, name: definition.name, native });
  if (!model.valid) error(errors, 'model', model.code);
  else if (model.value !== definition.model) error(errors, 'model', 'noncanonical_model');
  if (definition.temperature !== null && (typeof definition.temperature !== 'number' || !Number.isFinite(definition.temperature) || definition.temperature < 0 || definition.temperature > 1)) error(errors, 'temperature', 'invalid_temperature');
  // Null is preservation-only, never a new generic definition default.
  if (definition.temperature === null && !templateOnly && consumer?.allowNullTemperature !== true) error(errors, 'temperature', 'temperature_required');
  if (utf8Length(JSON.stringify(definition)) > LIMITS.bytes) error(errors, '$', 'payload_too_large');
  return { valid: errors.length === 0, errors };
}
module.exports = { validateDefinition, shape, text, key, positive };
