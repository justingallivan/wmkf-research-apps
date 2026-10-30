#!/usr/bin/env node
/** Offline extraction only. Never imports services, env, credentials or live model lists.
 * Run with --check to detect drift; regeneration is an explicit reviewed policy change.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const parser = require('@babel/parser');
const root = path.resolve(__dirname, '..');
function literal(node) {
  switch (node.type) {
    case 'StringLiteral': case 'NumericLiteral': case 'BooleanLiteral': return node.value;
    case 'NullLiteral': return null;
    case 'RegExpLiteral': return { source: node.pattern, flags: node.flags };
    case 'CallExpression':
      if (node.callee.type !== 'MemberExpression' || node.callee.object.name !== 'Object' || node.callee.property.name !== 'freeze' || node.arguments.length !== 1) throw new Error('Nonliteral call');
      return literal(node.arguments[0]);
    case 'ArrayExpression': return node.elements.map(literal);
    case 'ObjectExpression': return Object.fromEntries(node.properties.map(p => {
      if (p.type !== 'ObjectProperty' || p.computed || p.method) throw new Error('Nonliteral policy property');
      return [p.key.name ?? p.key.value, literal(p.value)];
    }));
    default: throw new Error(`Nonliteral policy expression: ${node.type}`);
  }
}
function extract(file, names) {
  const ast = parser.parse(fs.readFileSync(path.join(root, file), 'utf8'), { sourceType: 'module' });
  const found = {};
  for (const item of ast.program.body) {
    const node = item.type === 'ExportNamedDeclaration' ? item.declaration : item;
    if (node?.type !== 'VariableDeclaration') continue;
    for (const d of node.declarations) if (names.includes(d.id.name)) found[d.id.name] = literal(d.init);
  }
  for (const name of names) if (!Object.hasOwn(found, name)) throw new Error(`Missing ${file}:${name}`);
  return found;
}
const templates = extract('lib/utils/prompt-validators.js', ['A7_FORBIDDEN_PATTERNS', 'REVIEWER_PARSE_CONTRACTS', 'PROMPT_TEMPLATE_CONTRACTS']);
const { TIER_FALLBACK_IDS } = extract('lib/services/model-resolver.js', ['TIER_FALLBACK_IDS']);
const { MODEL_CAPABILITIES } = extract('lib/services/model-capabilities.js', ['MODEL_CAPABILITIES']);
const { MODEL_PRICING } = extract('lib/utils/model-pricing.js', ['MODEL_PRICING']);
const models = Object.fromEntries(Object.entries(MODEL_CAPABILITIES).filter(([id, c]) => id.startsWith('claude-') && c.provider === 'anthropic' && Object.hasOwn(MODEL_PRICING, id)));
for (const [id, capabilities] of Object.entries(models)) {
  if (!Number.isSafeInteger(capabilities.maxOutputTokens) || capabilities.maxOutputTokens <= 0
      || typeof capabilities.supportsStructuredOutput !== 'boolean') throw new Error(`Incomplete model policy: ${id}`);
}
// Resolve only the explicitly reviewed YYYYMMDD aliases used by frozen tiers.
for (const id of Object.values(TIER_FALLBACK_IDS)) {
  if (Object.hasOwn(models, id)) continue;
  const base = id.replace(/-\d{8}$/, '');
  if (base === id || !Object.hasOwn(models, base)) throw new Error(`Unreviewed tier: ${id}`);
  models[id] = models[base];
}
const { ADMIN_PROMPT_CATALOG } = extract('shared/config/adminPromptCatalog.js', ['ADMIN_PROMPT_CATALOG']);
const observed = JSON.parse(fs.readFileSync(path.join(root, 'docs/plans/evidence/shared-prompt-library-schema-2026-10-29.json'), 'utf8'));
const pendingConsumerNames = [...new Set([...Object.keys(ADMIN_PROMPT_CATALOG), ...observed.promptRows.map(r => r.name)])].sort();
if (pendingConsumerNames.some(name => typeof name !== 'string')) throw new Error('Invalid pending consumer key');
const schemaSourceHashes = Object.fromEntries(['json-contract.js', 'definition-schema.js', 'publication-contract.js', 'fingerprint.js'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'lib/prompt-publication', file))).digest('hex')]));
const policy = {
  policyVersion: 2, definitionFormatVersion: 1,
  scope: 'definition-contract-foundation',
  limits: { templateUtf16: 65536, nameUtf16: 850 },
  placeholder: { token: '\\{\\{[ \\t\\r\\n\\f\\v]*([A-Za-z0-9_]+)[ \\t\\r\\n\\f\\v]*\\}\\}', name: '[A-Za-z0-9_]+', matchMode: 'full-string' },
  forbiddenPatterns: templates.A7_FORBIDDEN_PATTERNS,
  reviewerContracts: templates.REVIEWER_PARSE_CONTRACTS,
  templateContracts: templates.PROMPT_TEMPLATE_CONTRACTS,
  tiers: TIER_FALLBACK_IDS, models,
  // Empty until each existing null-model consumer's actual default is extracted.
  defaultsByName: {}, templateOnlyByName: {}, pendingConsumerNames, schemaSourceHashes,
};
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
const sorted = canonical(policy);
const artifact = { hashAlgorithm: 'sha256-canonical-json-utf8-v1', hash: crypto.createHash('sha256').update(JSON.stringify(sorted), 'utf8').digest('hex'), policy: sorted };
const target = path.join(root, 'lib/prompt-publication/policy-v1.json');
const content = JSON.stringify(artifact, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== content) throw new Error('Policy source drift: review and regenerate artifact; never silently refresh deployed policy.');
  console.log('Prompt publication policy matches reviewed source.');
} else {
  fs.writeFileSync(target, content);
  console.log(`Wrote ${path.relative(root, target)} (${artifact.hash})`);
}
