/** Offline source-contract extraction. Fixed config modules and named seed
 * declaration slices only; no services, env, discovery or unrestricted require.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const parser = require('@babel/parser');
const root = path.resolve(__dirname, '..');
const SPECS = [
  ['pre-site-visit.proposal-core.generate', 'pre-site-visit-proposal-core', 'PROMPT_VARIABLES', 'PROMPT_OUTPUT_SCHEMA', 'lib/services/pre-site-visit/artifact-model.js', { orderedMemos: true, exactBody: true, systemAssertions: 'REQUIRED_SYSTEM_ASSERTIONS' }],
  ['review-synthesis.generate', 'review-synthesis', 'PROMPT_VARIABLES', 'PROMPT_OUTPUT_SCHEMA', 'lib/services/review-manager/synthesize-reviews-service.js', {}],
  ['initial-assessment.generate', 'initial-assessment', 'INITIAL_ASSESSMENT_PROMPT_VARIABLES', 'INITIAL_ASSESSMENT_PROMPT_OUTPUT_SCHEMA', 'lib/services/initial-assessment/artifact-service.js', { orderedMemos: true, dependencies: ['lib/services/initial-assessment/artifact-model.js', 'lib/services/test-requests/run-runner.js', 'shared/config/requestDocument.js'] }],
  ['cycle-dossier.research-plan', 'cycle-dossier-research-plan', 'VARIABLES', 'OUTPUT_SCHEMA', 'lib/services/cycle-dossier-generation.js', { maxTokens: 16000 }],
  ['cycle-dossier.entry', 'cycle-dossier-entry', 'VARIABLES', 'OUTPUT_SCHEMA', 'lib/services/cycle-dossier-generation.js', { maxTokens: 16000 }],
  ['review-panel.seat', 'review-panel-seat', 'VARIABLES', 'OUTPUT_SCHEMA', 'lib/services/review-panel-generation.js', { maxTokens: 16000 }],
  ['review-panel.chair', 'review-panel-chair', 'VARIABLES', 'OUTPUT_SCHEMA', 'lib/services/review-panel-generation.js', { maxTokens: 16000 }],
  ['meeting-transcript.presentation-summary', 'meeting-presentation-summary', 'PROMPT_VARIABLES', 'PROMPT_OUTPUT_SCHEMA', 'lib/services/post-presentation-materials/transcript-summary-service.js', {}],
  ['meeting-transcript.staff-discussion-summary', 'meeting-staff-discussion-summary', 'PROMPT_VARIABLES', 'PROMPT_OUTPUT_SCHEMA', 'lib/services/post-presentation-materials/transcript-summary-service.js', {}],
  ['meeting-transcript.staff-discussion-sentiment', 'meeting-staff-discussion-sentiment', 'PROMPT_VARIABLES', 'PROMPT_OUTPUT_SCHEMA', 'lib/services/post-presentation-materials/discussion-sentiment-service.js', {}],
];
const TOOL_SPECS = [
  ['expense-reporter-dynamics', 'pages/api/process-expenses.js'],
  ['expertise-finder-dynamics', 'pages/api/expertise-finder/match.js'],
  ['funding-gap-dynamics', 'pages/api/analyze-funding-gap.js'],
  ['literature-analyzer-dynamics', 'pages/api/analyze-literature.js'],
  ['multi-perspective-dynamics', 'pages/api/evaluate-multi-perspective.js'],
];
SPECS.push(
  ['grantee-title.generate', 'grantee-title', 'PROMPT_VARIABLES', 'PROMPT_OUTPUT_SCHEMA', 'lib/services/grantee-title-service.js', {}],
  ['grantee-abstract.generate', 'grantee-abstract', 'PROMPT_VARIABLES', 'PROMPT_OUTPUT_SCHEMA', 'lib/services/grantee-abstract-service.js', {}],
  ['meeting-transcript.speaker-alignment', 'meeting-speaker-alignment', 'PROMPT_VARIABLES', 'PROMPT_OUTPUT_SCHEMA', 'lib/services/meeting-tracker-transcription/alignment-service.js', {}],
  ['meeting-transcript.fragment-review', 'meeting-fragment-review', 'PROMPT_VARIABLES', 'PROMPT_OUTPUT_SCHEMA', 'lib/services/meeting-tracker-transcription/fragment-review.js', {}],
);
const allowed = new Set([...SPECS.map(s => `shared/config/prompts/${s[1]}.js`), 'shared/config/reviewPanelSeats.js', 'shared/config/executorBudgets.js', 'shared/config/keck-guidelines.js', ...TOOL_SPECS.map(s => `shared/config/prompts/${s[0]}.js`), ...['phase-i-dynamics','phase-ii-dynamics','peer-reviewer-dynamics','reviewer-finder-dynamics','field-primer'].map(s => `shared/config/prompts/${s}.js`)]);
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
      if (dependency === 'lib/utils/ai-payload-boundary.js') {
        // Runtime-only helpers must never execute during config extraction.
        replacements.push([node.start, node.end, node.specifiers.map(s => `const ${s.local.name} = () => { throw new Error('Runtime helper invoked during extraction'); };`).join('\n')]);
        continue;
      }
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
      ...(rules.dependencies ? { dependencyHashes: Object.fromEntries(rules.dependencies.map(file => [file, digest(file)])) } : {}),
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
  for (const [leaf, consumer] of TOOL_SPECS) {
    const file = `shared/config/prompts/${leaf}.js`;
    for (const row of load(file).TOOL_PROMPT_ROWS) {
      contracts[row.promptName] = {
        source: file, consumer,
        sourceHash: digest(file), consumerHash: digest(consumer),
        variablesJson: JSON.stringify(row.variables), outputJson: null,
        orderedMemos: false, body: row.body, systemIncludes: [],
        systemExact: row.systemPrompt, rowMaxTokens: null,
        blockedReason: null, rootPassThrough: false,
        allowNullTemperature: true, templateOnly: true,
      };
    }
  }
  const seeds = [
    ['seed-phase-i-summary-prompt.js', 'phase-i-dynamics', ['promptVariables','promptOutputSchema'], 'pages/api/phase-i-dynamics/summarize-v2.js', 'phase-i.summary'],
    ['seed-field-primer-prompt.js', 'field-primer', ['promptVariables','SECTION_KEYS','promptOutputSchema'], 'lib/services/field-primer-service.js', 'field-primer.generate'],
    ['seed-phase-ii-prompts.js', 'phase-ii-dynamics', ['MODEL','overrideVar','rows'], 'pages/api/process.js', null],
    ['seed-peer-review-summarizer-prompts.js', 'peer-reviewer-dynamics', ['MODEL','analyzeRow','questionsRow'], 'pages/api/process-peer-reviews.js', null],
    ['seed-reviewer-finder-prompts.js', 'reviewer-finder-dynamics', ['REVIEWER_FINDER_MODEL','analyzeRow','scoreRow'], 'lib/services/claude-reviewer-service.js', null],
    ['seed-echo-parity-prompt.js', null, ['PARITY_FILLER','SYSTEM_PROMPT','PROMPT_BODY','promptVariables','promptOutputSchema'], 'scripts/test-echo-parity.js', 'executor.echo-parity'],
  ];
  for (const [seed, leaf, names, consumer, single] of seeds) {
    const file = 'scripts/' + seed;
    const m = seedDeclarations(file, names, leaf ? load(`shared/config/prompts/${leaf}.js`) : {});
    const rows = single ? [{ promptName: single, variables: m.promptVariables, outputSchema: m.promptOutputSchema, body: m.USER_PROMPT_TEMPLATE || m.PROMPT_BODY, systemPrompt: m.SYSTEM_PROMPT }]
      : m.rows || [m.analyzeRow, m.questionsRow || m.scoreRow];
    for (const row of rows) {
      contracts[row.promptName] = {
        source: file, consumer, sourceHash: digest(file), consumerHash: digest(consumer),
        variablesJson: JSON.stringify(row.variables), outputJson: JSON.stringify(row.outputSchema),
        unusedDeclarations: row.variables.variables.filter(v => !new RegExp('\\{\\{\\s*' + v.name + '\\s*\\}\\}').test(row.body + row.systemPrompt)).map(v => v.name),
        orderedMemos: false, body: row.body, systemExact: row.systemPrompt,
        systemIncludes: [], rowMaxTokens: null, blockedReason: null,
        rootPassThrough: row.outputSchema.outputs.every(o => o.target.kind === 'none'), allowNullTemperature: true,
        ...(leaf ? { configSource: `shared/config/prompts/${leaf}.js`, configHash: digest(`shared/config/prompts/${leaf}.js`) } : {}),
      };
    }
  }
  return contracts;
}
// Execute ONLY named top-level declaration slices; never script imports, env
// loading, mode switches, bypass calls or write loops. Missing dependencies fail.
function seedDeclarations(file, names, bindings) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = parser.parse(source, { sourceType: 'module' });
  const slices = ast.program.body.filter(n => n.type === 'VariableDeclaration' && n.declarations.length === 1 && names.includes(n.declarations[0].id.name));
  if (slices.length !== names.length) throw new Error(`Missing seed declaration: ${file}`);
  const exports = { ...bindings };
  const code = slices.map(n => source.slice(n.start, n.end)).join('\n') + '\n' + names.map(n => `exports.${n} = ${n};`).join('\n');
  vm.runInNewContext(code, { ...bindings, exports }, { filename: file, timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } });
  return exports;
}
function digest(file) { return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'); }
function extractBudgetRegistry() {
  const m = load('shared/config/executorBudgets.js');
  return JSON.parse(JSON.stringify({ schemaVersion: m.EXECUTOR_BUDGET_SCHEMA_VERSION, settingPrefix: m.EXECUTOR_BUDGET_SETTING_PREFIX, defaults: m.EXECUTOR_BUDGET_DEFAULTS, limits: m.EXECUTOR_BUDGET_LIMITS }));
}
module.exports = { extractConsumerContracts, extractBudgetRegistry };
