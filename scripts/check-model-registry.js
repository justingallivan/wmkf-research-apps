#!/usr/bin/env node
/**
 * CI gate: configured Anthropic model ids must be reviewed before they can ship.
 *
 * Scans the static source-of-truth files without importing app modules:
 * - shared/config/baseConfig.js APP_MODELS + global Claude defaults
 * - lib/services/model-resolver.js TIER_FALLBACK_IDS
 * - lib/services/model-capabilities.js MODEL_CAPABILITIES
 * - lib/utils/model-pricing.js MODEL_PRICING
 *
 * Tier keys (opus/sonnet/haiku) are allowed in config, but every concrete id that
 * a tier can resolve to must have both a capability entry and a pricing entry.
 */

const fs = require('fs');
const path = require('path');
const babel = require('@babel/parser');

const TIER_KEYS = new Set(['opus', 'sonnet', 'haiku']);
const REQUIRED_CAPABILITY_FIELDS = [
  'provider',
  'family',
  'supportsTemperature',
  'supportsEffort',
  'thinkingMode',
  'maxInputTokens',
  'maxOutputTokens',
  'refusalSemantics',
  'requiresRefusalHandling',
  'dataRetentionClass',
  'reviewedAt',
  'source',
];

function parseArgs(argv) {
  let root = path.resolve(__dirname, '..');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') {
      const v = argv[i + 1];
      if (!v) throw new Error('--root requires a directory path');
      root = path.resolve(v);
      i++;
    }
  }
  return { root };
}

function read(root, rel) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) throw new Error(`missing required file: ${rel}`);
  return fs.readFileSync(file, 'utf8');
}

function parse(src, rel) {
  try {
    return babel.parse(src, {
      sourceType: 'unambiguous',
      errorRecovery: true,
      plugins: ['jsx', 'numericSeparator'],
    });
  } catch (e) {
    throw new Error(`parse error in ${rel}: ${e.message}`);
  }
}

function propName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'NumericLiteral') return String(node.value);
  return null;
}

function literal(node) {
  if (!node) return undefined;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'NumericLiteral') return node.value;
  if (node.type === 'BooleanLiteral') return node.value;
  if (node.type === 'NullLiteral') return null;
  if (node.type === 'ArrayExpression') return node.elements.map(literal);
  if (node.type === 'ObjectExpression') {
    const out = {};
    for (const p of node.properties || []) {
      if (p.type !== 'ObjectProperty') continue;
      const key = propName(p.key);
      if (!key) continue;
      out[key] = literal(p.value);
    }
    return out;
  }
  return undefined;
}

function findConstObject(root, rel, name) {
  const ast = parse(read(root, rel), rel);
  let found = null;
  (function walk(node) {
    if (!node || found) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator'
        && node.id?.type === 'Identifier'
        && node.id.name === name
        && node.init?.type === 'ObjectExpression') {
      found = literal(node.init);
      return;
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') walk(value);
    }
  })(ast.program);
  if (!found) throw new Error(`could not find object ${name} in ${rel}`);
  return found;
}

function matchesKnownPrefix(modelId, table) {
  if (Object.prototype.hasOwnProperty.call(table, modelId)) return true;
  const keys = Object.keys(table).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (!modelId.startsWith(key)) continue;
    const next = modelId[key.length];
    if (next === undefined || next === '-') return true;
  }
  return false;
}

function collectConfiguredModelValues(baseConfig) {
  const values = [];
  const claude = baseConfig.CLAUDE || {};
  for (const key of ['DEFAULT_MODEL', 'FALLBACK_MODEL']) {
    if (typeof claude[key] === 'string') {
      values.push({ source: `BASE_CONFIG.CLAUDE.${key}`, value: claude[key] });
    }
  }
  const apps = baseConfig.APP_MODELS || {};
  for (const [appKey, cfg] of Object.entries(apps)) {
    if (!cfg || typeof cfg !== 'object') continue;
    for (const type of ['model', 'visionModel', 'fallback']) {
      if (typeof cfg[type] === 'string') {
        values.push({ source: `BASE_CONFIG.APP_MODELS.${appKey}.${type}`, value: cfg[type] });
      }
    }
  }
  return values;
}

function validateCapabilityEntries(capabilities) {
  const errors = [];
  for (const [key, caps] of Object.entries(capabilities)) {
    if (!key.startsWith('claude-')) {
      errors.push(`MODEL_CAPABILITIES key "${key}" is not an Anthropic model id/prefix`);
    }
    for (const field of REQUIRED_CAPABILITY_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(caps, field) || caps[field] === undefined) {
        errors.push(`MODEL_CAPABILITIES["${key}"] missing required field "${field}"`);
      }
    }
    for (const field of ['supportsTemperature', 'supportsEffort', 'requiresRefusalHandling']) {
      if (typeof caps[field] !== 'boolean') {
        errors.push(`MODEL_CAPABILITIES["${key}"].${field} must be boolean`);
      }
    }
    if (typeof caps.reviewedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(caps.reviewedAt)) {
      errors.push(`MODEL_CAPABILITIES["${key}"].reviewedAt must be YYYY-MM-DD`);
    }
    if (typeof caps.source !== 'string' || !/^https?:\/\//.test(caps.source)) {
      errors.push(`MODEL_CAPABILITIES["${key}"].source must be an http(s) URL`);
    }
  }
  return errors;
}

function main() {
  const { root } = parseArgs(process.argv.slice(2));
  const baseConfig = findConstObject(root, 'shared/config/baseConfig.js', 'BASE_CONFIG');
  const tierFallbacks = findConstObject(root, 'lib/services/model-resolver.js', 'TIER_FALLBACK_IDS');
  const capabilities = findConstObject(root, 'lib/services/model-capabilities.js', 'MODEL_CAPABILITIES');
  const pricing = findConstObject(root, 'lib/utils/model-pricing.js', 'MODEL_PRICING');

  const errors = validateCapabilityEntries(capabilities);
  const configured = collectConfiguredModelValues(baseConfig);
  const concreteToCheck = [];

  for (const item of configured) {
    const value = item.value;
    if (TIER_KEYS.has(value)) continue;
    if (!value.startsWith('claude-')) continue;
    concreteToCheck.push(item);
  }

  for (const [tier, concrete] of Object.entries(tierFallbacks)) {
    if (!TIER_KEYS.has(tier)) {
      errors.push(`TIER_FALLBACK_IDS has unknown tier "${tier}"`);
    }
    if (typeof concrete !== 'string' || !concrete.startsWith('claude-')) {
      errors.push(`TIER_FALLBACK_IDS.${tier} must be a concrete Claude model id`);
      continue;
    }
    concreteToCheck.push({ source: `TIER_FALLBACK_IDS.${tier}`, value: concrete });
  }

  for (const { source, value } of concreteToCheck) {
    if (!matchesKnownPrefix(value, capabilities)) {
      errors.push(`${source} -> ${value} is missing from MODEL_CAPABILITIES`);
    }
    if (!matchesKnownPrefix(value, pricing)) {
      errors.push(`${source} -> ${value} is missing from MODEL_PRICING`);
    }
  }

  // Any reviewed first-party Claude capability must be priced too; otherwise the
  // registry can let a model ship while usage logging silently loses cost.
  for (const key of Object.keys(capabilities)) {
    if (!matchesKnownPrefix(key, pricing)) {
      errors.push(`MODEL_CAPABILITIES["${key}"] has no matching MODEL_PRICING entry`);
    }
  }

  if (errors.length > 0) {
    console.error(`model-registry check failed (${errors.length}):`);
    for (const e of errors) console.error(`- ${e}`);
    process.exit(1);
  }

  console.log(
    `model-registry OK: ${configured.length} configured value(s), ` +
    `${Object.keys(tierFallbacks).length} tier fallback(s), ` +
    `${Object.keys(capabilities).length} capability entr${Object.keys(capabilities).length === 1 ? 'y' : 'ies'}.`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
