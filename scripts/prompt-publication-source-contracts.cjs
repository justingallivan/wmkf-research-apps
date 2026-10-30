/** Offline source-contract extraction. Restricted pure config modules only;
 * no services, environment, provider discovery, or unrestricted require.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const parser = require('@babel/parser');
const root = path.resolve(__dirname, '..');
const SPECS = [
  ['pre-site-visit.proposal-core.generate', 'pre-site-visit-proposal-core', 'PROMPT_VARIABLES', 'PROMPT_OUTPUT_SCHEMA', 'lib/services/pre-site-visit/artifact-model.js', { orderedMemos: true, exactBody: true, systemAssertions: 'REQUIRED_SYSTEM_ASSERTIONS', blockedReason: 'consumer_native_schema_unverified' }],
  ['review-synthesis.generate', 'review-synthesis', 'PROMPT_VARIABLES', 'PROMPT_OUTPUT_SCHEMA', 'lib/services/review-manager/synthesize-reviews-service.js', {}],
  ['initial-assessment.generate', 'initial-assessment', 'INITIAL_ASSESSMENT_PROMPT_VARIABLES', 'INITIAL_ASSESSMENT_PROMPT_OUTPUT_SCHEMA', 'lib/services/initial-assessment/artifact-service.js', { blockedReason: 'consumer_version_pinned' }],
  ['cycle-dossier.research-plan', 'cycle-dossier-research-plan', 'VARIABLES', 'OUTPUT_SCHEMA', 'lib/services/cycle-dossier-generation.js', { maxTokens: 16000 }],
  ['cycle-dossier.entry', 'cycle-dossier-entry', 'VARIABLES', 'OUTPUT_SCHEMA', 'lib/services/cycle-dossier-generation.js', { maxTokens: 16000 }],
  ['review-panel.seat', 'review-panel-seat', 'VARIABLES', 'OUTPUT_SCHEMA', 'lib/services/review-panel-generation.js', { maxTokens: 16000 }],
  ['review-panel.chair', 'review-panel-chair', 'VARIABLES', 'OUTPUT_SCHEMA', 'lib/services/review-panel-generation.js', { maxTokens: 16000 }],
  ['meeting-transcript.presentation-summary', 'meeting-presentation-summary', 'PROMPT_VARIABLES', 'PROMPT_OUTPUT_SCHEMA', 'lib/services/post-presentation-materials/transcript-summary-service.js', {}],
  ['meeting-transcript.staff-discussion-summary', 'meeting-staff-discussion-summary', 'PROMPT_VARIABLES', 'PROMPT_OUTPUT_SCHEMA', 'lib/services/post-presentation-materials/transcript-summary-service.js', {}],
  ['meeting-transcript.staff-discussion-sentiment', 'meeting-staff-discussion-sentiment', 'PROMPT_VARIABLES', 'PROMPT_OUTPUT_SCHEMA', 'lib/services/post-presentation-materials/discussion-sentiment-service.js', {}],
];
const allowed = new Set([...SPECS.map(s => `shared/config/prompts/${s[1]}.js`), 'shared/config/reviewPanelSeats.js', 'shared/config/executorBudgets.js']);
function load(file, cache = new Map()) {
  if (!allowed.has(file)) throw new Error(`Non-config extraction refused: ${file}`);
  if (cache.has(file)) return cache.get(file);
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = parser.parse(source, { sourceType: 'module' });
  const replacements = [], names = [];
  for (const node of ast.program.body) {
    if (node.type === 'ImportDeclaration') {
      const relative = path.relative(root, path.resolve(root, path.dirname(file), node.source.value));
      const dependency = relative.endsWith('.js') ? relative : relative + '.js';
      const bindings = node.specifiers.map(s => {
        if (s.type === 'ImportSpecifier') return `${s.imported.name}:${s.local.name}`;
        throw new Error('Unsupported config import');
      });
      replacements.push([node.start, node.end, `const {${bindings.join(',')}} = __load(${JSON.stringify(dependency)});`]);
    } else if (node.type === 'ExportNamedDeclaration') {
      if (!node.declaration) {
        if (node.source) throw new Error('Unsupported config re-export');
        replacements.push([node.start, node.end, node.specifiers.map(s => `exports.${s.exported.name} = ${s.local.name};`).join('\n')]);
        continue;
      }
      const d = node.declaration;
      if (d.type === 'VariableDeclaration') names.push(...d.declarations.map(v => v.id.name));
      else if (d.type === 'FunctionDeclaration') names.push(d.id.name);
      else throw new Error('Unsupported config declaration');
      replacements.push([node.start, d.start, '']);
    } else if (node.type === 'ExportDefaultDeclaration') throw new Error('Unsupported default export');
  }
  let code = source;
  for (const [start, end, value] of replacements.sort((a, b) => b[0] - a[0])) code = code.slice(0, start) + value + code.slice(end);
  code += '\n' + names.map(n => `exports.${n} = ${n};`).join('\n');
  const exports = {};
  cache.set(file, exports);
  vm.runInNewContext(code, { exports, __load: dep => load(dep, cache) }, { filename: file, timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } });
  return exports;
}
function extractConsumerContracts() {
  const contracts = {};
  for (const [name, leaf, variables, outputs, consumer, rules] of SPECS) {
    // Path presence/hash is an audit anchor, not an assertion that a seed is live.
    fs.accessSync(path.join(root, consumer));
    const file = `shared/config/prompts/${leaf}.js`, m = load(file);
    contracts[name] = {
      source: file, consumer,
      sourceHash: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'),
      consumerHash: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, consumer))).digest('hex'),
      variablesJson: JSON.stringify(m[variables]), outputJson: JSON.stringify(m[outputs]),
      orderedMemos: rules.orderedMemos || false,
      body: rules.exactBody ? m.USER_PROMPT_TEMPLATE : null,
      systemIncludes: rules.systemAssertions ? m[rules.systemAssertions] : [],
      rowMaxTokens: rules.maxTokens || null,
      blockedReason: rules.blockedReason || null,
      rootPassThrough: m[outputs].outputs.every(o => o.target.kind === 'none'),
      // Null only preserves omitted runtime temperature; never invent a model default.
      allowNullTemperature: true,
    };
    if (!contracts[name].variablesJson || !contracts[name].outputJson) throw new Error(`Incomplete consumer contract: ${name}`);
  }
  return contracts;
}
function extractBudgetRegistry() {
  const m = load('shared/config/executorBudgets.js');
  return JSON.parse(JSON.stringify({ schemaVersion: m.EXECUTOR_BUDGET_SCHEMA_VERSION, settingPrefix: m.EXECUTOR_BUDGET_SETTING_PREFIX, defaults: m.EXECUTOR_BUDGET_DEFAULTS, limits: m.EXECUTOR_BUDGET_LIMITS }));
}
module.exports = { extractConsumerContracts, extractBudgetRegistry };
