/**
 * Declarative validator for structured JSON returned by an LLM (A7 Part 0).
 *
 * Routes that `JSON.parse` raw model output must not trust the parsed shape:
 * a prompt-injected model can add keys, change types, or smuggle values into
 * fields that are later persisted (e.g. the Dynamics writeback in Phase I
 * Dynamics, or the grant-reporting extraction form). This primitive validates
 * a parsed object against a per-app schema AFTER parsing — it rejects bad
 * types, enforces enums and bounds, and drops keys the schema does not declare
 * (so an injected field cannot ride through to a sink).
 *
 * It is intentionally hand-rolled and dependency-free — the same rationale as
 * `lib/external/review-form-schema.js` (keep the dependency surface flat; no
 * zod). It is not a general JSON-Schema engine; it covers the node types the
 * codebase's LLM sinks actually use.
 *
 * Schema node shapes:
 *   { type: 'string',  maxLength?, forbidPattern?, enum?, coerceEnum?, nullable?, default? }
 *   { type: 'integer', min?, max?, nullable?, default? }
 *   { type: 'number',  min?, max?, nullable?, default? }
 *   { type: 'boolean', nullable?, default? }
 *   { type: 'array',   of: <node>, maxItems?, nullable?, default? }
 *   { type: 'object',  fields: { key: <node>, ... }, allowExtra?, nullable? }
 *   { type: 'record',  of: <node>, keys?: { maxLength?, pattern?, enum? }, maxEntries?, nullable?, default? }
 *
 * `record` is a dynamic-keyed map (string -> node) — the right shape for LLM
 * outputs whose keys are model-chosen (e.g. a rating matrix keyed by reviewer
 * name, or per-criterion ratings). Unlike `object` it has no fixed `fields`.
 * Prototype-pollution keys (`__proto__`, `constructor`, `prototype`) are
 * always rejected; `keys` optionally bounds key length / pattern / enum.
 *
 * Every node may carry `required` (default true). A non-required field that is
 * absent is simply omitted from the output (or set to `default` if provided).
 *
 * Returns `{ ok: true, value }` or `{ ok: false, errors: string[] }`.
 */

function fail(errors, path, msg) {
  errors.push(`${path}: ${msg}`);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function validateNode(value, node, path, errors) {
  const present = value !== undefined;

  if (!present || value === null) {
    if (value === null && node.nullable) return null;
    if (Object.prototype.hasOwnProperty.call(node, 'default')) return node.default;
    if (node.required === false) return undefined;
    fail(errors, path, value === null ? 'must not be null.' : 'required.');
    return undefined;
  }

  switch (node.type) {
    case 'string': {
      if (typeof value !== 'string') {
        fail(errors, path, 'must be a string.');
        return undefined;
      }
      if (node.maxLength != null && value.length > node.maxLength) {
        fail(errors, path, `max ${node.maxLength} characters.`);
        return undefined;
      }
      if (node.forbidPattern && new RegExp(node.forbidPattern).test(value)) {
        fail(errors, path, 'contains a forbidden text pattern.');
        return undefined;
      }
      if (node.enum && !node.enum.includes(value)) {
        // `coerceEnum` turns an out-of-enum value (a common injection vector
        // and a common honest model slip) into the declared default rather
        // than failing the whole payload. Without it, an enum miss is an error.
        if (node.coerceEnum && Object.prototype.hasOwnProperty.call(node, 'default')) {
          return node.default;
        }
        fail(errors, path, `must be one of: ${node.enum.join(', ')}.`);
        return undefined;
      }
      return value;
    }
    case 'integer':
    case 'number': {
      const num = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (typeof num !== 'number' || !Number.isFinite(num)) {
        fail(errors, path, 'must be a number.');
        return undefined;
      }
      if (node.type === 'integer' && !Number.isInteger(num)) {
        fail(errors, path, 'must be an integer.');
        return undefined;
      }
      if (node.min != null && num < node.min) {
        fail(errors, path, `must be >= ${node.min}.`);
        return undefined;
      }
      if (node.max != null && num > node.max) {
        fail(errors, path, `must be <= ${node.max}.`);
        return undefined;
      }
      return num;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        fail(errors, path, 'must be a boolean.');
        return undefined;
      }
      return value;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        fail(errors, path, 'must be an array.');
        return undefined;
      }
      if (node.maxItems != null && value.length > node.maxItems) {
        fail(errors, path, `max ${node.maxItems} items.`);
        return undefined;
      }
      const out = [];
      value.forEach((item, i) => {
        const v = validateNode(item, node.of, `${path}[${i}]`, errors);
        if (v !== undefined) out.push(v);
      });
      return out;
    }
    case 'object': {
      if (!isPlainObject(value)) {
        fail(errors, path, 'must be an object.');
        return undefined;
      }
      const out = {};
      for (const [key, childNode] of Object.entries(node.fields)) {
        const v = validateNode(value[key], childNode, `${path}.${key}`, errors);
        if (v !== undefined) out[key] = v;
      }
      // Keys not declared in the schema are DROPPED, not carried through —
      // this is the core anti-injection property. Optionally flag them.
      if (node.allowExtra === 'error') {
        for (const key of Object.keys(value)) {
          if (!(key in node.fields)) fail(errors, path, `unexpected key "${key}".`);
        }
      }
      return out;
    }
    case 'record': {
      // A dynamic-keyed map: keys are model-chosen, every value validated by
      // `node.of`. Used where an `object` cannot be — e.g. a rating matrix
      // keyed by reviewer name. The keys themselves are untrusted, so:
      //  - prototype-pollution keys are rejected outright;
      //  - `node.keys` may bound key length / pattern / membership.
      if (!isPlainObject(value)) {
        fail(errors, path, 'must be an object.');
        return undefined;
      }
      const entries = Object.entries(value);
      if (node.maxEntries != null && entries.length > node.maxEntries) {
        fail(errors, path, `max ${node.maxEntries} entries.`);
        return undefined;
      }
      const keySpec = node.keys || {};
      const keyRe = keySpec.pattern ? new RegExp(keySpec.pattern) : null;
      const out = Object.create(null);
      for (const [key, childValue] of entries) {
        const keyPath = `${path}.${key}`;
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          fail(errors, keyPath, 'forbidden key.');
          continue;
        }
        if (keySpec.maxLength != null && key.length > keySpec.maxLength) {
          fail(errors, keyPath, `key exceeds ${keySpec.maxLength} characters.`);
          continue;
        }
        if (keyRe && !keyRe.test(key)) {
          fail(errors, keyPath, 'key does not match the allowed pattern.');
          continue;
        }
        if (keySpec.enum && !keySpec.enum.includes(key)) {
          fail(errors, keyPath, `key must be one of: ${keySpec.enum.join(', ')}.`);
          continue;
        }
        const v = validateNode(childValue, node.of, keyPath, errors);
        if (v !== undefined) out[key] = v;
      }
      // Return a plain object (callers JSON.stringify / spread it). The
      // null-prototype `out` above blocked pollution during assignment.
      return { ...out };
    }
    default:
      fail(errors, path, `unsupported schema node type "${node.type}".`);
      return undefined;
  }
}

/**
 * Validate a parsed LLM JSON object against a schema.
 *
 * @param {*} parsed - The already-JSON.parsed model output.
 * @param {object} schema - A schema node (typically `{ type: 'object', ... }`).
 * @param {object} [opts]
 * @param {string} [opts.path='$'] - Root path label for error messages.
 * @returns {{ ok: true, value: * } | { ok: false, errors: string[] }}
 */
export function validateAiJson(parsed, schema, { path = '$' } = {}) {
  const errors = [];
  const value = validateNode(parsed, schema, path, errors);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value };
}
